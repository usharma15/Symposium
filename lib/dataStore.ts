import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type {
  CanonicalActionActivityContract,
  ContentQuoteContract,
  OpportunityPostInputContract,
  PatronageProposalInputContract,
  ToggleActionContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";
import {
  getProfileForName,
  inquiryItems,
  profile as defaultProfile,
  profilesByName,
  type ContentKind,
  type InquiryAttachment,
  type InquiryComment,
  type InquiryItem,
  type ResearchProfile,
  type RoomId
} from "@/lib/mockData";
import {
  appendCommentToTree,
  canManageComment,
  cleanHandle,
  commentActionActive,
  commentMetricsFallback,
  findCommentInTree,
  hasHandle,
  incrementMetric,
  isDeletedComment,
  isDeletedPost,
  isSavedBy,
  mapCommentTree,
  mutateCommentForActor,
  mutateItemForActor,
  setCommentActionMembership,
  setItemActionMembership,
  tombstoneCommentInItem,
  tombstonePost,
  updateSignalValue,
  type PostAction
} from "@/lib/symposiumCore";
import {
  buildLegacyActionLedger,
  canonicalActivityKey,
  createLocalCanonicalActivity,
  mergeCanonicalActivities,
  projectCanonicalActionLedger
} from "@/lib/profileActivity";
import { invalidateQuotedSource } from "@/lib/contentQuotes";

type AppData = {
  profiles: Record<string, ResearchProfile>;
  items: InquiryItem[];
  viewDedupe: Record<string, string>;
  actionLedger: Record<string, CanonicalActionActivityContract>;
};

export type CreateProfileInput = {
  name: string;
  handle: string;
  email?: string;
  avatarUrl?: string;
  likesPublic?: boolean;
  resharesPublic?: boolean;
  role: string;
  location: string;
  bio: string;
  fields: string[];
};

export type CreatePostInput = {
  title: string;
  body: string;
  document?: VersionedDocumentContract;
  kind: ContentKind;
  room: Exclude<RoomId, "hall">;
  attachments?: InquiryAttachment[];
  quote?: ContentQuoteContract;
  patronage?: PatronageProposalInputContract;
  opportunity?: OpportunityPostInputContract;
};

export type CreateCommentInput = {
  id?: string;
  body: string;
  document?: VersionedDocumentContract;
  stance: string;
  parentId?: string | null;
  attachments?: InquiryAttachment[];
  quote?: ContentQuoteContract;
};

export type { PostAction };
export type CommentAction = PostAction;

export type ActionMutationResult = {
  item: InquiryItem;
  activity?: CanonicalActionActivityContract;
};

export type UpdatePostInput = {
  title: string;
  body: string;
  document?: VersionedDocumentContract;
  attachments?: InquiryAttachment[];
  quote?: ContentQuoteContract | null;
  patronage?: PatronageProposalInputContract;
  opportunity?: OpportunityPostInputContract;
};

export type UpdateCommentInput = {
  body: string;
  document?: VersionedDocumentContract;
  attachments?: InquiryAttachment[];
  quote?: ContentQuoteContract | null;
};

const viewDedupeWindowMs = 60 * 60 * 1000;
type ViewTargetType = "post" | "comment";

const localDataPath = process.env.VERCEL
  ? path.join("/tmp", "symposium.json")
  : path.join(process.cwd(), ".data", "symposium.json");
const databaseUrl = process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
const usePostgres = Boolean(databaseUrl);

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;
let seedReady: Promise<void> | null = null;
let localActionQueue: Promise<void> = Promise.resolve();

const withLocalActionLock = <T>(operation: () => Promise<T>) => {
  const result = localActionQueue.then(operation, operation);
  localActionQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
};

const handleFromName = (name: string) => getProfileForName(name).handle;

const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const seedItemById = new Map(inquiryItems.map((item) => [item.id, item]));
const seedCommentById = new Map<string, InquiryComment>();
for (const item of inquiryItems) {
  const visit = (comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (comment.id) seedCommentById.set(comment.id, comment);
      visit(comment.replies ?? []);
    }
  };
  visit(item.comments);
}

const legacyLiveSeedCreatedAt = (id?: string, offsetMinutes = 0) => {
  const match = id?.match(/^live-(\d+)-/);
  if (!match) return undefined;
  const index = Number(match[1]);
  if (!Number.isFinite(index)) return undefined;
  return new Date(Date.UTC(2026, 5, 18, 12, 0, 0) - (index * 19 + offsetMinutes) * 60 * 1000).toISOString();
};

const stableSeedCreatedAt = (createdAt: string | undefined, fallback?: string) => {
  if (createdAt && !Number.isNaN(Date.parse(createdAt))) return createdAt;
  return fallback ?? createdAt;
};

const normalizeViewActorHandle = (handle: string | undefined) => {
  const normalized = cleanHandle(handle || defaultProfile.handle);
  return normalized === "@" ? defaultProfile.handle : normalized;
};

const contentViewKey = (targetType: ViewTargetType, targetId: string, actorHandle: string) =>
  `${targetType}:${targetId}:${normalizeViewActorHandle(actorHandle)}`;

const pruneViewDedupe = (dedupe: Record<string, string> | undefined, now = Date.now()) =>
  Object.fromEntries(
    Object.entries(dedupe ?? {}).filter(([, timestamp]) => {
      const parsed = Date.parse(timestamp);
      return Number.isFinite(parsed) && now - parsed < viewDedupeWindowMs;
    })
  );

const claimLocalContentView = (
  data: AppData,
  targetType: ViewTargetType,
  targetId: string,
  actorHandle: string
) => {
  const now = Date.now();
  const key = contentViewKey(targetType, targetId, actorHandle);
  const dedupe = pruneViewDedupe(data.viewDedupe, now);
  const lastViewedAt = Date.parse(dedupe[key] ?? "");
  data.viewDedupe = dedupe;

  if (Number.isFinite(lastViewedAt) && now - lastViewedAt < viewDedupeWindowMs) {
    return false;
  }

  data.viewDedupe[key] = new Date(now).toISOString();
  return true;
};

const recordPostgresContentView = async (
  targetType: ViewTargetType,
  targetId: string,
  actorHandle: string,
  trigger?: string,
  surface?: string
) => {
  const bucketStart = new Date(Math.floor(Date.now() / viewDedupeWindowMs) * viewDedupeWindowMs).toISOString();
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO content_views (target_type, target_id, actor_handle, bucket_start, trigger, surface)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (target_type, target_id, actor_handle, bucket_start) DO NOTHING
     RETURNING id`,
    [targetType, targetId, normalizeViewActorHandle(actorHandle), bucketStart, trigger ?? null, surface ?? null]
  );
  return (result.rowCount ?? 0) > 0;
};

const persistPostgresActivity = async (activity: CanonicalActionActivityContract) => {
  const result = await getPool().query<ActionLedgerRow>(
    `INSERT INTO action_ledger (
       subject_type, subject_id, post_id, actor_handle, action, active, count, revision, occurred_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)
     ON CONFLICT (subject_type, subject_id, actor_handle, action) DO UPDATE SET
       post_id = EXCLUDED.post_id,
       active = EXCLUDED.active,
       count = EXCLUDED.count,
       revision = action_ledger.revision +
         CASE WHEN action_ledger.active IS DISTINCT FROM EXCLUDED.active THEN 1 ELSE 0 END,
       occurred_at = CASE
         WHEN action_ledger.active IS DISTINCT FROM EXCLUDED.active THEN EXCLUDED.occurred_at
         ELSE action_ledger.occurred_at
       END
     RETURNING subject_type, subject_id, post_id, actor_handle, action, active, count, revision, occurred_at`,
    [
      activity.subjectType,
      activity.subjectId,
      activity.postId,
      activity.actorHandle,
      activity.action,
      activity.active,
      activity.count,
      activity.occurredAt
    ]
  );
  const row = result.rows[0];
  return {
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    postId: row.post_id,
    actorHandle: row.actor_handle,
    action: row.action,
    active: row.active,
    count: row.count,
    revision: Number(row.revision),
    occurredAt: new Date(row.occurred_at).toISOString()
  } satisfies CanonicalActionActivityContract;
};

const normalizeProfile = (input: CreateProfileInput): ResearchProfile => ({
  name: input.name.trim(),
  handle: cleanHandle(input.handle),
  email: input.email?.trim().toLowerCase() || undefined,
  avatarUrl: input.avatarUrl?.trim() || undefined,
  likesPublic: input.likesPublic ?? true,
  resharesPublic: input.resharesPublic ?? true,
  role: input.role.trim() || "Symposium participant",
  location: input.location.trim() || "Public rooms",
  bio: (input.bio.trim() || "A participant in the current inquiry thread.").slice(0, 200),
  fields: input.fields.map((field) => field.trim()).filter(Boolean).slice(0, 8)
});

const normalizeCommentState = (comments: InquiryComment[]): InquiryComment[] =>
  comments.map((comment) => {
    const seedComment = comment.id ? seedCommentById.get(comment.id) : undefined;
    return {
      ...comment,
      createdAt: stableSeedCreatedAt(
        seedComment?.createdAt ?? comment.createdAt,
        legacyLiveSeedCreatedAt(comment.id, 1)
      ),
      metrics: { ...commentMetricsFallback, ...(comment.metrics ?? {}) },
      savedBy: comment.savedBy ?? [],
      signaledBy: comment.signaledBy ?? [],
      forkedBy: comment.forkedBy ?? [],
      replies: normalizeCommentState(comment.replies ?? [])
    };
  });

const normalizeItem = (item: InquiryItem): InquiryItem => {
  const seedItem = seedItemById.get(item.id);
  return {
    ...item,
    kind: item.room === "funding" ? "paper" : item.room === "opportunities" ? "thought" : item.kind,
    patronage: item.patronage ?? (item.room === "funding" ? seedItem?.patronage : undefined),
    opportunity: item.opportunity ?? (item.room === "opportunities" ? seedItem?.opportunity : undefined),
    createdAt: stableSeedCreatedAt(seedItem?.createdAt ?? item.createdAt, legacyLiveSeedCreatedAt(item.id)),
    savedBy: item.savedBy ?? (item.saved ? [defaultProfile.handle] : []),
    signaledBy: item.signaledBy ?? [],
    forkedBy: item.forkedBy ?? [],
    saved: Boolean(item.saved),
    attachments: item.attachments ?? [],
    comments: normalizeCommentState(item.comments ?? [])
  };
};

const activityRecord = (entries: CanonicalActionActivityContract[]) =>
  Object.fromEntries(entries.map((activity) => [canonicalActivityKey(activity), activity]));

const transitionLocalActivity = ({
  ledger,
  subjectType,
  subjectId,
  postId,
  actorHandle,
  action,
  active,
  fallbackActive
}: {
  ledger: AppData["actionLedger"];
  subjectType: CanonicalActionActivityContract["subjectType"];
  subjectId: string;
  postId: string;
  actorHandle: string;
  action: ToggleActionContract;
  active?: boolean;
  fallbackActive: boolean;
}) => {
  const key = canonicalActivityKey({ subjectType, subjectId, actorHandle, action });
  const previous = ledger[key];
  const previousActive = previous?.active ?? fallbackActive;
  const nextActive = active ?? !previousActive;
  const changed = previousActive !== nextActive;
  const activity: CanonicalActionActivityContract = {
    ...createLocalCanonicalActivity({
      subjectType,
      subjectId,
      postId,
      actorHandle,
      action,
      active: nextActive,
      occurredAt: changed || !previous ? new Date().toISOString() : previous.occurredAt
    }),
    revision: previous ? previous.revision + (changed ? 1 : 0) : 1
  };
  ledger[key] = activity;
  return { activity, previousActive };
};

const deactivateLedgerEntries = (
  ledger: AppData["actionLedger"],
  matches: (activity: CanonicalActionActivityContract) => boolean
) => {
  const occurredAt = new Date().toISOString();
  for (const [key, activity] of Object.entries(ledger)) {
    if (!activity.active || !matches(activity)) continue;
    ledger[key] = {
      ...activity,
      active: false,
      count: 0,
      revision: activity.revision + 1,
      occurredAt
    };
  }
};

const normalizeData = (data: AppData): AppData => {
  const normalizedItems = data.items.map(normalizeItem);
  const entries = mergeCanonicalActivities(
    buildLegacyActionLedger(normalizedItems),
    Object.values(data.actionLedger ?? {})
  );
  return {
    profiles: data.profiles,
    items: projectCanonicalActionLedger(normalizedItems, entries),
    viewDedupe: pruneViewDedupe(data.viewDedupe),
    actionLedger: activityRecord(entries)
  };
};

const mergeSeedData = (data: AppData): AppData => {
  const seed = seedData();
  const existingItemIds = new Set(data.items.map((item) => item.id));
  const normalizedItems = [
    ...data.items,
    ...seed.items.filter((item) => !existingItemIds.has(item.id))
  ].map(normalizeItem);
  const ledger = mergeCanonicalActivities(
    buildLegacyActionLedger(normalizedItems),
    Object.values(data.actionLedger ?? {})
  );

  return {
    profiles: { ...seed.profiles, ...data.profiles },
    items: projectCanonicalActionLedger(normalizedItems, ledger),
    viewDedupe: pruneViewDedupe(data.viewDedupe),
    actionLedger: activityRecord(ledger)
  };
};

const seedData = (): AppData => {
  const profiles = Object.fromEntries(
    Object.values(profilesByName).map((person) => [person.handle, person])
  );

  const items = inquiryItems.map((item, itemIndex) => ({
    ...normalizeItem(item),
    authorHandle: handleFromName(item.author),
    comments: normalizeComments(item.comments, item.id, itemIndex)
  }));
  return {
    profiles,
    viewDedupe: {},
    items,
    actionLedger: activityRecord(buildLegacyActionLedger(items))
  };
};

const normalizeComments = (
  comments: InquiryComment[],
  itemId: string,
  itemIndex: number,
  parentId: string | null = null
): InquiryComment[] =>
  comments.map((comment, commentIndex) => {
    const id = comment.id ?? `${itemId}-comment-${itemIndex}-${parentId ?? "root"}-${commentIndex}`;
    return {
      ...comment,
      id,
      parentId,
      authorHandle: comment.authorHandle ?? handleFromName(comment.author),
      createdAt: comment.createdAt ?? "Seeded",
      metrics: { ...commentMetricsFallback, ...(comment.metrics ?? {}) },
      savedBy: comment.savedBy ?? [],
      signaledBy: comment.signaledBy ?? [],
      forkedBy: comment.forkedBy ?? [],
      replies: normalizeComments(comment.replies ?? [], itemId, itemIndex, id)
    };
  });

const getPool = () => {
  if (!databaseUrl) throw new Error("No database URL configured.");
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false }
    });
  }
  return pool;
};

const ensureSchema = async () => {
  if (!usePostgres) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getPool();
      await db.query(`
        CREATE TABLE IF NOT EXISTS profiles (
          handle TEXT PRIMARY KEY,
          email TEXT,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          location TEXT NOT NULL,
          bio TEXT NOT NULL,
          fields JSONB NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          room TEXT NOT NULL,
          title TEXT NOT NULL,
          author_handle TEXT NOT NULL,
          author_name TEXT NOT NULL,
          affiliation TEXT NOT NULL,
          date_label TEXT NOT NULL,
          status TEXT NOT NULL,
          metrics JSONB NOT NULL,
          gathering_reason TEXT NOT NULL,
          excerpt TEXT NOT NULL,
          body TEXT NOT NULL,
          content_document JSONB,
          tags JSONB NOT NULL,
          signals JSONB NOT NULL,
          claims JSONB NOT NULL,
          objections JSONB NOT NULL,
          evidence JSONB NOT NULL,
          tests JSONB NOT NULL,
          forks JSONB NOT NULL,
          attachments JSONB DEFAULT '[]'::jsonb,
          saved BOOLEAN DEFAULT false,
          saved_by JSONB DEFAULT '[]'::jsonb,
          signaled_by JSONB DEFAULT '[]'::jsonb,
          forked_by JSONB DEFAULT '[]'::jsonb,
          quote JSONB,
          patronage JSONB,
          opportunity JSONB,
          edited_at TIMESTAMPTZ,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS comments (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
          author_handle TEXT NOT NULL,
          author_name TEXT NOT NULL,
          stance TEXT NOT NULL,
          body TEXT NOT NULL,
          content_document JSONB,
          metrics JSONB NOT NULL DEFAULT '{"signal":"0","forks":"0","saves":"0","reads":"0"}'::jsonb,
          saved_by JSONB NOT NULL DEFAULT '[]'::jsonb,
          signaled_by JSONB NOT NULL DEFAULT '[]'::jsonb,
          forked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
          quote JSONB,
          edited_at TIMESTAMPTZ,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS content_views (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          actor_handle TEXT NOT NULL,
          bucket_start TIMESTAMPTZ NOT NULL,
          trigger TEXT,
          surface TEXT,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE (target_type, target_id, actor_handle, bucket_start)
        );

        CREATE TABLE IF NOT EXISTS action_ledger (
          subject_type TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          post_id TEXT NOT NULL,
          actor_handle TEXT NOT NULL,
          action TEXT NOT NULL,
          active BOOLEAN NOT NULL DEFAULT true,
          count INTEGER NOT NULL DEFAULT 1,
          revision INTEGER NOT NULL DEFAULT 1,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (subject_type, subject_id, actor_handle, action),
          CHECK (subject_type IN ('post', 'comment')),
          CHECK (action IN ('save', 'signal', 'fork')),
          CHECK (count >= 0),
          CHECK (revision > 0)
        );
      `);

      await db.query(`
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS likes_public BOOLEAN DEFAULT true;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reshares_public BOOLEAN DEFAULT true;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS saved_by JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS signaled_by JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS forked_by JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS content_document JSONB;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS quote JSONB;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS patronage JSONB;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS opportunity JSONB;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{"signal":"0","forks":"0","saves":"0","reads":"0"}'::jsonb;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS saved_by JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS signaled_by JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS forked_by JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS quote JSONB;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS content_document JSONB;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
        CREATE INDEX IF NOT EXISTS content_views_target_idx ON content_views (target_type, target_id);
        CREATE INDEX IF NOT EXISTS content_views_actor_idx ON content_views (actor_handle);
        CREATE INDEX IF NOT EXISTS action_ledger_actor_activity_idx
          ON action_ledger (actor_handle, occurred_at DESC, subject_type, subject_id, action);
        CREATE INDEX IF NOT EXISTS items_quote_source_post_idx
          ON items ((quote->>'sourcePostId')) WHERE quote IS NOT NULL;
        CREATE INDEX IF NOT EXISTS comments_quote_source_post_idx
          ON comments ((quote->>'sourcePostId')) WHERE quote IS NOT NULL;
        CREATE INDEX IF NOT EXISTS items_quote_comment_source_idx
          ON items ((quote->>'sourceId')) WHERE quote->>'sourceType' = 'comment';
        CREATE INDEX IF NOT EXISTS comments_quote_comment_source_idx
          ON comments ((quote->>'sourceId')) WHERE quote->>'sourceType' = 'comment';
      `);

      const { rows } = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM items");
      if (Number(rows[0]?.count ?? 0) === 0) {
        await syncSeedPostgres();
      }

      await db.query(`
        INSERT INTO action_ledger (
          subject_type, subject_id, post_id, actor_handle, action, active, count, revision, occurred_at
        )
        SELECT DISTINCT
          'post', source.id, source.id, membership.actor_handle, membership.action, true, 1, 1, source.created_at
        FROM items source
        CROSS JOIN LATERAL (
          SELECT jsonb_array_elements_text(COALESCE(source.saved_by, '[]'::jsonb)) AS actor_handle, 'save'::text AS action
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(source.signaled_by, '[]'::jsonb)), 'signal'::text
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(source.forked_by, '[]'::jsonb)), 'fork'::text
        ) membership
        WHERE source.deleted_at IS NULL
        ON CONFLICT (subject_type, subject_id, actor_handle, action) DO NOTHING;

        INSERT INTO action_ledger (
          subject_type, subject_id, post_id, actor_handle, action, active, count, revision, occurred_at
        )
        SELECT DISTINCT
          'comment', source.id, source.item_id, membership.actor_handle, membership.action, true, 1, 1, source.created_at
        FROM comments source
        CROSS JOIN LATERAL (
          SELECT jsonb_array_elements_text(COALESCE(source.saved_by, '[]'::jsonb)) AS actor_handle, 'save'::text AS action
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(source.signaled_by, '[]'::jsonb)), 'signal'::text
          UNION ALL
          SELECT jsonb_array_elements_text(COALESCE(source.forked_by, '[]'::jsonb)), 'fork'::text
        ) membership
        WHERE source.deleted_at IS NULL
        ON CONFLICT (subject_type, subject_id, actor_handle, action) DO NOTHING;
      `);
    })();
  }
  await schemaReady;
};

const seedPostgres = async () => {
  const db = getPool();
  const seed = seedData();

  for (const person of Object.values(seed.profiles)) {
    await db.query(
      `INSERT INTO profiles (handle, name, role, location, bio, fields)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (handle) DO NOTHING`,
      [person.handle, person.name, person.role, person.location, person.bio, JSON.stringify(person.fields)]
    );
  }

  for (const item of seed.items) {
    await db.query(
      `INSERT INTO items (
        id, kind, room, title, author_handle, author_name, affiliation, date_label, status,
        metrics, gathering_reason, excerpt, body, tags, signals, claims, objections, evidence,
        tests, forks, saved, saved_by, signaled_by, forked_by, quote, patronage, opportunity, created_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        item.id,
        item.kind,
        item.room,
        item.title,
        item.authorHandle ?? handleFromName(item.author),
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
        JSON.stringify(item.savedBy ?? []),
        JSON.stringify(item.signaledBy ?? []),
        JSON.stringify(item.forkedBy ?? []),
        item.quote ? JSON.stringify(item.quote) : null,
        item.patronage ? JSON.stringify(item.patronage) : null,
        item.opportunity ? JSON.stringify(item.opportunity) : null,
        item.createdAt ?? null
      ]
    );
    if (item.createdAt) {
      await db.query(
        "UPDATE items SET created_at = $2 WHERE id = $1 AND author_handle = $3",
        [item.id, item.createdAt, item.authorHandle ?? handleFromName(item.author)]
      );
    }
    await insertCommentTree(item.id, item.comments);
  }
};

const syncSeedPostgres = async () => {
  if (!usePostgres) return;
  if (!seedReady) seedReady = seedPostgres();
  await seedReady;
};

const insertCommentTree = async (itemId: string, comments: InquiryComment[]) => {
  const db = getPool();

  for (const comment of comments) {
    await db.query(
      `INSERT INTO comments (
        id, item_id, parent_id, author_handle, author_name, stance, body,
        metrics, saved_by, signaled_by, forked_by, quote, created_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO NOTHING`,
      [
        comment.id ?? newId("comment"),
        itemId,
        comment.parentId ?? null,
        comment.authorHandle ?? handleFromName(comment.author),
        comment.author,
        comment.stance,
        comment.body,
        JSON.stringify({ ...commentMetricsFallback, ...(comment.metrics ?? {}) }),
        JSON.stringify(comment.savedBy ?? []),
        JSON.stringify(comment.signaledBy ?? []),
        JSON.stringify(comment.forkedBy ?? []),
        comment.quote ? JSON.stringify(comment.quote) : null,
        stableSeedCreatedAt(comment.createdAt, legacyLiveSeedCreatedAt(comment.id, 1)) ?? new Date().toISOString()
      ]
    );
    await insertCommentTree(itemId, comment.replies ?? []);
  }
};

const readLocal = async (): Promise<AppData> => {
  try {
    const raw = await readFile(localDataPath, "utf8");
    return mergeSeedData(normalizeData(JSON.parse(raw) as AppData));
  } catch {
    const seed = seedData();
    await writeLocal(seed);
    return seed;
  }
};

const writeLocal = async (data: AppData) => {
  await mkdir(path.dirname(localDataPath), { recursive: true });
  const temporaryPath = `${localDataPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temporaryPath, localDataPath);
};

type CommentRow = {
  id: string;
  item_id: string;
  parent_id: string | null;
  author_handle: string;
  author_name: string;
  stance: string;
  body: string;
  content_document: VersionedDocumentContract | null;
  metrics: Pick<InquiryItem["metrics"], "signal" | "forks" | "saves" | "reads"> | null;
  saved_by: string[] | null;
  signaled_by: string[] | null;
  forked_by: string[] | null;
  quote: ContentQuoteContract | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string | null;
};

type ActionLedgerRow = {
  subject_type: CanonicalActionActivityContract["subjectType"];
  subject_id: string;
  post_id: string;
  actor_handle: string;
  action: ToggleActionContract;
  active: boolean;
  count: number;
  revision: number;
  occurred_at: string;
};

const commentTreesFromRows = (rows: CommentRow[]) => {
  const byItemAndParent = new Map<string, Map<string, CommentRow[]>>();

  for (const row of rows) {
    const parentKey = row.parent_id ?? "root";
    const byParent = byItemAndParent.get(row.item_id) ?? new Map<string, CommentRow[]>();
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), row]);
    byItemAndParent.set(row.item_id, byParent);
  }

  const buildTree = (byParent: Map<string, CommentRow[]>, parentId: string | null = null): InquiryComment[] =>
    (byParent.get(parentId ?? "root") ?? []).map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      author: row.author_name,
      authorHandle: row.author_handle,
      stance: row.stance,
      body: row.body,
      document: row.content_document ?? undefined,
      metrics: { ...commentMetricsFallback, ...(row.metrics ?? {}) },
      savedBy: row.saved_by ?? [],
      signaledBy: row.signaled_by ?? [],
      forkedBy: row.forked_by ?? [],
      quote: row.quote ?? undefined,
      editedAt: row.edited_at ?? undefined,
      deletedAt: row.deleted_at ?? undefined,
      createdAt: row.created_at ?? undefined,
      replies: buildTree(byParent, row.id)
    }));

  return new Map(
    [...byItemAndParent.entries()].map(([itemId, byParent]) => [itemId, buildTree(byParent)])
  );
};

const loadPostgres = async (): Promise<AppData> => {
  await ensureSchema();
  await syncSeedPostgres();
  const db = getPool();
  const [profileResult, itemResult, commentResult, actionResult] = await Promise.all([
    db.query<{
      handle: string;
      email: string | null;
      avatar_url: string | null;
      likes_public: boolean;
      reshares_public: boolean;
      name: string;
      role: string;
      location: string;
      bio: string;
      fields: string[];
    }>(
      `SELECT
        handle,
        email,
        avatar_url,
        likes_public,
        reshares_public,
        name,
        role,
        location,
        bio,
        fields
       FROM profiles
       ORDER BY created_at ASC`
    ),
    db.query<{
      id: string;
      kind: ContentKind;
      room: Exclude<RoomId, "hall">;
      title: string;
      author_handle: string;
      author_name: string;
      affiliation: string;
      date_label: string;
      created_at: string;
      edited_at: string | null;
      deleted_at: string | null;
      status: string;
      metrics: InquiryItem["metrics"];
      gathering_reason: string;
      excerpt: string;
      body: string;
      content_document: VersionedDocumentContract | null;
      tags: string[];
      signals: InquiryItem["signals"];
      claims: string[];
      objections: string[];
      evidence: string[];
      tests: string[];
      forks: string[];
      attachments: InquiryAttachment[] | null;
      saved: boolean;
      saved_by: string[];
      signaled_by: string[];
      forked_by: string[];
      quote: ContentQuoteContract | null;
      patronage: InquiryItem["patronage"] | null;
      opportunity: InquiryItem["opportunity"] | null;
    }>("SELECT * FROM items ORDER BY created_at DESC"),
    db.query<CommentRow>("SELECT * FROM comments ORDER BY created_at ASC"),
    db.query<ActionLedgerRow>(
      `SELECT subject_type, subject_id, post_id, actor_handle, action, active, count, revision, occurred_at
       FROM action_ledger
       ORDER BY occurred_at DESC, subject_type DESC, subject_id DESC, action DESC`
    )
  ]);
  const commentsByItem = commentTreesFromRows(commentResult.rows);

  const profiles = Object.fromEntries(
    profileResult.rows.map((person) => [
      person.handle,
      {
        name: person.name,
        handle: person.handle,
        email: person.email ?? undefined,
        avatarUrl: person.avatar_url ?? undefined,
        likesPublic: person.likes_public ?? true,
        resharesPublic: person.reshares_public ?? true,
        role: person.role,
        location: person.location,
        bio: person.bio,
        fields: person.fields
      }
    ])
  );
  const items = itemResult.rows.map((item) => ({
    id: item.id,
    kind: item.kind,
    room: item.room,
    title: item.title,
    author: item.author_name,
    authorHandle: item.author_handle || undefined,
    affiliation: item.affiliation,
    date: item.date_label,
    createdAt: item.created_at ? new Date(item.created_at).toISOString() : undefined,
    editedAt: item.edited_at ? new Date(item.edited_at).toISOString() : undefined,
    deletedAt: item.deleted_at ? new Date(item.deleted_at).toISOString() : undefined,
    status: item.status,
    metrics: item.metrics,
    gatheringReason: item.gathering_reason,
    excerpt: item.excerpt,
    body: item.body,
    document: item.content_document ?? undefined,
    tags: item.tags,
    signals: item.signals,
    claims: item.claims,
    objections: item.objections,
    evidence: item.evidence,
    tests: item.tests,
    forks: item.forks,
    attachments: item.attachments ?? [],
    quote: item.quote ?? undefined,
    patronage: item.patronage ?? undefined,
    opportunity: item.opportunity ?? undefined,
    comments: commentsByItem.get(item.id) ?? [],
    saved: item.saved,
    savedBy: item.saved_by?.length ? item.saved_by : item.saved ? [defaultProfile.handle] : [],
    signaledBy: item.signaled_by ?? [],
    forkedBy: item.forked_by ?? []
  }));
  const ledger = mergeCanonicalActivities(
    buildLegacyActionLedger(items),
    actionResult.rows.map((row) => ({
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      postId: row.post_id,
      actorHandle: row.actor_handle,
      action: row.action,
      active: row.active,
      count: row.count,
      revision: Number(row.revision),
      occurredAt: new Date(row.occurred_at).toISOString()
    }))
  );

  return {
    viewDedupe: {},
    profiles,
    items: projectCanonicalActionLedger(items, ledger),
    actionLedger: activityRecord(ledger)
  };
};

export const getSnapshot = async () => (usePostgres ? loadPostgres() : readLocal());

export const upsertProfile = async (input: CreateProfileInput) => {
  const person = normalizeProfile(input);

  if (usePostgres) {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO profiles (handle, email, avatar_url, likes_public, reshares_public, name, role, location, bio, fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (handle) DO UPDATE SET
         email = EXCLUDED.email,
         avatar_url = EXCLUDED.avatar_url,
         likes_public = EXCLUDED.likes_public,
         reshares_public = EXCLUDED.reshares_public,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         location = EXCLUDED.location,
         bio = EXCLUDED.bio,
         fields = EXCLUDED.fields,
         updated_at = now()`,
      [
        person.handle,
        person.email ?? null,
        person.avatarUrl ?? null,
        person.likesPublic ?? true,
        person.resharesPublic ?? true,
        person.name,
        person.role,
        person.location,
        person.bio,
        JSON.stringify(person.fields)
      ]
    );
    await getPool().query("UPDATE items SET author_name = $2 WHERE author_handle = $1", [person.handle, person.name]);
    await getPool().query("UPDATE comments SET author_name = $2 WHERE author_handle = $1", [person.handle, person.name]);
    return person;
  }

  const data = await readLocal();
  const previousPerson = data.profiles[person.handle];
  const revisionedPerson = { ...person, revision: (previousPerson?.revision ?? 0) + 1 };
  data.profiles[person.handle] = revisionedPerson;
  const updateCommentAuthors = (comments: InquiryComment[]): InquiryComment[] =>
    comments.map((comment) => {
      const replies = updateCommentAuthors(comment.replies ?? []);
      const authorChanged =
        !isDeletedComment(comment) &&
        comment.authorHandle === revisionedPerson.handle &&
        comment.author !== revisionedPerson.name;
      if (!authorChanged && replies.every((reply, index) => reply === comment.replies?.[index])) return comment;
      return {
        ...comment,
        author: authorChanged ? revisionedPerson.name : comment.author,
        revision: authorChanged ? (comment.revision ?? 1) + 1 : comment.revision,
        replies
      };
    });
  data.items = data.items.map((item) => {
    const comments = updateCommentAuthors(item.comments);
    const authorChanged = item.authorHandle === revisionedPerson.handle && item.author !== revisionedPerson.name;
    const commentsChanged = comments.some((comment, index) => comment !== item.comments[index]);
    return {
      ...item,
      author: item.authorHandle === revisionedPerson.handle ? revisionedPerson.name : item.author,
      revision: authorChanged || commentsChanged ? (item.revision ?? 1) + 1 : item.revision,
      comments
    };
  });
  await writeLocal(data);
  return revisionedPerson;
};

export const createPost = async (input: CreatePostInput, authorHandle: string) => {
  const data = await getSnapshot();
  const author = data.profiles[authorHandle] ?? defaultProfile;
  const isPaper = input.kind === "paper";
  const isProposal = Boolean(input.patronage);
  const isOpportunity = Boolean(input.opportunity);
  const item: InquiryItem = {
    id: newId("post"),
    revision: 1,
    kind: input.kind,
    room: input.room,
    title: input.title.trim(),
    author: author.name,
    authorHandle: author.handle,
    affiliation: author.location,
    date: "Just now",
    createdAt: new Date().toISOString(),
    status: isProposal || isOpportunity ? "Open" : isPaper ? "Draft" : "New",
    metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
    gatheringReason: isProposal ? "A public Patronage proposal seeking practical support." : isOpportunity ? "A public opportunity inviting applications." : "A new working post added to the live v0.",
    excerpt: input.body.trim(),
    body: input.body.trim(),
    document: input.document,
    tags: [input.room, input.kind, ...(isProposal ? ["patronage", "proposal"] : []), ...(isOpportunity ? ["opportunity", input.opportunity!.kind] : []), ...author.fields.slice(0, 2).map((field) => field.toLowerCase())],
    signals: [
      { label: "Status", value: isProposal ? "Open" : isPaper ? "Draft" : "New" },
      { label: "Critiques", value: "0" },
      { label: "Forks", value: "0" },
      { label: "Next action", value: "Invite critique" }
    ],
    claims: [input.body.trim()],
    objections: [],
    evidence: [],
    tests: [],
    forks: [],
    comments: [],
    attachments: input.attachments ?? [],
    quote: input.quote,
    patronage: input.patronage ? {
      ...input.patronage,
      raisedMinorUnits: 0,
      supporterCount: 0,
      topSupporters: []
    } : undefined,
    opportunity: input.opportunity ? { ...input.opportunity, applicationCount: 0 } : undefined,
    saved: input.room === "office",
    savedBy: input.room === "office" ? [author.handle] : [],
    signaledBy: [],
    forkedBy: []
  };

  if (usePostgres) {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO items (
        id, kind, room, title, author_handle, author_name, affiliation, date_label, created_at, status,
        metrics, gathering_reason, excerpt, body, tags, signals, claims, objections, evidence,
        tests, forks, attachments, saved, saved_by, signaled_by, forked_by, quote, patronage, opportunity
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
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
        item.createdAt,
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
        JSON.stringify(item.attachments ?? []),
        item.saved,
        JSON.stringify(item.savedBy),
        JSON.stringify(item.signaledBy),
        JSON.stringify(item.forkedBy),
        item.quote ? JSON.stringify(item.quote) : null,
        item.patronage ? JSON.stringify(item.patronage) : null,
        item.opportunity ? JSON.stringify(item.opportunity) : null
      ]
    );
    if (item.document) {
      await getPool().query("UPDATE items SET content_document = $2 WHERE id = $1", [item.id, JSON.stringify(item.document)]);
    }
    if (item.savedBy?.includes(author.handle)) {
      await persistPostgresActivity({
        ...createLocalCanonicalActivity({
          subjectType: "post",
          subjectId: item.id,
          postId: item.id,
          actorHandle: author.handle,
          action: "save",
          active: true,
          occurredAt: item.createdAt
        }),
        revision: 1
      });
    }
    return item;
  }

  const local = await readLocal();
  local.items = [item, ...local.items];
  if (item.savedBy?.includes(author.handle)) {
    const activity: CanonicalActionActivityContract = {
      ...createLocalCanonicalActivity({
        subjectType: "post",
        subjectId: item.id,
        postId: item.id,
        actorHandle: author.handle,
        action: "save",
        active: true,
        occurredAt: item.createdAt
      }),
      revision: 1
    };
    local.actionLedger[canonicalActivityKey(activity)] = activity;
  }
  await writeLocal(local);
  return item;
};

export const addComment = async (itemId: string, input: CreateCommentInput, authorHandle: string) => {
  const data = await getSnapshot();
  const existing = data.items.find((item) => item.id === itemId);
  if (!existing || isDeletedPost(existing)) return null;
  if (input.parentId && !findCommentInTree(existing.comments, input.parentId)) return null;
  if (input.attachments?.length && (existing.room === "office" || existing.kind === "draft")) return null;

  const author = data.profiles[authorHandle] ?? defaultProfile;
  const comment: InquiryComment = {
    id: input.id ?? newId("comment"),
    revision: 1,
    parentId: input.parentId ?? null,
    author: author.name,
    authorHandle: author.handle,
    stance: input.stance.trim() || "Comment",
    body: input.body.trim(),
    document: input.document,
    createdAt: new Date().toISOString(),
    metrics: { ...commentMetricsFallback },
    savedBy: [],
    signaledBy: [],
    forkedBy: [],
    attachments: input.attachments,
    quote: input.quote,
    replies: []
  };
  const nextCritiques = incrementMetric(existing.metrics.critiques, 1);
  const nextSignals = updateSignalValue(existing.signals, "Critiques", nextCritiques);
  const appended = appendCommentToTree(existing.comments, comment);
  if (!appended.inserted) return null;
  const updatedItem: InquiryItem = {
    ...existing,
    revision: (existing.revision ?? 1) + 1,
    metrics: { ...existing.metrics, critiques: nextCritiques },
    signals: nextSignals,
    comments: appended.comments
  };

  if (usePostgres) {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO comments (
        id, item_id, parent_id, author_handle, author_name, stance, body,
        metrics, saved_by, signaled_by, forked_by, quote, created_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        comment.id,
        itemId,
        comment.parentId,
        comment.authorHandle,
        comment.author,
        comment.stance,
        comment.body,
        JSON.stringify(comment.metrics),
        JSON.stringify(comment.savedBy),
        JSON.stringify(comment.signaledBy),
        JSON.stringify(comment.forkedBy),
        comment.quote ? JSON.stringify(comment.quote) : null,
        comment.createdAt
      ]
    );
    await getPool().query(
      `UPDATE items
       SET metrics = jsonb_set(metrics, '{critiques}', to_jsonb(($2)::text)),
           signals = $3
       WHERE id = $1`,
      [itemId, nextCritiques, JSON.stringify(nextSignals)]
    );
    if (comment.document) {
      await getPool().query("UPDATE comments SET content_document = $2 WHERE id = $1", [comment.id, JSON.stringify(comment.document)]);
    }
    return { comment, item: updatedItem };
  }

  const local = await readLocal();
  let localUpdatedItem: InquiryItem | null = null;
  local.items = local.items.map((item) => {
    if (item.id !== itemId) return item;
    if (isDeletedPost(item)) return item;
    if (input.parentId && !findCommentInTree(item.comments, input.parentId)) return item;

    const localAppended = appendCommentToTree(item.comments, comment);
    if (!localAppended.inserted) return item;

    const localNextCritiques = incrementMetric(item.metrics.critiques, 1);
    localUpdatedItem = {
      ...item,
      revision: (item.revision ?? 1) + 1,
      metrics: { ...item.metrics, critiques: localNextCritiques },
      signals: updateSignalValue(item.signals, "Critiques", localNextCritiques),
      comments: localAppended.comments
    };
    return localUpdatedItem;
  });
  if (!localUpdatedItem) return null;
  await writeLocal(local);
  return { comment, item: localUpdatedItem };
};

export const applyPostAction = async (
  itemId: string,
  action: PostAction,
  actorHandle = defaultProfile.handle,
  active?: boolean,
  trigger?: string,
  surface?: string
): Promise<ActionMutationResult | null> => {
  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing) return null;
    if (isDeletedPost(existing)) return { item: existing };
    if (action === "read" && !(await recordPostgresContentView("post", itemId, actorHandle, trigger, surface))) {
      return { item: existing };
    }
    let activity: CanonicalActionActivityContract | undefined;
    let base = existing;
    if (action !== "read") {
      const fallbackActive =
        action === "save"
          ? isSavedBy(existing, actorHandle, defaultProfile.handle)
          : action === "signal"
            ? hasHandle(existing.signaledBy, actorHandle)
            : hasHandle(existing.forkedBy, actorHandle);
      const transition = transitionLocalActivity({
        ledger: data.actionLedger,
        subjectType: "post",
        subjectId: itemId,
        postId: itemId,
        actorHandle,
        action,
        active,
        fallbackActive
      });
      activity = await persistPostgresActivity(transition.activity);
      base = setItemActionMembership(
        existing,
        action,
        actorHandle,
        transition.previousActive,
        defaultProfile.handle
      );
    }
    const updated = {
      ...mutateItemForActor(
      base,
      action,
      actorHandle,
      defaultProfile.handle,
      activity?.active ?? active
      ),
      revision: (existing.revision ?? 1) + 1
    };
    await getPool().query(
      `UPDATE items
       SET metrics = $2,
           saved = $3,
           saved_by = $4,
           signaled_by = $5,
           forked_by = $6,
           signals = $7
       WHERE id = $1`,
      [
        itemId,
        JSON.stringify(updated.metrics),
        Boolean(updated.saved),
        JSON.stringify(updated.savedBy ?? []),
        JSON.stringify(updated.signaledBy ?? []),
        JSON.stringify(updated.forkedBy ?? []),
        JSON.stringify(updated.signals)
      ]
    );
    return { item: updated, activity };
  }

  return withLocalActionLock(async () => {
    const local = await readLocal();
    let result: ActionMutationResult | null = null;
    local.items = local.items.map((item) => {
      if (item.id !== itemId) return item;
      if (isDeletedPost(item)) {
        result = { item };
        return item;
      }
      if (action === "read" && !claimLocalContentView(local, "post", itemId, actorHandle)) {
        result = { item };
        return item;
      }
      if (action === "read") {
        const updated = {
          ...mutateItemForActor(item, action, actorHandle, defaultProfile.handle, active),
          revision: (item.revision ?? 1) + 1
        };
        result = { item: updated };
        return updated;
      }

      const fallbackActive =
        action === "save"
          ? isSavedBy(item, actorHandle, defaultProfile.handle)
          : action === "signal"
            ? hasHandle(item.signaledBy, actorHandle)
            : hasHandle(item.forkedBy, actorHandle);
      const transition = transitionLocalActivity({
        ledger: local.actionLedger,
        subjectType: "post",
        subjectId: itemId,
        postId: itemId,
        actorHandle,
        action,
        active,
        fallbackActive
      });
      const base = setItemActionMembership(
        item,
        action,
        actorHandle,
        transition.previousActive,
        defaultProfile.handle
      );
      const updated = {
        ...mutateItemForActor(
        base,
        action,
        actorHandle,
        defaultProfile.handle,
        transition.activity.active
        ),
        revision: (item.revision ?? 1) + 1
      };
      result = { item: updated, activity: transition.activity };
      return updated;
    });
    await writeLocal(local);
    return result;
  });
};

const canManagePost = (item: InquiryItem, actorHandle: string) =>
  cleanHandle(item.authorHandle ?? item.author) === cleanHandle(actorHandle);

const sanitizePostgresQuotedSource = async (sourceType: "post" | "comment", sourceId: string) => {
  const predicate = sourceType === "post"
    ? "quote->>'sourcePostId' = $1"
    : "quote->>'sourceType' = 'comment' AND quote->>'sourceId' = $1";
  const unavailableQuote = `jsonb_build_object(
    'sourceType', quote->>'sourceType',
    'sourceId', quote->>'sourceId',
    'sourcePostId', quote->>'sourcePostId',
    'available', false,
    'attachmentCount', 0
  )`;
  await Promise.all([
    getPool().query(
      `UPDATE items SET quote = ${unavailableQuote} WHERE quote->>'available' = 'true' AND ${predicate}`,
      [sourceId]
    ),
    getPool().query(
      `UPDATE comments SET quote = ${unavailableQuote}, updated_at = now() WHERE quote->>'available' = 'true' AND ${predicate}`,
      [sourceId]
    )
  ]);
};

const updatePostShape = (item: InquiryItem, input: UpdatePostInput, editedAt = new Date().toISOString()): InquiryItem => {
  const patronage = input.patronage
    ? {
        ...input.patronage,
        raisedMinorUnits: item.patronage?.raisedMinorUnits ?? 0,
        supporterCount: item.patronage?.supporterCount ?? 0,
        topSupporters: item.patronage?.topSupporters ?? []
      }
    : item.patronage;
  const opportunity = input.opportunity
    ? { ...input.opportunity, applicationCount: item.opportunity?.applicationCount ?? 0 }
    : item.opportunity;
  return {
    ...item,
    revision: (item.revision ?? 1) + 1,
    title: input.title.trim(),
    body: input.body.trim(),
    document: input.document ?? item.document,
    excerpt: input.body.trim(),
    claims: [input.body.trim()],
    attachments: input.attachments ?? item.attachments,
    quote: input.quote === undefined ? item.quote : input.quote ?? undefined,
    patronage,
    opportunity,
    status: patronage ? patronage.status[0].toUpperCase() + patronage.status.slice(1)
      : opportunity ? opportunity.status[0].toUpperCase() + opportunity.status.slice(1)
      : item.status,
    editedAt
  };
};

export const updatePost = async (itemId: string, input: UpdatePostInput, actorHandle = defaultProfile.handle) => {
  const cleanInput = {
    title: input.title.trim(),
    body: input.body.trim(),
    document: input.document,
    attachments: input.attachments,
    quote: input.quote,
    patronage: input.patronage,
    opportunity: input.opportunity
  };
  if (!cleanInput.title || !cleanInput.body) return null;

  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing) || !canManagePost(existing, actorHandle)) return null;
    if (input.attachments?.length && (existing.room === "office" || existing.kind === "draft")) return null;

    const updated = updatePostShape(existing, cleanInput);
    await getPool().query(
      `UPDATE items
       SET title = $2,
           body = $3,
           content_document = $7,
           excerpt = $3,
           claims = $4,
           edited_at = $5,
           quote = $6,
           patronage = $8,
           opportunity = $9,
           status = $10
       WHERE id = $1`,
      [
        itemId,
        updated.title,
        updated.body,
        JSON.stringify(updated.claims),
        updated.editedAt,
        updated.quote ? JSON.stringify(updated.quote) : null,
        updated.document ? JSON.stringify(updated.document) : null,
        updated.patronage ? JSON.stringify(updated.patronage) : null,
        updated.opportunity ? JSON.stringify(updated.opportunity) : null,
        updated.status
      ]
    );
    return updated;
  }

  const local = await readLocal();
  let updated: InquiryItem | null = null;
  local.items = local.items.map((item) => {
    if (item.id !== itemId || isDeletedPost(item) || !canManagePost(item, actorHandle)) return item;
    if (input.attachments?.length && (item.room === "office" || item.kind === "draft")) return item;
    updated = updatePostShape(item, cleanInput);
    return updated;
  });
  if (!updated) return null;
  await writeLocal(local);
  return updated;
};

export const deletePost = async (itemId: string, actorHandle = defaultProfile.handle) => {
  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing) || !canManagePost(existing, actorHandle)) return null;

    const deleted = { ...tombstonePost(existing), revision: (existing.revision ?? 1) + 1 };
    await getPool().query(
      `UPDATE items
       SET title = $2,
           author_handle = $3,
           author_name = $4,
           affiliation = $5,
           status = $6,
           gathering_reason = $7,
           excerpt = $8,
           body = $9,
           tags = $10,
           signals = $11,
           claims = $12,
           objections = $13,
           evidence = $14,
           tests = $15,
           forks = $16,
           quote = NULL,
           patronage = NULL,
           opportunity = NULL,
           edited_at = NULL,
           deleted_at = $17
       WHERE id = $1`,
      [
        itemId,
        deleted.title,
        deleted.authorHandle ?? "",
        deleted.author,
        deleted.affiliation,
        deleted.status,
        deleted.gatheringReason,
        deleted.excerpt,
        deleted.body,
        JSON.stringify(deleted.tags),
        JSON.stringify(deleted.signals),
        JSON.stringify(deleted.claims),
        JSON.stringify(deleted.objections),
        JSON.stringify(deleted.evidence),
        JSON.stringify(deleted.tests),
        JSON.stringify(deleted.forks),
        deleted.deletedAt
      ]
    );
    await getPool().query(
      `UPDATE action_ledger
       SET active = false,
           count = 0,
           revision = revision + 1,
           occurred_at = now()
       WHERE post_id = $1 AND active = true`,
      [itemId]
    );
    await sanitizePostgresQuotedSource("post", itemId);
    return deleted;
  }

  const local = await readLocal();
  const existing = local.items.find((item) => item.id === itemId);
  if (!existing || isDeletedPost(existing) || !canManagePost(existing, actorHandle)) return null;
  const deleted = { ...tombstonePost(existing), revision: (existing.revision ?? 1) + 1 };
  local.items = local.items.map((item) => (item.id === itemId ? deleted : item));
  local.items = invalidateQuotedSource(local.items, {
    sourceType: "post",
    sourceId: itemId,
    sourcePostId: itemId
  });
  deactivateLedgerEntries(local.actionLedger, (activity) => activity.postId === itemId);
  await writeLocal(local);
  return deleted;
};

const updateCommentShape = (
  comment: InquiryComment,
  input: UpdateCommentInput,
  editedAt = new Date().toISOString()
): InquiryComment => ({
  ...comment,
  revision: (comment.revision ?? 1) + 1,
  body: input.body.trim(),
  document: input.document ?? comment.document,
  attachments: input.attachments ?? comment.attachments,
  quote: input.quote === undefined ? comment.quote : input.quote ?? undefined,
  editedAt
});

export const updateComment = async (
  itemId: string,
  commentId: string,
  input: UpdateCommentInput,
  actorHandle = defaultProfile.handle
) => {
  const cleanInput = { body: input.body.trim(), document: input.document, attachments: input.attachments, quote: input.quote };
  if (!cleanInput.body) return null;

  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing) return null;
    if (input.attachments?.length && (existing.room === "office" || existing.kind === "draft")) return null;
    const mapped = mapCommentTree(existing.comments, commentId, (comment) => {
      if (isDeletedComment(comment) || !canManageComment(comment, actorHandle)) return comment;
      return updateCommentShape(comment, cleanInput);
    });
    if (!mapped.updated || isDeletedComment(mapped.updated) || !canManageComment(mapped.updated, actorHandle)) {
      return null;
    }

    await getPool().query(
      `UPDATE comments
       SET body = $3,
           content_document = $6,
           edited_at = $4,
           quote = $5,
           updated_at = now()
       WHERE item_id = $1 AND id = $2`,
      [
        itemId,
        commentId,
        mapped.updated.body,
        mapped.updated.editedAt,
        mapped.updated.quote ? JSON.stringify(mapped.updated.quote) : null,
        mapped.updated.document ? JSON.stringify(mapped.updated.document) : null
      ]
    );
    return { ...existing, comments: mapped.comments, revision: (existing.revision ?? 1) + 1 };
  }

  const local = await readLocal();
  let updated: InquiryItem | null = null;
  local.items = local.items.map((item) => {
    if (item.id !== itemId) return item;
    if (input.attachments?.length && (item.room === "office" || item.kind === "draft")) return item;
    const mapped = mapCommentTree(item.comments, commentId, (comment) => {
      if (isDeletedComment(comment) || !canManageComment(comment, actorHandle)) return comment;
      return updateCommentShape(comment, cleanInput);
    });
    if (!mapped.updated || isDeletedComment(mapped.updated) || !canManageComment(mapped.updated, actorHandle)) {
      return item;
    }
    updated = { ...item, comments: mapped.comments, revision: (item.revision ?? 1) + 1 };
    return updated;
  });
  if (!updated) return null;
  await writeLocal(local);
  return updated;
};

export const deleteComment = async (
  itemId: string,
  commentId: string,
  actorHandle = defaultProfile.handle
) => {
  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing) return null;
    const original = findCommentInTree(existing.comments, commentId);
    if (!original || isDeletedComment(original) || !canManageComment(original, actorHandle)) return null;
    const deletion = tombstoneCommentInItem(existing, commentId);
    if (!deletion.deletedComment) return null;

    await getPool().query(
      `UPDATE comments
       SET author_handle = $3,
           author_name = $4,
           stance = $5,
           body = $6,
           metrics = $7,
           saved_by = $8,
           signaled_by = $9,
           forked_by = $10,
           quote = NULL,
           edited_at = NULL,
           deleted_at = $11,
           updated_at = now()
       WHERE item_id = $1 AND id = $2`,
      [
        itemId,
        commentId,
        "",
        deletion.deletedComment.author,
        deletion.deletedComment.stance,
        deletion.deletedComment.body,
        JSON.stringify(deletion.deletedComment.metrics ?? commentMetricsFallback),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        deletion.deletedComment.deletedAt
      ]
    );
    await getPool().query(
      `UPDATE action_ledger
       SET active = false,
           count = 0,
           revision = revision + 1,
           occurred_at = now()
       WHERE subject_type = 'comment' AND subject_id = $1 AND active = true`,
      [commentId]
    );

    await getPool().query(
      `UPDATE items
       SET metrics = $2,
           signals = $3
       WHERE id = $1`,
      [itemId, JSON.stringify(deletion.item.metrics), JSON.stringify(deletion.item.signals)]
    );

    await sanitizePostgresQuotedSource("comment", commentId);

    return { ...deletion.item, revision: (existing.revision ?? 1) + 1 };
  }

  const local = await readLocal();
  let deleted: InquiryItem | null = null;
  local.items = local.items.map((item) => {
    if (item.id !== itemId) return item;
    const original = findCommentInTree(item.comments, commentId);
    if (!original || isDeletedComment(original) || !canManageComment(original, actorHandle)) return item;
    const deletion = tombstoneCommentInItem(item, commentId);
    if (!deletion.deletedComment) return item;
    deleted = { ...deletion.item, revision: (item.revision ?? 1) + 1 };
    return deleted;
  });
  if (!deleted) return null;
  local.items = invalidateQuotedSource(local.items, {
    sourceType: "comment",
    sourceId: commentId,
    sourcePostId: itemId
  });
  deactivateLedgerEntries(
    local.actionLedger,
    (activity) => activity.subjectType === "comment" && activity.subjectId === commentId
  );
  await writeLocal(local);
  return deleted;
};

export const applyCommentAction = async (
  itemId: string,
  commentId: string,
  action: CommentAction,
  actorHandle = defaultProfile.handle,
  active?: boolean,
  trigger?: string,
  surface?: string
): Promise<ActionMutationResult | null> => {
  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing) return null;

    const original = findCommentInTree(existing.comments, commentId);
    if (!original) return null;
    if (isDeletedComment(original)) return { item: existing };
    if (action === "read" && !(await recordPostgresContentView("comment", commentId, actorHandle, trigger, surface))) {
      return { item: existing };
    }

    let activity: CanonicalActionActivityContract | undefined;
    let previousActive = false;
    if (action !== "read") {
      const transition = transitionLocalActivity({
        ledger: data.actionLedger,
        subjectType: "comment",
        subjectId: commentId,
        postId: itemId,
        actorHandle,
        action,
        active,
        fallbackActive: Boolean(commentActionActive(original, action, actorHandle))
      });
      previousActive = transition.previousActive;
      activity = await persistPostgresActivity(transition.activity);
    }

    const mapped = mapCommentTree(existing.comments, commentId, (comment) => {
      const base = action === "read"
        ? comment
        : setCommentActionMembership(comment, action, actorHandle, previousActive);
      return {
        ...mutateCommentForActor(base, action, actorHandle, activity?.active ?? active),
        revision: (comment.revision ?? 1) + 1
      };
    });
    if (!mapped.updated) return null;

    await getPool().query(
      `UPDATE comments
       SET metrics = $3,
           saved_by = $4,
           signaled_by = $5,
           forked_by = $6,
           updated_at = now()
       WHERE item_id = $1 AND id = $2`,
      [
        itemId,
        commentId,
        JSON.stringify(mapped.updated.metrics ?? commentMetricsFallback),
        JSON.stringify(mapped.updated.savedBy ?? []),
        JSON.stringify(mapped.updated.signaledBy ?? []),
        JSON.stringify(mapped.updated.forkedBy ?? [])
      ]
    );

    return {
      item: { ...existing, comments: mapped.comments, revision: (existing.revision ?? 1) + 1 },
      activity
    };
  }

  return withLocalActionLock(async () => {
    const local = await readLocal();
    let result: ActionMutationResult | null = null;
    local.items = local.items.map((item) => {
      if (item.id !== itemId) return item;
      const original = findCommentInTree(item.comments, commentId);
      if (!original) return item;
      if (isDeletedComment(original)) {
        result = { item };
        return item;
      }
      if (action === "read" && !claimLocalContentView(local, "comment", commentId, actorHandle)) {
        result = { item };
        return item;
      }
      let activity: CanonicalActionActivityContract | undefined;
      let previousActive = false;
      if (action !== "read") {
        const transition = transitionLocalActivity({
          ledger: local.actionLedger,
          subjectType: "comment",
          subjectId: commentId,
          postId: itemId,
          actorHandle,
          action,
          active,
          fallbackActive: Boolean(commentActionActive(original, action, actorHandle))
        });
        previousActive = transition.previousActive;
        activity = transition.activity;
      }
      const mapped = mapCommentTree(item.comments, commentId, (comment) => {
        const base = action === "read"
          ? comment
          : setCommentActionMembership(comment, action, actorHandle, previousActive);
        return {
          ...mutateCommentForActor(base, action, actorHandle, activity?.active ?? active),
          revision: (comment.revision ?? 1) + 1
        };
      });
      if (!mapped.updated) return item;
      const updated = { ...item, comments: mapped.comments, revision: (item.revision ?? 1) + 1 };
      result = { item: updated, activity };
      return updated;
    });
    if (!result) return null;
    await writeLocal(local);
    return result;
  });
};
