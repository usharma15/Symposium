import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type {
  BootstrapResponseContract,
  CommunityCallContract,
  CreateProfileInputContract,
  InquiryCommentContract,
  InquiryItemContract,
  OpportunityContract,
  ResearchCommunityContract,
  ResearchProfileContract
} from "../../../../packages/contracts/src";
import {
  getProfileForName,
  inquiryItems,
  profile,
  profilesByName,
  researchCommunities
} from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import { ensureDatabase } from "../db/migrate";

export const defaultProfile = profile;

export type SnapshotRow = Omit<InquiryItemContract, "author" | "date" | "comments"> & {
  authorHandle: string | null;
  authorName: string;
  dateLabel: string;
  comments?: InquiryCommentContract[];
};

export type CommentRow = {
  id: string;
  postId: string;
  parentId: string | null;
  authorHandle: string | null;
  authorName: string;
  stance: string;
  body: string;
  createdAt: string;
};

let seedReady: Promise<void> | null = null;

export const json = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const nowLabel = () =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());

export const searchablePostText = (item: {
  title: string;
  body: string;
  excerpt?: string;
  tags?: string[];
  authorName?: string;
}) => [item.title, item.body, item.excerpt, item.authorName, ...(item.tags ?? [])].filter(Boolean).join(" ");

export const normalizeProfile = (input: CreateProfileInputContract): ResearchProfileContract => ({
  name: input.name.trim(),
  handle: cleanHandle(input.handle),
  email: input.email?.trim().toLowerCase() || undefined,
  role: input.role?.trim() || "Symposium participant",
  location: input.location?.trim() || "Public rooms",
  bio: input.bio?.trim() || "A participant in the current inquiry thread.",
  fields: input.fields.map((field) => field.trim()).filter(Boolean).slice(0, 8)
});

export const actorHandle = (actor: { handle?: string }, requestedHandle?: string) =>
  actor.handle ?? (requestedHandle ? cleanHandle(requestedHandle) : defaultProfile.handle);

export const ensureProfileHandle = async (handle: string) => {
  const clean = cleanHandle(handle);
  if (!hasDatabase()) return clean;
  await ensureLiveData();

  const existing = await getPool().query<{ handle: string }>(
    "SELECT handle FROM profiles WHERE handle = $1 LIMIT 1",
    [clean]
  );

  if (!existing.rowCount) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found." });
  }

  return clean;
};

export const callRowToContract = (row: {
  id: string;
  communityId: string;
  hostHandle: string | null;
  title: string;
  kind: string;
  status: string;
  startsAt: Date | string | null;
  endedAt: Date | string | null;
  provider: string | null;
  providerRoomId: string | null;
  participantHandles?: unknown;
}): CommunityCallContract => ({
  id: row.id,
  communityId: row.communityId,
  hostHandle: row.hostHandle ?? undefined,
  title: row.title,
  kind: row.kind === "video" ? "video" : "voice",
  status: ["scheduled", "live", "ended", "cancelled"].includes(row.status)
    ? (row.status as CommunityCallContract["status"])
    : "scheduled",
  startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : undefined,
  endedAt: row.endedAt ? new Date(row.endedAt).toISOString() : undefined,
  provider: row.provider ?? undefined,
  providerRoomId: row.providerRoomId ?? undefined,
  participantHandles: json(row.participantHandles, [])
});

export const opportunityRowToContract = (row: {
  id: string;
  title: string;
  body: string;
  kind: string;
  status: string;
  creatorHandle: string | null;
  communityId: string | null;
  location: string | null;
  compensation: string | null;
  tags: unknown;
  createdAt?: Date | string | null;
}): OpportunityContract => ({
  id: row.id,
  title: row.title,
  body: row.body,
  kind: ["job", "bounty", "collaboration", "grant", "internship"].includes(row.kind)
    ? (row.kind as OpportunityContract["kind"])
    : "job",
  status: ["open", "closed", "draft"].includes(row.status)
    ? (row.status as OpportunityContract["status"])
    : "open",
  creatorHandle: row.creatorHandle ?? undefined,
  communityId: row.communityId ?? undefined,
  location: row.location ?? undefined,
  compensation: row.compensation ?? undefined,
  tags: json(row.tags, []),
  createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined
});

const seedProfiles = () => {
  const people = new Map<string, ResearchProfileContract>();
  for (const person of Object.values(profilesByName)) {
    const publicPerson = person as ResearchProfileContract;
    people.set(person.handle, {
      ...person,
      likesPublic: publicPerson.likesPublic ?? true,
      resharesPublic: publicPerson.resharesPublic ?? true
    });
  }
  people.set(defaultProfile.handle, {
    ...defaultProfile,
    likesPublic: true,
    resharesPublic: true
  });
  return [...people.values()];
};

const normalizeComments = (
  comments: InquiryCommentContract[],
  itemId: string,
  itemIndex: number,
  parentId: string | null = null
): InquiryCommentContract[] =>
  comments.map((comment, commentIndex) => {
    const id = comment.id ?? `${itemId}-comment-${itemIndex}-${parentId ?? "root"}-${commentIndex}`;
    return {
      ...comment,
      id,
      parentId,
      authorHandle: comment.authorHandle ?? getProfileForName(comment.author).handle,
      createdAt: comment.createdAt ?? "Seeded",
      replies: normalizeComments(comment.replies ?? [], itemId, itemIndex, id)
    };
  });

export const seedSnapshot = (): BootstrapResponseContract => {
  const profiles = Object.fromEntries(seedProfiles().map((person) => [person.handle, person]));
  const items = inquiryItems.map((item, itemIndex) => {
    const author = getProfileForName(item.author);
    return {
      ...item,
      authorHandle: item.authorHandle ?? author.handle,
      comments: normalizeComments(item.comments, item.id, itemIndex),
      savedBy: item.savedBy ?? (item.saved ? [defaultProfile.handle] : []),
      signaledBy: item.signaledBy ?? [],
      forkedBy: item.forkedBy ?? []
    };
  });

  return {
    profiles,
    items,
    communities: researchCommunities,
    defaultProfile
  };
};

export const insertProfile = async (
  client: PoolClient,
  person: ResearchProfileContract,
  userId?: string | null
) => {
  await client.query(
    `INSERT INTO profiles (
      handle, user_id, email, name, avatar_url, likes_public, reshares_public, role, location, bio, fields
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (handle) DO UPDATE SET
      user_id = COALESCE(EXCLUDED.user_id, profiles.user_id),
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      avatar_url = EXCLUDED.avatar_url,
      likes_public = EXCLUDED.likes_public,
      reshares_public = EXCLUDED.reshares_public,
      role = EXCLUDED.role,
      location = EXCLUDED.location,
      bio = EXCLUDED.bio,
      fields = EXCLUDED.fields,
      updated_at = now()`,
    [
      person.handle,
      userId ?? null,
      person.email ?? null,
      person.name,
      person.avatarUrl ?? null,
      person.likesPublic ?? true,
      person.resharesPublic ?? true,
      person.role,
      person.location,
      person.bio,
      JSON.stringify(person.fields)
    ]
  );
};

const insertCommentTree = async (
  client: PoolClient,
  postId: string,
  comments: InquiryCommentContract[]
) => {
  for (const comment of comments) {
    const author = getProfileForName(comment.author);
    await client.query(
      `INSERT INTO comments (id, post_id, parent_id, author_handle, author_name, stance, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        comment.id ?? newId("comment"),
        postId,
        comment.parentId ?? null,
        comment.authorHandle ?? author.handle,
        comment.author,
        comment.stance,
        comment.body
      ]
    );
    await insertCommentTree(client, postId, comment.replies ?? []);
  }
};

const seedDatabase = async () => {
  if (!hasDatabase() || env.SYMPOSIUM_SEED_ON_BOOT === false) return;
  await ensureDatabase();

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existing = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM posts");
    if (Number(existing.rows[0]?.count ?? 0) > 0) {
      await client.query("COMMIT");
      return;
    }

    for (const person of seedProfiles()) {
      await insertProfile(client, person);
    }

    for (const community of researchCommunities) {
      await client.query(
        `INSERT INTO communities (
          id, name, field, summary, visibility, online, member_handles, keywords, seed_counts, call_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          field = EXCLUDED.field,
          summary = EXCLUDED.summary,
          visibility = EXCLUDED.visibility,
          online = EXCLUDED.online,
          member_handles = EXCLUDED.member_handles,
          keywords = EXCLUDED.keywords,
          seed_counts = EXCLUDED.seed_counts,
          call_status = EXCLUDED.call_status,
          updated_at = now()`,
        [
          community.id,
          community.name,
          community.field,
          community.summary,
          community.visibility,
          community.online,
          JSON.stringify(community.memberHandles),
          JSON.stringify(community.keywords),
          JSON.stringify(community.seedCounts),
          community.callStatus
        ]
      );

      for (const handle of community.memberHandles) {
        await client.query(
          `INSERT INTO community_memberships (community_id, profile_handle, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (community_id, profile_handle) DO NOTHING`,
          [community.id, handle, handle === defaultProfile.handle ? "owner" : "member"]
        );
      }

      for (const channel of ["feed", "papers", "calls", "bounties", "notes", "members"]) {
        await client.query(
          `INSERT INTO community_channels (community_id, kind, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (community_id, kind, name) DO NOTHING`,
          [community.id, channel, channel]
        );
      }
    }

    for (const [itemIndex, item] of inquiryItems.entries()) {
      const author = getProfileForName(item.author);
      const comments = normalizeComments(item.comments, item.id, itemIndex);
      await client.query(
        `INSERT INTO posts (
          id, kind, room, title, author_handle, author_name, affiliation, date_label, status,
          metrics, gathering_reason, excerpt, body, tags, signals, claims, objections, evidence,
          tests, forks, saved, saved_by, signaled_by, forked_by, search_text
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24, $25
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          item.id,
          item.kind,
          item.room,
          item.title,
          item.authorHandle ?? author.handle,
          item.author,
          item.affiliation,
          item.date,
          item.status,
          JSON.stringify(item.metrics),
          item.gatheringReason,
          item.excerpt,
          item.body,
          JSON.stringify(item.tags),
          JSON.stringify(item.signals),
          JSON.stringify(item.claims),
          JSON.stringify(item.objections),
          JSON.stringify(item.evidence),
          JSON.stringify(item.tests),
          JSON.stringify(item.forks),
          Boolean(item.saved),
          JSON.stringify(item.savedBy ?? (item.saved ? [defaultProfile.handle] : [])),
          JSON.stringify(item.signaledBy ?? []),
          JSON.stringify(item.forkedBy ?? []),
          searchablePostText({ ...item, authorName: item.author })
        ]
      );
      await insertCommentTree(client, item.id, comments);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const ensureLiveData = async () => {
  if (!hasDatabase()) return;
  await ensureDatabase();
  if (!seedReady) seedReady = seedDatabase();
  await seedReady;
};

const commentTreesFromRows = (rows: CommentRow[]) => {
  const byPostAndParent = new Map<string, Map<string, CommentRow[]>>();

  for (const row of rows) {
    const parentKey = row.parentId ?? "root";
    const byParent = byPostAndParent.get(row.postId) ?? new Map<string, CommentRow[]>();
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), row]);
    byPostAndParent.set(row.postId, byParent);
  }

  const buildTree = (byParent: Map<string, CommentRow[]>, parentId: string | null = null): InquiryCommentContract[] =>
    (byParent.get(parentId ?? "root") ?? []).map((row) => ({
      id: row.id,
      parentId: row.parentId,
      author: row.authorName,
      authorHandle: row.authorHandle ?? undefined,
      stance: row.stance,
      body: row.body,
      createdAt: row.createdAt,
      replies: buildTree(byParent, row.id)
    }));

  return new Map([...byPostAndParent.entries()].map(([postId, byParent]) => [postId, buildTree(byParent)]));
};

export const rowToItem = (row: SnapshotRow, comments: InquiryCommentContract[]): InquiryItemContract => ({
  id: row.id,
  kind: row.kind,
  room: row.room,
  title: row.title,
  author: row.authorName,
  authorHandle: row.authorHandle ?? undefined,
  affiliation: row.affiliation,
  date: row.dateLabel,
  status: row.status,
  metrics: json(row.metrics, { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" }),
  gatheringReason: row.gatheringReason,
  excerpt: row.excerpt,
  body: row.body,
  tags: json(row.tags, []),
  signals: json(row.signals, []),
  claims: json(row.claims, []),
  objections: json(row.objections, []),
  evidence: json(row.evidence, []),
  tests: json(row.tests, []),
  forks: json(row.forks, []),
  comments,
  saved: row.saved,
  savedBy: json(row.savedBy, []),
  signaledBy: json(row.signaledBy, []),
  forkedBy: json(row.forkedBy, [])
});

export const getInitialState = async (): Promise<BootstrapResponseContract> => {
  if (!hasDatabase()) return seedSnapshot();
  await ensureLiveData();

  const [profileResult, postResult, commentResult, communityResult] = await Promise.all([
    getPool().query<ResearchProfileContract & {
      likesPublic: boolean;
      resharesPublic: boolean;
      avatarUrl: string | null;
    }>(
      `SELECT
        handle,
        email,
        name,
        avatar_url AS "avatarUrl",
        likes_public AS "likesPublic",
        reshares_public AS "resharesPublic",
        role,
        location,
        bio,
        fields
       FROM profiles
       ORDER BY created_at ASC`
    ),
    getPool().query<SnapshotRow>(
      `SELECT
        id,
        kind,
        room,
        title,
        author_handle AS "authorHandle",
        author_name AS "authorName",
        affiliation,
        date_label AS "dateLabel",
        status,
        metrics,
        gathering_reason AS "gatheringReason",
        excerpt,
        body,
        tags,
        signals,
        claims,
        objections,
        evidence,
        tests,
        forks,
        saved,
        saved_by AS "savedBy",
        signaled_by AS "signaledBy",
        forked_by AS "forkedBy"
       FROM posts
       ORDER BY created_at DESC`
    ),
    getPool().query<CommentRow>(
      `SELECT
        id,
        post_id AS "postId",
        parent_id AS "parentId",
        author_handle AS "authorHandle",
        author_name AS "authorName",
        stance,
        body,
        created_at AS "createdAt"
       FROM comments
       ORDER BY created_at ASC`
    ),
    getPool().query<ResearchCommunityContract>(
      `SELECT
        id,
        name,
        field,
        summary,
        visibility,
        online,
        member_handles AS "memberHandles",
        keywords,
        seed_counts AS "seedCounts",
        call_status AS "callStatus"
       FROM communities
       ORDER BY name ASC`
    )
  ]);

  const commentsByPost = commentTreesFromRows(commentResult.rows);
  const profiles = Object.fromEntries(
    profileResult.rows.map((person) => [
      person.handle,
      {
        ...person,
        email: person.email || undefined,
        avatarUrl: person.avatarUrl || undefined,
        fields: json(person.fields, [])
      }
    ])
  );

  return {
    profiles,
    items: postResult.rows.map((row) => rowToItem(row, commentsByPost.get(row.id) ?? [])),
    communities: communityResult.rows.map((community) => ({
      ...community,
      memberHandles: json(community.memberHandles, []),
      keywords: json(community.keywords, []),
      seedCounts: json(community.seedCounts, { papers: 0, thoughts: 0, opportunities: 0 })
    })),
    defaultProfile
  };
};

export const listCommunities = async () => (await getInitialState()).communities ?? [];

export const getCommunity = async (communityId: string) => {
  const community = (await listCommunities()).find((item) => item.id === communityId);
  if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "Community not found." });
  return community;
};
