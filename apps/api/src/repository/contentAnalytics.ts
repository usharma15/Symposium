import { TRPCError } from "@trpc/server";
import {
  contentAnalyticsQuerySchema,
  type ContentAnalyticsActorContract,
  type ContentAnalyticsPageContract,
  type ContentAnalyticsQuoteContract
} from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { actorHandle, ensureLiveData } from "./foundation";

type AnalyticsCursor = { occurredAt: string; id: string };
type SubjectRow = {
  subjectId: string;
  postId: string;
  title: string;
  authorHandle: string | null;
  metrics: Record<string, unknown> | null;
};

const encodeCursor = (occurredAt: Date | string, id: string) =>
  Buffer.from(JSON.stringify({
    occurredAt: new Date(occurredAt).toISOString(),
    id
  } satisfies AnalyticsCursor)).toString("base64url");

const decodeCursor = (cursor?: string): AnalyticsCursor | null => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<AnalyticsCursor>;
    if (
      !value.occurredAt ||
      Number.isNaN(Date.parse(value.occurredAt)) ||
      !value.id ||
      value.id.length > 240
    ) return null;
    return { occurredAt: new Date(value.occurredAt).toISOString(), id: value.id };
  } catch {
    return null;
  }
};

const metricNumber = (metrics: Record<string, unknown> | null, key: string) => {
  const value = Number(metrics?.[key] ?? 0);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
};

const loadOwnedSubject = async (
  subjectType: "post" | "comment",
  postId: string,
  commentId: string | undefined,
  handle: string
) => {
  const result = subjectType === "post"
    ? await getPool().query<SubjectRow>(
        `SELECT id AS "subjectId", id AS "postId", title, author_handle AS "authorHandle", metrics
         FROM posts
         WHERE id = $1 AND deleted_at IS NULL`,
        [postId]
      )
    : await getPool().query<SubjectRow>(
        `SELECT comment.id AS "subjectId", post.id AS "postId",
           ('Comment on ' || post.title) AS title,
           comment.author_handle AS "authorHandle", comment.metrics
         FROM comments comment
         INNER JOIN posts post ON post.id = comment.post_id
         WHERE post.id = $1 AND comment.id = $2
           AND post.deleted_at IS NULL AND comment.deleted_at IS NULL`,
        [postId, commentId]
      );
  const subject = result.rows[0];
  if (!subject) throw new TRPCError({ code: "NOT_FOUND", message: "Content not found." });
  if (subject.authorHandle !== handle) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can view private content analytics." });
  }
  return subject;
};

const quoteAccessSql = `
  AND (
    quoted_post.community_id IS NULL
    OR quoted_post.post_type = 'paper'
    OR quoted_community.visibility = 'public'
    OR EXISTS (
      SELECT 1
      FROM community_memberships membership
      WHERE membership.community_id = quoted_post.community_id
        AND membership.profile_handle = $2
        AND membership.status = 'active'
    )
  )`;

export const getContentAnalytics = async (
  postId: string,
  rawQuery: unknown,
  actor: Actor
): Promise<ContentAnalyticsPageContract> => {
  const query = contentAnalyticsQuerySchema.parse(rawQuery ?? {});
  const handle = actorHandle(actor);
  const cursor = decodeCursor(query.cursor);
  if (query.cursor && !cursor) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid analytics cursor." });
  }
  if (!hasDatabase()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Content analytics require the live database." });
  }
  await ensureLiveData();
  const subject = await loadOwnedSubject(query.subjectType, postId, query.commentId, handle);
  const actionTable = query.subjectType === "post" ? "post_actions" : "comment_actions";
  const subjectColumn = query.subjectType === "post" ? "post_id" : "comment_id";
  const counts = await getPool().query<{
    likes: number;
    reshares: number;
    saves: number;
    quotes: number;
  }>(
    `WITH action_counts AS (
       SELECT
         count(*) FILTER (WHERE action = 'signal' AND active)::int AS likes,
         count(*) FILTER (WHERE action = 'fork' AND active)::int AS reshares,
         count(*) FILTER (WHERE action = 'save' AND active)::int AS saves
       FROM ${actionTable}
       WHERE ${subjectColumn} = $1
     ),
     quote_count AS (
       SELECT count(*)::int AS quotes
       FROM (
         SELECT quoted_post.id
         FROM posts quoted_post
         LEFT JOIN communities quoted_community ON quoted_community.id = quoted_post.community_id
         WHERE quoted_post.deleted_at IS NULL
           AND quoted_post.room <> 'office'
           AND quoted_post.kind <> 'draft'
           AND quoted_post.quote ->> 'sourceType' = $3
           AND quoted_post.quote ->> 'sourceId' = $1
           ${quoteAccessSql}
         UNION ALL
         SELECT quoted_comment.id
         FROM comments quoted_comment
         INNER JOIN posts quoted_post ON quoted_post.id = quoted_comment.post_id
         LEFT JOIN communities quoted_community ON quoted_community.id = quoted_post.community_id
         WHERE quoted_comment.deleted_at IS NULL
           AND quoted_post.deleted_at IS NULL
           AND quoted_post.room <> 'office'
           AND quoted_post.kind <> 'draft'
           AND quoted_comment.quote ->> 'sourceType' = $3
           AND quoted_comment.quote ->> 'sourceId' = $1
           ${quoteAccessSql}
       ) accessible_quotes
     )
     SELECT action_counts.likes, action_counts.reshares, action_counts.saves, quote_count.quotes
     FROM action_counts CROSS JOIN quote_count`,
    [subject.subjectId, handle, query.subjectType]
  );
  const overview = {
    likes: counts.rows[0]?.likes ?? 0,
    reshares: counts.rows[0]?.reshares ?? 0,
    quotes: counts.rows[0]?.quotes ?? 0,
    saves: counts.rows[0]?.saves ?? 0,
    views: metricNumber(subject.metrics, "reads")
  };

  let actors: ContentAnalyticsActorContract[] = [];
  let quotes: ContentAnalyticsQuoteContract[] = [];
  let nextCursor: string | null = null;

  if (query.view === "likes" || query.view === "reshares") {
    const action = query.view === "likes" ? "signal" : "fork";
    const values: unknown[] = [subject.subjectId, action, query.query || null];
    const cursorCondition = cursor
      ? `AND (activity.updated_at, activity.actor_handle) < ($4::timestamptz, $5::text)`
      : "";
    if (cursor) values.push(cursor.occurredAt, cursor.id);
    values.push(query.limit + 1);
    const result = await getPool().query<{
      handle: string;
      name: string;
      avatarUrl: string | null;
      occurredAt: Date | string;
    }>(
      `SELECT profile.handle, profile.name, profile.avatar_url AS "avatarUrl",
         activity.updated_at AS "occurredAt"
       FROM ${actionTable} activity
       INNER JOIN profiles profile ON profile.handle = activity.actor_handle
       WHERE activity.${subjectColumn} = $1
         AND activity.action = $2
         AND activity.active = true
         AND ($3::text IS NULL OR profile.name ILIKE '%' || $3 || '%' OR profile.handle ILIKE '%' || $3 || '%')
         ${cursorCondition}
       ORDER BY activity.updated_at DESC, activity.actor_handle DESC
       LIMIT $${values.length}`,
      values
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    actors = rows.map((row) => ({
      handle: row.handle,
      name: row.name,
      ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
      occurredAt: new Date(row.occurredAt).toISOString()
    }));
    const last = rows.at(-1);
    nextCursor = hasMore && last ? encodeCursor(last.occurredAt, last.handle) : null;
  }

  if (query.view === "quotes") {
    const values: unknown[] = [
      subject.subjectId,
      handle,
      query.subjectType,
      query.query || null
    ];
    const cursorCondition = cursor
      ? `WHERE (quote_rows."occurredAt", quote_rows.id) < ($5::timestamptz, $6::text)`
      : "";
    if (cursor) values.push(cursor.occurredAt, cursor.id);
    values.push(query.limit + 1);
    const result = await getPool().query<{
      id: string;
      title: string;
      authorHandle: string;
      authorName: string;
      avatarUrl: string | null;
      href: string;
      occurredAt: Date | string;
    }>(
      `WITH quote_rows AS (
         SELECT quoted_post.id, quoted_post.title,
           profile.handle AS "authorHandle", profile.name AS "authorName",
           profile.avatar_url AS "avatarUrl",
           ('/posts/' || quoted_post.id) AS href,
           quoted_post.created_at AS "occurredAt"
         FROM posts quoted_post
         INNER JOIN profiles profile ON profile.handle = quoted_post.author_handle
         LEFT JOIN communities quoted_community ON quoted_community.id = quoted_post.community_id
         WHERE quoted_post.deleted_at IS NULL
           AND quoted_post.room <> 'office'
           AND quoted_post.kind <> 'draft'
           AND quoted_post.quote ->> 'sourceType' = $3
           AND quoted_post.quote ->> 'sourceId' = $1
           AND ($4::text IS NULL OR profile.name ILIKE '%' || $4 || '%' OR profile.handle ILIKE '%' || $4 || '%' OR quoted_post.title ILIKE '%' || $4 || '%')
           ${quoteAccessSql}
         UNION ALL
         SELECT quoted_comment.id,
           left(quoted_comment.body, 300) AS title,
           profile.handle AS "authorHandle", profile.name AS "authorName",
           profile.avatar_url AS "avatarUrl",
           ('/posts/' || quoted_post.id || '?comment=' || quoted_comment.id) AS href,
           quoted_comment.created_at AS "occurredAt"
         FROM comments quoted_comment
         INNER JOIN posts quoted_post ON quoted_post.id = quoted_comment.post_id
         INNER JOIN profiles profile ON profile.handle = quoted_comment.author_handle
         LEFT JOIN communities quoted_community ON quoted_community.id = quoted_post.community_id
         WHERE quoted_comment.deleted_at IS NULL
           AND quoted_post.deleted_at IS NULL
           AND quoted_post.room <> 'office'
           AND quoted_post.kind <> 'draft'
           AND quoted_comment.quote ->> 'sourceType' = $3
           AND quoted_comment.quote ->> 'sourceId' = $1
           AND ($4::text IS NULL OR profile.name ILIKE '%' || $4 || '%' OR profile.handle ILIKE '%' || $4 || '%' OR quoted_comment.body ILIKE '%' || $4 || '%')
           ${quoteAccessSql}
       )
       SELECT *
       FROM quote_rows
       ${cursorCondition}
       ORDER BY "occurredAt" DESC, id DESC
       LIMIT $${values.length}`,
      values
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    quotes = rows.map((row) => ({
      id: row.id,
      title: row.title,
      authorHandle: row.authorHandle,
      authorName: row.authorName,
      ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
      href: row.href,
      occurredAt: new Date(row.occurredAt).toISOString()
    }));
    const last = rows.at(-1);
    nextCursor = hasMore && last ? encodeCursor(last.occurredAt, last.id) : null;
  }

  return {
    subjectType: query.subjectType,
    subjectId: subject.subjectId,
    postId: subject.postId,
    title: subject.title,
    overview,
    actors,
    quotes,
    nextCursor
  };
};
