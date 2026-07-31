"use client";

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import type { CommentAction, PostAction } from "@/lib/dataStore";
import {
  profile,
  type ContentQuoteSource,
  type InquiryAttachment,
  type InquiryComment,
  type InquiryItem,
  type ResearchCommunity,
  type ResearchProfile,
  type RoomId
} from "@/lib/mockData";
import type {
  CanonicalActionActivityContract,
  OpportunityPostInputContract,
  PatronageProposalInputContract,
  PostPageQueryContract,
  PostPageResponseContract,
  ToggleActionContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";
import type { ViewActionOptions } from "@/features/actions/actionTypes";
import {
  createClientMutationId,
  shouldRetainRetryMutation,
  symposiumApi,
  SymposiumApiError
} from "@/features/api/symposiumApiClient";
import {
  persistCachedBootstrap,
  readCachedBootstrapSnapshot,
  resolveCachedBootstrap
} from "@/features/bootstrap/cachedBootstrap";
import {
  normalizeClientSeedTimes,
  preservePublishedPosition
} from "@/features/bootstrap/clientItemNormalization";
import { useInquiryEntityStore } from "@/features/entities/useInquiryEntityStore";
import {
  isCrossTabItemMessage,
  type CrossTabItemMessage
} from "@/features/live-sync/crossTabItemSync";
import { compareEntityRevisions } from "@/features/live-sync/entityRevision";
import {
  createInquiryActionReconciler,
  type ProtectedActionMetricState
} from "@/features/live-sync/inquiryActionReconciler";
import { recordPassiveView } from "@/features/live-sync/recordPassiveView";
import { useCrossTabItemTransport } from "@/features/live-sync/useCrossTabItemTransport";
import { createContentDeletionController } from "@/features/moderation/contentDeletionController";
import { createItemMutationCoordinator } from "@/features/mutations/itemMutationCoordinator";
import { projectProfileIntoInquiryItems } from "@/features/profiles/profileProjection";
import { invalidateQuotedSource, resolveLocalContentQuote } from "@/lib/contentQuotes";
import { communityViewerProjectionChanged } from "@/lib/communityContentProjection";
import { isCanonicalActionActivity } from "@/lib/profileActivity";
import {
  postTitlePolicyError,
  preservePostSemanticProjection
} from "@/lib/postSemantics";
import {
  appendCommentToTree,
  cleanHandle,
  commentActionActive,
  commentMetricsFallback,
  findCommentInTree,
  hasHandle,
  incrementMetric,
  isDeletedComment,
  isDeletedPost,
  isSavedBy,
  itemTimestampScore,
  mapCommentTree,
  mutateCommentForActor,
  mutateItemForActor,
  updateSignalValue
} from "@/lib/symposiumCore";

export type InquiryFeedPageState = {
  initialized: boolean;
  loading: boolean;
  nextCursor: string | null;
};

export type InquiryLivePayload = {
  itemId?: string;
  commentId?: string;
  commentRevision?: number;
  metrics?: Partial<InquiryItem["metrics"]>;
  revision?: number;
};

export type InquiryPostDraft = {
  title: string;
  body: string;
  document: VersionedDocumentContract;
  kind: "paper" | "thought" | "proposal" | "opportunity";
  patronage?: PatronageProposalInputContract;
  opportunity?: OpportunityPostInputContract;
  attachments: InquiryAttachment[];
  quoteSource?: ContentQuoteSource;
};

export type InquiryPostEditDraft = {
  title: string;
  body: string;
  document: VersionedDocumentContract;
  attachments: InquiryAttachment[];
  quote: InquiryItem["quote"] | null;
  patronage?: PatronageProposalInputContract;
  opportunity?: OpportunityPostInputContract;
};

export type InquiryCommentCreateInput = {
  itemId: string;
  body: string;
  document: VersionedDocumentContract;
  stance: string;
  parentId: string | null;
  attachments: InquiryAttachment[];
  quoteSource?: ContentQuoteSource;
  onOptimistic: (commentId: string) => void;
  onRollback: () => void;
  onCommitted: (commentId: string | null) => void;
};

export type InquiryCommentEditInput = {
  itemId: string;
  commentId: string;
  body: string;
  document: VersionedDocumentContract;
  attachments: InquiryAttachment[];
  quote: InquiryComment["quote"] | null;
};

type RetryMutationPort = {
  acquire: (scope: string, fingerprint: string) => {
    fingerprintKey: string;
    idempotencyKey: string;
  };
  clear: (fingerprintKey: string) => void;
};

type InquiryActivityPort = {
  acceptCanonical: (activity: CanonicalActionActivityContract) => boolean;
  committed: (
    subjectType: "post" | "comment",
    subjectId: string,
    actorHandle: string,
    action: ToggleActionContract,
    desiredActive: boolean | undefined,
    previous: CanonicalActionActivityContract | undefined
  ) => boolean;
  finishWithoutCanonical: (
    subjectType: "post" | "comment",
    subjectId: string,
    actorHandle: string,
    action: ToggleActionContract
  ) => void;
  restore: (
    subjectType: "post" | "comment",
    subjectId: string,
    actorHandle: string,
    action: ToggleActionContract,
    previous: CanonicalActionActivityContract | undefined
  ) => void;
  stage: (
    subjectType: "post" | "comment",
    subjectId: string,
    postId: string,
    actorHandle: string,
    action: ToggleActionContract,
    active: boolean
  ) => CanonicalActionActivityContract | undefined;
  touchComment: (
    itemId: string,
    commentId: string,
    action: CommentAction,
    handle?: string,
    timestamp?: number
  ) => void;
  touchPost: (
    itemId: string,
    action: PostAction,
    handle?: string,
    timestamp?: number
  ) => void;
};

type InquiryControllerInput = {
  actorHandle: string;
  communitiesRef: MutableRefObject<ResearchCommunity[]>;
  currentProfileRef: MutableRefObject<ResearchProfile>;
  initialItems: InquiryItem[];
  profilesRef: MutableRefObject<Record<string, ResearchProfile>>;
  retryMutation: RetryMutationPort;
  activity: InquiryActivityPort;
  onProfilesDiscovered: (profiles: Record<string, ResearchProfile>) => void;
  onStaleLiveState: () => void;
  onStatus: (status: string) => void;
  onTouchItem: (itemId: string) => void;
  clearPostEditor: () => void;
  clearCommentEditor: (itemId: string, commentId: string) => void;
};

type RefreshSnapshot = ReturnType<
  ReturnType<typeof createItemMutationCoordinator<InquiryItem>>["capture"]
>;

const clientId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const sortByPublishedRecency = (items: InquiryItem[]) =>
  [...items].sort((left, right) => itemTimestampScore(right) - itemTimestampScore(left));

const mergeSparseComments = (
  current: InquiryComment[],
  incoming: InquiryComment[]
) => {
  const existingIds = new Set<string>();
  const collectIds = (comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (comment.id) existingIds.add(comment.id);
      collectIds(comment.replies ?? []);
    }
  };
  collectIds(current);
  return [
    ...current,
    ...incoming.filter((comment) => !comment.id || !existingIds.has(comment.id))
  ];
};

const isInquiryItemMessage = (
  value: unknown
): value is CrossTabItemMessage<InquiryItem> => isCrossTabItemMessage<InquiryItem>(value);

const routeForPostKind = (
  kind: InquiryPostDraft["kind"]
): Exclude<RoomId, "hall" | "office"> =>
  kind === "proposal"
    ? "funding"
    : kind === "opportunity"
      ? "opportunities"
      : kind === "paper"
        ? "library"
        : "amphitheater";

const viewDedupeWindowMs = 60 * 60 * 1000;
const viewStorageKey = (handle: string) => `symposium-view-dedupe:${cleanHandle(handle)}`;
const viewKey = (targetType: "post" | "comment", targetId: string) =>
  `${targetType}:${targetId}`;
const pruneViewDedupe = (dedupe: Record<string, number>, now = Date.now()) =>
  Object.fromEntries(
    Object.entries(dedupe).filter(
      ([, timestamp]) =>
        Number.isFinite(timestamp) && now - timestamp < viewDedupeWindowMs
    )
  );

export const useInquiryController = (input: InquiryControllerInput) => {
  const inputRef = useRef(input);
  inputRef.current = input;
  const { items, itemsRef, replaceItems } = useInquiryEntityStore(input.initialItems);
  const [feedPages, setFeedPages] = useState<Record<string, InquiryFeedPageState>>({});
  const feedPagesRef = useRef(feedPages);
  const feedActorHandleRef = useRef(input.actorHandle);
  const actionVersionsRef = useRef<Record<string, number>>({});
  const viewDedupeRef = useRef<Record<string, number>>({});
  const coordinatorRef = useRef(
    createItemMutationCoordinator<InquiryItem>({
      equalRevisionProjectionChanged: communityViewerProjectionChanged
    })
  );
  const reconcilerRef = useRef(createInquiryActionReconciler());
  const lastPersistedItemsRef = useRef<InquiryItem[]>(input.initialItems);

  feedPagesRef.current = feedPages;

  useEffect(() => {
    if (feedActorHandleRef.current === input.actorHandle) return;
    feedActorHandleRef.current = input.actorHandle;
    feedPagesRef.current = {};
    setFeedPages({});
  }, [input.actorHandle]);

  const persistViewDedupe = (
    dedupe: Record<string, number>,
    handle = inputRef.current.currentProfileRef.current.handle
  ) => {
    const pruned = pruneViewDedupe(dedupe);
    viewDedupeRef.current = pruned;
    try {
      window.localStorage.setItem(viewStorageKey(handle), JSON.stringify(pruned));
    } catch {
      // View recording is best-effort and must not block navigation.
    }
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(viewStorageKey(input.actorHandle));
      const parsed = raw ? JSON.parse(raw) as Record<string, number> : {};
      persistViewDedupe(pruneViewDedupe(parsed), input.actorHandle);
    } catch {
      viewDedupeRef.current = {};
    }
  }, [input.actorHandle]);

  const claimView = (targetType: "post" | "comment", targetId: string) => {
    const now = Date.now();
    const key = viewKey(targetType, targetId);
    const dedupe = pruneViewDedupe(viewDedupeRef.current, now);
    const lastViewedAt = dedupe[key];
    if (Number.isFinite(lastViewedAt) && now - lastViewedAt < viewDedupeWindowMs) {
      viewDedupeRef.current = dedupe;
      return false;
    }
    dedupe[key] = now;
    persistViewDedupe(dedupe);
    return true;
  };

  const releaseView = (targetType: "post" | "comment", targetId: string) => {
    const rest = { ...viewDedupeRef.current };
    delete rest[viewKey(targetType, targetId)];
    persistViewDedupe(rest);
  };

  const reconcileCommittedItem = (
    incoming: InquiryItem,
    current: InquiryItem | undefined,
    actorHandle = inputRef.current.currentProfileRef.current.handle
  ) =>
    preservePublishedPosition(
      reconcilerRef.current.protectItemFromStaleActionState(
        coordinatorRef.current.protectIncomingItem(
          preservePostSemanticProjection(incoming, current),
          current
        ),
        current,
        actorHandle
      ),
      current
    );

  const reconcileBoundedReadItem = (
    incoming: InquiryItem,
    current: InquiryItem | undefined,
    actorHandle = inputRef.current.currentProfileRef.current.handle
  ) => {
    let next = reconcileCommittedItem(incoming, current, actorHandle);
    if (current?.detailLoaded && !incoming.detailLoaded) {
      next = {
        ...next,
        comments: mergeSparseComments(current.comments, incoming.comments ?? []),
        attachments: current.attachments,
        commentCount: incoming.commentCount ?? current.commentCount,
        detailLoaded: true
      };
    } else if (incoming.detailLoaded) {
      next = {
        ...next,
        comments: incoming.comments,
        attachments: incoming.attachments,
        commentCount: incoming.commentCount,
        detailLoaded: true
      };
    } else {
      next = {
        ...next,
        comments: mergeSparseComments(current?.comments ?? [], incoming.comments ?? [])
      };
    }
    return next;
  };

  const persistSnapshot = () => {
    const current = inputRef.current;
    persistCachedBootstrap(
      window.localStorage,
      {
        items: itemsRef.current,
        profiles: current.profilesRef.current,
        communities: current.communitiesRef.current
      },
      current.currentProfileRef.current.handle
    );
  };

  const publishCrossTabItem = useCrossTabItemTransport<CrossTabItemMessage<InquiryItem>>({
    channelName: "symposium-item-sync-v1",
    isMessage: isInquiryItemMessage,
    onMessage: (message) => {
      const received = coordinatorRef.current.receive(message, itemsRef.current);
      if (!received.accepted) return;
      const nextItems = sortByPublishedRecency(received.items);
      replaceItems(nextItems);
      lastPersistedItemsRef.current = nextItems;
      persistCachedBootstrap(
        window.localStorage,
        {
          items: nextItems,
          profiles: inputRef.current.profilesRef.current,
          communities: inputRef.current.communitiesRef.current
        },
        inputRef.current.currentProfileRef.current.handle
      );
    },
    storageKey: "symposium-cross-tab-item"
  });

  const persistItems = (
    nextItems: InquiryItem[],
    explicitItemIds: string[] = []
  ) => {
    persistCachedBootstrap(
      window.localStorage,
      {
        items: nextItems,
        profiles: inputRef.current.profilesRef.current,
        communities: inputRef.current.communitiesRef.current
      },
      inputRef.current.currentProfileRef.current.handle
    );
    const messages = coordinatorRef.current.publishChanges(
      nextItems,
      lastPersistedItemsRef.current,
      explicitItemIds
    );
    lastPersistedItemsRef.current = nextItems;
    for (const message of messages) publishCrossTabItem(message);
  };

  const replaceAndPersist = (
    nextItems: InquiryItem[],
    explicitItemIds: string[] = []
  ) => {
    replaceItems(nextItems);
    persistItems(nextItems, explicitItemIds);
  };

  const hydrateCachedSnapshot = (preferredHandle: string | null) => {
    const cached = resolveCachedBootstrap({
      fallbackProfile: profile,
      preferredHandle,
      seedItems: input.initialItems,
      snapshot: readCachedBootstrapSnapshot(window.localStorage)
    });
    const cachedItems = sortByPublishedRecency(normalizeClientSeedTimes(cached.items));
    lastPersistedItemsRef.current = cachedItems;
    replaceItems(cachedItems);
    return {
      communities: cached.communities,
      currentProfile: cached.currentProfile,
      profiles: cached.profiles
    };
  };

  const projectProfile = (
    person: ResearchProfile,
    options: { persist?: boolean } = {}
  ) => {
    const nextItems = projectProfileIntoInquiryItems(itemsRef.current, person);
    replaceItems(nextItems);
    lastPersistedItemsRef.current = nextItems;
    if (options.persist !== false) persistSnapshot();
    return nextItems;
  };

  const captureRefresh = (): RefreshSnapshot => coordinatorRef.current.capture();

  const commitRefresh = (
    incomingItems: InquiryItem[],
    actorHandle: string,
    snapshot: RefreshSnapshot
  ) => {
    const currentById = new Map(itemsRef.current.map((item) => [item.id, item]));
    const normalizedItems = sortByPublishedRecency(
      normalizeClientSeedTimes(incomingItems).map((rawIncoming) => {
        const current = currentById.get(rawIncoming.id);
        const incoming = preservePostSemanticProjection(rawIncoming, current);
        const comparison = compareEntityRevisions(incoming, current);
        if (current && comparison !== null && comparison < 0) return current;
        return reconcileBoundedReadItem(incoming, current, actorHandle);
      })
    );
    for (const incoming of normalizedItems) {
      if (!coordinatorRef.current.changedSince(snapshot, incoming.id)) {
        reconcilerRef.current.settleFreshItemActionState(incoming, actorHandle);
      }
    }
    const incomingIds = new Set(normalizedItems.map((item) => item.id));
    const refreshInput = [
      ...normalizedItems,
      ...itemsRef.current.filter((item) => !incomingIds.has(item.id))
    ];
    const safeItems = sortByPublishedRecency(
      coordinatorRef.current.reconcileRefresh(refreshInput, itemsRef.current, snapshot)
    );
    const loadedItems = reconcilerRef.current.protectItemsFromStaleActionState(
      safeItems,
      itemsRef.current,
      actorHandle
    );
    replaceAndPersist(loadedItems);
    return loadedItems;
  };

  const mergeBoundedRead = (
    data: {
      items: InquiryItem[];
      profiles?: Record<string, ResearchProfile>;
    },
    options: { persist?: boolean } = {}
  ) => {
    if (data.profiles && Object.keys(data.profiles).length) {
      inputRef.current.onProfilesDiscovered(data.profiles);
    }
    const nextById = new Map(itemsRef.current.map((item) => [item.id, item]));
    for (const rawIncoming of normalizeClientSeedTimes(data.items)) {
      const current = nextById.get(rawIncoming.id);
      const incoming = preservePostSemanticProjection(rawIncoming, current);
      const comparison = compareEntityRevisions(incoming, current);
      if (current && comparison !== null && comparison < 0) continue;
      const next = reconcileBoundedReadItem(
        incoming,
        current,
        inputRef.current.currentProfileRef.current.handle
      );
      nextById.set(next.id, next);
    }
    const nextItems = sortByPublishedRecency([...nextById.values()]);
    replaceItems(nextItems);
    if (options.persist !== false) persistItems(nextItems);
    return nextItems;
  };

  const setFeedPageState = (key: string, next: InquiryFeedPageState) => {
    const pages = { ...feedPagesRef.current, [key]: next };
    feedPagesRef.current = pages;
    setFeedPages(pages);
  };

  const loadPostPage = async (
    key: string,
    query: PostPageQueryContract,
    append = false
  ) => {
    const current = feedPagesRef.current[key];
    if (current?.loading || (append && !current?.nextCursor)) return;
    setFeedPageState(key, {
      initialized: current?.initialized ?? false,
      loading: true,
      nextCursor: current?.nextCursor ?? null
    });
    try {
      const parameters = new URLSearchParams({
        limit: String(query.limit),
        actorHandle: inputRef.current.currentProfileRef.current.handle
      });
      if (append && current?.nextCursor) parameters.set("cursor", current.nextCursor);
      if (query.room) parameters.set("room", query.room);
      if (query.postType) parameters.set("postType", query.postType);
      if (query.postTypes?.length) parameters.set("postTypes", query.postTypes.join(","));
      if (query.communityId) parameters.set("communityId", query.communityId);
      if (query.authorHandle) parameters.set("authorHandle", query.authorHandle);
      if (query.saved) parameters.set("saved", "true");
      if (query.following) parameters.set("following", "true");
      if (query.ids?.length) parameters.set("ids", query.ids.join(","));
      const page = await symposiumApi.request<PostPageResponseContract>(
        `/api/posts?${parameters.toString()}`,
        { cache: "no-store" }
      );
      mergeBoundedRead(page);
      setFeedPageState(key, {
        initialized: true,
        loading: false,
        nextCursor: page.nextCursor
      });
    } catch (error) {
      setFeedPageState(key, {
        initialized: current?.initialized ?? false,
        loading: false,
        nextCursor: current?.nextCursor ?? null
      });
      throw error;
    }
  };

  const loadPostDetail = async (
    postId: string,
    actorHandle: string,
    accept = () => true
  ) => {
    const data = await symposiumApi.request<{
      item: InquiryItem;
      profiles?: Record<string, ResearchProfile>;
    }>(
      `/api/posts/${encodeURIComponent(postId)}?actorHandle=${encodeURIComponent(actorHandle)}`,
      { cache: "no-store" }
    );
    if (accept()) {
      mergeBoundedRead({ items: [data.item], profiles: data.profiles });
    }
    return data;
  };

  const loadPostSubjects = async (
    postIds: string[],
    commentIds: string[],
    actorHandle: string
  ) => {
    if (!postIds.length) return undefined;
    const parameters = new URLSearchParams({
      ids: Array.from(new Set(postIds)).slice(0, 50).join(","),
      limit: String(postIds.length),
      actorHandle
    });
    if (commentIds.length) {
      parameters.set(
        "commentIds",
        Array.from(new Set(commentIds)).slice(0, 50).join(",")
      );
    }
    const page = await symposiumApi.request<PostPageResponseContract>(
      `/api/posts?${parameters.toString()}`,
      { cache: "no-store" }
    );
    mergeBoundedRead(page);
    return page;
  };

  const mergeLiveMetricPatch = (payload: InquiryLivePayload) => {
    if (!payload.itemId || !payload.metrics || typeof payload.metrics !== "object") {
      return false;
    }
    const applyMetricPatch = <
      T extends { signal: string; forks: string; saves: string; reads: string }
    >(current: T): T => ({
      ...current,
      signal:
        typeof payload.metrics?.signal === "string"
          ? payload.metrics.signal
          : current.signal,
      forks:
        typeof payload.metrics?.forks === "string"
          ? payload.metrics.forks
          : current.forks,
      saves:
        typeof payload.metrics?.saves === "string"
          ? payload.metrics.saves
          : current.saves,
      reads:
        typeof payload.metrics?.reads === "string"
          ? payload.metrics.reads
          : current.reads
    });
    let changed = false;
    const nextItems = itemsRef.current.map((item) => {
      if (item.id !== payload.itemId) return item;
      const itemRevision = item.revision ?? 0;
      if (typeof payload.revision === "number" && itemRevision > payload.revision) {
        return item;
      }
      if (!payload.commentId) {
        changed = true;
        return {
          ...item,
          metrics: applyMetricPatch(item.metrics),
          revision:
            typeof payload.revision === "number"
              ? Math.max(itemRevision, payload.revision)
              : item.revision
        };
      }
      const mapped = mapCommentTree(item.comments, payload.commentId, (comment) => {
        const commentRevision = comment.revision ?? 0;
        if (
          typeof payload.commentRevision === "number" &&
          commentRevision > payload.commentRevision
        ) {
          return comment;
        }
        changed = true;
        return {
          ...comment,
          metrics: applyMetricPatch({
            ...commentMetricsFallback,
            ...(comment.metrics ?? {})
          }),
          revision:
            typeof payload.commentRevision === "number"
              ? Math.max(commentRevision, payload.commentRevision)
              : comment.revision
        };
      });
      if (!mapped.updated) return item;
      return {
        ...item,
        comments: mapped.comments,
        revision:
          typeof payload.revision === "number"
            ? Math.max(itemRevision, payload.revision)
            : item.revision
      };
    });
    if (!changed) return false;
    replaceAndPersist(nextItems);
    return true;
  };

  const mergeLiveItem = (incoming: InquiryItem) => {
    const currentItems = itemsRef.current;
    const existingIndex = currentItems.findIndex((item) => item.id === incoming.id);
    const currentItem = existingIndex >= 0 ? currentItems[existingIndex] : undefined;
    const semanticIncoming = preservePostSemanticProjection(incoming, currentItem);
    const revisionComparison = compareEntityRevisions(semanticIncoming, currentItem);
    const canonicalIncomingIsNewer = (revisionComparison ?? 0) > 0;
    if (currentItem && revisionComparison === 0) return false;
    if (
      currentItem &&
      coordinatorRef.current.isPending(incoming.id) &&
      !canonicalIncomingIsNewer
    ) {
      inputRef.current.onStaleLiveState();
      return false;
    }
    const crossTabProtected = coordinatorRef.current.protectIncomingItem(
      semanticIncoming,
      currentItem
    );
    const protectedIncoming = reconcilerRef.current.protectItemFromStaleActionState(
      crossTabProtected,
      currentItem,
      inputRef.current.currentProfileRef.current.handle
    );
    const nextItem = preservePublishedPosition(protectedIncoming, currentItem);
    const nextItems =
      existingIndex >= 0
        ? currentItems.map((item) => (item.id === incoming.id ? nextItem : item))
        : sortByPublishedRecency([nextItem, ...currentItems]);
    replaceAndPersist(nextItems);
    return true;
  };

  const invalidateLiveQuotedSource = (source: {
    sourceType: "post" | "comment";
    sourceId: string;
    sourcePostId: string;
  }) => {
    const current = itemsRef.current;
    const next = invalidateQuotedSource(current, source);
    const changedItemIds = next
      .filter((item, index) => item !== current[index])
      .map((item) => item.id);
    if (!changedItemIds.length) return false;
    replaceAndPersist(next, changedItemIds);
    return true;
  };

  const acceptLiveActionProjection = ({
    action,
    actorHandle,
    commentId,
    item
  }: {
    action: PostAction;
    actorHandle: string;
    commentId?: string;
    item: InquiryItem;
  }) => {
    if (commentId) {
      const desired = reconcilerRef.current.protectedDesiredActionState(
        `${item.id}:${commentId}:${action}:${actorHandle}`
      );
      const comment = findCommentInTree(item.comments, commentId);
      const serverActive = comment
        ? commentActionActive(comment, action, actorHandle)
        : undefined;
      return desired === undefined || serverActive === desired;
    }
    const desired = reconcilerRef.current.protectedDesiredActionState(
      `${item.id}:${action}:${actorHandle}`
    );
    const serverActive = reconcilerRef.current.itemActionActive(
      item,
      action,
      actorHandle
    );
    return desired === undefined || serverActive === desired;
  };

  const createPost = async (
    draft: InquiryPostDraft,
    communityId?: string | null
  ) => {
    const routedRoom = routeForPostKind(draft.kind);
    const contentKind =
      draft.kind === "proposal"
        ? "paper"
        : draft.kind === "opportunity"
          ? "thought"
          : draft.kind;
    const createdAt = new Date().toISOString();
    const postPayload = {
      title: draft.title,
      body: draft.body,
      document: draft.document,
      kind: contentKind,
      postType: draft.kind,
      room: routedRoom,
      communityId: communityId ?? undefined,
      patronage: draft.patronage,
      opportunity: draft.opportunity,
      authorHandle: inputRef.current.currentProfileRef.current.handle,
      attachmentIds: draft.attachments.map((attachment) => attachment.id),
      quoteSource: draft.quoteSource
        ? {
            sourceType: draft.quoteSource.sourceType,
            sourceId: draft.quoteSource.sourceId
          }
        : undefined
    };
    const mutation = inputRef.current.retryMutation.acquire(
      "post-create",
      JSON.stringify(postPayload)
    );
    inputRef.current.onStatus("Posting");
    let data: { item: InquiryItem };
    try {
      data = await symposiumApi.request<{ item: InquiryItem }>("/api/posts", {
        method: "POST",
        idempotencyKey: mutation.idempotencyKey,
        body: postPayload
      });
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) {
        inputRef.current.retryMutation.clear(mutation.fingerprintKey);
      }
      const message =
        error instanceof SymposiumApiError && error.status === null
          ? "Post could not reach the live service"
          : error instanceof Error
            ? error.message
            : "Post could not be saved";
      inputRef.current.onStatus(message);
      return { ok: false as const, error: message };
    }
    inputRef.current.retryMutation.clear(mutation.fingerprintKey);
    const existing = itemsRef.current.find((item) => item.id === data.item.id);
    const committedItem = reconcileCommittedItem(
      { ...data.item, createdAt: data.item.createdAt ?? createdAt },
      existing
    );
    const nextItems = sortByPublishedRecency([
      committedItem,
      ...itemsRef.current.filter((item) => item.id !== committedItem.id)
    ]);
    inputRef.current.onTouchItem(committedItem.id);
    replaceAndPersist(nextItems, [committedItem.id]);
    inputRef.current.onStatus("Post saved");
    return { ok: true as const, item: committedItem };
  };

  const addComment = async (command: InquiryCommentCreateInput) => {
    const {
      itemId,
      body,
      document,
      stance,
      parentId,
      attachments,
      quoteSource
    } = command;
    const previousItems = itemsRef.current;
    const existing = previousItems.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing)) {
      inputRef.current.onStatus("This post cannot accept comments");
      return false;
    }
    if (parentId && !findCommentInTree(existing.comments, parentId)) {
      inputRef.current.onStatus("Reply target is no longer available");
      return false;
    }
    inputRef.current.onStatus(parentId ? "Saving reply" : "Saving comment");
    let quote: InquiryComment["quote"];
    try {
      quote = resolveLocalContentQuote(previousItems, quoteSource);
    } catch (error) {
      inputRef.current.onStatus(
        error instanceof Error ? error.message : "Quoted content is unavailable"
      );
      return false;
    }
    const optimisticComment: InquiryComment = {
      id: clientId("comment"),
      parentId: parentId ?? null,
      author: inputRef.current.currentProfileRef.current.name,
      authorHandle: inputRef.current.currentProfileRef.current.handle,
      stance: stance.trim() || "Comment",
      body,
      document,
      createdAt: new Date().toISOString(),
      metrics: { ...commentMetricsFallback },
      savedBy: [],
      signaledBy: [],
      forkedBy: [],
      attachments,
      quote,
      replies: []
    };
    const appended = appendCommentToTree(existing.comments, optimisticComment);
    if (!appended.inserted) {
      inputRef.current.onStatus("Reply target is no longer available");
      return false;
    }
    coordinatorRef.current.begin(itemId);
    const nextCritiques = incrementMetric(existing.metrics.critiques, 1);
    const optimisticItem: InquiryItem = {
      ...existing,
      metrics: { ...existing.metrics, critiques: nextCritiques },
      signals: updateSignalValue(existing.signals, "Critiques", nextCritiques),
      comments: appended.comments
    };
    const optimisticItems = previousItems.map((item) =>
      item.id === itemId ? optimisticItem : item
    );
    replaceAndPersist(optimisticItems);
    inputRef.current.onTouchItem(itemId);
    command.onOptimistic(optimisticComment.id!);

    const commentPayload = {
      body,
      document,
      stance,
      parentId: parentId ?? null,
      authorHandle: inputRef.current.currentProfileRef.current.handle,
      attachmentIds: attachments.map((attachment) => attachment.id),
      quoteSource
    };
    const mutation = inputRef.current.retryMutation.acquire(
      "comment-create",
      JSON.stringify({ itemId, ...commentPayload })
    );
    try {
      const data = await symposiumApi.request<{
        comment?: InquiryComment;
        item?: InquiryItem;
      }>(`/api/posts/${itemId}/comments`, {
        method: "POST",
        idempotencyKey: mutation.idempotencyKey,
        body: commentPayload
      });
      inputRef.current.retryMutation.clear(mutation.fingerprintKey);
      if (data.item) {
        const currentItem = itemsRef.current.find((item) => item.id === itemId);
        const committedItem = reconcileCommittedItem(
          data.item,
          currentItem,
          inputRef.current.currentProfileRef.current.handle
        );
        replaceAndPersist(
          itemsRef.current.map((item) =>
            item.id === itemId ? committedItem : item
          )
        );
      }
      command.onCommitted(data.comment?.id ?? optimisticComment.id ?? null);
      inputRef.current.onStatus(parentId ? "Reply saved" : "Comment saved");
      return true;
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) {
        inputRef.current.retryMutation.clear(mutation.fingerprintKey);
      }
      const message =
        error instanceof SymposiumApiError && error.status === null
          ? parentId
            ? "Reply could not reach the live service"
            : "Comment could not reach the live service"
          : error instanceof Error
            ? error.message
            : parentId
              ? "Reply could not be saved"
              : "Comment could not be saved";
      replaceAndPersist(previousItems);
      command.onRollback();
      inputRef.current.onStatus(message);
      return false;
    } finally {
      coordinatorRef.current.complete(itemId);
    }
  };

  const applyAction = async (
    itemId: string,
    action: PostAction,
    options: ViewActionOptions = {}
  ) => {
    const isViewAction = action === "read";
    if (isViewAction && !claimView("post", itemId)) return;
    const actorHandle = inputRef.current.currentProfileRef.current.handle;
    if (isViewAction) {
      const synced = await recordPassiveView(
        "post",
        itemId,
        null,
        actorHandle,
        options
      );
      if (synced?.item) mergeLiveItem(synced.item);
      else if (synced?.itemId && synced.metrics) mergeLiveMetricPatch(synced);
      else releaseView("post", itemId);
      return;
    }
    const actionKey = `${itemId}:${action}:${actorHandle}`;
    const version = (actionVersionsRef.current[actionKey] ?? 0) + 1;
    actionVersionsRef.current[actionKey] = version;
    const mutationKey = createClientMutationId("post-action");
    const previousItems = itemsRef.current;
    let actionApplied = false;
    let desiredActive: boolean | undefined;
    let protectedMetricState: ProtectedActionMetricState | undefined;
    let previousCanonicalActivity: CanonicalActionActivityContract | undefined;
    const optimisticItems = previousItems.map((item) => {
      if (item.id !== itemId || isDeletedPost(item)) return item;
      actionApplied = true;
      const nextItem = mutateItemForActor(item, action, actorHandle, profile.handle);
      protectedMetricState =
        reconcilerRef.current.actionMetricStateFromValues(
          item.metrics,
          nextItem.metrics,
          action
        );
      if (action === "save") {
        desiredActive = isSavedBy(nextItem, actorHandle, profile.handle);
      }
      if (action === "signal") desiredActive = hasHandle(nextItem.signaledBy, actorHandle);
      if (action === "fork") desiredActive = hasHandle(nextItem.forkedBy, actorHandle);
      return nextItem;
    });
    if (!actionApplied) return;
    coordinatorRef.current.begin(itemId);
    reconcilerRef.current.setProtectedDesiredActionState(
      actionKey,
      desiredActive,
      protectedMetricState
    );
    if (desiredActive !== undefined) {
      previousCanonicalActivity = inputRef.current.activity.stage(
        "post",
        itemId,
        itemId,
        actorHandle,
        action as ToggleActionContract,
        desiredActive
      );
    }
    replaceAndPersist(optimisticItems);
    try {
      const data = await symposiumApi.request<{
        item: InquiryItem;
        activity?: unknown;
      }>(`/api/posts/${itemId}/actions`, {
        method: "POST",
        idempotencyKey: mutationKey,
        body: {
          action,
          actorHandle,
          active: desiredActive,
          trigger: options.trigger,
          surface: options.surface
        }
      });
      if (actionVersionsRef.current[actionKey] !== version) {
        const latestActive =
          reconcilerRef.current.protectedDesiredActionState(actionKey);
        if (latestActive !== undefined) {
          void symposiumApi.request(`/api/posts/${itemId}/actions`, {
            method: "POST",
            idempotencyKey: createClientMutationId("post-action-converge"),
            body: {
              action,
              actorHandle,
              active: latestActive,
              trigger: options.trigger,
              surface: options.surface
            }
          }).catch(() => undefined);
        }
        return;
      }
      const committedActive = reconcilerRef.current.itemActionActive(
        data.item,
        action,
        actorHandle
      );
      if (desiredActive !== undefined && committedActive !== desiredActive) {
        reconcilerRef.current.setProtectedDesiredActionState(
          actionKey,
          desiredActive,
          protectedMetricState
        );
        inputRef.current.onStatus("Action syncing");
        return;
      }
      const canonicalActivity = isCanonicalActionActivity(data.activity)
        ? data.activity
        : null;
      if (
        canonicalActivity &&
        !inputRef.current.activity.acceptCanonical(canonicalActivity)
      ) {
        inputRef.current.onStatus("Action synced");
        return;
      }
      replaceAndPersist(
        itemsRef.current.map((item) =>
          item.id === itemId
            ? reconcileCommittedItem(data.item, item, actorHandle)
            : item
        )
      );
      reconcilerRef.current.setProtectedDesiredActionState(
        actionKey,
        desiredActive,
        protectedMetricState
      );
      if (!canonicalActivity) {
        inputRef.current.activity.finishWithoutCanonical(
          "post",
          itemId,
          actorHandle,
          action as ToggleActionContract
        );
        inputRef.current.activity.touchPost(itemId, action, actorHandle);
      }
      inputRef.current.onStatus("Action synced");
    } catch {
      if (actionVersionsRef.current[actionKey] !== version) return;
      if (
        inputRef.current.activity.committed(
          "post",
          itemId,
          actorHandle,
          action as ToggleActionContract,
          desiredActive,
          previousCanonicalActivity
        )
      ) {
        reconcilerRef.current.clearDesiredActionState(actionKey);
        inputRef.current.onStatus("Action synced");
        return;
      }
      reconcilerRef.current.clearDesiredActionState(actionKey);
      inputRef.current.activity.restore(
        "post",
        itemId,
        actorHandle,
        action as ToggleActionContract,
        previousCanonicalActivity
      );
      replaceAndPersist(previousItems);
      inputRef.current.onStatus("Action could not sync");
    } finally {
      coordinatorRef.current.complete(itemId);
    }
  };

  const applyCommentAction = async (
    itemId: string,
    commentId: string,
    action: CommentAction,
    options: ViewActionOptions = {}
  ) => {
    const isViewAction = action === "read";
    if (isViewAction && !claimView("comment", commentId)) return;
    const actorHandle = inputRef.current.currentProfileRef.current.handle;
    if (isViewAction) {
      const synced = await recordPassiveView(
        "comment",
        itemId,
        commentId,
        actorHandle,
        options
      );
      if (synced?.item) mergeLiveItem(synced.item);
      else if (synced?.itemId && synced.metrics) mergeLiveMetricPatch(synced);
      else releaseView("comment", commentId);
      return;
    }
    const actionKey = `${itemId}:${commentId}:${action}:${actorHandle}`;
    const version = (actionVersionsRef.current[actionKey] ?? 0) + 1;
    actionVersionsRef.current[actionKey] = version;
    const mutationKey = createClientMutationId("comment-action");
    const previousItems = itemsRef.current;
    let actionApplied = false;
    let desiredActive: boolean | undefined;
    let protectedMetricState: ProtectedActionMetricState | undefined;
    let previousCanonicalActivity: CanonicalActionActivityContract | undefined;
    const optimisticItems = previousItems.map((item) => {
      if (item.id !== itemId) return item;
      const mapped = mapCommentTree(item.comments, commentId, (comment) => {
        const nextComment = mutateCommentForActor(comment, action, actorHandle);
        protectedMetricState =
          reconcilerRef.current.actionMetricStateFromValues(
            { ...commentMetricsFallback, ...(comment.metrics ?? {}) },
            { ...commentMetricsFallback, ...(nextComment.metrics ?? {}) },
            action
          );
        return nextComment;
      });
      if (!mapped.updated) return item;
      actionApplied = true;
      desiredActive = commentActionActive(mapped.updated, action, actorHandle);
      return { ...item, comments: mapped.comments };
    });
    if (!actionApplied) return;
    coordinatorRef.current.begin(itemId);
    reconcilerRef.current.setProtectedDesiredActionState(
      actionKey,
      desiredActive,
      protectedMetricState
    );
    if (desiredActive !== undefined) {
      previousCanonicalActivity = inputRef.current.activity.stage(
        "comment",
        commentId,
        itemId,
        actorHandle,
        action as ToggleActionContract,
        desiredActive
      );
    }
    replaceAndPersist(optimisticItems);
    try {
      const data = await symposiumApi.request<{
        item: InquiryItem;
        activity?: unknown;
      }>(`/api/posts/${itemId}/comments/${commentId}/actions`, {
        method: "POST",
        idempotencyKey: mutationKey,
        body: {
          action,
          actorHandle,
          active: desiredActive,
          trigger: options.trigger,
          surface: options.surface
        }
      });
      if (actionVersionsRef.current[actionKey] !== version) return;
      const committedComment = findCommentInTree(data.item.comments, commentId);
      const committedActive = committedComment
        ? commentActionActive(committedComment, action, actorHandle)
        : undefined;
      if (desiredActive !== undefined && committedActive !== desiredActive) {
        reconcilerRef.current.setProtectedDesiredActionState(
          actionKey,
          desiredActive,
          protectedMetricState
        );
        inputRef.current.onStatus("Comment action syncing");
        return;
      }
      const canonicalActivity = isCanonicalActionActivity(data.activity)
        ? data.activity
        : null;
      if (
        canonicalActivity &&
        !inputRef.current.activity.acceptCanonical(canonicalActivity)
      ) {
        inputRef.current.onStatus("Comment action synced");
        return;
      }
      replaceAndPersist(
        itemsRef.current.map((item) =>
          item.id === itemId
            ? reconcileCommittedItem(data.item, item, actorHandle)
            : item
        )
      );
      reconcilerRef.current.setProtectedDesiredActionState(
        actionKey,
        desiredActive,
        protectedMetricState
      );
      if (!canonicalActivity) {
        inputRef.current.activity.finishWithoutCanonical(
          "comment",
          commentId,
          actorHandle,
          action as ToggleActionContract
        );
        inputRef.current.activity.touchComment(
          itemId,
          commentId,
          action,
          actorHandle
        );
      }
      inputRef.current.onStatus("Comment action synced");
    } catch {
      if (actionVersionsRef.current[actionKey] !== version) return;
      if (
        inputRef.current.activity.committed(
          "comment",
          commentId,
          actorHandle,
          action as ToggleActionContract,
          desiredActive,
          previousCanonicalActivity
        )
      ) {
        reconcilerRef.current.clearDesiredActionState(actionKey);
        inputRef.current.onStatus("Comment action synced");
        return;
      }
      reconcilerRef.current.clearDesiredActionState(actionKey);
      inputRef.current.activity.restore(
        "comment",
        commentId,
        actorHandle,
        action as ToggleActionContract,
        previousCanonicalActivity
      );
      replaceAndPersist(previousItems);
      inputRef.current.onStatus("Comment action could not sync");
    } finally {
      coordinatorRef.current.complete(itemId);
    }
  };

  const savePostEdit = async (itemId: string, draft: InquiryPostEditDraft) => {
    const cleanTitle = draft.title.trim();
    const cleanBody = draft.body.trim();
    const previousItems = itemsRef.current;
    const existing = previousItems.find((item) => item.id === itemId);
    if (
      !existing ||
      isDeletedPost(existing) ||
      !cleanBody ||
      postTitlePolicyError(existing, cleanTitle)
    ) {
      return false;
    }
    coordinatorRef.current.begin(itemId);
    const editedAt = new Date().toISOString();
    const optimisticItems = previousItems.map((item) =>
      item.id === itemId
        ? {
            ...item,
            title: cleanTitle,
            body: cleanBody,
            document: draft.document,
            excerpt: cleanBody,
            claims: [cleanBody],
            attachments: draft.attachments,
            quote: draft.quote ?? undefined,
            patronage: draft.patronage
              ? {
                  ...draft.patronage,
                  raisedMinorUnits: existing.patronage?.raisedMinorUnits ?? 0,
                  supporterCount: existing.patronage?.supporterCount ?? 0,
                  topSupporters: existing.patronage?.topSupporters ?? []
                }
              : existing.patronage,
            opportunity: draft.opportunity
              ? {
                  ...draft.opportunity,
                  applicationCount: existing.opportunity?.applicationCount ?? 0
                }
              : existing.opportunity,
            editedAt
          }
        : item
    );
    replaceAndPersist(optimisticItems);
    inputRef.current.onStatus("Saving post edit");
    try {
      const data = await symposiumApi.request<{ item: InquiryItem }>(
        `/api/posts/${itemId}`,
        {
          method: "PATCH",
          idempotencyKey: createClientMutationId("post-update"),
          body: {
            title: cleanTitle,
            body: cleanBody,
            document: draft.document,
            actorHandle: inputRef.current.currentProfileRef.current.handle,
            expectedEditedAt: existing.editedAt ?? null,
            attachmentIds: draft.attachments.map((attachment) => attachment.id),
            patronage: draft.patronage,
            opportunity: draft.opportunity,
            quoteSource: !draft.quote
              ? existing.quote
                ? null
                : undefined
              : !existing.quote ||
                  existing.quote.sourceType !== draft.quote.sourceType ||
                  existing.quote.sourceId !== draft.quote.sourceId
                ? {
                    sourceType: draft.quote.sourceType,
                    sourceId: draft.quote.sourceId
                  }
                : undefined
          }
        }
      );
      replaceAndPersist(
        itemsRef.current.map((item) =>
          item.id === itemId ? reconcileCommittedItem(data.item, item) : item
        )
      );
      inputRef.current.onStatus("Post edited");
      return true;
    } catch {
      replaceAndPersist(previousItems);
      inputRef.current.onStatus("Post edit could not sync");
      return false;
    } finally {
      coordinatorRef.current.complete(itemId);
    }
  };

  const saveCommentEdit = async (command: InquiryCommentEditInput) => {
    const { itemId, commentId, document, attachments, quote } = command;
    const cleanBody = command.body.trim();
    if (!cleanBody) return false;
    const previousItems = itemsRef.current;
    const existing = previousItems.find((item) => item.id === itemId);
    const existingComment = existing
      ? findCommentInTree(existing.comments, commentId)
      : undefined;
    if (
      !existing ||
      !existingComment ||
      isDeletedComment(existingComment) ||
      cleanHandle(existingComment.authorHandle ?? existingComment.author) !==
        inputRef.current.currentProfileRef.current.handle
    ) {
      return false;
    }
    coordinatorRef.current.begin(itemId);
    const editedAt = new Date().toISOString();
    const optimisticItems = previousItems.map((item) => {
      if (item.id !== itemId) return item;
      const mapped = mapCommentTree(item.comments, commentId, (comment) => ({
        ...comment,
        body: cleanBody,
        document,
        attachments,
        quote: quote ?? undefined,
        editedAt
      }));
      return mapped.updated ? { ...item, comments: mapped.comments } : item;
    });
    replaceAndPersist(optimisticItems);
    inputRef.current.onStatus("Saving comment edit");
    try {
      const data = await symposiumApi.request<{ item: InquiryItem }>(
        `/api/posts/${itemId}/comments/${commentId}`,
        {
          method: "PATCH",
          idempotencyKey: createClientMutationId("comment-update"),
          body: {
            body: cleanBody,
            document,
            actorHandle: inputRef.current.currentProfileRef.current.handle,
            expectedEditedAt: existingComment.editedAt ?? null,
            attachmentIds: attachments.map((attachment) => attachment.id),
            quoteSource: !quote
              ? existingComment.quote
                ? null
                : undefined
              : !existingComment.quote ||
                  existingComment.quote.sourceType !== quote.sourceType ||
                  existingComment.quote.sourceId !== quote.sourceId
                ? { sourceType: quote.sourceType, sourceId: quote.sourceId }
                : undefined
          }
        }
      );
      replaceAndPersist(
        itemsRef.current.map((item) =>
          item.id === itemId ? reconcileCommittedItem(data.item, item) : item
        )
      );
      inputRef.current.onStatus("Comment edited");
      return true;
    } catch {
      replaceAndPersist(previousItems);
      inputRef.current.onStatus("Comment edit could not sync");
      return false;
    } finally {
      coordinatorRef.current.complete(itemId);
    }
  };

  const deletion = createContentDeletionController({
    itemsRef,
    communitiesRef: input.communitiesRef,
    actorHandle: input.currentProfileRef.current.handle,
    beginMutation: coordinatorRef.current.begin,
    completeMutation: coordinatorRef.current.complete,
    replaceItems,
    persistItems,
    reconcileItem: reconcileCommittedItem,
    clearPostEditor: () => inputRef.current.clearPostEditor(),
    clearCommentEditor: (itemId, commentId) =>
      inputRef.current.clearCommentEditor(itemId, commentId),
    setStatus: (status) => inputRef.current.onStatus(status)
  });

  return {
    acceptLiveActionProjection,
    addComment,
    applyAction,
    applyCommentAction,
    captureRefresh,
    commitRefresh,
    createPost,
    deleteComment: deletion.deleteComment,
    deletePost: deletion.deletePost,
    feedPages,
    feedPagesRef,
    hydrateCachedSnapshot,
    invalidateLiveQuotedSource,
    items,
    itemsRef,
    loadPostDetail,
    loadPostPage,
    loadPostSubjects,
    mergeBoundedRead,
    mergeLiveItem,
    mergeLiveMetricPatch,
    persistSnapshot,
    projectProfile,
    saveCommentEdit,
    savePostEdit
  };
};
