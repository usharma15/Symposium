import type { CanonicalActionActivityContract, ProfileActivityCountsContract, ProfileAuthoredCommentActivityContract, ToggleActionContract } from "@/packages/contracts/src";
import type { InquiryComment, InquiryItem, ResearchCommunity, ResearchProfile } from "@/lib/mockData";
import { cleanHandle, hasHandle, isDeletedComment, isDeletedPost, isSavedBy } from "@/lib/symposiumCore";
import { itemHasPostType } from "@/lib/postSemantics";

export const emptyProfileActivityCounts = (): ProfileActivityCountsContract => ({
  all: 0,
  papers: 0,
  thoughts: 0,
  proposals: 0,
  opportunities: 0,
  comments: 0,
  reshares: 0,
  likes: 0,
  saved: 0
});

export const profileItemIsPubliclyListable = (
  item: InquiryItem,
  communities: ResearchCommunity[]
) => {
  if (!item.communityId || itemHasPostType(item, "paper")) return true;
  return communities.find((community) => community.id === item.communityId)?.visibility === "public";
};

export const profileCommentsArePubliclyListable = (
  item: InquiryItem,
  communities: ResearchCommunity[]
) => !item.communityId
  || itemHasPostType(item, "paper")
  || communities.find((community) => community.id === item.communityId)?.visibility === "public";

export const commentHasProfileActivity = (comment: InquiryComment, rawActorHandle: string): boolean => {
  const actorHandle = cleanHandle(rawActorHandle);
  return cleanHandle(comment.authorHandle ?? comment.author) === actorHandle
    || hasHandle(comment.savedBy, actorHandle)
    || hasHandle(comment.signaledBy, actorHandle)
    || hasHandle(comment.forkedBy, actorHandle)
    || (comment.replies ?? []).some((reply) => commentHasProfileActivity(reply, actorHandle));
};

export const profileActivityComments = (
  comments: InquiryComment[],
  rawActorHandle: string
): InquiryComment[] => comments.flatMap((comment) => {
  const replies = profileActivityComments(comment.replies ?? [], rawActorHandle);
  const actorHandle = cleanHandle(rawActorHandle);
  const directlyMatches = cleanHandle(comment.authorHandle ?? comment.author) === actorHandle
    || hasHandle(comment.savedBy, actorHandle)
    || hasHandle(comment.signaledBy, actorHandle)
    || hasHandle(comment.forkedBy, actorHandle);
  if (directlyMatches) return [{ ...comment, replies }];
  return replies;
});

export const itemHasProfileActivity = (item: InquiryItem, rawActorHandle: string) => {
  const actorHandle = cleanHandle(rawActorHandle);
  return cleanHandle(item.authorHandle ?? item.author) === actorHandle
    || hasHandle(item.savedBy, actorHandle)
    || hasHandle(item.signaledBy, actorHandle)
    || hasHandle(item.forkedBy, actorHandle)
    || (item.comments ?? []).some((comment) => commentHasProfileActivity(comment, actorHandle));
};

const scopedProfileActivityCounts = (
  items: InquiryItem[],
  rawActorHandle: string,
  allowedActions: ToggleActionContract[],
  scopeForItem: (item: InquiryItem) => { includeComments: boolean; includePost: boolean }
): ProfileActivityCountsContract => {
  const actorHandle = cleanHandle(rawActorHandle);
  const allowed = new Set(allowedActions);
  const all = new Set<string>();
  const comments = new Set<string>();
  const reshares = new Set<string>();
  const likes = new Set<string>();
  const saved = new Set<string>();
  const authored = {
    papers: new Set<string>(),
    thoughts: new Set<string>(),
    proposals: new Set<string>(),
    opportunities: new Set<string>()
  };

  const visitComments = (item: InquiryItem, nextComments: InquiryComment[]) => {
    for (const comment of nextComments) {
      if (!comment.id || isDeletedComment(comment)) continue;
      const key = `comment:${comment.id}`;
      if (cleanHandle(comment.authorHandle ?? comment.author) === actorHandle) {
        comments.add(key);
        all.add(key);
        if (comment.quote && allowed.has("fork")) reshares.add(key);
      }
      if (allowed.has("fork") && hasHandle(comment.forkedBy, actorHandle)) {
        reshares.add(key);
        all.add(key);
      }
      if (allowed.has("signal") && hasHandle(comment.signaledBy, actorHandle)) likes.add(key);
      if (allowed.has("save") && hasHandle(comment.savedBy, actorHandle)) saved.add(key);
      visitComments(item, comment.replies ?? []);
    }
  };

  for (const item of items) {
    if (isDeletedPost(item)) continue;
    const { includeComments, includePost } = scopeForItem(item);
    if (!includePost && !includeComments) continue;
    const key = `post:${item.id}`;
    if (includePost && cleanHandle(item.authorHandle ?? item.author) === actorHandle) {
      all.add(key);
      if (itemHasPostType(item, "paper")) authored.papers.add(key);
      if (itemHasPostType(item, "thought")) authored.thoughts.add(key);
      if (itemHasPostType(item, "proposal")) authored.proposals.add(key);
      if (itemHasPostType(item, "opportunity")) authored.opportunities.add(key);
      if (item.quote && allowed.has("fork")) reshares.add(key);
    }
    if (includePost && allowed.has("fork") && hasHandle(item.forkedBy, actorHandle)) {
      reshares.add(key);
      all.add(key);
    }
    if (includePost && allowed.has("signal") && hasHandle(item.signaledBy, actorHandle)) likes.add(key);
    if (includePost && allowed.has("save") && hasHandle(item.savedBy, actorHandle)) saved.add(key);
    if (includeComments) visitComments(item, item.comments);
  }

  return {
    all: all.size,
    papers: authored.papers.size,
    thoughts: authored.thoughts.size,
    proposals: authored.proposals.size,
    opportunities: authored.opportunities.size,
    comments: comments.size,
    reshares: reshares.size,
    likes: likes.size,
    saved: saved.size
  };
};

export const profileActivityCounts = (
  items: InquiryItem[],
  rawActorHandle: string,
  allowedActions: ToggleActionContract[] = ["save", "signal", "fork"],
  options: { includePrivateWorkspace?: boolean } = {}
) => scopedProfileActivityCounts(items, rawActorHandle, allowedActions, (item) => {
  const included = Boolean(options.includePrivateWorkspace) || (item.room !== "office" && item.kind !== "draft");
  return { includeComments: included, includePost: included };
});

export const hiddenCommunityActivityCounts = (
  items: InquiryItem[],
  communities: ResearchCommunity[],
  rawActorHandle: string,
  allowedActions: ToggleActionContract[] = ["save", "signal", "fork"]
) => scopedProfileActivityCounts(items, rawActorHandle, allowedActions, (item) => ({
  includePost: !profileItemIsPubliclyListable(item, communities),
  includeComments: !profileCommentsArePubliclyListable(item, communities)
}));

export const applyProfileActivityActionTotalTransition = (
  totals: ProfileActivityCountsContract,
  action: ToggleActionContract,
  previousActive: boolean,
  nextActive: boolean,
  includeReshareInAll: boolean
): ProfileActivityCountsContract => {
  const delta = Number(nextActive) - Number(previousActive);
  if (!delta) return totals;
  const key = action === "signal" ? "likes" : action === "save" ? "saved" : "reshares";
  return {
    ...totals,
    [key]: Math.max(0, totals[key] + delta),
    all: action === "fork" && includeReshareInAll ? Math.max(0, totals.all + delta) : totals.all
  };
};

export type ProfilePostActionKind = "fork" | "signal" | "save";

export const itemMatchesProfilePostAction = (
  item: InquiryItem,
  person: ResearchProfile,
  action: ProfilePostActionKind,
  defaultSavedHandle?: string
) => {
  if (isDeletedPost(item)) return false;
  if (action === "fork") return hasHandle(item.forkedBy, person.handle);
  if (action === "signal") return hasHandle(item.signaledBy, person.handle);
  return isSavedBy(item, person.handle, defaultSavedHandle);
};

export const uniqueProfileActivityEntries = <T extends { id: string; recency: number }>(
  entries: T[],
  contentKey: (entry: T) => string
) => {
  const unique = new Map<string, T>();

  for (const entry of entries) {
    const key = contentKey(entry);
    const current = unique.get(key);
    if (!current || entry.recency > current.recency) unique.set(key, entry);
  }

  return [...unique.values()].sort((a, b) => {
    const timestampDelta = b.recency - a.recency;
    return timestampDelta || b.id.localeCompare(a.id);
  });
};

export const reconcileProfileActivitySlots = <T extends { id: string }>(current: T[], next: T[]) => {
  if (
    current.length === next.length &&
    current.every((slot, index) => slot.id === next[index]?.id && slot === next[index])
  ) return current;
  return next;
};

export const selectProfileActivitySlots = <T extends { id: string }>(
  currentContext: string,
  nextContext: string,
  current: T[],
  next: T[]
) => (currentContext === nextContext ? current : next);

export const canonicalActivityKey = (
  activity: Pick<CanonicalActionActivityContract, "subjectType" | "subjectId" | "actorHandle" | "action">
) =>
  `${activity.subjectType}:${activity.subjectId}:${cleanHandle(activity.actorHandle)}:${activity.action}`;

export const canonicalActionState = (
  activities: CanonicalActionActivityContract[],
  subjectType: CanonicalActionActivityContract["subjectType"],
  subjectId: string,
  actorHandle: string,
  action: ToggleActionContract
) =>
  activities.find(
    (activity) =>
      activity.subjectType === subjectType &&
      activity.subjectId === subjectId &&
      cleanHandle(activity.actorHandle) === cleanHandle(actorHandle) &&
      activity.action === action
  );

export const isCanonicalActionActivity = (value: unknown): value is CanonicalActionActivityContract => {
  if (!value || typeof value !== "object") return false;
  const activity = value as Partial<CanonicalActionActivityContract>;
  return (
    (activity.subjectType === "post" || activity.subjectType === "comment") &&
    typeof activity.subjectId === "string" &&
    typeof activity.postId === "string" &&
    typeof activity.actorHandle === "string" &&
    (activity.action === "save" || activity.action === "signal" || activity.action === "fork") &&
    typeof activity.active === "boolean" &&
    Number.isInteger(activity.count) &&
    Number(activity.count) >= 0 &&
    Number.isInteger(activity.revision) &&
    Number(activity.revision) >= 1 &&
    typeof activity.occurredAt === "string" &&
    Number.isFinite(Date.parse(activity.occurredAt))
  );
};

export const mergeCanonicalActivities = (
  current: CanonicalActionActivityContract[],
  incoming: CanonicalActionActivityContract[]
) => {
  const merged = new Map(current.map((activity) => [canonicalActivityKey(activity), activity]));
  for (const activity of incoming) {
    const key = canonicalActivityKey(activity);
    const existing = merged.get(key);
    if (!existing || activity.revision >= existing.revision) merged.set(key, activity);
  }
  return [...merged.values()].sort((a, b) => {
    const timestampDelta = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    if (timestampDelta) return timestampDelta;
    return `${b.subjectType}:${b.subjectId}:${b.action}`.localeCompare(
      `${a.subjectType}:${a.subjectId}:${a.action}`
    );
  });
};

export const reconcileCanonicalActivityRefresh = ({
  current,
  incoming,
  pendingKeys,
  currentRevisions,
  requestStartRevisions
}: {
  current: CanonicalActionActivityContract[];
  incoming: CanonicalActionActivityContract[];
  pendingKeys: ReadonlySet<string>;
  currentRevisions: Record<string, number>;
  requestStartRevisions: Record<string, number>;
}) => {
  const incomingByKey = new Map(incoming.map((activity) => [canonicalActivityKey(activity), activity]));
  const retained = current.filter((activity) => {
    const key = canonicalActivityKey(activity);
    const incomingActivity = incomingByKey.get(key);
    if (pendingKeys.has(key)) return true;
    if (incomingActivity) return activity.revision > incomingActivity.revision;
    return (currentRevisions[key] ?? 0) > (requestStartRevisions[key] ?? 0);
  });
  return mergeCanonicalActivities(incoming, retained);
};

export const createLocalCanonicalActivity = ({
  subjectType,
  subjectId,
  postId,
  actorHandle,
  action,
  active,
  occurredAt = new Date().toISOString()
}: Pick<
  CanonicalActionActivityContract,
  "subjectType" | "subjectId" | "postId" | "actorHandle" | "action" | "active"
> & { occurredAt?: string }): CanonicalActionActivityContract => ({
  subjectType,
  subjectId,
  postId,
  actorHandle: cleanHandle(actorHandle),
  action,
  active,
  count: active ? 1 : 0,
  revision: Date.now(),
  occurredAt
});

const legacyActivityTimestamp = (createdAt: string | undefined) => {
  const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date(0).toISOString();
};

const legacyCommentActivities = (
  item: InquiryItem,
  comments: InquiryComment[],
  actorHandle: string,
  actions: Set<ToggleActionContract>,
  entries: CanonicalActionActivityContract[]
) => {
  for (const comment of comments) {
    if (!comment.id || isDeletedComment(comment)) continue;
    for (const action of actions) {
      const handles = action === "save" ? comment.savedBy : action === "signal" ? comment.signaledBy : comment.forkedBy;
      if (!hasHandle(handles, actorHandle)) continue;
      entries.push({
        subjectType: "comment",
        subjectId: comment.id,
        postId: item.id,
        actorHandle,
        action,
        active: true,
        count: 1,
        revision: 1,
        occurredAt: legacyActivityTimestamp(comment.createdAt ?? item.createdAt)
      });
    }
    legacyCommentActivities(item, comment.replies ?? [], actorHandle, actions, entries);
  }
};

export const buildLegacyProfileActivity = (
  items: InquiryItem[],
  actorHandle: string,
  allowedActions: ToggleActionContract[] = ["save", "signal", "fork"]
) => {
  const cleanActor = cleanHandle(actorHandle);
  const actions = new Set(allowedActions);
  const entries: CanonicalActionActivityContract[] = [];

  for (const item of items) {
    if (isDeletedPost(item)) continue;
    for (const action of actions) {
      const handles = action === "save" ? item.savedBy : action === "signal" ? item.signaledBy : item.forkedBy;
      if (!hasHandle(handles, cleanActor)) continue;
      entries.push({
        subjectType: "post",
        subjectId: item.id,
        postId: item.id,
        actorHandle: cleanActor,
        action,
        active: true,
        count: 1,
        revision: 1,
        occurredAt: legacyActivityTimestamp(item.createdAt)
      });
    }
    legacyCommentActivities(item, item.comments, cleanActor, actions, entries);
  }

  return entries.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
};

export const buildLegacyProfileAuthoredComments = (
  items: InquiryItem[],
  actorHandle: string
): ProfileAuthoredCommentActivityContract[] => {
  const cleanActor = cleanHandle(actorHandle);
  const entries: ProfileAuthoredCommentActivityContract[] = [];
  const visit = (item: InquiryItem, comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (
        comment.id &&
        !isDeletedComment(comment) &&
        cleanHandle(comment.authorHandle ?? comment.author) === cleanActor
      ) {
        entries.push({
          commentId: comment.id,
          postId: item.id,
          occurredAt: legacyActivityTimestamp(comment.createdAt ?? item.createdAt)
        });
      }
      visit(item, comment.replies ?? []);
    }
  };
  for (const item of items) {
    if (!isDeletedPost(item)) visit(item, item.comments);
  }
  return entries.sort((a, b) => {
    const timestampDelta = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    return timestampDelta || b.commentId.localeCompare(a.commentId);
  });
};

export const buildLegacyActionLedger = (items: InquiryItem[]) => {
  const entries = new Map<string, CanonicalActionActivityContract>();
  const addActivity = (activity: CanonicalActionActivityContract) => {
    if (cleanHandle(activity.actorHandle) === "@") return;
    entries.set(canonicalActivityKey(activity), activity);
  };
  const collectCommentActivities = (item: InquiryItem, comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (!comment.id || isDeletedComment(comment)) continue;
      const occurredAt = legacyActivityTimestamp(comment.createdAt ?? item.createdAt);
      for (const [action, handles] of [
        ["save", comment.savedBy],
        ["signal", comment.signaledBy],
        ["fork", comment.forkedBy]
      ] as const) {
        for (const actorHandle of handles ?? []) {
          addActivity({
            subjectType: "comment",
            subjectId: comment.id,
            postId: item.id,
            actorHandle: cleanHandle(actorHandle),
            action,
            active: true,
            count: 1,
            revision: 1,
            occurredAt
          });
        }
      }
      collectCommentActivities(item, comment.replies ?? []);
    }
  };

  for (const item of items) {
    if (isDeletedPost(item)) continue;
    const occurredAt = legacyActivityTimestamp(item.createdAt);
    for (const [action, handles] of [
      ["save", item.savedBy],
      ["signal", item.signaledBy],
      ["fork", item.forkedBy]
    ] as const) {
      for (const actorHandle of handles ?? []) {
        addActivity({
          subjectType: "post",
          subjectId: item.id,
          postId: item.id,
          actorHandle: cleanHandle(actorHandle),
          action,
          active: true,
          count: 1,
          revision: 1,
          occurredAt
        });
      }
    }
    collectCommentActivities(item, item.comments);
  }

  return [...entries.values()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
};

type ActionProjection = Record<ToggleActionContract, string[]>;

export const projectCanonicalActionLedger = (
  items: InquiryItem[],
  activities: CanonicalActionActivityContract[]
) => {
  const projections = new Map<string, ActionProjection>();
  for (const activity of activities) {
    const key = `${activity.subjectType}:${activity.subjectId}`;
    const projection = projections.get(key) ?? { save: [], signal: [], fork: [] };
    if (activity.active && !projection[activity.action].includes(cleanHandle(activity.actorHandle))) {
      projection[activity.action].push(cleanHandle(activity.actorHandle));
    }
    projections.set(key, projection);
  }

  const projectComments = (comments: InquiryComment[]): InquiryComment[] =>
    comments.map((comment) => {
      const projection = comment.id ? projections.get(`comment:${comment.id}`) : undefined;
      return {
        ...comment,
        ...(projection
          ? {
              savedBy: projection.save,
              signaledBy: projection.signal,
              forkedBy: projection.fork
            }
          : {}),
        replies: projectComments(comment.replies ?? [])
      };
    });

  return items.map((item) => {
    const projection = projections.get(`post:${item.id}`);
    return {
      ...item,
      ...(projection
        ? {
            saved: projection.save.length > 0,
            savedBy: projection.save,
            signaledBy: projection.signal,
            forkedBy: projection.fork
          }
        : {}),
      comments: projectComments(item.comments)
    };
  });
};
