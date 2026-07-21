import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type {
  BootstrapResponseContract,
  CommunityCallContract,
  CreateProfileInputContract,
  InquiryAttachmentContract,
  InquiryCommentContract,
  InquiryItemContract,
  OpportunityContract,
  ResearchCommunityContract,
  ResearchProfileContract,
  VersionedDocumentContract
} from "../../../../packages/contracts/src";
import { attachmentKindForFile } from "../../../../packages/contracts/src";
import {
  communityActivityItems,
  getProfileForName,
  inquiryItems,
  profile,
  profilesByName,
  researchCommunities
} from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { seededCommunityCallMap } from "@/lib/communityFixtures";
import { syncHistoricalWorldAssetFixtures, syncHistoricalWorldFixtures } from "./historicalWorldFixtures";
import { projectCommunityItemsForViewer } from "@/lib/communityContentProjection";
import { activeCommunityAnnouncements } from "@/lib/communityAnnouncements";
import { postTypeForItem } from "@/lib/postSemantics";
import { env, webOrigins } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import { ensureDatabase } from "../db/migrate";
import type { Actor } from "../services/auth";

export const defaultProfile = profile;

export type SnapshotRow = Omit<InquiryItemContract, "author" | "date" | "comments"> & {
  authorHandle: string | null;
  authorName: string;
  dateLabel: string;
  createdAt?: Date | string | null;
  editedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  comments?: InquiryCommentContract[];
};

export type CommentRow = {
  id: string;
  revision?: number;
  postId: string;
  parentId: string | null;
  authorHandle: string | null;
  authorName: string;
  stance: string;
  body: string;
  document?: VersionedDocumentContract | null;
  metrics?: unknown;
  savedBy?: unknown;
  signaledBy?: unknown;
  forkedBy?: unknown;
  quote?: unknown;
  editedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  createdAt: Date | string;
};

export type AttachmentRow = {
  id: string;
  ownerType?: string;
  ownerId: string | null;
  fileName: string;
  contentType: string;
  byteSize: number;
  status: "pending" | "uploaded" | "previewed" | "failed";
  metadata?: unknown;
  objectKey: string;
  createdAt?: Date | string | null;
};

type ActionProjectionRow = {
  subjectId: string;
  actorHandle: string;
  action: "save" | "signal" | "fork";
  active: boolean;
};

type ActionHandleProjection = {
  save: string[];
  signal: string[];
  fork: string[];
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
  avatarUrl: input.avatarUrl?.trim() || undefined,
  likesPublic: input.likesPublic ?? true,
  resharesPublic: input.resharesPublic ?? true,
  role: input.role?.trim() || "Symposium participant",
  location: input.location?.trim() || "Public rooms",
  bio: (input.bio?.trim() || "A participant in the current inquiry thread.").slice(0, 200),
  fields: input.fields.map((field) => field.trim()).filter(Boolean).slice(0, 8)
});

export const actorHandle = (
  actor: Pick<Actor, "handle" | "isAuthenticated" | "source">,
  requestedHandle?: string
) => {
  if (actor.handle) return cleanHandle(actor.handle);

  if (actor.source === "dev") {
    return requestedHandle ? cleanHandle(requestedHandle) : defaultProfile.handle;
  }

  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "Your authenticated account must be synchronized before it can write to Symposium."
  });
};

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

export const getProfileByHandle = async (handle: string) => {
  const clean = cleanHandle(handle);
  if (!hasDatabase()) return seedSnapshot().profiles[clean] ?? null;
  await ensureLiveData();
  const result = await getPool().query<ResearchProfileContract & { avatarUrl: string | null }>(
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
       fields,
       actor_kind AS "actorKind",
       era,
       life_dates AS "lifeDates",
       disclosure,
       source_url AS "sourceUrl",
       revision
     FROM profiles
     WHERE handle = $1
     LIMIT 1`,
    [clean]
  );
  const person = result.rows[0];
  return person ? publicProfile({ ...person, fields: json(person.fields, []) }) : null;
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

  for (const community of researchCommunities) {
    for (const rawHandle of community.memberHandles) {
      const handle = cleanHandle(rawHandle);
      if (people.has(handle)) continue;

      people.set(handle, {
        name: handle.replace(/^@/, "").replace(/_/g, " "),
        handle,
        likesPublic: true,
        resharesPublic: true,
        role: "Research community member",
        location: community.name,
        bio: `A seeded member of ${community.name}.`,
        fields: [community.field]
      });
    }
  }

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
      metrics: comment.metrics ?? { signal: "0", forks: "0", saves: "0", reads: "0" },
      savedBy: comment.savedBy ?? [],
      signaledBy: comment.signaledBy ?? [],
      forkedBy: comment.forkedBy ?? [],
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
    communityCalls: seededCommunityCallMap(researchCommunities),
    defaultProfile
  };
};

export const insertProfile = async (
  client: PoolClient,
  person: ResearchProfileContract,
  userId?: string | null
) => {
  const result = await client.query<{ revision: number }>(
    `INSERT INTO profiles (
      handle, user_id, email, name, avatar_url, likes_public, reshares_public, role, location, bio, fields,
      actor_kind, era, life_dates, disclosure, source_url
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
      actor_kind = EXCLUDED.actor_kind,
      era = EXCLUDED.era,
      life_dates = EXCLUDED.life_dates,
      disclosure = EXCLUDED.disclosure,
      source_url = EXCLUDED.source_url,
      revision = CASE WHEN (
        profiles.user_id,
        profiles.email,
        profiles.name,
        profiles.avatar_url,
        profiles.likes_public,
        profiles.reshares_public,
        profiles.role,
        profiles.location,
        profiles.bio,
        profiles.fields,
        profiles.actor_kind,
        profiles.era,
        profiles.life_dates,
        profiles.disclosure,
        profiles.source_url
      ) IS DISTINCT FROM (
        COALESCE(EXCLUDED.user_id, profiles.user_id),
        EXCLUDED.email,
        EXCLUDED.name,
        EXCLUDED.avatar_url,
        EXCLUDED.likes_public,
        EXCLUDED.reshares_public,
        EXCLUDED.role,
        EXCLUDED.location,
        EXCLUDED.bio,
        EXCLUDED.fields,
        EXCLUDED.actor_kind,
        EXCLUDED.era,
        EXCLUDED.life_dates,
        EXCLUDED.disclosure,
        EXCLUDED.source_url
      ) THEN profiles.revision + 1 ELSE profiles.revision END,
      updated_at = now()
    RETURNING revision`,
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
      JSON.stringify(person.fields),
      person.actorKind ?? "person",
      person.era ?? null,
      person.lifeDates ?? null,
      person.disclosure ?? null,
      person.sourceUrl ?? null
    ]
  );
  return { ...person, revision: result.rows[0].revision };
};

const insertCommentTree = async (
  client: PoolClient,
  postId: string,
  comments: InquiryCommentContract[]
) => {
  for (const comment of comments) {
    const author = getProfileForName(comment.author);
    await client.query(
      `INSERT INTO comments (
         id, post_id, parent_id, author_handle, author_name, stance, body, content_document,
         metrics, saved_by, signaled_by, forked_by, quote, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO NOTHING`,
      [
        comment.id ?? newId("comment"),
        postId,
        comment.parentId ?? null,
        comment.authorHandle ?? author.handle,
        comment.author,
        comment.stance,
        comment.body,
        comment.document ? JSON.stringify(comment.document) : null,
        JSON.stringify(comment.metrics ?? { signal: "0", forks: "0", saves: "0", reads: "0" }),
        JSON.stringify(comment.savedBy ?? []),
        JSON.stringify(comment.signaledBy ?? []),
        JSON.stringify(comment.forkedBy ?? []),
        comment.quote ? JSON.stringify(comment.quote) : null,
        comment.createdAt && Number.isFinite(Date.parse(comment.createdAt)) ? comment.createdAt : new Date().toISOString()
      ]
    );
    await insertCommentTree(client, postId, comment.replies ?? []);
  }
};

const communityActivityFixtureRevision = "communities-activity-v3";
const communityContentFixtureRevision = "communities-content-v1";

const syncCommunityActivityFixtures = async (client: PoolClient) => {
  const alreadyApplied = await client.query("SELECT 1 FROM fixture_revisions WHERE id = $1", [communityActivityFixtureRevision]);
  if (alreadyApplied.rowCount) return;
  const fixtureProfiles = seedProfiles();
  const existingProfiles = await client.query<{ handle: string }>(
    "SELECT handle FROM profiles WHERE handle = ANY($1::text[])",
    [fixtureProfiles.map((person) => cleanHandle(person.handle))]
  );
  const existingHandles = new Set(existingProfiles.rows.map((row) => cleanHandle(row.handle)));
  for (const person of fixtureProfiles) {
    if (!existingHandles.has(cleanHandle(person.handle))) await insertProfile(client, person);
  }
  const communityFixtures = researchCommunities.map((community) => ({
    id: community.id,
    online: community.online,
    member_handles: community.memberHandles,
    seed_counts: community.seedCounts,
    call_status: community.callStatus,
    moderator_handles: community.moderatorHandles ?? [],
    guidelines: community.guidelines ?? "",
    announcements: community.announcements ?? []
  }));
  await client.query(
    `WITH fixture AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(
         id text, online integer, member_handles jsonb, seed_counts jsonb, call_status text,
         moderator_handles jsonb, guidelines text, announcements jsonb
       )
     )
     UPDATE communities community SET
       online = fixture.online,
       member_handles = CASE WHEN jsonb_array_length(community.member_handles) < 10 THEN fixture.member_handles ELSE community.member_handles END,
       seed_counts = fixture.seed_counts,
       call_status = CASE WHEN community.call_status = 'quiet' THEN fixture.call_status ELSE community.call_status END,
       moderator_handles = CASE WHEN jsonb_array_length(community.moderator_handles) < 3 THEN fixture.moderator_handles ELSE community.moderator_handles END,
       guidelines = CASE WHEN length(trim(community.guidelines)) < 160 THEN fixture.guidelines ELSE community.guidelines END,
       updated_at = now()
     FROM fixture
     WHERE community.id = fixture.id`,
    [JSON.stringify(communityFixtures)]
  );

  const memberships = researchCommunities.flatMap((community) => {
    const moderators = new Set((community.moderatorHandles ?? []).map(cleanHandle));
    return community.memberHandles.map((rawHandle, memberIndex) => ({
      community_id: community.id,
      profile_handle: cleanHandle(rawHandle),
      role: memberIndex === 0 ? "owner" : moderators.has(cleanHandle(rawHandle)) ? "moderator" : "member"
    }));
  });
  await client.query(
    `INSERT INTO community_memberships (community_id, profile_handle, role, status)
     SELECT row.community_id, row.profile_handle, row.role, 'active'
     FROM jsonb_to_recordset($1::jsonb) AS row(community_id text, profile_handle text, role text)
     ON CONFLICT (community_id, profile_handle) DO UPDATE SET role = EXCLUDED.role`,
    [JSON.stringify(memberships)]
  );

  const calls = Object.values(seededCommunityCallMap(researchCommunities)).flat();
  await client.query(
    `INSERT INTO community_calls (id, community_id, host_handle, title, kind, status, starts_at, provider, provider_room_id)
     SELECT row.id::uuid, row.community_id, row.host_handle, row.title, row.kind, row.status, row.starts_at::timestamptz, row.provider, row.provider_room_id
     FROM jsonb_to_recordset($1::jsonb) AS row(
       id text, community_id text, host_handle text, title text, kind text, status text,
       starts_at text, provider text, provider_room_id text
     )
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(calls.map((call) => ({
      id: call.id,
      community_id: call.communityId,
      host_handle: call.hostHandle,
      title: call.title,
      kind: call.kind,
      status: call.status,
      starts_at: call.startsAt,
      provider: call.provider,
      provider_room_id: call.providerRoomId
    })))]
  );
  const participants = calls.flatMap((call) => call.participantHandles.map((profileHandle, index) => ({
    call_id: call.id,
    profile_handle: cleanHandle(profileHandle),
    role: index === 0 ? "host" : "participant"
  })));
  await client.query(
    `INSERT INTO call_participants (call_id, profile_handle, role)
     SELECT row.call_id::uuid, row.profile_handle, row.role
     FROM jsonb_to_recordset($1::jsonb) AS row(call_id text, profile_handle text, role text)
     ON CONFLICT (call_id, profile_handle) DO NOTHING`,
    [JSON.stringify(participants)]
  );
  await client.query("INSERT INTO fixture_revisions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [communityActivityFixtureRevision]);
};

type FixtureComment = InquiryCommentContract & { postId: string };

const flattenFixtureComments = (postId: string, comments: InquiryCommentContract[]): FixtureComment[] =>
  comments.flatMap((comment) => [
    { ...comment, postId },
    ...flattenFixtureComments(postId, comment.replies ?? [])
  ]);

const fixtureActionRows = (
  subjectId: string,
  postId: string,
  createdAt: string,
  actionHandles: Pick<InquiryItemContract, "savedBy" | "signaledBy" | "forkedBy">
) => ([
  ["save", actionHandles.savedBy ?? []],
  ["signal", actionHandles.signaledBy ?? []],
  ["fork", actionHandles.forkedBy ?? []]
] as const).flatMap(([action, handles], actionIndex) => handles.map((actorHandle, actorIndex) => ({
  subject_id: subjectId,
  post_id: postId,
  actor_handle: cleanHandle(actorHandle),
  action,
  occurred_at: new Date(Date.parse(createdAt) + (actionIndex * 20 + actorIndex + 1) * 60_000).toISOString()
})));

const syncCommunityContentFixtures = async (client: PoolClient) => {
  const alreadyApplied = await client.query("SELECT 1 FROM fixture_revisions WHERE id = $1", [communityContentFixtureRevision]);
  if (alreadyApplied.rowCount) return;

  const posts = communityActivityItems.map((item) => ({
    id: item.id,
    kind: item.kind,
    post_type: postTypeForItem(item),
    room: item.room,
    community_id: item.communityId,
    title: item.title,
    author_handle: item.authorHandle ?? getProfileForName(item.author).handle,
    author_name: item.author,
    affiliation: item.affiliation,
    date_label: item.date,
    created_at: item.createdAt,
    status: item.status,
    metrics: item.metrics,
    gathering_reason: item.gatheringReason,
    excerpt: item.excerpt,
    body: item.body,
    tags: item.tags,
    signals: item.signals,
    claims: item.claims,
    objections: item.objections,
    evidence: item.evidence,
    tests: item.tests,
    forks: item.forks,
    saved: Boolean(item.saved),
    saved_by: item.savedBy ?? [],
    signaled_by: item.signaledBy ?? [],
    forked_by: item.forkedBy ?? [],
    quote: item.quote ?? null,
    patronage: item.patronage ?? null,
    opportunity: item.opportunity ?? null,
    search_text: searchablePostText({ ...item, authorName: item.author }),
    visibility: item.postType === "paper" ? "public" : "community"
  }));
  await client.query(
    `INSERT INTO posts (
       id, kind, post_type, room, community_id, title, author_handle, author_name, affiliation,
       date_label, created_at, status, metrics, gathering_reason, excerpt, body, tags, signals,
       claims, objections, evidence, tests, forks, saved, saved_by, signaled_by, forked_by,
       quote, patronage, opportunity, search_text, visibility
     )
     SELECT
       row.id, row.kind, row.post_type, row.room, row.community_id, row.title, row.author_handle,
       row.author_name, row.affiliation, row.date_label, row.created_at::timestamptz, row.status,
       row.metrics, row.gathering_reason, row.excerpt, row.body, row.tags, row.signals, row.claims,
       row.objections, row.evidence, row.tests, row.forks, row.saved, row.saved_by, row.signaled_by,
       row.forked_by, row.quote, row.patronage, row.opportunity, row.search_text, row.visibility
     FROM jsonb_to_recordset($1::jsonb) AS row(
       id text, kind text, post_type text, room text, community_id text, title text,
       author_handle text, author_name text, affiliation text, date_label text, created_at text,
       status text, metrics jsonb, gathering_reason text, excerpt text, body text, tags jsonb,
       signals jsonb, claims jsonb, objections jsonb, evidence jsonb, tests jsonb, forks jsonb,
       saved boolean, saved_by jsonb, signaled_by jsonb, forked_by jsonb, quote jsonb,
       patronage jsonb, opportunity jsonb, search_text text, visibility text
     )
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(posts)]
  );

  const comments = communityActivityItems.flatMap((item) => flattenFixtureComments(item.id, item.comments));
  await client.query(
    `INSERT INTO comments (
       id, post_id, parent_id, author_handle, author_name, stance, body, metrics,
       saved_by, signaled_by, forked_by, quote, created_at
     )
     SELECT
       row.id, row.post_id, row.parent_id, row.author_handle, row.author_name, row.stance,
       row.body, row.metrics, row.saved_by, row.signaled_by, row.forked_by, row.quote,
       row.created_at::timestamptz
     FROM jsonb_to_recordset($1::jsonb) AS row(
       id text, post_id text, parent_id text, author_handle text, author_name text, stance text,
       body text, metrics jsonb, saved_by jsonb, signaled_by jsonb, forked_by jsonb,
       quote jsonb, created_at text
     )
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(comments.map((comment) => ({
      id: comment.id,
      post_id: comment.postId,
      parent_id: comment.parentId ?? null,
      author_handle: comment.authorHandle ?? getProfileForName(comment.author).handle,
      author_name: comment.author,
      stance: comment.stance,
      body: comment.body,
      metrics: comment.metrics ?? { signal: "0", forks: "0", saves: "0", reads: "0" },
      saved_by: comment.savedBy ?? [],
      signaled_by: comment.signaledBy ?? [],
      forked_by: comment.forkedBy ?? [],
      quote: comment.quote ?? null,
      created_at: comment.createdAt
    })))]
  );

  const proposals = communityActivityItems.filter((item) => item.patronage).map((item) => ({
    post_id: item.id,
    status: item.patronage!.status,
    currency: item.patronage!.currency,
    goal_minor_units: item.patronage!.goalMinorUnits,
    deadline: item.patronage!.deadline
  }));
  await client.query(
    `INSERT INTO patronage_proposals (post_id, status, currency, goal_minor_units, deadline)
     SELECT row.post_id, row.status, row.currency, row.goal_minor_units, row.deadline::date
     FROM jsonb_to_recordset($1::jsonb) AS row(
       post_id text, status text, currency text, goal_minor_units bigint, deadline text
     )
     ON CONFLICT (post_id) DO NOTHING`,
    [JSON.stringify(proposals)]
  );

  const postActions = communityActivityItems.flatMap((item) =>
    fixtureActionRows(item.id, item.id, item.createdAt as string, item)
  );
  await client.query(
    `INSERT INTO post_actions (post_id, actor_handle, action, active, count, revision, created_at, updated_at)
     SELECT row.subject_id, row.actor_handle, row.action, true, 1, 1, row.occurred_at::timestamptz, row.occurred_at::timestamptz
     FROM jsonb_to_recordset($1::jsonb) AS row(
       subject_id text, post_id text, actor_handle text, action text, occurred_at text
     )
     ON CONFLICT (post_id, actor_handle, action) DO NOTHING`,
    [JSON.stringify(postActions)]
  );
  const commentActions = comments.flatMap((comment) =>
    fixtureActionRows(comment.id as string, comment.postId, comment.createdAt as string, comment)
  );
  await client.query(
    `INSERT INTO comment_actions (
       comment_id, post_id, actor_handle, action, active, count, revision, created_at, updated_at
     )
     SELECT row.subject_id, row.post_id, row.actor_handle, row.action, true, 1, 1,
       row.occurred_at::timestamptz, row.occurred_at::timestamptz
     FROM jsonb_to_recordset($1::jsonb) AS row(
       subject_id text, post_id text, actor_handle text, action text, occurred_at text
     )
     ON CONFLICT (comment_id, actor_handle, action) DO NOTHING`,
    [JSON.stringify(commentActions)]
  );

  await client.query("INSERT INTO fixture_revisions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [communityContentFixtureRevision]);
};

const legacySeedDatabase = async () => {
  if (!hasDatabase() || env.SYMPOSIUM_SEED_ON_BOOT === false) return;
  await ensureDatabase();

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existing = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM posts");
    if (Number(existing.rows[0]?.count ?? 0) > 0) {
      await syncCommunityActivityFixtures(client);
      await syncCommunityContentFixtures(client);
      await client.query("COMMIT");
      return;
    }

    for (const person of seedProfiles()) {
      await insertProfile(client, person);
    }

    for (const community of researchCommunities) {
      await client.query(
        `INSERT INTO communities (
          id, name, field, summary, visibility, online, member_handles, keywords, seed_counts, call_status,
          moderator_handles, guidelines, announcements
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
          moderator_handles = EXCLUDED.moderator_handles,
          guidelines = EXCLUDED.guidelines,
          announcements = EXCLUDED.announcements,
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
          community.callStatus,
          JSON.stringify(community.moderatorHandles ?? community.memberHandles.slice(0, 2)),
          community.guidelines ?? "Keep criticism attached to the work. Preserve sources, explain edits, and leave a legible trail when a claim changes.",
          JSON.stringify(community.announcements ?? [])
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

    await syncCommunityActivityFixtures(client);

    for (const [itemIndex, item] of inquiryItems.entries()) {
      const author = getProfileForName(item.author);
      const comments = normalizeComments(item.comments, item.id, itemIndex);
      await client.query(
        `INSERT INTO posts (
          id, kind, post_type, room, community_id, title, author_handle, author_name, affiliation, date_label, created_at, status,
          metrics, gathering_reason, excerpt, body, tags, signals, claims, objections, evidence,
          tests, forks, saved, saved_by, signaled_by, forked_by, quote, patronage, opportunity, search_text, visibility
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          item.id,
          item.kind,
          postTypeForItem(item),
          item.room,
          item.communityId ?? null,
          item.title,
          item.authorHandle ?? author.handle,
          item.author,
          item.affiliation,
          item.date,
          item.createdAt ?? null,
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
          item.quote ? JSON.stringify(item.quote) : null,
          item.patronage ? JSON.stringify(item.patronage) : null,
          item.opportunity ? JSON.stringify(item.opportunity) : null,
          searchablePostText({ ...item, authorName: item.author }),
          item.communityId && postTypeForItem(item) !== "paper" ? "community" : "public"
        ]
      );
      if (item.patronage) {
        await client.query(
          `INSERT INTO patronage_proposals (post_id, status, currency, goal_minor_units, deadline)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (post_id) DO NOTHING`,
          [item.id, item.patronage.status, item.patronage.currency, item.patronage.goalMinorUnits, item.patronage.deadline]
        );
        for (const [supporterIndex, supporter] of item.patronage.topSupporters.entries()) {
          const contributor = supporter.anonymous ? null : getProfileForName(supporter.displayName)?.handle ?? null;
          await client.query(
            `INSERT INTO patronage_contributions (
               post_id, contributor_handle, display_name, amount_minor_units, currency,
               anonymous, provider, provider_reference, status, confirmed_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'seed', $7, 'confirmed', now())
             ON CONFLICT (provider_reference) DO NOTHING`,
            [
              item.id,
              contributor,
              supporter.displayName,
              supporter.amountMinorUnits,
              item.patronage.currency,
              supporter.anonymous,
              `seed:${item.id}:${supporterIndex}`
            ]
          );
        }
      }
      await insertCommentTree(client, item.id, comments);
    }

    await syncCommunityContentFixtures(client);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const seedDatabase = async () => {
  if (!hasDatabase()) return;
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await syncHistoricalWorldFixtures(client);
    const assetResult = await syncHistoricalWorldAssetFixtures(client);
    await client.query("COMMIT");
    if (result.applied) {
      console.info("Historical world fixture replacement applied.", {
        revision: result.revision,
        manifest: result.manifest
      });
    }
    if (assetResult.applied) {
      console.info("Historical world attachment metadata refresh applied.", {
        revision: assetResult.revision
      });
    }
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

export const commentTreesFromRows = (
  rows: CommentRow[],
  attachmentsByComment: Map<string, InquiryAttachmentContract[]> = new Map()
) => {
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
      document: row.document ?? undefined,
      createdAt: new Date(row.createdAt).toISOString(),
      editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : undefined,
      deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : undefined,
      revision: row.revision,
      metrics: json(row.metrics, { signal: "0", forks: "0", saves: "0", reads: "0" }),
      savedBy: json(row.savedBy, []),
      signaledBy: json(row.signaledBy, []),
      forkedBy: json(row.forkedBy, []),
      attachments: attachmentsByComment.get(row.id),
      quote: json(row.quote, undefined),
      replies: buildTree(byParent, row.id)
    }));

  return new Map([...byPostAndParent.entries()].map(([postId, byParent]) => [postId, buildTree(byParent)]));
};

const attachmentPublicUrl = (row: Pick<AttachmentRow, "objectKey" | "metadata">) => {
  const metadata = json<Record<string, unknown>>(row.metadata, {});
  const staticPublicPath = typeof metadata.staticPublicPath === "string" && metadata.staticPublicPath.startsWith("/historical-world/")
    ? metadata.staticPublicPath
    : null;
  if (staticPublicPath) {
    const publicWebOrigin = webOrigins.find((origin) => origin.startsWith("https://")) ?? webOrigins[0];
    return publicWebOrigin ? `${publicWebOrigin.replace(/\/$/, "")}${staticPublicPath}` : undefined;
  }
  return env.R2_PUBLIC_BASE_URL ? `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${row.objectKey}` : undefined;
};

export const rowToAttachment = (row: AttachmentRow): InquiryAttachmentContract => ({
  id: row.id,
  fileName: row.fileName,
  contentType: row.contentType,
  byteSize: row.byteSize,
  url: attachmentPublicUrl(row),
  status: row.status,
  kind: attachmentKindForFile(row.contentType, row.fileName),
  metadata: json(row.metadata, {}),
  createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined
});

export const attachmentsByOwner = (rows: AttachmentRow[]) => {
  const byOwner = new Map<string, InquiryAttachmentContract[]>();
  for (const row of rows) {
    if (!row.ownerId) continue;
    byOwner.set(row.ownerId, [...(byOwner.get(row.ownerId) ?? []), rowToAttachment(row)]);
  }
  return byOwner;
};

export const getActiveAttachmentsByOwner = async (
  client: Pick<PoolClient, "query">,
  ownerType: "post" | "comment",
  ownerIds: string[]
) => {
  if (!ownerIds.length) return new Map<string, InquiryAttachmentContract[]>();
  const result = await client.query<AttachmentRow>(
    `SELECT
       id::text,
       owner_id AS "ownerId",
       file_name AS "fileName",
       content_type AS "contentType",
       byte_size AS "byteSize",
       status,
       metadata,
       object_key AS "objectKey",
       created_at AS "createdAt"
     FROM attachments
     WHERE owner_type = $1
       AND owner_id = ANY($2::text[])
       AND status IN ('uploaded', 'previewed')
     ORDER BY created_at ASC`,
    [ownerType, ownerIds]
  );
  return attachmentsByOwner(result.rows);
};

export const getPostConversationAttachments = (
  client: Pick<PoolClient, "query">,
  postId: string,
  commentRows: CommentRow[]
) =>
  Promise.all([
    getActiveAttachmentsByOwner(client, "comment", commentRows.map((comment) => comment.id)),
    getActiveAttachmentsByOwner(client, "post", [postId])
  ]);

const actionHandlesBySubject = (rows: ActionProjectionRow[]) => {
  const bySubject = new Map<string, ActionHandleProjection>();
  for (const row of rows) {
    const projection = bySubject.get(row.subjectId) ?? { save: [], signal: [], fork: [] };
    if (row.active) projection[row.action].push(cleanHandle(row.actorHandle));
    bySubject.set(row.subjectId, projection);
  }
  return bySubject;
};

const applyPostActionProjection = (row: SnapshotRow, projection?: ActionHandleProjection): SnapshotRow => {
  if (!projection) return row;
  return {
    ...row,
    saved: projection.save.length > 0,
    savedBy: projection.save,
    signaledBy: projection.signal,
    forkedBy: projection.fork
  };
};

const applyCommentActionProjection = (row: CommentRow, projection?: ActionHandleProjection): CommentRow => {
  if (!projection) return row;
  return {
    ...row,
    savedBy: projection.save,
    signaledBy: projection.signal,
    forkedBy: projection.fork
  };
};

export const rowToItem = (
  row: SnapshotRow,
  comments: InquiryCommentContract[],
  attachments?: InquiryAttachmentContract[]
): InquiryItemContract => {
  const postAttachments = attachments ?? row.attachments ?? [];
  return {
    id: row.id,
    revision: row.revision,
    kind: row.kind,
    postType: row.postType ?? postTypeForItem(row) ?? undefined,
    room: row.room,
    communityId: row.communityId ?? undefined,
    title: row.title,
    author: row.authorName,
    authorHandle: row.authorHandle ?? undefined,
    affiliation: row.affiliation,
    date: row.dateLabel,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
    editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : undefined,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : undefined,
    status: row.status,
    metrics: json(row.metrics, { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" }),
    gatheringReason: row.gatheringReason,
    excerpt: row.excerpt,
    body: row.body,
    document: row.document ?? undefined,
    tags: json(row.tags, []),
    signals: json(row.signals, []),
    claims: json(row.claims, []),
    objections: json(row.objections, []),
    evidence: json(row.evidence, []),
    tests: json(row.tests, []),
    forks: json(row.forks, []),
    comments,
    attachments: postAttachments.length ? postAttachments : undefined,
    quote: row.quote ?? undefined,
    patronage: row.patronage ?? undefined,
    opportunity: row.opportunity ?? undefined,
    saved: row.saved,
    savedBy: json(row.savedBy, []),
    signaledBy: json(row.signaledBy, []),
    forkedBy: json(row.forkedBy, [])
  };
};

export const communityRowToContract = (community: ResearchCommunityContract): ResearchCommunityContract => ({
  ...community,
  memberHandles: json(community.memberHandles, []),
  keywords: json(community.keywords, []),
  seedCounts: json(community.seedCounts, { papers: 0, thoughts: 0, opportunities: 0 }),
  moderatorHandles: json(community.moderatorHandles, []),
  announcements: json(community.announcements, [])
});

export const getInitialState = async (): Promise<BootstrapResponseContract> => {
  if (!hasDatabase()) return seedSnapshot();
  await ensureLiveData();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const [
      profileResult,
      postResult,
      commentResult,
      attachmentResult,
      communityResult,
      communityCallResult,
      postActionResult,
      commentActionResult
    ] = await Promise.all([
      client.query<ResearchProfileContract & {
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
          fields,
          actor_kind AS "actorKind",
          era,
          life_dates AS "lifeDates",
          disclosure,
          source_url AS "sourceUrl",
          revision
         FROM profiles
         ORDER BY created_at ASC`
      ),
      client.query<SnapshotRow>(
        `SELECT
          id,
          revision,
          kind,
          post_type AS "postType",
          room,
          community_id AS "communityId",
          title,
          author_handle AS "authorHandle",
          author_name AS "authorName",
          affiliation,
          date_label AS "dateLabel",
          created_at AS "createdAt",
          edited_at AS "editedAt",
          deleted_at AS "deletedAt",
          status,
          metrics,
          gathering_reason AS "gatheringReason",
          excerpt,
          body,
          content_document AS "document",
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
          forked_by AS "forkedBy",
          quote,
          patronage,
          opportunity
         FROM posts
         ORDER BY created_at DESC`
      ),
      client.query<CommentRow>(
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
         ORDER BY created_at ASC`
      ),
      client.query<AttachmentRow>(
        `SELECT
          id::text,
          owner_type AS "ownerType",
          owner_id AS "ownerId",
          file_name AS "fileName",
          content_type AS "contentType",
          byte_size AS "byteSize",
          status,
          metadata,
          object_key AS "objectKey",
          created_at AS "createdAt"
         FROM attachments
         WHERE owner_type IN ('post', 'comment')
           AND status IN ('uploaded', 'previewed')
         ORDER BY created_at ASC`
      ),
      client.query<ResearchCommunityContract>(
        `SELECT
          id,
          name,
          field,
          summary,
          visibility,
          online,
          COALESCE((
            SELECT jsonb_agg(member.value ORDER BY member.ordinality)
            FROM jsonb_array_elements(community.member_handles) WITH ORDINALITY AS member(value, ordinality)
            WHERE member.ordinality <= 50
          ), '[]'::jsonb) AS "memberHandles",
          keywords,
          seed_counts AS "seedCounts",
          call_status AS "callStatus",
          (
            SELECT membership.profile_handle
            FROM community_memberships membership
            WHERE membership.community_id = community.id AND membership.status = 'active' AND membership.role = 'owner'
            ORDER BY membership.created_at ASC LIMIT 1
          ) AS "ownerHandle",
          moderator_handles AS "moderatorHandles",
          guidelines,
          announcements,
          revision
         FROM communities AS community
         ORDER BY name ASC`
      ),
      client.query(
        `WITH ranked_calls AS (
           SELECT call.*, ROW_NUMBER() OVER (PARTITION BY community_id ORDER BY created_at DESC) AS rank
           FROM community_calls call
           WHERE status IN ('live', 'scheduled')
         )
         SELECT
           call.id,
           call.community_id AS "communityId",
           call.host_handle AS "hostHandle",
           call.title,
           call.kind,
           call.status,
           call.starts_at AS "startsAt",
           call.ended_at AS "endedAt",
           call.provider,
           call.provider_room_id AS "providerRoomId",
           COALESCE(json_agg(participant.profile_handle) FILTER (WHERE participant.profile_handle IS NOT NULL), '[]') AS "participantHandles"
         FROM ranked_calls call
         LEFT JOIN call_participants participant ON participant.call_id = call.id AND participant.left_at IS NULL
         WHERE call.rank <= 25
         GROUP BY call.id, call.community_id, call.host_handle, call.title, call.kind, call.status,
           call.starts_at, call.ended_at, call.provider, call.provider_room_id, call.created_at
         ORDER BY call.community_id, call.created_at DESC`
      ),
      client.query<ActionProjectionRow>(
        `SELECT
          post_id AS "subjectId",
          actor_handle AS "actorHandle",
          action,
          active
         FROM post_actions
         WHERE action IN ('save', 'signal', 'fork')
         ORDER BY post_id, action, actor_handle`
      ),
      client.query<ActionProjectionRow>(
        `SELECT
          comment_id AS "subjectId",
          actor_handle AS "actorHandle",
          action,
          active
         FROM comment_actions
         WHERE action IN ('save', 'signal', 'fork')
         ORDER BY comment_id, action, actor_handle`
      )
    ]);

    const postActionHandles = actionHandlesBySubject(postActionResult.rows);
    const commentActionHandles = actionHandlesBySubject(commentActionResult.rows);
    const projectedComments = commentResult.rows.map((row) =>
      applyCommentActionProjection(row, commentActionHandles.get(row.id))
    );
    const postAttachmentRows = attachmentResult.rows.filter((row) => row.ownerType === "post");
    const commentAttachmentRows = attachmentResult.rows.filter((row) => row.ownerType === "comment");
    const attachmentsByComment = attachmentsByOwner(commentAttachmentRows);
    const commentsByPost = commentTreesFromRows(projectedComments, attachmentsByComment);
    const attachmentsByPost = attachmentsByOwner(postAttachmentRows);
    const communityCalls = Object.fromEntries(communityResult.rows.map((community) => [community.id, [] as CommunityCallContract[]]));
    for (const callRow of communityCallResult.rows) {
      const call = callRowToContract(callRow);
      (communityCalls[call.communityId] ??= []).push(call);
    }
    const profiles = Object.fromEntries(
      profileResult.rows.map((person) => [
        person.handle,
        publicProfile({
          ...person,
          email: person.email || undefined,
          avatarUrl: person.avatarUrl || undefined,
          fields: json(person.fields, [])
        })
      ])
    );

    const state: BootstrapResponseContract = {
      profiles,
      items: postResult.rows.map((row) => {
        const projectedRow = applyPostActionProjection(row, postActionHandles.get(row.id));
        return rowToItem(projectedRow, commentsByPost.get(row.id) ?? [], attachmentsByPost.get(row.id) ?? []);
      }),
      communities: communityResult.rows.map(communityRowToContract),
      communityCalls,
      defaultProfile
    };
    await client.query("COMMIT");
    return state;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const listCommunities = async () => {
  if (!hasDatabase()) return researchCommunities;
  await ensureLiveData();
  const result = await getPool().query<ResearchCommunityContract>(
    `SELECT
       id,
       name,
       field,
       summary,
       visibility,
       online,
       COALESCE((
         SELECT jsonb_agg(member.value ORDER BY member.ordinality)
         FROM jsonb_array_elements(community.member_handles) WITH ORDINALITY AS member(value, ordinality)
         WHERE member.ordinality <= 50
       ), '[]'::jsonb) AS "memberHandles",
       keywords,
       seed_counts AS "seedCounts",
       call_status AS "callStatus",
       (
         SELECT membership.profile_handle
         FROM community_memberships membership
         WHERE membership.community_id = community.id
           AND membership.status = 'active'
           AND membership.role = 'owner'
         ORDER BY membership.created_at ASC
         LIMIT 1
       ) AS "ownerHandle",
       moderator_handles AS "moderatorHandles",
       guidelines,
       announcements,
       revision
     FROM communities community
     ORDER BY name ASC
     LIMIT 200`
  );
  return result.rows.map(communityRowToContract);
};

const communityMemberPreviewLimit = 50;

export function publicProfile(person: ResearchProfileContract): ResearchProfileContract {
  const { email: _email, ...profile } = person;
  return {
    ...profile,
    avatarUrl: person.avatarUrl ?? undefined,
    actorKind: person.actorKind ?? undefined,
    era: person.era ?? undefined,
    lifeDates: person.lifeDates ?? undefined,
    disclosure: person.disclosure ?? undefined,
    sourceUrl: person.sourceUrl ?? undefined
  };
}

export const publicCommunity = (
  community: ResearchCommunityContract,
  membershipStatus: ResearchCommunityContract["membershipStatus"] = community.membershipStatus ?? "none"
): ResearchCommunityContract => {
  const privateHidden = community.visibility === "private" && membershipStatus !== "active";
  return {
    ...community,
    online: privateHidden ? 0 : community.online,
    memberHandles: privateHidden ? [] : community.memberHandles.slice(0, communityMemberPreviewLimit),
    ownerHandle: privateHidden ? undefined : community.ownerHandle ?? community.memberHandles[0],
    moderatorHandles: privateHidden ? [] : community.moderatorHandles ?? [],
    guidelines: privateHidden ? undefined : community.guidelines,
    announcements: privateHidden ? [] : activeCommunityAnnouncements(community.announcements),
    memberCount: privateHidden ? 0 : community.memberCount,
    monthlyActive: privateHidden ? 0 : community.monthlyActive,
    callStatus: privateHidden ? "quiet" : community.callStatus,
    membershipStatus,
    viewerRole: membershipStatus === "active" ? community.viewerRole : undefined
  };
};

const visibleActionHandles = (
  handles: string[] | undefined,
  profiles: Record<string, ResearchProfileContract>,
  requesterHandle: string | null,
  privacy: "likesPublic" | "resharesPublic"
) =>
  (handles ?? []).filter((handle) => {
    const normalized = cleanHandle(handle);
    return normalized === requesterHandle || profiles[normalized]?.[privacy] !== false;
  });

const publicCommentProjection = (
  comment: InquiryCommentContract,
  profiles: Record<string, ResearchProfileContract>,
  requesterHandle: string | null
): InquiryCommentContract => ({
  ...comment,
  savedBy: (comment.savedBy ?? []).filter((handle) => cleanHandle(handle) === requesterHandle),
  signaledBy: visibleActionHandles(comment.signaledBy, profiles, requesterHandle, "likesPublic"),
  forkedBy: visibleActionHandles(comment.forkedBy, profiles, requesterHandle, "resharesPublic"),
  replies: (comment.replies ?? []).map((reply) => publicCommentProjection(reply, profiles, requesterHandle))
});

const publicItemProjection = (
  item: InquiryItemContract,
  profiles: Record<string, ResearchProfileContract>,
  requesterHandle: string | null
): InquiryItemContract => {
  const savedBy = (item.savedBy ?? []).filter((handle) => cleanHandle(handle) === requesterHandle);
  return {
    ...item,
    saved: savedBy.length > 0,
    savedBy,
    signaledBy: visibleActionHandles(item.signaledBy, profiles, requesterHandle, "likesPublic"),
    forkedBy: visibleActionHandles(item.forkedBy, profiles, requesterHandle, "resharesPublic"),
    comments: (item.comments ?? []).map((comment) => publicCommentProjection(comment, profiles, requesterHandle))
  };
};

type CommunityViewerState = {
  status: ResearchCommunityContract["membershipStatus"];
  role?: ResearchCommunityContract["viewerRole"];
  lastAccessedAt?: string;
  memberCount: number;
  monthlyActive: number;
};

export const communityViewerState = async (
  communities: ResearchCommunityContract[],
  requesterHandle: string | null
) => {
  if (!hasDatabase()) {
    return new Map(communities.map((community) => {
      const active = Boolean(requesterHandle && community.memberHandles.some((handle) => cleanHandle(handle) === requesterHandle));
      return [community.id, {
        status: active ? "active" as const : "none" as const,
        role: active
          ? cleanHandle(community.memberHandles[0] ?? "") === requesterHandle
            ? "owner" as const
            : (community.moderatorHandles ?? []).some((handle) => cleanHandle(handle) === requesterHandle)
              ? "moderator" as const
              : "member" as const
          : undefined,
        lastAccessedAt: undefined,
        memberCount: community.memberHandles.length,
        monthlyActive: Math.max(community.online, Math.round(community.memberHandles.length * 0.72))
      }];
    }));
  }

  const result = await getPool().query<{
    communityId: string;
    membershipStatus: string | null;
    viewerRole: string | null;
    lastAccessedAt: Date | string | null;
    memberCount: number;
    monthlyActive: number;
  }>(
    `SELECT
       community.id AS "communityId",
       viewer.status AS "membershipStatus",
       viewer.role AS "viewerRole",
       viewer.last_accessed_at AS "lastAccessedAt",
       COUNT(membership.profile_handle) FILTER (WHERE membership.status = 'active')::int AS "memberCount",
       COUNT(membership.profile_handle) FILTER (
         WHERE membership.status = 'active'
           AND COALESCE(membership.last_accessed_at, membership.updated_at, membership.created_at) >= now() - interval '30 days'
       )::int AS "monthlyActive"
     FROM communities community
     LEFT JOIN community_memberships membership ON membership.community_id = community.id
     LEFT JOIN community_memberships viewer
      ON viewer.community_id = community.id
     AND viewer.profile_handle = $1
     WHERE community.id = ANY($2::text[])
     GROUP BY community.id, viewer.status, viewer.role, viewer.last_accessed_at`,
    [requesterHandle, communities.map((community) => community.id)]
  );
  return new Map(result.rows.map((row) => {
    const status = row.membershipStatus === "active" || row.membershipStatus === "requested" || row.membershipStatus === "invited"
      ? row.membershipStatus
      : "none";
    return [row.communityId, {
      status,
      role: status === "active" && (row.viewerRole === "owner" || row.viewerRole === "moderator")
        ? row.viewerRole
        : status === "active" ? "member" : undefined,
      lastAccessedAt: row.lastAccessedAt ? new Date(row.lastAccessedAt).toISOString() : undefined,
      memberCount: Number(row.memberCount ?? 0),
      monthlyActive: Number(row.monthlyActive ?? 0)
    } satisfies CommunityViewerState];
  }));
};

export const getPublicInitialState = async (rawRequesterHandle?: string | null) => {
  const state = await getInitialState();
  const requesterHandle = rawRequesterHandle ? cleanHandle(rawRequesterHandle) : null;
  const communities = state.communities ?? [];
  const viewerState = await communityViewerState(communities, requesterHandle);
  const viewerCommunities = communities.map((community) => {
    const viewer = viewerState.get(community.id) ?? { status: "none" as const, role: undefined, lastAccessedAt: undefined, memberCount: 0, monthlyActive: 0 };
    return publicCommunity({
      ...community,
      viewerRole: viewer.role,
      memberCount: viewer.memberCount,
      monthlyActive: viewer.monthlyActive,
      lastAccessedAt: viewer.lastAccessedAt
    }, viewer.status);
  });
  const readableItems = state.items.filter((item) =>
    item.room !== "office" && item.kind !== "draft"
    || Boolean(requesterHandle && item.authorHandle && cleanHandle(item.authorHandle) === requesterHandle)
  );
  return {
    ...state,
    profiles: Object.fromEntries(
      Object.entries(state.profiles).map(([handle, person]) => [handle, publicProfile(person)])
    ),
    items: projectCommunityItemsForViewer(readableItems, viewerCommunities, requesterHandle)
      .map((item) => publicItemProjection(item, state.profiles, requesterHandle)),
    communities: viewerCommunities,
    communityCalls: Object.fromEntries(communities.map((community) => [
      community.id,
      community.visibility === "public" || viewerState.get(community.id)?.status === "active"
        ? state.communityCalls?.[community.id] ?? []
        : []
    ])),
    defaultProfile: publicProfile(state.defaultProfile)
  };
};

export const listPublicCommunities = async (rawRequesterHandle?: string | null) => {
  const communities = await listCommunities();
  const requesterHandle = rawRequesterHandle ? cleanHandle(rawRequesterHandle) : null;
  const viewerState = await communityViewerState(communities, requesterHandle);
  return communities.map((community) => {
    const viewer = viewerState.get(community.id) ?? {
      status: "none" as const,
      role: undefined,
      lastAccessedAt: undefined,
      memberCount: 0,
      monthlyActive: 0
    };
    return publicCommunity({
      ...community,
      viewerRole: viewer.role,
      memberCount: viewer.memberCount,
      monthlyActive: viewer.monthlyActive,
      lastAccessedAt: viewer.lastAccessedAt
    }, viewer.status);
  });
};

export const listPublicCommunityCallMap = async (
  communities: ResearchCommunityContract[],
  _rawRequesterHandle?: string | null
) => {
  if (!communities.length) return {};
  if (!hasDatabase()) {
    const calls = seededCommunityCallMap(communities);
    return Object.fromEntries(communities.map((community) => [
      community.id,
      community.visibility === "public" || community.membershipStatus === "active"
        ? calls[community.id] ?? []
        : []
    ]));
  }
  await ensureLiveData();
  const readableCommunityIds = communities
    .filter((community) => community.visibility === "public" || community.membershipStatus === "active")
    .map((community) => community.id);
  const callMap = Object.fromEntries(communities.map((community) => [community.id, [] as CommunityCallContract[]]));
  if (!readableCommunityIds.length) return callMap;
  const result = await getPool().query(
    `WITH ranked_calls AS (
       SELECT community_call.*, ROW_NUMBER() OVER (PARTITION BY community_id ORDER BY created_at DESC) AS rank
       FROM community_calls community_call
       WHERE community_call.community_id = ANY($1::text[])
         AND community_call.status IN ('live', 'scheduled')
     )
     SELECT
       community_call.id,
       community_call.community_id AS "communityId",
       community_call.host_handle AS "hostHandle",
       community_call.title,
       community_call.kind,
       community_call.status,
       community_call.starts_at AS "startsAt",
       community_call.ended_at AS "endedAt",
       community_call.provider,
       community_call.provider_room_id AS "providerRoomId",
       COALESCE(json_agg(participant.profile_handle) FILTER (WHERE participant.profile_handle IS NOT NULL), '[]') AS "participantHandles"
     FROM ranked_calls community_call
     LEFT JOIN LATERAL (
       SELECT call_participant.profile_handle
       FROM call_participants call_participant
       WHERE call_participant.call_id = community_call.id
         AND call_participant.left_at IS NULL
       ORDER BY call_participant.joined_at ASC, call_participant.profile_handle ASC
       LIMIT 50
     ) participant ON true
     WHERE community_call.rank <= 5
     GROUP BY community_call.id, community_call.community_id, community_call.host_handle, community_call.title, community_call.kind, community_call.status,
       community_call.starts_at, community_call.ended_at, community_call.provider, community_call.provider_room_id, community_call.created_at
     ORDER BY community_call.community_id, community_call.created_at DESC`,
    [readableCommunityIds]
  );
  for (const row of result.rows) (callMap[row.communityId] ??= []).push(callRowToContract(row));
  return callMap;
};

export const getCommunity = async (communityId: string) => {
  if (!hasDatabase()) {
    const community = researchCommunities.find((item) => item.id === communityId);
    if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "Community not found." });
    return community;
  }
  await ensureLiveData();
  const result = await getPool().query<ResearchCommunityContract>(
    `SELECT
       id, name, field, summary, visibility, online,
       member_handles AS "memberHandles",
       keywords,
       seed_counts AS "seedCounts",
       call_status AS "callStatus",
       (
         SELECT membership.profile_handle
         FROM community_memberships membership
         WHERE membership.community_id = communities.id AND membership.status = 'active' AND membership.role = 'owner'
         ORDER BY membership.created_at ASC LIMIT 1
       ) AS "ownerHandle",
       moderator_handles AS "moderatorHandles",
       guidelines,
       announcements,
       revision
     FROM communities
     WHERE id = $1
     LIMIT 1`,
    [communityId]
  );
  const community = result.rows[0] ? communityRowToContract(result.rows[0]) : undefined;
  if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "Community not found." });
  return community;
};

export const getPublicCommunity = async (communityId: string, requesterHandle?: string | null) => {
  const community = await getCommunity(communityId);
  const viewer = (await communityViewerState([community], requesterHandle ? cleanHandle(requesterHandle) : null)).get(community.id)
    ?? { status: "none" as const, role: undefined, lastAccessedAt: undefined, memberCount: community.memberHandles.length, monthlyActive: community.online };
  return publicCommunity({
    ...community,
    viewerRole: viewer.role,
    memberCount: viewer.memberCount,
    monthlyActive: viewer.monthlyActive,
    lastAccessedAt: viewer.lastAccessedAt
  }, viewer.status);
};
