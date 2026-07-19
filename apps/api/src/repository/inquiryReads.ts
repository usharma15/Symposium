import { TRPCError } from "@trpc/server";
import {
  postPageQuerySchema,
  type BootstrapResponseContract,
  type InquiryItemContract,
  type PostPageQueryContract,
  type PostPageResponseContract,
  type ResearchProfileContract
} from "../../../../packages/contracts/src";
import { postTypeForItem } from "@/lib/postSemantics";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import {
  commentTreesFromRows,
  defaultProfile,
  ensureLiveData,
  getActiveAttachmentsByOwner,
  getPostConversationAttachments,
  json,
  listPublicCommunities,
  listPublicCommunityCallMap,
  publicProfile,
  rowToAttachment,
  rowToItem,
  seedSnapshot,
  type CommentRow,
  type SnapshotRow
} from "./foundation";

type PostCursor = { createdAt: string; id: string };
type FeedRow = SnapshotRow & { commentCount: number };
type ViewerActionRow = {
  subjectId: string;
  action: "save" | "signal" | "fork";
};

const selectedCommentFromRow = (
  row: CommentRow,
  attachments: Awaited<ReturnType<typeof getActiveAttachmentsByOwner>>
) => ({
  id: row.id,
  parentId: row.parentId,
  author: row.authorName,
  authorHandle: row.authorHandle ?? undefined,
  stance: row.stance,
  body: row.body,
  document: row.document ?? undefined,
  createdAt: new Date(row.createdAt).toISOString(),
  editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : undefined,
  deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : undefined,
  revision: row.revision,
  metrics: json(row.metrics, { signal: "0", forks: "0", saves: "0", reads: "0" }),
  savedBy: json(row.savedBy, [] as string[]),
  signaledBy: json(row.signaledBy, [] as string[]),
  forkedBy: json(row.forkedBy, [] as string[]),
  attachments: attachments.get(row.id),
  quote: json(row.quote, undefined),
  replies: []
});

const postColumns = `
  post.id,
  post.revision,
  post.kind,
  post.post_type AS "postType",
  post.room,
  post.community_id AS "communityId",
  post.title,
  post.author_handle AS "authorHandle",
  post.author_name AS "authorName",
  post.affiliation,
  post.date_label AS "dateLabel",
  post.created_at AS "createdAt",
  post.edited_at AS "editedAt",
  post.deleted_at AS "deletedAt",
  post.status,
  post.metrics,
  post.gathering_reason AS "gatheringReason",
  post.excerpt,
  post.body,
  post.content_document AS "document",
  post.tags,
  post.signals,
  post.claims,
  post.objections,
  post.evidence,
  post.tests,
  post.forks,
  post.saved,
  post.saved_by AS "savedBy",
  post.signaled_by AS "signaledBy",
  post.forked_by AS "forkedBy",
  post.quote,
  post.patronage,
  post.opportunity`;

const encodePostCursor = (row: Pick<FeedRow, "createdAt" | "id">) =>
  Buffer.from(JSON.stringify({
    createdAt: new Date(row.createdAt ?? 0).toISOString(),
    id: row.id
  } satisfies PostCursor)).toString("base64url");

export const decodePostCursor = (cursor?: string | null): PostCursor | null => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<PostCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !parsed.id ||
      parsed.id.length > 240
    ) return null;
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch {
    return null;
  }
};

const countComments = (comments: InquiryItemContract["comments"]): number =>
  comments.reduce((total, comment) => total + (comment.deletedAt ? 0 : 1) + countComments(comment.replies ?? []), 0);

const selectCommentsById = (
  comments: InquiryItemContract["comments"],
  selectedIds: ReadonlySet<string>
): InquiryItemContract["comments"] => {
  const selected: InquiryItemContract["comments"] = [];
  for (const comment of comments) {
    if (comment.id && selectedIds.has(comment.id) && !comment.deletedAt) {
      selected.push({ ...comment, replies: [] });
    }
    selected.push(...selectCommentsById(comment.replies ?? [], selectedIds));
  }
  return selected;
};

const localItemIsReadable = (
  item: InquiryItemContract,
  requesterHandle: string | null,
  query: PostPageQueryContract,
  communities: NonNullable<BootstrapResponseContract["communities"]>
) => {
  const isOwner = Boolean(requesterHandle && cleanHandle(item.authorHandle ?? "") === requesterHandle);
  if (query.authorHandle && (item.room === "office" || item.kind === "draft")) return false;
  if ((item.room === "office" || item.kind === "draft") && !isOwner) return false;
  if (item.communityId && item.postType !== "paper") {
    const community = communities.find((candidate) => candidate.id === item.communityId);
    const member = Boolean(requesterHandle && community?.memberHandles.some((handle) => cleanHandle(handle) === requesterHandle));
    if (community?.visibility !== "public" && !member && !isOwner) return false;
    if (!query.communityId && !query.authorHandle && !query.saved && !query.ids?.length && !query.commentIds?.length) return false;
  }
  return true;
};

const localPage = (
  rawQuery: unknown,
  rawRequesterHandle?: string | null
): PostPageResponseContract => {
  const query = postPageQuerySchema.parse(rawQuery ?? {});
  const requesterHandle = rawRequesterHandle ? cleanHandle(rawRequesterHandle) : null;
  const snapshot = seedSnapshot();
  const communities = snapshot.communities ?? [];
  const cursor = decodePostCursor(query.cursor);
  if (query.cursor && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid post cursor." });
  const requestedTypes = new Set(query.postTypes ?? (query.postType ? [query.postType] : []));
  const requestedIds = new Set(query.ids ?? []);
  const requestedCommentIds = new Set(query.commentIds ?? []);
  const sorted = [...snapshot.items]
    .filter((item) => !item.deletedAt)
    .filter((item) => localItemIsReadable(item, requesterHandle, query, communities))
    .filter((item) => !query.room || item.room === query.room)
    .filter((item) => !requestedTypes.size || requestedTypes.has(postTypeForItem(item) ?? "thought"))
    .filter((item) => !query.communityId || item.communityId === query.communityId)
    .filter((item) => !query.authorHandle || cleanHandle(item.authorHandle ?? "") === cleanHandle(query.authorHandle))
    .filter((item) => !query.saved || Boolean(requesterHandle && item.savedBy?.some((handle) => cleanHandle(handle) === requesterHandle)))
    .filter((item) => !query.following || Boolean(requesterHandle && cleanHandle(item.authorHandle ?? "") === requesterHandle))
    .filter((item) => !requestedIds.size || requestedIds.has(item.id))
    .filter((item) => requestedIds.size || !requestedCommentIds.size || selectCommentsById(item.comments, requestedCommentIds).length > 0)
    .filter((item) => {
      if (!cursor) return true;
      const createdAt = item.createdAt ?? "1970-01-01T00:00:00.000Z";
      return createdAt < cursor.createdAt || (createdAt === cursor.createdAt && item.id < cursor.id);
    })
    .sort((a, b) => {
      const time = Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "");
      return time || b.id.localeCompare(a.id);
    });
  const limit = query.ids?.length ? Math.min(query.ids.length, 50) : query.limit;
  const page = sorted.slice(0, limit + 1);
  const hasNextPage = page.length > limit;
  const visible = hasNextPage ? page.slice(0, limit) : page;
  const items = visible.map((item) => ({
    ...item,
    commentCount: countComments(item.comments),
    detailLoaded: false,
    comments: requestedCommentIds.size ? selectCommentsById(item.comments, requestedCommentIds) : [],
    attachments: item.attachments?.slice(0, 10),
    saved: Boolean(requesterHandle && item.savedBy?.some((handle) => cleanHandle(handle) === requesterHandle)),
    savedBy: requesterHandle && item.savedBy?.some((handle) => cleanHandle(handle) === requesterHandle) ? [requesterHandle] : [],
    signaledBy: requesterHandle && item.signaledBy?.some((handle) => cleanHandle(handle) === requesterHandle) ? [requesterHandle] : [],
    forkedBy: requesterHandle && item.forkedBy?.some((handle) => cleanHandle(handle) === requesterHandle) ? [requesterHandle] : []
  }));
  const handles = new Set(items.flatMap((item) => item.authorHandle ? [cleanHandle(item.authorHandle)] : []));
  if (requesterHandle) handles.add(requesterHandle);
  const profiles = Object.fromEntries(
    [...handles].flatMap((handle) => snapshot.profiles[handle] ? [[handle, publicProfile(snapshot.profiles[handle])]] : [])
  );
  const last = items.at(-1);
  return {
    items,
    profiles,
    nextCursor: hasNextPage && last ? encodePostCursor({ id: last.id, createdAt: last.createdAt }) : null
  };
};

export const listProfilesByHandles = async (rawHandles: string[]) => {
  const handles = Array.from(new Set(rawHandles.map(cleanHandle).filter((handle) => handle && handle !== "@"))).slice(0, 200);
  if (!handles.length) return {} as Record<string, ResearchProfileContract>;
  if (!hasDatabase()) {
    const profiles = seedSnapshot().profiles;
    return Object.fromEntries(handles.flatMap((handle) => profiles[handle] ? [[handle, publicProfile(profiles[handle])]] : []));
  }
  await ensureLiveData();
  const result = await getPool().query<ResearchProfileContract & { avatarUrl: string | null }>(
    `SELECT
       handle,
       name,
       avatar_url AS "avatarUrl",
       likes_public AS "likesPublic",
       reshares_public AS "resharesPublic",
       role,
       location,
       bio,
       fields,
       revision
     FROM profiles
     WHERE handle = ANY($1::text[])
     LIMIT 200`,
    [handles]
  );
  return Object.fromEntries(result.rows.map((person) => [person.handle, publicProfile({
    ...person,
    avatarUrl: person.avatarUrl ?? undefined
  })]));
};

const viewerActionsForPosts = async (postIds: string[], requesterHandle: string | null) => {
  const byPost = new Map<string, Set<ViewerActionRow["action"]>>();
  if (!postIds.length || !requesterHandle) return byPost;
  const result = await getPool().query<ViewerActionRow>(
    `SELECT post_id AS "subjectId", action
     FROM post_actions
     WHERE post_id = ANY($1::text[])
       AND actor_handle = $2
       AND active = true
       AND action IN ('save', 'signal', 'fork')`,
    [postIds, requesterHandle]
  );
  for (const row of result.rows) {
    const actions = byPost.get(row.subjectId) ?? new Set<ViewerActionRow["action"]>();
    actions.add(row.action);
    byPost.set(row.subjectId, actions);
  }
  return byPost;
};

const viewerActionsForComments = async (commentIds: string[], requesterHandle: string | null) => {
  const byComment = new Map<string, Set<ViewerActionRow["action"]>>();
  if (!commentIds.length || !requesterHandle) return byComment;
  const result = await getPool().query<ViewerActionRow>(
    `SELECT comment_id AS "subjectId", action
     FROM comment_actions
     WHERE comment_id = ANY($1::text[])
       AND actor_handle = $2
       AND active = true
       AND action IN ('save', 'signal', 'fork')`,
    [commentIds, requesterHandle]
  );
  for (const row of result.rows) {
    const actions = byComment.get(row.subjectId) ?? new Set<ViewerActionRow["action"]>();
    actions.add(row.action);
    byComment.set(row.subjectId, actions);
  }
  return byComment;
};

const previewAttachments = async (postIds: string[]) => {
  if (!postIds.length) return new Map<string, InquiryItemContract["attachments"]>();
  const result = await getPool().query<import("./foundation").AttachmentRow>(
    `WITH ranked AS (
       SELECT attachment.*, ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at ASC) AS rank
       FROM attachments attachment
       WHERE owner_type = 'post'
         AND owner_id = ANY($1::text[])
         AND status IN ('uploaded', 'previewed')
     )
     SELECT
       id::text,
       owner_id AS "ownerId",
       file_name AS "fileName",
       content_type AS "contentType",
       byte_size AS "byteSize",
       status,
       metadata,
       object_key AS "objectKey",
       created_at AS "createdAt"
     FROM ranked
     WHERE rank <= 10
     ORDER BY owner_id, created_at ASC`,
    [postIds]
  );
  const byPost = new Map<string, InquiryItemContract["attachments"]>();
  for (const row of result.rows) {
    if (!row.ownerId) continue;
    const attachment = rowToAttachment({ ...row, byteSize: Number(row.byteSize) });
    byPost.set(row.ownerId, [...(byPost.get(row.ownerId) ?? []), attachment]);
  }
  return byPost;
};

type HydratedPostSubjects = Pick<PostPageResponseContract, "items" | "profiles">;

const hydratePostRows = async (
  rows: FeedRow[],
  requestedCommentIds: string[],
  requesterHandle: string | null
): Promise<HydratedPostSubjects> => {
  const postIds = rows.map((row) => row.id);
  const [actionsByPost, attachmentsByPost, selectedCommentResult] = await Promise.all([
    viewerActionsForPosts(postIds, requesterHandle),
    previewAttachments(postIds),
    requestedCommentIds.length && postIds.length
      ? getPool().query<CommentRow>(
          `SELECT
             id,
             revision,
             post_id AS "postId",
             parent_id AS "parentId",
             author_handle AS "authorHandle",
             author_name AS "authorName",
             stance,
             body,
             content_document AS "document",
             metrics,
             saved_by AS "savedBy",
             signaled_by AS "signaledBy",
             forked_by AS "forkedBy",
             quote,
             edited_at AS "editedAt",
             deleted_at AS "deletedAt",
             created_at AS "createdAt"
           FROM comments
           WHERE id = ANY($1::text[])
             AND post_id = ANY($2::text[])
             AND deleted_at IS NULL
           ORDER BY created_at DESC, id DESC`,
          [requestedCommentIds, postIds]
        )
      : Promise.resolve({ rows: [] as CommentRow[] })
  ]);
  const selectedCommentIds = selectedCommentResult.rows.map((comment) => comment.id);
  const [actionsByComment, attachmentsByComment] = await Promise.all([
    viewerActionsForComments(selectedCommentIds, requesterHandle),
    getActiveAttachmentsByOwner(getPool(), "comment", selectedCommentIds)
  ]);
  const commentsByPost = new Map<string, ReturnType<typeof selectedCommentFromRow>[]>();
  for (const comment of selectedCommentResult.rows) {
    const actions = actionsByComment.get(comment.id) ?? new Set<ViewerActionRow["action"]>();
    const projected = selectedCommentFromRow({
      ...comment,
      savedBy: actions.has("save") && requesterHandle ? [requesterHandle] : [],
      signaledBy: actions.has("signal") && requesterHandle ? [requesterHandle] : [],
      forkedBy: actions.has("fork") && requesterHandle ? [requesterHandle] : []
    }, attachmentsByComment);
    commentsByPost.set(comment.postId, [...(commentsByPost.get(comment.postId) ?? []), projected]);
  }
  const items = rows.map((row) => {
    const actions = actionsByPost.get(row.id) ?? new Set<ViewerActionRow["action"]>();
    const item = rowToItem({
      ...row,
      saved: actions.has("save"),
      savedBy: actions.has("save") && requesterHandle ? [requesterHandle] : [],
      signaledBy: actions.has("signal") && requesterHandle ? [requesterHandle] : [],
      forkedBy: actions.has("fork") && requesterHandle ? [requesterHandle] : []
    }, commentsByPost.get(row.id) ?? [], attachmentsByPost.get(row.id));
    return { ...item, commentCount: row.commentCount, detailLoaded: false };
  });
  const profiles = await listProfilesByHandles([
    ...items.flatMap((item) => item.authorHandle ? [item.authorHandle] : []),
    ...selectedCommentResult.rows.flatMap((comment) => comment.authorHandle ? [comment.authorHandle] : []),
    ...(requesterHandle ? [requesterHandle] : [])
  ]);
  return { items, profiles };
};

export const listProfileActivitySubjects = async (
  rawPostIds: string[],
  rawCommentIds: string[],
  rawRequesterHandle?: string | null
): Promise<HydratedPostSubjects> => {
  const postIds = Array.from(new Set(rawPostIds.filter((id) => id && id.length <= 240))).slice(0, 100);
  const commentIds = Array.from(new Set(rawCommentIds.filter((id) => id && id.length <= 240))).slice(0, 100);
  if (!hasDatabase() || !postIds.length) return { items: [], profiles: {} };
  const requesterHandle = rawRequesterHandle ? cleanHandle(rawRequesterHandle) : null;
  await ensureLiveData();
  const result = await getPool().query<FeedRow>(
    `SELECT
       ${postColumns},
       COALESCE(comment_count.total, 0)::int AS "commentCount"
     FROM posts post
     LEFT JOIN communities community ON community.id = post.community_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS total FROM comments comment WHERE comment.post_id = post.id AND comment.deleted_at IS NULL
     ) comment_count ON true
     WHERE post.id = ANY($2::text[])
       AND post.deleted_at IS NULL
       AND ((post.room <> 'office' AND post.kind <> 'draft') OR ($1::text IS NOT NULL AND post.author_handle = $1))
       AND (post.community_id IS NULL OR post.post_type = 'paper' OR community.visibility = 'public'
         OR ($1::text IS NOT NULL AND post.author_handle = $1)
         OR EXISTS (
           SELECT 1 FROM community_memberships viewer
           WHERE viewer.community_id = post.community_id
             AND viewer.profile_handle = $1
             AND viewer.status = 'active'
         ))
     ORDER BY post.created_at DESC, post.id DESC
     LIMIT 100`,
    [requesterHandle, postIds]
  );
  return hydratePostRows(result.rows, commentIds, requesterHandle);
};

export const listPostPage = async (
  rawQuery: unknown,
  rawRequesterHandle?: string | null
): Promise<PostPageResponseContract> => {
  if (!hasDatabase()) return localPage(rawQuery, rawRequesterHandle);
  const query = postPageQuerySchema.parse(rawQuery ?? {});
  const requesterHandle = rawRequesterHandle ? cleanHandle(rawRequesterHandle) : null;
  const cursor = decodePostCursor(query.cursor);
  if (query.cursor && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid post cursor." });
  await ensureLiveData();

  const values: unknown[] = [requesterHandle];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions = [
    `post.deleted_at IS NULL`,
    `((post.room <> 'office' AND post.kind <> 'draft') OR ($1::text IS NOT NULL AND post.author_handle = $1))`,
    `(post.community_id IS NULL OR post.post_type = 'paper' OR community.visibility = 'public'
      OR ($1::text IS NOT NULL AND post.author_handle = $1)
      OR EXISTS (
        SELECT 1 FROM community_memberships viewer
        WHERE viewer.community_id = post.community_id
          AND viewer.profile_handle = $1
          AND viewer.status = 'active'
      ))`
  ];
  if (query.room) conditions.push(`post.room = ${bind(query.room)}`);
  const postTypes = query.postTypes ?? (query.postType ? [query.postType] : []);
  if (postTypes.length) conditions.push(`post.post_type = ANY(${bind(postTypes)}::text[])`);
  if (query.communityId) conditions.push(`post.community_id = ${bind(query.communityId)}`);
  if (query.authorHandle) {
    conditions.push(`post.author_handle = ${bind(cleanHandle(query.authorHandle))}`);
    conditions.push(`post.room <> 'office' AND post.kind <> 'draft'`);
  }
  if (query.saved) {
    conditions.push(`$1::text IS NOT NULL AND EXISTS (
      SELECT 1 FROM post_actions saved_action
      WHERE saved_action.post_id = post.id
        AND saved_action.actor_handle = $1
        AND saved_action.action = 'save'
        AND saved_action.active = true
    )`);
  }
  if (query.following) {
    conditions.push(`$1::text IS NOT NULL AND (
      post.author_handle = $1 OR EXISTS (
        SELECT 1 FROM profile_follows followed
        WHERE followed.follower_handle = $1
          AND followed.following_handle = post.author_handle
          AND followed.status = 'active'
      )
    )`);
  }
  if (query.ids?.length) conditions.push(`post.id = ANY(${bind(query.ids)}::text[])`);
  if (query.commentIds?.length && !query.ids?.length) {
    conditions.push(`EXISTS (
      SELECT 1 FROM comments selected_comment
      WHERE selected_comment.post_id = post.id
        AND selected_comment.id = ANY(${bind(query.commentIds)}::text[])
        AND selected_comment.deleted_at IS NULL
    )`);
  }
  if (!query.communityId && !query.authorHandle && !query.saved && !query.ids?.length && !query.commentIds?.length) {
    conditions.push(`(post.community_id IS NULL OR post.post_type = 'paper')`);
  }
  if (cursor) {
    const createdAtParameter = bind(cursor.createdAt);
    const idParameter = bind(cursor.id);
    conditions.push(`(post.created_at, post.id) < (${createdAtParameter}::timestamptz, ${idParameter}::text)`);
  }
  const limit = query.ids?.length ? Math.min(query.ids.length, 50) : query.limit;
  const limitParameter = bind(limit + 1);
  const result = await getPool().query<FeedRow>(
    `SELECT
       ${postColumns},
       COALESCE(comment_count.total, 0)::int AS "commentCount"
     FROM posts post
     LEFT JOIN communities community ON community.id = post.community_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS total FROM comments comment WHERE comment.post_id = post.id AND comment.deleted_at IS NULL
     ) comment_count ON true
     WHERE ${conditions.join("\n       AND ")}
     ORDER BY post.created_at DESC, post.id DESC
     LIMIT ${limitParameter}`,
    values
  );
  const hasNextPage = !query.ids?.length && result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const hydrated = await hydratePostRows(rows, query.commentIds ?? [], requesterHandle);
  const last = rows.at(-1);
  return {
    ...hydrated,
    nextCursor: hasNextPage && last ? encodePostCursor(last) : null
  };
};

export const listPublicProfiles = async (rawLimit: unknown = 50, rawQuery: unknown = "") => {
  const numericLimit = typeof rawLimit === "string" ? Number(rawLimit) : rawLimit;
  const limit = Number.isInteger(numericLimit) ? Math.max(1, Math.min(Number(numericLimit), 50)) : 50;
  const query = typeof rawQuery === "string" ? rawQuery.trim().slice(0, 120) : "";
  if (!hasDatabase()) {
    const normalizedQuery = query.toLocaleLowerCase().replace(/^@/, "");
    return Object.fromEntries(Object.entries(seedSnapshot().profiles)
      .filter(([handle, person]) => !normalizedQuery
        || cleanHandle(handle).toLocaleLowerCase().includes(normalizedQuery)
        || person.name.toLocaleLowerCase().includes(normalizedQuery))
      .sort(([leftHandle, left], [rightHandle, right]) => {
        if (!normalizedQuery) return 0;
        const leftCleanHandle = cleanHandle(leftHandle).toLocaleLowerCase();
        const rightCleanHandle = cleanHandle(rightHandle).toLocaleLowerCase();
        const leftName = left.name.toLocaleLowerCase();
        const rightName = right.name.toLocaleLowerCase();
        const score = (handle: string, name: string) => handle === normalizedQuery ? 0
          : name === normalizedQuery ? 1
            : handle.startsWith(normalizedQuery) ? 2
              : name.startsWith(normalizedQuery) ? 3
                : 4;
        return score(leftCleanHandle, leftName) - score(rightCleanHandle, rightName)
          || left.name.localeCompare(right.name)
          || leftCleanHandle.localeCompare(rightCleanHandle);
      })
      .slice(0, limit)
      .map(([handle, person]) => [handle, publicProfile(person)]));
  }
  await ensureLiveData();
  const normalizedQuery = query.replace(/^@/, "");
  const escapedQuery = normalizedQuery.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escapedQuery}%`;
  const prefix = `${escapedQuery}%`;
  const result = await getPool().query<ResearchProfileContract & { avatarUrl: string | null }>(
    `SELECT
       handle,
       name,
       avatar_url AS "avatarUrl",
       likes_public AS "likesPublic",
       reshares_public AS "resharesPublic",
       role,
       location,
       bio,
       fields,
       revision
     FROM profiles
     WHERE $2::text = ''
        OR name ILIKE $3 ESCAPE '\\'
        OR handle ILIKE $3 ESCAPE '\\'
     ORDER BY
       CASE
         WHEN $2::text <> '' AND lower(handle) = lower($2) THEN 0
         WHEN $2::text <> '' AND lower(name) = lower($2) THEN 1
         WHEN $2::text <> '' AND handle ILIKE $4 ESCAPE '\\' THEN 2
         WHEN $2::text <> '' AND name ILIKE $4 ESCAPE '\\' THEN 3
         ELSE 4
       END,
       CASE WHEN $2::text = '' THEN updated_at END DESC,
       name ASC,
       handle ASC
     LIMIT $1`,
    [limit, normalizedQuery, pattern, prefix]
  );
  return Object.fromEntries(result.rows.map((person) => [person.handle, publicProfile({
    ...person,
    avatarUrl: person.avatarUrl ?? undefined
  })]));
};

export const getPostDetail = async (postId: string, rawRequesterHandle?: string | null) => {
  const requesterHandle = rawRequesterHandle ? cleanHandle(rawRequesterHandle) : null;
  if (!hasDatabase()) {
    const snapshot = seedSnapshot();
    const item = snapshot.items.find((candidate) => candidate.id === postId);
    if (!item || !localItemIsReadable(item, requesterHandle, { limit: 1, ids: [postId] }, snapshot.communities ?? [])) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    const detail = {
      ...item,
      commentCount: countComments(item.comments),
      detailLoaded: true,
      saved: Boolean(requesterHandle && item.savedBy?.some((handle) => cleanHandle(handle) === requesterHandle)),
      savedBy: requesterHandle && item.savedBy?.some((handle) => cleanHandle(handle) === requesterHandle) ? [requesterHandle] : [],
      signaledBy: requesterHandle && item.signaledBy?.some((handle) => cleanHandle(handle) === requesterHandle) ? [requesterHandle] : [],
      forkedBy: requesterHandle && item.forkedBy?.some((handle) => cleanHandle(handle) === requesterHandle) ? [requesterHandle] : []
    };
    const profiles = await listProfilesByHandles([
      ...(detail.authorHandle ? [detail.authorHandle] : []),
      ...detail.comments.flatMap(function commentHandles(comment): string[] {
        return [...(comment.authorHandle ? [comment.authorHandle] : []), ...(comment.replies ?? []).flatMap(commentHandles)];
      }),
      ...(requesterHandle ? [requesterHandle] : [])
    ]);
    return { item: detail, profiles };
  }

  await ensureLiveData();
  const postResult = await getPool().query<FeedRow>(
    `SELECT
       ${postColumns},
       COALESCE(comment_count.total, 0)::int AS "commentCount"
     FROM posts post
     LEFT JOIN communities community ON community.id = post.community_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS total FROM comments comment WHERE comment.post_id = post.id AND comment.deleted_at IS NULL
     ) comment_count ON true
     WHERE post.id = $1
       AND post.deleted_at IS NULL
       AND ((post.room <> 'office' AND post.kind <> 'draft') OR ($2::text IS NOT NULL AND post.author_handle = $2))
       AND (post.community_id IS NULL OR post.post_type = 'paper' OR community.visibility = 'public'
         OR ($2::text IS NOT NULL AND post.author_handle = $2)
         OR EXISTS (
           SELECT 1 FROM community_memberships viewer
           WHERE viewer.community_id = post.community_id
             AND viewer.profile_handle = $2
             AND viewer.status = 'active'
         ))
     LIMIT 1`,
    [postId, requesterHandle]
  );
  const row = postResult.rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
  const commentsResult = await getPool().query<CommentRow>(
    `SELECT
       id,
       revision,
       post_id AS "postId",
       parent_id AS "parentId",
       author_handle AS "authorHandle",
       author_name AS "authorName",
       stance,
       body,
       content_document AS "document",
       metrics,
       saved_by AS "savedBy",
       signaled_by AS "signaledBy",
       forked_by AS "forkedBy",
       quote,
       edited_at AS "editedAt",
       deleted_at AS "deletedAt",
       created_at AS "createdAt"
     FROM comments
     WHERE post_id = $1
     ORDER BY created_at ASC`,
    [postId]
  );
  const commentIds = commentsResult.rows.map((comment) => comment.id);
  const [postActions, commentActions, [commentAttachments, postAttachments]] = await Promise.all([
    viewerActionsForPosts([postId], requesterHandle),
    requesterHandle && commentIds.length
      ? getPool().query<ViewerActionRow>(
          `SELECT comment_id AS "subjectId", action
           FROM comment_actions
           WHERE comment_id = ANY($1::text[])
             AND actor_handle = $2
             AND active = true
             AND action IN ('save', 'signal', 'fork')`,
          [commentIds, requesterHandle]
        )
      : Promise.resolve({ rows: [] as ViewerActionRow[] }),
    getPostConversationAttachments(getPool(), postId, commentsResult.rows)
  ]);
  const actionsByComment = new Map<string, Set<ViewerActionRow["action"]>>();
  for (const action of commentActions.rows) {
    const actions = actionsByComment.get(action.subjectId) ?? new Set<ViewerActionRow["action"]>();
    actions.add(action.action);
    actionsByComment.set(action.subjectId, actions);
  }
  const projectedComments = commentsResult.rows.map((comment) => {
    const actions = actionsByComment.get(comment.id) ?? new Set<ViewerActionRow["action"]>();
    return {
      ...comment,
      savedBy: actions.has("save") && requesterHandle ? [requesterHandle] : [],
      signaledBy: actions.has("signal") && requesterHandle ? [requesterHandle] : [],
      forkedBy: actions.has("fork") && requesterHandle ? [requesterHandle] : []
    };
  });
  const actions = postActions.get(postId) ?? new Set<ViewerActionRow["action"]>();
  const commentsByPost = commentTreesFromRows(projectedComments, commentAttachments);
  const item = {
    ...rowToItem({
      ...row,
      saved: actions.has("save"),
      savedBy: actions.has("save") && requesterHandle ? [requesterHandle] : [],
      signaledBy: actions.has("signal") && requesterHandle ? [requesterHandle] : [],
      forkedBy: actions.has("fork") && requesterHandle ? [requesterHandle] : []
    }, commentsByPost.get(postId) ?? [], postAttachments.get(postId) ?? []),
    commentCount: row.commentCount,
    detailLoaded: true
  };
  const profiles = await listProfilesByHandles([
    ...(item.authorHandle ? [item.authorHandle] : []),
    ...commentsResult.rows.flatMap((comment) => comment.authorHandle ? [comment.authorHandle] : []),
    ...(requesterHandle ? [requesterHandle] : [])
  ]);
  return { item, profiles };
};

export const getBoundedBootstrap = async (rawRequesterHandle?: string | null): Promise<BootstrapResponseContract> => {
  const requesterHandle = rawRequesterHandle ? cleanHandle(rawRequesterHandle) : null;
  const [recent, communities] = await Promise.all([
    listPostPage({ postTypes: ["paper", "thought", "proposal", "opportunity"], limit: 24 }, requesterHandle),
    listPublicCommunities(requesterHandle)
  ]);
  const profiles = { ...recent.profiles };
  const requiredProfiles = await listProfilesByHandles([
    defaultProfile.handle,
    ...(requesterHandle ? [requesterHandle] : [])
  ]);
  Object.assign(profiles, requiredProfiles);
  const fallbackProfile = profiles[defaultProfile.handle] ?? publicProfile(defaultProfile);
  const communityCalls = await listPublicCommunityCallMap(communities, requesterHandle);
  return {
    profiles,
    items: recent.items,
    communities,
    communityCalls,
    defaultProfile: fallbackProfile,
    nextCursor: recent.nextCursor,
    readModelVersion: 2
  };
};
