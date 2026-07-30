import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
import path from "node:path";
import type {
  CanonicalActionActivityContract,
  ContentQuoteContract,
  OpportunityPostInputContract,
  PatronageProposalInputContract,
  PostTypeContract,
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
import { writeJsonFileAtomically } from "@/lib/localJsonStore";
import {
  legacyLiveSeedCreatedAt,
  seedCommentById,
  seedItemById,
  stableSeedCreatedAt
} from "@/lib/seedItemNormalization";
import { postTitlePolicyError, postTypeForItem } from "@/lib/postSemantics";
import {
  deterministicPostDesignAssignment,
  postTypeHasAuthoredArtifact,
  randomPostDesignAssignment,
  resolvePostDesignAssignment
} from "@/lib/postDesign";

type AppData = {
  fixtureRevision?: string;
  profiles: Record<string, ResearchProfile>;
  items: InquiryItem[];
  viewDedupe: Record<string, string>;
  actionLedger: Record<string, CanonicalActionActivityContract>;
};

const historicalWorldFixtureRevision = "historical-world-v2-casual-activity";
const localHistoricalWorldSnapshotPath = process.env.VERCEL
  ? path.join("/tmp", `${historicalWorldFixtureRevision}-symposium.snapshot.json`)
  : path.join(process.cwd(), ".data", "snapshots", `${historicalWorldFixtureRevision}-symposium.json`);

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
  postType: PostTypeContract;
  room: Exclude<RoomId, "hall">;
  communityId?: string;
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
const databaseBackedModeConfigured = [
  process.env.POSTGRES_PRISMA_URL,
  process.env.POSTGRES_URL,
  process.env.DATABASE_URL
].some((value) => Boolean(value?.trim()));
let localMutationQueue: Promise<void> = Promise.resolve();

const assertLocalPreviewMode = () => {
  if (!databaseBackedModeConfigured) return;
  throw new Error(
    "Direct Postgres access from the Next compatibility store has been retired. Configure SYMPOSIUM_API_URL and run the canonical API for database-backed development."
  );
};

const withLocalMutation = <T>(operation: () => Promise<T>) => {
  const result = localMutationQueue.then(operation, operation);
  localMutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
};

const handleFromName = (name: string) => getProfileForName(name).handle;

const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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
  const postType = postTypeForItem(item) ?? undefined;
  return {
    ...item,
    communityId: item.communityId ?? seedItem?.communityId,
    postType,
    designAssignment: resolvePostDesignAssignment({
      postType,
      assignment: item.designAssignment ?? seedItem?.designAssignment,
      identity: item.id
    }),
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
    fixtureRevision: data.fixtureRevision,
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
    fixtureRevision: data.fixtureRevision,
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
    fixtureRevision: historicalWorldFixtureRevision,
    profiles,
    viewDedupe: {},
    items,
    actionLedger: activityRecord(buildLegacyActionLedger(items))
  };
};

const retainProtectedLocalComments = (comments: InquiryComment[]): InquiryComment[] => comments.flatMap((comment) => {
  const replies = retainProtectedLocalComments(comment.replies ?? []);
  if (cleanHandle(comment.authorHandle ?? comment.author) !== defaultProfile.handle) return replies.map((reply) => ({ ...reply, parentId: null }));
  return [{ ...comment, parentId: null, replies }];
});

const migrateLocalHistoricalWorld = (data: AppData): AppData => {
  const seed = seedData();
  const preservedItems = data.items
    .filter((item) => cleanHandle(item.authorHandle ?? item.author) === defaultProfile.handle)
    .map((item) => ({ ...normalizeItem(item), comments: retainProtectedLocalComments(item.comments) }));
  const seedIds = new Set(seed.items.map((item) => item.id));
  const retainedItems = preservedItems.filter((item) => !seedIds.has(item.id));
  const retainedIds = new Set(retainedItems.map((item) => item.id));
  const retainedCommentIds = new Set<string>();
  for (const item of retainedItems) {
    const visit = (comments: InquiryComment[]) => comments.forEach((comment) => {
      if (comment.id) retainedCommentIds.add(comment.id);
      visit(comment.replies ?? []);
    });
    visit(item.comments);
  }
  const retainedActivities = Object.values(data.actionLedger ?? {}).filter((activity) =>
    cleanHandle(activity.actorHandle) === defaultProfile.handle
    && (activity.subjectType === "post" ? retainedIds.has(activity.subjectId) : retainedCommentIds.has(activity.subjectId))
  );
  const items = [...seed.items, ...retainedItems];
  const actionLedger = mergeCanonicalActivities(
    Object.values(seed.actionLedger),
    retainedActivities
  );
  return {
    fixtureRevision: historicalWorldFixtureRevision,
    profiles: {
      ...seed.profiles,
      [defaultProfile.handle]: data.profiles[defaultProfile.handle] ?? seed.profiles[defaultProfile.handle]!
    },
    items: projectCanonicalActionLedger(items, actionLedger),
    viewDedupe: {},
    actionLedger: activityRecord(actionLedger)
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

const readLocal = async (): Promise<AppData> => {
  assertLocalPreviewMode();
  try {
    const raw = await readFile(localDataPath, "utf8");
    const parsed = JSON.parse(raw) as AppData;
    if (parsed.fixtureRevision !== historicalWorldFixtureRevision) {
      await mkdir(path.dirname(localHistoricalWorldSnapshotPath), { recursive: true });
      try {
        await writeFile(localHistoricalWorldSnapshotPath, raw, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      }
      const migrated = migrateLocalHistoricalWorld(parsed);
      await writeLocal(migrated);
      return migrated;
    }
    return mergeSeedData(normalizeData(parsed));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const seed = seedData();
    await writeLocal(seed);
    return seed;
  }
};

const writeLocal = (data: AppData) => writeJsonFileAtomically(localDataPath, data);

export const getSnapshot = async (): Promise<AppData> => withLocalMutation(readLocal);

export const upsertProfile = async (input: CreateProfileInput): Promise<ResearchProfile> => {
  const person = normalizeProfile(input);

  return withLocalMutation(async () => {
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
  });
};

export const createPost = async (
  input: CreatePostInput,
  authorHandle: string
): Promise<InquiryItem> => {
  const data = await getSnapshot();
  const author = data.profiles[authorHandle] ?? defaultProfile;
  const isPaper = input.kind === "paper";
  const isProposal = Boolean(input.patronage);
  const isOpportunity = Boolean(input.opportunity);
  const designAssignment = postTypeHasAuthoredArtifact(input.postType)
    ? randomPostDesignAssignment(input.postType, randomInt)
    : undefined;
  const item: InquiryItem = {
    id: newId("post"),
    revision: 1,
    kind: input.kind,
    postType: input.postType,
    designAssignment,
    room: input.room,
    communityId: input.communityId,
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

  return withLocalMutation(async () => {
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
  });
};

export const addComment = async (
  itemId: string,
  input: CreateCommentInput,
  authorHandle: string
): Promise<{ comment: InquiryComment; item: InquiryItem } | null> => {
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
  const appended = appendCommentToTree(existing.comments, comment);
  if (!appended.inserted) return null;

  return withLocalMutation(async () => {
    const local = await readLocal();
    let localUpdatedItem: InquiryItem | null = null;
    local.items = local.items.map((item) => {
      if (item.id !== itemId || isDeletedPost(item)) return item;
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
  });
};

export const applyPostAction = async (
  itemId: string,
  action: PostAction,
  actorHandle = defaultProfile.handle,
  active?: boolean,
  trigger?: string,
  surface?: string
): Promise<ActionMutationResult | null> => {

  return withLocalMutation(async () => {
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

export const updatePost = async (
  itemId: string,
  input: UpdatePostInput,
  actorHandle = defaultProfile.handle
): Promise<InquiryItem | null> => {
  const cleanInput = {
    title: input.title.trim(),
    body: input.body.trim(),
    document: input.document,
    attachments: input.attachments,
    quote: input.quote,
    patronage: input.patronage,
    opportunity: input.opportunity
  };
  if (!cleanInput.body) return null;

  return withLocalMutation(async () => {
    const local = await readLocal();
    let updated: InquiryItem | null = null;
    local.items = local.items.map((item) => {
      if (item.id !== itemId || isDeletedPost(item) || !canManagePost(item, actorHandle)) return item;
      if (postTitlePolicyError(item, cleanInput.title)) return item;
      if (input.attachments?.length && (item.room === "office" || item.kind === "draft")) return item;
      updated = updatePostShape(item, cleanInput);
      return updated;
    });
    if (!updated) return null;
    await writeLocal(local);
    return updated;
  });
};

export const deletePost = async (
  itemId: string,
  actorHandle = defaultProfile.handle,
  allowCommunityModerator = false
): Promise<InquiryItem | null> => {

  return withLocalMutation(async () => {
    const local = await readLocal();
    const existing = local.items.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing) || (!canManagePost(existing, actorHandle) && !(allowCommunityModerator && existing.communityId && existing.postType !== "paper"))) return null;
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
  });
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
): Promise<InquiryItem | null> => {
  const cleanInput = { body: input.body.trim(), document: input.document, attachments: input.attachments, quote: input.quote };
  if (!cleanInput.body) return null;

  return withLocalMutation(async () => {
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
  });
};

export const deleteComment = async (
  itemId: string,
  commentId: string,
  actorHandle = defaultProfile.handle,
  allowCommunityModerator = false
): Promise<InquiryItem | null> => {

  return withLocalMutation(async () => {
    const local = await readLocal();
    let deleted: InquiryItem | null = null;
    local.items = local.items.map((item) => {
      if (item.id !== itemId) return item;
      const original = findCommentInTree(item.comments, commentId);
      if (!original || isDeletedComment(original) || (!canManageComment(original, actorHandle) && !(allowCommunityModerator && item.communityId))) return item;
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
  });
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

  return withLocalMutation(async () => {
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
