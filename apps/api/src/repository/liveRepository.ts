import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  assistantMessageInputSchema,
  authSyncInputSchema,
  callIdInputSchema,
  confirmAttachmentInputSchema,
  createAttachmentUploadInputSchema,
  createCommentInputSchema,
  createCommunityCallInputSchema,
  createOpportunityInputSchema,
  createPostInputSchema,
  createProfileInputSchema,
  followProfileInputSchema,
  joinCommunityInputSchema,
  markNotificationInputSchema,
  postActionInputSchema,
  publishNoteInputSchema,
  saveNoteBlockInputSchema,
  searchInputSchema,
  sendMessageInputSchema,
  unfollowProfileInputSchema,
  type AssistantResponseContract,
  type BootstrapResponseContract,
  type CommunityCallContract,
  type CreateCommentInputContract,
  type CreateOpportunityInputContract,
  type CreatePostInputContract,
  type CreateProfileInputContract,
  type InquiryCommentContract,
  type InquiryItemContract,
  type OpportunityContract,
  type PostActionInputContract,
  type PublishNoteInputContract,
  type ResearchCommunityContract,
  type ResearchProfileContract
} from "../../../../packages/contracts/src";
import {
  getProfileForName,
  inquiryItems,
  profile as defaultProfile,
  profilesByName,
  researchCommunities
} from "@/lib/mockData";
import {
  cleanHandle,
  incrementMetric,
  metricNumber,
  mutateItemForActor,
  updateSignalValue
} from "@/lib/symposiumCore";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import { ensureDatabase } from "../db/migrate";
import type { Actor } from "../services/auth";
import { emitEvent } from "../services/events";
import { createObjectKey, createUploadUrl } from "../services/storage";

type SnapshotRow = Omit<InquiryItemContract, "author" | "date" | "comments"> & {
  authorHandle: string | null;
  authorName: string;
  dateLabel: string;
  comments?: InquiryCommentContract[];
};

type CommentRow = {
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

const json = <T>(value: unknown, fallback: T): T => {
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

const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const nowLabel = () =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());

const searchablePostText = (item: {
  title: string;
  body: string;
  excerpt?: string;
  tags?: string[];
  authorName?: string;
}) => [item.title, item.body, item.excerpt, item.authorName, ...(item.tags ?? [])].filter(Boolean).join(" ");

const normalizeProfile = (input: CreateProfileInputContract): ResearchProfileContract => ({
  name: input.name.trim(),
  handle: cleanHandle(input.handle),
  email: input.email?.trim().toLowerCase() || undefined,
  role: input.role?.trim() || "Symposium participant",
  location: input.location?.trim() || "Public rooms",
  bio: input.bio?.trim() || "A participant in the current inquiry thread.",
  fields: input.fields.map((field) => field.trim()).filter(Boolean).slice(0, 8)
});

const actorHandle = (actor: Actor, requestedHandle?: string) =>
  actor.handle ?? (requestedHandle ? cleanHandle(requestedHandle) : defaultProfile.handle);

const ensureProfileHandle = async (handle: string) => {
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

const callRowToContract = (row: {
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

const opportunityRowToContract = (row: {
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

const suffixedHandle = (baseHandle: string, index: number) =>
  index === 0 ? baseHandle : cleanHandle(`${baseHandle}_${index + 1}`);

const resolveSyncedHandle = async (client: PoolClient, desiredHandle: string, clerkSubject: string) => {
  const existingUser = await client.query<{ handle: string | null }>(
    "SELECT handle FROM users WHERE clerk_user_id = $1 AND handle IS NOT NULL LIMIT 1",
    [clerkSubject]
  );

  if (existingUser.rows[0]?.handle) return existingUser.rows[0].handle;

  const ownerHandle = cleanHandle(env.SYMPOSIUM_OWNER_HANDLE);
  const canClaimOwnerHandle =
    desiredHandle === ownerHandle && env.SYMPOSIUM_OWNER_CLERK_USER_ID === clerkSubject;

  for (let index = 0; index < 50; index += 1) {
    const candidate = suffixedHandle(desiredHandle, index);
    const userConflict = await client.query<{ clerkUserId: string | null }>(
      `SELECT clerk_user_id AS "clerkUserId"
       FROM users
       WHERE handle = $1 AND clerk_user_id IS DISTINCT FROM $2
       LIMIT 1`,
      [candidate, clerkSubject]
    );
    if (userConflict.rowCount) continue;

    const profileConflict = await client.query<{ userId: string | null; clerkUserId: string | null }>(
      `SELECT p.user_id AS "userId", u.clerk_user_id AS "clerkUserId"
       FROM profiles p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.handle = $1
       LIMIT 1`,
      [candidate]
    );

    const profile = profileConflict.rows[0];
    if (!profile) return candidate;
    if (profile.clerkUserId === clerkSubject) return candidate;
    if (!profile.userId && candidate === ownerHandle && canClaimOwnerHandle) return candidate;
  }

  throw new TRPCError({
    code: "CONFLICT",
    message: "Could not allocate a unique Symposium handle for this account."
  });
};

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

const seedSnapshot = (): BootstrapResponseContract => {
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

const insertProfile = async (client: PoolClient, person: ResearchProfileContract, userId?: string | null) => {
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

const ensureLiveData = async () => {
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

const rowToItem = (row: SnapshotRow, comments: InquiryCommentContract[]): InquiryItemContract => ({
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

export const upsertProfile = async (rawInput: unknown, actor?: Actor) => {
  const input = createProfileInputSchema.parse(rawInput);
  const person = normalizeProfile(input);

  if (!hasDatabase()) return person;
  await ensureLiveData();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await insertProfile(client, person);
    await client.query(
      `INSERT INTO audit_logs (actor_handle, action, subject_type, subject_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [actor?.handle ?? person.handle, "profile.upsert", "profile", person.handle, JSON.stringify({ source: actor?.source ?? "api" })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return person;
};

export const syncUser = async (rawInput: unknown, actor: Actor) => {
  const input = authSyncInputSchema.parse(rawInput ?? {});
  const clerkUserId = actor.clerkUserId ?? input.clerkUserId;
  const requestedHandle = cleanHandle(actor.handle ?? input.handle ?? input.email?.split("@")[0] ?? "symposium_member");
  const clerkSubject = clerkUserId ?? (actor.source === "dev" ? `dev:${requestedHandle}` : undefined);
  const name = actor.name ?? input.name ?? requestedHandle.replace(/^@/, "");
  const email = actor.email ?? input.email;

  if (!clerkSubject) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "No Clerk subject was found for this user." });
  }

  if (!hasDatabase()) {
    return normalizeProfile({
      name,
      handle: requestedHandle,
      email,
      role: "Symposium participant",
      location: "Public rooms",
      bio: "A participant in the current inquiry thread.",
      fields: ["Inquiry"]
    });
  }

  await ensureLiveData();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const handle = await resolveSyncedHandle(client, requestedHandle, clerkSubject);
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (clerk_user_id, primary_email, handle, display_name, image_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         primary_email = EXCLUDED.primary_email,
         handle = EXCLUDED.handle,
         display_name = EXCLUDED.display_name,
         image_url = EXCLUDED.image_url,
         updated_at = now()
       RETURNING id`,
      [clerkSubject, email ?? null, handle, name, actor.imageUrl ?? input.imageUrl ?? null]
    );

    const person = normalizeProfile({
      name,
      handle,
      email,
      role: "Symposium participant",
      location: "Public rooms",
      bio: "A participant in the current inquiry thread.",
      fields: ["Inquiry"]
    });
    await insertProfile(client, person, user.rows[0]?.id);
    await client.query("COMMIT");
    return person;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const createPost = async (rawInput: unknown, actor: Actor) => {
  const input = createPostInputSchema.parse(rawInput);
  const snapshot = await getInitialState();
  const handle = actorHandle(actor, input.authorHandle);
  const author = snapshot.profiles[handle] ?? defaultProfile;
  const isPaper = input.kind === "paper";
  const item: InquiryItemContract = {
    id: newId("post"),
    kind: input.kind,
    room: input.room,
    title: input.title,
    author: author.name,
    authorHandle: author.handle,
    affiliation: author.location,
    date: "Just now",
    status: isPaper ? "Draft" : "New",
    metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
    gatheringReason: "A new working post added to the live beta.",
    excerpt: input.body,
    body: input.body,
    tags: [input.room, input.kind, ...author.fields.slice(0, 2).map((field) => field.toLowerCase())],
    signals: [
      { label: "Status", value: isPaper ? "Draft" : "New" },
      { label: "Critiques", value: "0" },
      { label: "Forks", value: "0" },
      { label: "Next action", value: "Invite critique" }
    ],
    claims: [input.body],
    objections: [],
    evidence: [],
    tests: [],
    forks: [],
    comments: [],
    saved: input.room === "office",
    savedBy: input.room === "office" ? [author.handle] : [],
    signaledBy: [],
    forkedBy: []
  };

  if (!hasDatabase()) return item;
  await ensureLiveData();

  await getPool().query(
    `INSERT INTO posts (
      id, kind, room, title, author_handle, author_name, affiliation, date_label, status,
      metrics, gathering_reason, excerpt, body, tags, signals, claims, objections, evidence,
      tests, forks, saved, saved_by, signaled_by, forked_by, search_text
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25
    )`,
    [
      item.id,
      item.kind,
      item.room,
      item.title,
      item.authorHandle,
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
      item.saved,
      JSON.stringify(item.savedBy ?? []),
      JSON.stringify(item.signaledBy ?? []),
      JSON.stringify(item.forkedBy ?? []),
      searchablePostText({ ...item, authorName: item.author })
    ]
  );

  await emitEvent({
    kind: "post.created",
    actorHandle: item.authorHandle,
    subjectType: "post",
    subjectId: item.id,
    payload: { room: item.room, kind: item.kind, title: item.title }
  });

  return item;
};

export const addComment = async (postId: string, rawInput: unknown, actor: Actor) => {
  const input = createCommentInputSchema.parse(rawInput);
  const snapshot = await getInitialState();
  const existing = snapshot.items.find((item) => item.id === postId);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

  const handle = actorHandle(actor, input.authorHandle);
  const author = snapshot.profiles[handle] ?? defaultProfile;
  const comment: InquiryCommentContract = {
    id: newId("comment"),
    parentId: input.parentId ?? null,
    author: author.name,
    authorHandle: author.handle,
    stance: input.stance || "Comment",
    body: input.body,
    createdAt: nowLabel(),
    replies: []
  };

  if (!hasDatabase()) return comment;

  const nextCritiques = String(metricNumber(existing.metrics.critiques) + 1);
  const nextSignals = updateSignalValue(existing.signals, "Critiques", nextCritiques);

  await getPool().query(
    `INSERT INTO comments (id, post_id, parent_id, author_handle, author_name, stance, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [comment.id, postId, comment.parentId, comment.authorHandle, comment.author, comment.stance, comment.body]
  );
  await getPool().query(
    `UPDATE posts
     SET metrics = jsonb_set(metrics, '{critiques}', to_jsonb(($2)::text)),
         signals = $3,
         updated_at = now()
     WHERE id = $1`,
    [postId, nextCritiques, JSON.stringify(nextSignals)]
  );

  await emitEvent({
    kind: "comment.created",
    actorHandle: comment.authorHandle,
    subjectType: "post",
    subjectId: postId,
    payload: { commentId: comment.id, parentId: comment.parentId }
  });

  return comment;
};

export const applyPostAction = async (postId: string, rawInput: unknown, actor: Actor) => {
  const input: PostActionInputContract = postActionInputSchema.parse(rawInput);
  const snapshot = await getInitialState();
  const existing = snapshot.items.find((item) => item.id === postId);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

  const handle = actorHandle(actor, input.actorHandle);
  const updated = mutateItemForActor(existing, input.action, handle, defaultProfile.handle);

  if (!hasDatabase()) return updated;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (input.action === "read") {
      await client.query(
        `INSERT INTO post_actions (post_id, actor_handle, action, count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (post_id, actor_handle, action)
         DO UPDATE SET count = post_actions.count + 1, updated_at = now()`,
        [postId, handle, input.action]
      );
    } else {
      const listKey =
        input.action === "save" ? "savedBy" : input.action === "signal" ? "signaledBy" : "forkedBy";
      const list = updated[listKey] ?? [];
      if (list.includes(handle)) {
        await client.query(
          `INSERT INTO post_actions (post_id, actor_handle, action)
           VALUES ($1, $2, $3)
           ON CONFLICT (post_id, actor_handle, action) DO NOTHING`,
          [postId, handle, input.action]
        );
      } else {
        await client.query(
          "DELETE FROM post_actions WHERE post_id = $1 AND actor_handle = $2 AND action = $3",
          [postId, handle, input.action]
        );
      }
    }

    await client.query(
      `UPDATE posts
       SET metrics = $2,
           saved = $3,
           saved_by = $4,
           signaled_by = $5,
           forked_by = $6,
           signals = $7,
           updated_at = now()
       WHERE id = $1`,
      [
        postId,
        JSON.stringify(updated.metrics),
        Boolean(updated.saved),
        JSON.stringify(updated.savedBy ?? []),
        JSON.stringify(updated.signaledBy ?? []),
        JSON.stringify(updated.forkedBy ?? []),
        JSON.stringify(updated.signals)
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await emitEvent({
    kind: `post.${input.action}`,
    actorHandle: handle,
    subjectType: "post",
    subjectId: postId
  });

  return updated;
};

export const followProfile = async (rawInput: unknown, actor: Actor) => {
  const input = followProfileInputSchema.parse(rawInput);
  const follower = await ensureProfileHandle(actorHandle(actor));
  const following = await ensureProfileHandle(input.targetHandle);

  if (follower === following) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot follow yourself." });
  }

  if (!hasDatabase()) {
    return { followerHandle: follower, followingHandle: following, status: input.status };
  }

  await getPool().query(
    `INSERT INTO profile_follows (follower_handle, following_handle, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (follower_handle, following_handle)
     DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [follower, following, input.status]
  );

  await emitEvent({
    kind: "profile.followed",
    actorHandle: follower,
    subjectType: "profile",
    subjectId: following
  });

  return { followerHandle: follower, followingHandle: following, status: input.status };
};

export const unfollowProfile = async (rawInput: unknown, actor: Actor) => {
  const input = unfollowProfileInputSchema.parse(rawInput);
  const follower = await ensureProfileHandle(actorHandle(actor));
  const following = cleanHandle(input.targetHandle);

  if (hasDatabase()) {
    await ensureLiveData();
    await getPool().query(
      "DELETE FROM profile_follows WHERE follower_handle = $1 AND following_handle = $2",
      [follower, following]
    );
  }

  await emitEvent({
    kind: "profile.unfollowed",
    actorHandle: follower,
    subjectType: "profile",
    subjectId: following
  });

  return { followerHandle: follower, followingHandle: following, status: "none" };
};

export const listFollowing = async (actor: Actor) => {
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { following: [], followers: [] };
  await ensureLiveData();

  const [following, followers] = await Promise.all([
    getPool().query(
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, created_at AS "createdAt"
       FROM profile_follows
       WHERE follower_handle = $1
       ORDER BY created_at DESC`,
      [handle]
    ),
    getPool().query(
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, created_at AS "createdAt"
       FROM profile_follows
       WHERE following_handle = $1
       ORDER BY created_at DESC`,
      [handle]
    )
  ]);

  return { following: following.rows, followers: followers.rows };
};

export const listCommunities = async () => (await getInitialState()).communities ?? researchCommunities;

export const getCommunity = async (communityId: string) => {
  const community = (await listCommunities()).find((item) => item.id === communityId);
  if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "Community not found." });
  return community;
};

export const joinOrRequestCommunity = async (rawInput: unknown, actor: Actor) => {
  const input = joinCommunityInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) return { community, status: community.visibility === "private" ? "requested" : "joined" };

  await getPool().query(
    `INSERT INTO community_memberships (community_id, profile_handle, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (community_id, profile_handle) DO UPDATE SET status = EXCLUDED.status`,
    [community.id, handle, community.visibility === "private" ? "requested" : "active"]
  );

  await emitEvent({
    kind: community.visibility === "private" ? "community.requested" : "community.joined",
    actorHandle: handle,
    subjectType: "community",
    subjectId: community.id
  });

  return { community, status: community.visibility === "private" ? "requested" : "joined" };
};

export const listCommunityCalls = async (communityId: string) => {
  const community = await getCommunity(communityId);
  if (!hasDatabase()) return { community, calls: [] as CommunityCallContract[] };
  await ensureLiveData();

  const result = await getPool().query(
    `SELECT
       c.id,
       c.community_id AS "communityId",
       c.host_handle AS "hostHandle",
       c.title,
       c.kind,
       c.status,
       c.starts_at AS "startsAt",
       c.ended_at AS "endedAt",
       c.provider,
       c.provider_room_id AS "providerRoomId",
       COALESCE(json_agg(cp.profile_handle) FILTER (WHERE cp.profile_handle IS NOT NULL), '[]') AS "participantHandles"
     FROM community_calls c
     LEFT JOIN call_participants cp ON cp.call_id = c.id AND cp.left_at IS NULL
     WHERE c.community_id = $1
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT 25`,
    [community.id]
  );

  return { community, calls: result.rows.map(callRowToContract) };
};

export const createCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = createCommunityCallInputSchema.parse(rawInput);
  const host = await ensureProfileHandle(actorHandle(actor));
  await getCommunity(input.communityId);

  if (!hasDatabase()) {
    return {
      id: randomUUID(),
      communityId: input.communityId,
      hostHandle: host,
      title: input.title,
      kind: input.kind,
      status: "live",
      startsAt: input.startsAt ?? new Date().toISOString(),
      provider: input.provider,
      providerRoomId: input.providerRoomId,
      participantHandles: [host]
    } satisfies CommunityCallContract;
  }

  await ensureLiveData();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const call = await client.query(
      `INSERT INTO community_calls (
         community_id, host_handle, title, kind, status, starts_at, provider, provider_room_id
       )
       VALUES ($1, $2, $3, $4, 'live', COALESCE($5::timestamptz, now()), $6, $7)
       RETURNING
         id,
         community_id AS "communityId",
         host_handle AS "hostHandle",
         title,
         kind,
         status,
         starts_at AS "startsAt",
         ended_at AS "endedAt",
         provider,
         provider_room_id AS "providerRoomId"`,
      [
        input.communityId,
        host,
        input.title,
        input.kind,
        input.startsAt ?? null,
        input.provider ?? null,
        input.providerRoomId ?? null
      ]
    );
    await client.query(
      `INSERT INTO call_participants (call_id, profile_handle, role)
       VALUES ($1, $2, 'host')
       ON CONFLICT (call_id, profile_handle)
       DO UPDATE SET left_at = NULL, role = 'host'`,
      [call.rows[0]!.id, host]
    );
    await client.query(
      `UPDATE communities
       SET call_status = $2, updated_at = now()
       WHERE id = $1`,
      [input.communityId, input.kind === "video" ? "video live" : "voice live"]
    );
    await client.query("COMMIT");

    const created = callRowToContract({ ...call.rows[0]!, participantHandles: [host] });
    await emitEvent({
      kind: "community.call.created",
      actorHandle: host,
      subjectType: "community_call",
      subjectId: created.id,
      payload: { communityId: input.communityId, title: input.title, kind: input.kind }
    });
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const joinCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = callIdInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));

  if (!hasDatabase()) return { callId: input.callId, profileHandle: handle, status: "joined" };
  await ensureLiveData();

  const call = await getPool().query<{ id: string; status: string }>(
    "SELECT id, status FROM community_calls WHERE id = $1 LIMIT 1",
    [input.callId]
  );
  if (!call.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
  if (call.rows[0]!.status === "ended") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This call has already ended." });
  }

  await getPool().query(
    `INSERT INTO call_participants (call_id, profile_handle)
     VALUES ($1, $2)
     ON CONFLICT (call_id, profile_handle)
     DO UPDATE SET left_at = NULL`,
    [input.callId, handle]
  );

  await emitEvent({
    kind: "community.call.joined",
    actorHandle: handle,
    subjectType: "community_call",
    subjectId: input.callId
  });

  return { callId: input.callId, profileHandle: handle, status: "joined" };
};

export const endCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = callIdInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));

  if (!hasDatabase()) return { callId: input.callId, status: "ended" };
  await ensureLiveData();

  const result = await getPool().query<{ communityId: string }>(
    `UPDATE community_calls
     SET status = 'ended', ended_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING community_id AS "communityId"`,
    [input.callId]
  );
  if (!result.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });

  await getPool().query("UPDATE call_participants SET left_at = now() WHERE call_id = $1", [input.callId]);
  await getPool().query(
    `UPDATE communities
     SET call_status = 'quiet', updated_at = now()
     WHERE id = $1
       AND NOT EXISTS (
         SELECT 1 FROM community_calls
         WHERE community_id = $1 AND status = 'live' AND id <> $2
       )`,
    [result.rows[0]!.communityId, input.callId]
  );

  await emitEvent({
    kind: "community.call.ended",
    actorHandle: handle,
    subjectType: "community_call",
    subjectId: input.callId
  });

  return { callId: input.callId, status: "ended" };
};

export const createAttachmentUpload = async (rawInput: unknown, actor: Actor) => {
  const input = createAttachmentUploadInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  const objectKey = createObjectKey(input.ownerType, input.fileName);
  const uploadUrl = await createUploadUrl(objectKey, input.contentType);
  const attachmentId = randomUUID();

  if (hasDatabase()) {
    await ensureLiveData();
    await getPool().query(
      `INSERT INTO attachments (
        id, owner_type, owner_id, uploader_handle, bucket, object_key, file_name, content_type, byte_size, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
      [
        attachmentId,
        input.ownerType,
        input.ownerId ?? null,
        handle,
        env.R2_BUCKET ?? "symposium",
        objectKey,
        input.fileName,
        input.contentType,
        input.byteSize
      ]
    );
  }

  return {
    attachmentId,
    objectKey,
    uploadUrl,
    publicUrl: env.R2_PUBLIC_BASE_URL ? `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${objectKey}` : null
  };
};

export const confirmAttachment = async (rawInput: unknown, actor: Actor) => {
  const input = confirmAttachmentInputSchema.parse(rawInput);
  const handle = actorHandle(actor);

  if (!hasDatabase()) return { attachmentId: input.attachmentId, status: "uploaded" };
  await getPool().query(
    `UPDATE attachments
     SET status = 'uploaded',
         byte_size = COALESCE($2, byte_size),
         updated_at = now()
     WHERE id = $1 AND uploader_handle = $3`,
    [input.attachmentId, input.byteSize ?? null, handle]
  );

  await emitEvent({
    kind: "attachment.uploaded",
    actorHandle: handle,
    subjectType: "attachment",
    subjectId: input.attachmentId
  });

  return { attachmentId: input.attachmentId, status: "uploaded" };
};

export const search = async (rawInput: unknown) => {
  const input = searchInputSchema.parse(rawInput);
  const term = input.query.toLowerCase();

  if (!hasDatabase()) {
    const snapshot = seedSnapshot();
    return {
      posts: snapshot.items
        .filter((item) => searchablePostText({ ...item, authorName: item.author }).toLowerCase().includes(term))
        .slice(0, input.limit),
      profiles: Object.values(snapshot.profiles)
        .filter((person) => [person.name, person.handle, person.role, person.location, person.bio, ...person.fields].join(" ").toLowerCase().includes(term))
        .slice(0, input.limit),
      communities: (snapshot.communities ?? []).filter((community) => [community.name, community.field, community.summary, ...community.keywords].join(" ").toLowerCase().includes(term)).slice(0, input.limit)
    };
  }

  await ensureLiveData();
  const like = `%${input.query}%`;
  const [postsResult, profilesResult, communitiesResult] = await Promise.all([
    getPool().query<SnapshotRow>(
      `SELECT
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", status, metrics, gathering_reason AS "gatheringReason",
        excerpt, body, tags, signals, claims, objections, evidence, tests, forks, saved,
        saved_by AS "savedBy", signaled_by AS "signaledBy", forked_by AS "forkedBy"
       FROM posts
       WHERE search_text ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [like, input.limit]
    ),
    getPool().query<ResearchProfileContract>(
      `SELECT handle, email, name, avatar_url AS "avatarUrl", likes_public AS "likesPublic",
        reshares_public AS "resharesPublic", role, location, bio, fields
       FROM profiles
       WHERE name ILIKE $1 OR handle ILIKE $1 OR role ILIKE $1 OR location ILIKE $1 OR bio ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [like, input.limit]
    ),
    getPool().query<ResearchCommunityContract>(
      `SELECT id, name, field, summary, visibility, online, member_handles AS "memberHandles",
        keywords, seed_counts AS "seedCounts", call_status AS "callStatus"
       FROM communities
       WHERE name ILIKE $1 OR field ILIKE $1 OR summary ILIKE $1
       ORDER BY name ASC
       LIMIT $2`,
      [like, input.limit]
    )
  ]);

  return {
    posts: postsResult.rows.map((row) => rowToItem(row, [])),
    profiles: profilesResult.rows.map((person) => ({ ...person, fields: json(person.fields, []) })),
    communities: communitiesResult.rows.map((community) => ({
      ...community,
      memberHandles: json(community.memberHandles, []),
      keywords: json(community.keywords, []),
      seedCounts: json(community.seedCounts, { papers: 0, thoughts: 0, opportunities: 0 })
    }))
  };
};

export const listOpportunities = async (rawInput?: unknown) => {
  const input = rawInput ? createOpportunityInputSchema.partial().parse(rawInput) : {};

  if (!hasDatabase()) return [] as OpportunityContract[];
  await ensureLiveData();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.communityId) {
    params.push(input.communityId);
    conditions.push(`community_id = $${params.length}`);
  }

  if (input.status) {
    params.push(input.status);
    conditions.push(`status = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await getPool().query(
    `SELECT
       id,
       title,
       body,
       kind,
       status,
       creator_handle AS "creatorHandle",
       community_id AS "communityId",
       location,
       compensation,
       tags,
       created_at AS "createdAt"
     FROM opportunity_posts
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT 100`,
    params
  );

  return result.rows.map(opportunityRowToContract);
};

export const createOpportunity = async (rawInput: unknown, actor: Actor) => {
  const input: CreateOpportunityInputContract = createOpportunityInputSchema.parse(rawInput);
  const creator = await ensureProfileHandle(actorHandle(actor));
  if (input.communityId) await getCommunity(input.communityId);

  if (!hasDatabase()) {
    return {
      id: randomUUID(),
      title: input.title,
      body: input.body,
      kind: input.kind,
      status: input.status,
      creatorHandle: creator,
      communityId: input.communityId,
      location: input.location,
      compensation: input.compensation,
      tags: input.tags,
      createdAt: new Date().toISOString()
    } satisfies OpportunityContract;
  }

  await ensureLiveData();
  const result = await getPool().query(
    `INSERT INTO opportunity_posts (
       title, body, kind, status, creator_handle, community_id, location, compensation, tags
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING
       id,
       title,
       body,
       kind,
       status,
       creator_handle AS "creatorHandle",
       community_id AS "communityId",
       location,
       compensation,
       tags,
       created_at AS "createdAt"`,
    [
      input.title,
      input.body,
      input.kind,
      input.status,
      creator,
      input.communityId ?? null,
      input.location ?? null,
      input.compensation ?? null,
      JSON.stringify(input.tags)
    ]
  );

  const opportunity = opportunityRowToContract(result.rows[0]!);
  await emitEvent({
    kind: "opportunity.created",
    actorHandle: creator,
    subjectType: "opportunity",
    subjectId: opportunity.id,
    payload: { kind: opportunity.kind, communityId: opportunity.communityId, title: opportunity.title }
  });

  return opportunity;
};

export const listNotifications = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return [];
  await ensureLiveData();
  const result = await getPool().query(
    `SELECT id, kind, title, body, href, read_at AS "readAt", metadata, created_at AS "createdAt"
     FROM notifications
     WHERE profile_handle = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [handle]
  );
  return result.rows;
};

export const markNotificationRead = async (rawInput: unknown, actor: Actor) => {
  const input = markNotificationInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { notificationId: input.notificationId, read: true };
  await getPool().query(
    "UPDATE notifications SET read_at = now() WHERE id = $1 AND profile_handle = $2",
    [input.notificationId, handle]
  );
  return { notificationId: input.notificationId, read: true };
};

export const listConversations = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return [];
  await ensureLiveData();
  const result = await getPool().query(
    `SELECT c.id, c.kind, c.title, c.updated_at AS "updatedAt",
      COALESCE(json_agg(cp.profile_handle) FILTER (WHERE cp.profile_handle IS NOT NULL), '[]') AS participants
     FROM conversations c
     JOIN conversation_participants me ON me.conversation_id = c.id AND me.profile_handle = $1
     LEFT JOIN conversation_participants cp ON cp.conversation_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT 50`,
    [handle]
  );
  return result.rows;
};

export const sendMessage = async (rawInput: unknown, actor: Actor) => {
  const input = sendMessageInputSchema.parse(rawInput);
  const sender = actorHandle(actor);
  if (!hasDatabase()) {
    return { id: randomUUID(), conversationId: input.conversationId ?? randomUUID(), senderHandle: sender, body: input.body };
  }
  await ensureLiveData();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let conversationId = input.conversationId;

    if (!conversationId) {
      if (!input.recipientHandle) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "recipientHandle or conversationId is required." });
      }
      const recipient = cleanHandle(input.recipientHandle);
      const existing = await client.query<{ conversationId: string }>(
        `SELECT cp1.conversation_id AS "conversationId"
         FROM conversation_participants cp1
         JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
         WHERE cp1.profile_handle = $1 AND cp2.profile_handle = $2
         LIMIT 1`,
        [sender, recipient]
      );
      conversationId = existing.rows[0]?.conversationId;

      if (!conversationId) {
        const created = await client.query<{ id: string }>(
          "INSERT INTO conversations (kind) VALUES ('direct') RETURNING id"
        );
        conversationId = created.rows[0]!.id;
        await client.query(
          `INSERT INTO conversation_participants (conversation_id, profile_handle)
           VALUES ($1, $2), ($1, $3)
           ON CONFLICT DO NOTHING`,
          [conversationId, sender, recipient]
        );
      }
    }

    const message = await client.query(
      `INSERT INTO messages (conversation_id, sender_handle, body)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id AS "conversationId", sender_handle AS "senderHandle", body, created_at AS "createdAt"`,
      [conversationId, sender, input.body]
    );
    await client.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [conversationId]);
    await client.query("COMMIT");

    await emitEvent({
      kind: "message.sent",
      actorHandle: sender,
      subjectType: "conversation",
      subjectId: conversationId!,
      visibility: "private"
    });

    return message.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const getWorkspace = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { workspace: null, notes: [], blocks: [] };
  await ensureLiveData();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const workspace = await client.query<{ id: string; name: string; visibility: string }>(
      `INSERT INTO workspaces (owner_handle, name)
       VALUES ($1, 'Notebook')
       ON CONFLICT (owner_handle, name) DO UPDATE SET updated_at = workspaces.updated_at
       RETURNING id, name, visibility`,
      [handle]
    );

    let workspaceRow = workspace.rows[0];
    if (!workspaceRow) {
      const existing = await client.query<{ id: string; name: string; visibility: string }>(
        "SELECT id, name, visibility FROM workspaces WHERE owner_handle = $1 ORDER BY created_at ASC LIMIT 1",
        [handle]
      );
      workspaceRow = existing.rows[0]!;
    }

    const notes = await client.query(
      "SELECT id, title, visibility, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM notes WHERE workspace_id = $1 ORDER BY created_at ASC",
      [workspaceRow.id]
    );
    const blocks = await client.query(
      `SELECT nb.id, nb.note_id AS "noteId", nb.kind, nb.body, nb.sort_order AS "sortOrder", nb.updated_at AS "updatedAt"
       FROM note_blocks nb
       JOIN notes n ON n.id = nb.note_id
       WHERE n.workspace_id = $1
       ORDER BY nb.sort_order ASC, nb.created_at ASC`,
      [workspaceRow.id]
    );
    await client.query("COMMIT");
    return { workspace: workspaceRow, notes: notes.rows, blocks: blocks.rows };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const saveNoteBlock = async (rawInput: unknown, actor: Actor) => {
  const input = saveNoteBlockInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { id: input.blockId ?? randomUUID(), body: input.body };
  await ensureLiveData();

  const workspaceState = await getWorkspace(actor);
  const workspaceId = input.workspaceId ?? workspaceState.workspace?.id;
  if (!workspaceId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Workspace could not be created." });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let noteId = input.noteId;
    if (!noteId) {
      const note = await client.query<{ id: string }>(
        `INSERT INTO notes (workspace_id, title, visibility)
         VALUES ($1, 'Notebook', $2)
         RETURNING id`,
        [workspaceId, input.visibility]
      );
      noteId = note.rows[0]!.id;
    }

    const block = await client.query(
      `INSERT INTO note_blocks (id, note_id, body)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3)
       ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
       RETURNING id, note_id AS "noteId", body, updated_at AS "updatedAt"`,
      [input.blockId ?? null, noteId, input.body]
    );
    await client.query("UPDATE workspaces SET updated_at = now() WHERE id = $1 AND owner_handle = $2", [workspaceId, handle]);
    await client.query("COMMIT");
    return block.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const publishNote = async (rawInput: unknown, actor: Actor) => {
  const input: PublishNoteInputContract = publishNoteInputSchema.parse(rawInput);
  const publisher = await ensureProfileHandle(actorHandle(actor));

  let title = input.title;
  let body = input.body;

  if (hasDatabase() && input.noteId) {
    await ensureLiveData();
    const note = await getPool().query<{ title: string; body: string }>(
      `SELECT
         n.title,
         COALESCE(string_agg(nb.body, E'\n\n' ORDER BY nb.sort_order ASC, nb.created_at ASC), '') AS body
       FROM notes n
       JOIN workspaces w ON w.id = n.workspace_id
       LEFT JOIN note_blocks nb ON nb.note_id = n.id
       WHERE n.id = $1 AND w.owner_handle = $2
       GROUP BY n.id`,
      [input.noteId, publisher]
    );

    if (!note.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
    title = title ?? note.rows[0]!.title;
    body = body ?? note.rows[0]!.body;
  }

  if (!title || !body) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Publishing requires a noteId or explicit title and body."
    });
  }

  const item = await createPost(
    {
      title,
      body,
      kind: "paper",
      room: "library",
      authorHandle: publisher
    },
    actor
  );

  if (hasDatabase()) {
    await getPool().query(
      `INSERT INTO note_publications (note_id, post_id, publisher_handle, visibility, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.noteId ?? null,
        item.id,
        publisher,
        input.visibility,
        JSON.stringify({ source: input.noteId ? "note" : "direct" })
      ]
    );
  }

  await emitEvent({
    kind: "note.published",
    actorHandle: publisher,
    subjectType: "post",
    subjectId: item.id,
    payload: { noteId: input.noteId ?? null, visibility: input.visibility }
  });

  return { item, publication: { noteId: input.noteId ?? null, postId: item.id, visibility: input.visibility } };
};

const aiFallbackBody = (message: string) =>
  [
    "The SYMPOSIUM AI tablet backend is receiving messages and storing the conversation path, but the model provider is not configured yet.",
    "",
    `Your message: ${message}`,
    "",
    "Next live step: set an AI provider key and model policy, then this endpoint can return real assistant responses with explicit room/post/community/note context."
  ].join("\n");

export const askAssistant = async (rawInput: unknown, actor: Actor): Promise<AssistantResponseContract> => {
  const input = assistantMessageInputSchema.parse(rawInput);
  const owner = await ensureProfileHandle(actorHandle(actor));
  const providerConfigured = Boolean(env.OPENAI_API_KEY);

  if (!hasDatabase()) {
    const conversationId = input.conversationId ?? randomUUID();
    return {
      conversationId,
      providerConfigured,
      status: providerConfigured ? "answered" : "provider_not_configured",
      message: {
        id: randomUUID(),
        conversationId,
        role: "assistant",
        body: providerConfigured
          ? "The AI provider key is present, but model execution is intentionally not enabled until the live provider policy is finalized."
          : aiFallbackBody(input.message),
        createdAt: new Date().toISOString()
      }
    };
  }

  await ensureLiveData();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    let conversationId = input.conversationId;

    if (!conversationId) {
      const conversation = await client.query<{ id: string }>(
        `INSERT INTO ai_conversations (owner_handle, title, context_type, context_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          owner,
          input.message.slice(0, 80) || "AI tablet conversation",
          input.contextType,
          input.contextId ?? null
        ]
      );
      conversationId = conversation.rows[0]!.id;
    }

    await client.query(
      `INSERT INTO ai_messages (conversation_id, role, body, metadata)
       VALUES ($1, 'user', $2, $3)`,
      [conversationId, input.message, JSON.stringify({ contextType: input.contextType, contextId: input.contextId ?? null })]
    );

    const body = providerConfigured
      ? "The AI provider key is present, but model execution is intentionally not enabled until the live provider policy is finalized."
      : aiFallbackBody(input.message);
    const assistantMessage = await client.query(
      `INSERT INTO ai_messages (conversation_id, role, body, metadata)
       VALUES ($1, 'assistant', $2, $3)
       RETURNING id, conversation_id AS "conversationId", role, body, created_at AS "createdAt"`,
      [conversationId, body, JSON.stringify({ providerConfigured, model: env.SYMPOSIUM_AI_MODEL })]
    );
    await client.query("UPDATE ai_conversations SET updated_at = now() WHERE id = $1 AND owner_handle = $2", [
      conversationId,
      owner
    ]);
    await client.query("COMMIT");

    return {
      conversationId,
      providerConfigured,
      status: providerConfigured ? "answered" : "provider_not_configured",
      message: {
        ...assistantMessage.rows[0],
        role: "assistant",
        createdAt: assistantMessage.rows[0]?.createdAt
          ? new Date(assistantMessage.rows[0].createdAt).toISOString()
          : undefined
      }
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
