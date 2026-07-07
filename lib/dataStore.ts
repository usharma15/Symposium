import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  getProfileForName,
  inquiryItems,
  profile as defaultProfile,
  profilesByName,
  type ContentKind,
  type InquiryComment,
  type InquiryItem,
  type ResearchProfile,
  type RoomId
} from "@/lib/mockData";
import {
  cleanHandle,
  incrementMetric,
  isDeletedComment,
  isDeletedPost,
  mutateItemForActor,
  tombstoneComment,
  tombstonePost,
  toggleHandle,
  updateSignalValue,
  type PostAction
} from "@/lib/symposiumCore";

type AppData = {
  profiles: Record<string, ResearchProfile>;
  items: InquiryItem[];
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
  kind: ContentKind;
  room: Exclude<RoomId, "hall">;
};

export type CreateCommentInput = {
  body: string;
  stance: string;
  parentId?: string | null;
};

export type { PostAction };
export type CommentAction = PostAction;

export type UpdatePostInput = {
  title: string;
  body: string;
};

export type UpdateCommentInput = {
  body: string;
};

const commentMetricsFallback = { signal: "0", forks: "0", saves: "0", reads: "0" };

const localDataPath = process.env.VERCEL
  ? path.join("/tmp", "symposium.json")
  : path.join(process.cwd(), ".data", "symposium.json");
const databaseUrl = process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
const usePostgres = Boolean(databaseUrl);

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;
let seedReady: Promise<void> | null = null;

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
    createdAt: stableSeedCreatedAt(seedItem?.createdAt ?? item.createdAt, legacyLiveSeedCreatedAt(item.id)),
    savedBy: item.savedBy ?? (item.saved ? [defaultProfile.handle] : []),
    signaledBy: item.signaledBy ?? [],
    forkedBy: item.forkedBy ?? [],
    saved: Boolean(item.saved),
    comments: normalizeCommentState(item.comments ?? [])
  };
};

const normalizeData = (data: AppData): AppData => ({
  profiles: data.profiles,
  items: data.items.map(normalizeItem)
});

const mergeSeedData = (data: AppData): AppData => {
  const seed = seedData();
  const existingItemIds = new Set(data.items.map((item) => item.id));

  return {
    profiles: { ...seed.profiles, ...data.profiles },
    items: [
      ...data.items,
      ...seed.items.filter((item) => !existingItemIds.has(item.id))
    ].map(normalizeItem)
  };
};

const seedData = (): AppData => {
  const profiles = Object.fromEntries(
    Object.values(profilesByName).map((person) => [person.handle, person])
  );

  return {
    profiles,
    items: inquiryItems.map((item, itemIndex) => ({
      ...normalizeItem(item),
      authorHandle: handleFromName(item.author),
      comments: normalizeComments(item.comments, item.id, itemIndex)
    }))
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
          tags JSONB NOT NULL,
          signals JSONB NOT NULL,
          claims JSONB NOT NULL,
          objections JSONB NOT NULL,
          evidence JSONB NOT NULL,
          tests JSONB NOT NULL,
          forks JSONB NOT NULL,
          saved BOOLEAN DEFAULT false,
          saved_by JSONB DEFAULT '[]'::jsonb,
          signaled_by JSONB DEFAULT '[]'::jsonb,
          forked_by JSONB DEFAULT '[]'::jsonb,
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
          metrics JSONB NOT NULL DEFAULT '{"signal":"0","forks":"0","saves":"0","reads":"0"}'::jsonb,
          saved_by JSONB NOT NULL DEFAULT '[]'::jsonb,
          signaled_by JSONB NOT NULL DEFAULT '[]'::jsonb,
          forked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
          edited_at TIMESTAMPTZ,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
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
        ALTER TABLE items ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
        ALTER TABLE items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{"signal":"0","forks":"0","saves":"0","reads":"0"}'::jsonb;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS saved_by JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS signaled_by JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS forked_by JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
      `);

      const { rows } = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM items");
      if (Number(rows[0]?.count ?? 0) === 0) {
        await syncSeedPostgres();
      }
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
        tests, forks, saved, saved_by, signaled_by, forked_by, created_at
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
        metrics, saved_by, signaled_by, forked_by, created_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        stableSeedCreatedAt(comment.createdAt, legacyLiveSeedCreatedAt(comment.id, 1)) ?? new Date().toISOString()
      ]
    );
    await insertCommentTree(itemId, comment.replies ?? []);
  }
};

const readLocal = async (): Promise<AppData> => {
  try {
    const raw = await readFile(localDataPath, "utf8");
    const merged = mergeSeedData(normalizeData(JSON.parse(raw) as AppData));
    await writeLocal(merged);
    return merged;
  } catch {
    const seed = seedData();
    await writeLocal(seed);
    return seed;
  }
};

const writeLocal = async (data: AppData) => {
  await mkdir(path.dirname(localDataPath), { recursive: true });
  await writeFile(localDataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

type CommentRow = {
  id: string;
  item_id: string;
  parent_id: string | null;
  author_handle: string;
  author_name: string;
  stance: string;
  body: string;
  metrics: Pick<InquiryItem["metrics"], "signal" | "forks" | "saves" | "reads"> | null;
  saved_by: string[] | null;
  signaled_by: string[] | null;
  forked_by: string[] | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string | null;
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
      metrics: { ...commentMetricsFallback, ...(row.metrics ?? {}) },
      savedBy: row.saved_by ?? [],
      signaledBy: row.signaled_by ?? [],
      forkedBy: row.forked_by ?? [],
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
  const [profileResult, itemResult, commentResult] = await Promise.all([
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
      tags: string[];
      signals: InquiryItem["signals"];
      claims: string[];
      objections: string[];
      evidence: string[];
      tests: string[];
      forks: string[];
      saved: boolean;
      saved_by: string[];
      signaled_by: string[];
      forked_by: string[];
    }>("SELECT * FROM items ORDER BY created_at DESC"),
    db.query<CommentRow>("SELECT * FROM comments ORDER BY created_at ASC")
  ]);
  const commentsByItem = commentTreesFromRows(commentResult.rows);

  return {
    profiles: Object.fromEntries(
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
    ),
    items: itemResult.rows.map((item) => ({
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
      tags: item.tags,
      signals: item.signals,
      claims: item.claims,
      objections: item.objections,
      evidence: item.evidence,
      tests: item.tests,
      forks: item.forks,
      comments: commentsByItem.get(item.id) ?? [],
      saved: item.saved,
      savedBy: item.saved_by?.length ? item.saved_by : item.saved ? [defaultProfile.handle] : [],
      signaledBy: item.signaled_by ?? [],
      forkedBy: item.forked_by ?? []
    }))
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
  data.profiles[person.handle] = person;
  const updateCommentAuthors = (comments: InquiryComment[]): InquiryComment[] =>
    comments.map((comment) => ({
      ...comment,
      author: !isDeletedComment(comment) && comment.authorHandle === person.handle ? person.name : comment.author,
      replies: updateCommentAuthors(comment.replies ?? [])
    }));
  data.items = data.items.map((item) => ({
    ...item,
    author: item.authorHandle === person.handle ? person.name : item.author,
    comments: updateCommentAuthors(item.comments)
  }));
  await writeLocal(data);
  return person;
};

export const createPost = async (input: CreatePostInput, authorHandle: string) => {
  const data = await getSnapshot();
  const author = data.profiles[authorHandle] ?? defaultProfile;
  const isPaper = input.kind === "paper";
  const item: InquiryItem = {
    id: newId("post"),
    kind: input.kind,
    room: input.room,
    title: input.title.trim(),
    author: author.name,
    authorHandle: author.handle,
    affiliation: author.location,
    date: "Just now",
    createdAt: new Date().toISOString(),
    status: isPaper ? "Draft" : "New",
    metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
    gatheringReason: "A new working post added to the live v0.",
    excerpt: input.body.trim(),
    body: input.body.trim(),
    tags: [input.room, input.kind, ...author.fields.slice(0, 2).map((field) => field.toLowerCase())],
    signals: [
      { label: "Status", value: isPaper ? "Draft" : "New" },
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
        tests, forks, saved, saved_by, signaled_by, forked_by
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
        item.saved,
        JSON.stringify(item.savedBy),
        JSON.stringify(item.signaledBy),
        JSON.stringify(item.forkedBy)
      ]
    );
    return item;
  }

  const local = await readLocal();
  local.items = [item, ...local.items];
  await writeLocal(local);
  return item;
};

export const addComment = async (itemId: string, input: CreateCommentInput, authorHandle: string) => {
  const data = await getSnapshot();
  const author = data.profiles[authorHandle] ?? defaultProfile;
  const comment: InquiryComment = {
    id: newId("comment"),
    parentId: input.parentId ?? null,
    author: author.name,
    authorHandle: author.handle,
    stance: input.stance.trim() || "Comment",
    body: input.body.trim(),
    createdAt: new Date().toISOString(),
    metrics: { ...commentMetricsFallback },
    savedBy: [],
    signaledBy: [],
    forkedBy: [],
    replies: []
  };

  if (usePostgres) {
    await ensureSchema();
    const existing = data.items.find((item) => item.id === itemId);
    const nextCritiques = incrementMetric(existing?.metrics.critiques ?? "0", 1);
    const nextSignals = updateSignalValue(existing?.signals ?? [], "Critiques", nextCritiques);
    await getPool().query(
      `INSERT INTO comments (
        id, item_id, parent_id, author_handle, author_name, stance, body,
        metrics, saved_by, signaled_by, forked_by, created_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
    return comment;
  }

  const addToTree = (comments: InquiryComment[]): InquiryComment[] => {
    if (!comment.parentId) return [...comments, comment];
    return comments.map((current) =>
      current.id === comment.parentId
        ? { ...current, replies: [...(current.replies ?? []), comment] }
        : { ...current, replies: addToTree(current.replies ?? []) }
    );
  };

  const local = await readLocal();
  local.items = local.items.map((item) =>
    item.id === itemId
      ? (() => {
          const nextCritiques = incrementMetric(item.metrics.critiques, 1);
          return {
            ...item,
            metrics: { ...item.metrics, critiques: nextCritiques },
            signals: updateSignalValue(item.signals, "Critiques", nextCritiques),
            comments: addToTree(item.comments)
          };
        })()
      : item
  );
  await writeLocal(local);
  return comment;
};

export const applyPostAction = async (itemId: string, action: PostAction, actorHandle = defaultProfile.handle, active?: boolean) => {
  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing) return null;
    if (isDeletedPost(existing)) return existing;
    const updated = mutateItemForActor(existing, action, actorHandle, defaultProfile.handle, active);
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
    return updated;
  }

  const local = await readLocal();
  let updated: InquiryItem | null = null;
  local.items = local.items.map((item) => {
    if (item.id !== itemId) return item;
    if (isDeletedPost(item)) {
      updated = item;
      return item;
    }
    updated = mutateItemForActor(item, action, actorHandle, defaultProfile.handle, active);
    return updated;
  });
  await writeLocal(local);
  return updated;
};

const canManagePost = (item: InquiryItem, actorHandle: string) =>
  cleanHandle(item.authorHandle ?? item.author) === cleanHandle(actorHandle);

const updatePostShape = (item: InquiryItem, input: UpdatePostInput, editedAt = new Date().toISOString()): InquiryItem => ({
  ...item,
  title: input.title.trim(),
  body: input.body.trim(),
  excerpt: input.body.trim(),
  claims: [input.body.trim()],
  editedAt
});

export const updatePost = async (itemId: string, input: UpdatePostInput, actorHandle = defaultProfile.handle) => {
  const cleanInput = {
    title: input.title.trim(),
    body: input.body.trim()
  };
  if (!cleanInput.title || !cleanInput.body) return null;

  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing) || !canManagePost(existing, actorHandle)) return null;

    const updated = updatePostShape(existing, cleanInput);
    await getPool().query(
      `UPDATE items
       SET title = $2,
           body = $3,
           excerpt = $3,
           claims = $4,
           edited_at = $5
       WHERE id = $1`,
      [itemId, updated.title, updated.body, JSON.stringify(updated.claims), updated.editedAt]
    );
    return updated;
  }

  const local = await readLocal();
  let updated: InquiryItem | null = null;
  local.items = local.items.map((item) => {
    if (item.id !== itemId || isDeletedPost(item) || !canManagePost(item, actorHandle)) return item;
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

    const deleted = tombstonePost(existing);
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
    return deleted;
  }

  const local = await readLocal();
  const existing = local.items.find((item) => item.id === itemId);
  if (!existing || isDeletedPost(existing) || !canManagePost(existing, actorHandle)) return null;
  const deleted = tombstonePost(existing);
  local.items = local.items.map((item) => (item.id === itemId ? deleted : item));
  await writeLocal(local);
  return deleted;
};

const mutateCommentForActor = (
  comment: InquiryComment,
  action: CommentAction,
  actorHandle: string,
  active?: boolean
): InquiryComment => {
  if (isDeletedComment(comment)) return comment;

  const metrics = { ...commentMetricsFallback, ...(comment.metrics ?? {}) };

  if (action === "save") {
    const next = toggleHandle(comment.savedBy, actorHandle, active);
    return {
      ...comment,
      savedBy: next.handles,
      metrics: { ...metrics, saves: incrementMetric(metrics.saves, next.delta) }
    };
  }

  if (action === "signal") {
    const next = toggleHandle(comment.signaledBy, actorHandle, active);
    return {
      ...comment,
      signaledBy: next.handles,
      metrics: { ...metrics, signal: incrementMetric(metrics.signal, next.delta) }
    };
  }

  if (action === "fork") {
    const next = toggleHandle(comment.forkedBy, actorHandle, active);
    return {
      ...comment,
      forkedBy: next.handles,
      metrics: { ...metrics, forks: incrementMetric(metrics.forks, next.delta) }
    };
  }

  return {
    ...comment,
    metrics: { ...metrics, reads: incrementMetric(metrics.reads, 1) }
  };
};

const mapCommentTree = (
  comments: InquiryComment[],
  commentId: string,
  mutate: (comment: InquiryComment) => InquiryComment
): { comments: InquiryComment[]; updated: InquiryComment | null } => {
  let updated: InquiryComment | null = null;
  const nextComments = comments.map((comment) => {
    if (comment.id === commentId) {
      updated = mutate(comment);
      return updated;
    }
    const child = mapCommentTree(comment.replies ?? [], commentId, mutate);
    if (child.updated) updated = child.updated;
    return child.updated ? { ...comment, replies: child.comments } : comment;
  });

  return { comments: nextComments, updated };
};

const findCommentInTree = (comments: InquiryComment[], commentId: string): InquiryComment | null => {
  for (const comment of comments) {
    if (comment.id === commentId) return comment;
    const found = findCommentInTree(comment.replies ?? [], commentId);
    if (found) return found;
  }
  return null;
};

const canManageComment = (comment: InquiryComment, actorHandle: string) =>
  comment.authorHandle ? cleanHandle(comment.authorHandle) === cleanHandle(actorHandle) : false;

const updateCommentShape = (
  comment: InquiryComment,
  input: UpdateCommentInput,
  editedAt = new Date().toISOString()
): InquiryComment => ({
  ...comment,
  body: input.body.trim(),
  editedAt
});

export const updateComment = async (
  itemId: string,
  commentId: string,
  input: UpdateCommentInput,
  actorHandle = defaultProfile.handle
) => {
  const cleanInput = { body: input.body.trim() };
  if (!cleanInput.body) return null;

  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing) return null;
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
           edited_at = $4,
           updated_at = now()
       WHERE item_id = $1 AND id = $2`,
      [itemId, commentId, mapped.updated.body, mapped.updated.editedAt]
    );

    return { ...existing, comments: mapped.comments };
  }

  const local = await readLocal();
  let updated: InquiryItem | null = null;
  local.items = local.items.map((item) => {
    if (item.id !== itemId) return item;
    const mapped = mapCommentTree(item.comments, commentId, (comment) => {
      if (isDeletedComment(comment) || !canManageComment(comment, actorHandle)) return comment;
      return updateCommentShape(comment, cleanInput);
    });
    if (!mapped.updated || isDeletedComment(mapped.updated) || !canManageComment(mapped.updated, actorHandle)) {
      return item;
    }
    updated = { ...item, comments: mapped.comments };
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
    const mapped = mapCommentTree(existing.comments, commentId, tombstoneComment);
    if (!mapped.updated) return null;

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
           edited_at = NULL,
           deleted_at = $11,
           updated_at = now()
       WHERE item_id = $1 AND id = $2`,
      [
        itemId,
        commentId,
        "",
        mapped.updated.author,
        mapped.updated.stance,
        mapped.updated.body,
        JSON.stringify(mapped.updated.metrics ?? commentMetricsFallback),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
        mapped.updated.deletedAt
      ]
    );

    return { ...existing, comments: mapped.comments };
  }

  const local = await readLocal();
  let deleted: InquiryItem | null = null;
  local.items = local.items.map((item) => {
    if (item.id !== itemId) return item;
    const original = findCommentInTree(item.comments, commentId);
    if (!original || isDeletedComment(original) || !canManageComment(original, actorHandle)) return item;
    const mapped = mapCommentTree(item.comments, commentId, tombstoneComment);
    if (!mapped.updated) return item;
    deleted = { ...item, comments: mapped.comments };
    return deleted;
  });
  if (!deleted) return null;
  await writeLocal(local);
  return deleted;
};

export const applyCommentAction = async (
  itemId: string,
  commentId: string,
  action: CommentAction,
  actorHandle = defaultProfile.handle,
  active?: boolean
) => {
  if (usePostgres) {
    const data = await getSnapshot();
    const existing = data.items.find((item) => item.id === itemId);
    if (!existing) return null;

    const mapped = mapCommentTree(existing.comments, commentId, (comment) =>
      mutateCommentForActor(comment, action, actorHandle, active)
    );
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

    return { ...existing, comments: mapped.comments };
  }

  const local = await readLocal();
  let updated: InquiryItem | null = null;
  local.items = local.items.map((item) => {
    if (item.id !== itemId) return item;
    const mapped = mapCommentTree(item.comments, commentId, (comment) =>
      mutateCommentForActor(comment, action, actorHandle, active)
    );
    if (!mapped.updated) return item;
    updated = { ...item, comments: mapped.comments };
    return updated;
  });
  if (!updated) return null;
  await writeLocal(local);
  return updated;
};
