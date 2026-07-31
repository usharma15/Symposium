"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import type { CommentAction, PostAction } from "@/lib/symposiumCore";
import type {
  CanonicalActionActivityContract,
  ProfileActivityResponseContract,
  ProfileAuthoredCommentActivityContract,
  ToggleActionContract
} from "@/packages/contracts/src";
import type {
  InquiryComment,
  InquiryItem,
  ResearchProfile
} from "@/lib/mockData";
import {
  applyProfileActivityActionTotalTransition,
  canonicalActionState,
  canonicalActivityKey,
  createLocalCanonicalActivity,
  emptyProfileActivityCounts,
  isCanonicalActionActivity,
  mergeCanonicalActivities,
  profileItemIsInActivityScope,
  reconcileCanonicalActivityRefresh
} from "@/lib/profileActivity";
import {
  cleanHandle,
  itemTimestampScore
} from "@/lib/symposiumCore";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import {
  persistCachedProfileActivity,
  readCachedProfileActivity
} from "@/features/profiles/profileReadCache";
import {
  commentTimestampScore,
  emptyProfileActivitySnapshot,
  profileActivityActionsForScope,
  profileActivityCommentModeForScope,
  profileActivityKey,
  profileActivityScopeForTab,
  profileCommentActivityKey,
  type ProfileActivityPageScope,
  type ProfileActivitySnapshot
} from "@/features/profiles/profileActivityModel";
import type {
  ProfileActivityKind,
  ProfileCommentActivityKind,
  ProfileTab
} from "@/features/profiles/profileTypes";
import type { ProfileInquiryPort } from "@/features/profiles/profileControllerPorts";

type ProfileActivityControllerInput = {
  activeTab: ProfileTab;
  currentProfileRef: MutableRefObject<ResearchProfile>;
  inquiryRef: MutableRefObject<ProfileInquiryPort | null>;
  readsEnabled: boolean;
  selectedProfile: ResearchProfile | null;
  selectedProfileName: string | null;
};

export const useProfileActivityController = (
  input: ProfileActivityControllerInput
) => {
  const inputRef = useRef(input);
  inputRef.current = input;
  const [activityRevision, setActivityRevision] = useState(0);
  const [activityByHandle, setActivityByHandle] = useState<
    Record<string, ProfileActivitySnapshot>
  >({});
  const [activityErrors, setActivityErrors] = useState<Record<string, boolean>>(
    {}
  );
  const [activityRecency, setActivityRecency] = useState<Record<string, number>>(
    {}
  );
  const activityRecencyRef = useRef(activityRecency);
  const activityByHandleRef = useRef(activityByHandle);
  const inFlightRef = useRef<Record<string, Promise<void> | undefined>>({});
  const canonicalRevisionRef = useRef<Record<string, number>>({});
  const pendingCanonicalKeysRef = useRef(new Set<string>());
  const requestRef = useRef<Record<string, number>>({});
  const cacheHydrationRef = useRef(new Set<string>());
  const pendingRecencyRef = useRef<Record<string, number>>({});

  useEffect(() => {
    activityRecencyRef.current = activityRecency;
  }, [activityRecency]);

  useEffect(() => {
    activityByHandleRef.current = activityByHandle;
  }, [activityByHandle]);

  const persistActivityRecency = (next: Record<string, number>) => {
    activityRecencyRef.current = next;
    window.localStorage.setItem(
      "symposium-activity-recency",
      JSON.stringify(next)
    );
  };

  const hydrateLocalRecency = () => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem("symposium-activity-recency") ?? "{}"
      ) as Record<string, number>;
      activityRecencyRef.current = stored;
      setActivityRecency(stored);
    } catch {
      activityRecencyRef.current = {};
      setActivityRecency({});
    }
  };

  const recordActivityRecency = (
    updates: Record<string, number>,
    deferForProfile = false
  ) => {
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => Number.isFinite(value))
    ) as Record<string, number>;
    if (!Object.keys(cleanUpdates).length) return;

    if (deferForProfile) {
      pendingRecencyRef.current = {
        ...pendingRecencyRef.current,
        ...cleanUpdates
      };
      persistActivityRecency({
        ...activityRecencyRef.current,
        ...pendingRecencyRef.current
      });
      return;
    }

    const pending = pendingRecencyRef.current;
    pendingRecencyRef.current = {};
    setActivityRecency((current) => {
      const next = { ...current, ...pending, ...cleanUpdates };
      persistActivityRecency(next);
      return next;
    });
  };

  const flushPendingRecency = () => {
    const pending = pendingRecencyRef.current;
    if (!Object.keys(pending).length) {
      setActivityRevision((revision) => revision + 1);
      return;
    }
    pendingRecencyRef.current = {};
    setActivityRecency((current) => {
      const next = { ...current, ...pending };
      persistActivityRecency(next);
      return next;
    });
    setActivityRevision((revision) => revision + 1);
  };

  const touchItem = (itemId: string, timestamp = Date.now()) => {
    recordActivityRecency({ [itemId]: timestamp });
  };

  const touchPost = (
    itemId: string,
    action: PostAction,
    handle = inputRef.current.currentProfileRef.current.handle,
    timestamp = Date.now()
  ) => {
    if (action === "read") return;
    recordActivityRecency(
      { [profileActivityKey(cleanHandle(handle), action, itemId)]: timestamp },
      Boolean(inputRef.current.selectedProfileName)
    );
  };

  const touchComment = (
    itemId: string,
    commentId: string,
    action: CommentAction,
    handle = inputRef.current.currentProfileRef.current.handle,
    timestamp = Date.now()
  ) => {
    if (action === "read") return;
    recordActivityRecency(
      {
        [profileCommentActivityKey(
          cleanHandle(handle),
          action,
          itemId,
          commentId
        )]: timestamp
      },
      Boolean(inputRef.current.selectedProfileName)
    );
  };

  const getProfileRecency = (
    item: InquiryItem,
    handle: string,
    kind: ProfileActivityKind
  ) => {
    const published = itemTimestampScore(item);
    if (kind === "authored") return published;
    if (kind === "comments") return activityRecency[item.id] ?? published;
    return (
      activityRecency[profileActivityKey(cleanHandle(handle), kind, item.id)] ??
      published
    );
  };

  const getProfileCommentRecency = (
    item: InquiryItem,
    comment: InquiryComment,
    handle: string,
    kind: ProfileCommentActivityKind
  ) => {
    const fallback = commentTimestampScore(comment) || itemTimestampScore(item);
    if (kind === "comments" || !comment.id) return fallback;
    return (
      activityRecency[
        profileCommentActivityKey(
          cleanHandle(handle),
          kind,
          item.id,
          comment.id
        )
      ] ?? fallback
    );
  };

  const setSnapshot = (
    handle: string,
    snapshot: ProfileActivitySnapshot
  ) => {
    const clean = cleanHandle(handle);
    const next = { ...activityByHandleRef.current, [clean]: snapshot };
    activityByHandleRef.current = next;
    setActivityByHandle(next);
  };

  const canonicalRecencyUpdate = (
    activity: CanonicalActionActivityContract
  ) => {
    if (!activity.active) return null;
    const timestamp = Date.parse(activity.occurredAt);
    if (!Number.isFinite(timestamp)) return null;
    if (activity.subjectType === "comment") {
      return {
        [profileCommentActivityKey(
          cleanHandle(activity.actorHandle),
          activity.action,
          activity.postId,
          activity.subjectId
        )]: timestamp
      };
    }
    return {
      [profileActivityKey(
        cleanHandle(activity.actorHandle),
        activity.action,
        activity.postId
      )]: timestamp
    };
  };

  const reshareAddsToAll = (activity: CanonicalActionActivityContract) => {
    if (activity.action !== "fork") return false;
    const item = inputRef.current.inquiryRef.current?.findItem(activity.postId);
    return Boolean(item && profileItemIsInActivityScope(item));
  };

  const acceptCanonical = (activity: CanonicalActionActivityContract) => {
    const key = canonicalActivityKey(activity);
    const currentRevision = canonicalRevisionRef.current[key] ?? 0;
    if (activity.revision < currentRevision) return false;

    pendingCanonicalKeysRef.current.delete(key);
    canonicalRevisionRef.current[key] = activity.revision;
    const handle = cleanHandle(activity.actorHandle);
    const current =
      activityByHandleRef.current[handle] ?? emptyProfileActivitySnapshot();
    const previous = canonicalActionState(
      current.entries,
      activity.subjectType,
      activity.subjectId,
      handle,
      activity.action
    );
    setSnapshot(handle, {
      ...current,
      entries: mergeCanonicalActivities(current.entries, [activity]),
      totals: current.totals
        ? applyProfileActivityActionTotalTransition(
            current.totals,
            activity.action,
            previous?.active ?? false,
            activity.active,
            reshareAddsToAll(activity)
          )
        : undefined
    });
    const update = canonicalRecencyUpdate(activity);
    if (update) {
      recordActivityRecency(
        update,
        Boolean(inputRef.current.selectedProfileName)
      );
    }
    return true;
  };

  const replaceCanonical = (
    handle: string,
    scope: ProfileActivityPageScope,
    requestedActions: ToggleActionContract[],
    response: ProfileActivityResponseContract,
    requestStartRevisions: Record<string, number>,
    append = false,
    stale = false
  ) => {
    const clean = cleanHandle(handle);
    const current =
      activityByHandleRef.current[clean] ?? emptyProfileActivitySnapshot();
    const actionSet = new Set(requestedActions);
    const currentScopeEntries = current.entries.filter((activity) =>
      actionSet.has(activity.action)
    );
    const retainedEntries = current.entries.filter(
      (activity) => !actionSet.has(activity.action)
    );
    const reconciledScopeEntries = reconcileCanonicalActivityRefresh({
      current: currentScopeEntries,
      incoming: append
        ? mergeCanonicalActivities(currentScopeEntries, response.entries)
        : response.entries,
      pendingKeys: pendingCanonicalKeysRef.current,
      currentRevisions: canonicalRevisionRef.current,
      requestStartRevisions
    });
    const entries = mergeCanonicalActivities(
      retainedEntries,
      reconciledScopeEntries
    );
    const finalScopeKeys = new Set(
      reconciledScopeEntries.map(canonicalActivityKey)
    );
    for (const activity of currentScopeEntries) {
      const key = canonicalActivityKey(activity);
      if (!finalScopeKeys.has(key)) delete canonicalRevisionRef.current[key];
    }
    const recencyUpdates: Record<string, number> = {};
    for (const activity of response.entries) {
      const key = canonicalActivityKey(activity);
      canonicalRevisionRef.current[key] = Math.max(
        canonicalRevisionRef.current[key] ?? 0,
        activity.revision
      );
      Object.assign(recencyUpdates, canonicalRecencyUpdate(activity));
    }
    recordActivityRecency(
      recencyUpdates,
      Boolean(inputRef.current.selectedProfileName)
    );
    setSnapshot(clean, {
      ...current,
      entries,
      loaded: true,
      nextCursor: scope === "all" ? response.nextCursor : current.nextCursor,
      pages: {
        ...current.pages,
        [scope]: {
          loaded: true,
          loading: false,
          nextCursor: response.nextCursor,
          commentsNextCursor: response.commentsNextCursor ?? null,
          stale
        }
      },
      hiddenCommunityCounts:
        response.hiddenCommunityCounts ?? current.hiddenCommunityCounts,
      totals: response.totals ?? current.totals
    });
  };

  const refresh = (
    handle: string,
    actorHandle = inputRef.current.currentProfileRef.current.handle,
    scope: ProfileActivityPageScope = "all",
    append = false,
    forceSummary = false
  ) => {
    const clean = cleanHandle(handle);
    const cleanActor = cleanHandle(actorHandle);
    const inquiry = inputRef.current.inquiryRef.current;
    if (!clean || clean === "@" || !inquiry) return Promise.resolve();
    const existingSnapshot =
      activityByHandleRef.current[clean] ?? emptyProfileActivitySnapshot();
    const existingPage = existingSnapshot.pages[scope];
    const configuredActions = profileActivityActionsForScope(scope);
    const includeComments =
      profileActivityCommentModeForScope(scope) !== "none";
    const startCursor = append ? existingPage?.nextCursor ?? null : null;
    const commentsCursor = append
      ? existingPage?.commentsNextCursor ?? null
      : null;
    const requestedActions =
      append && !startCursor ? [] : configuredActions;
    const requestComments =
      includeComments && (!append || Boolean(commentsCursor));
    const requestSummary =
      !append && (forceSummary || !existingSnapshot.totals);
    if (append && !requestedActions.length && !requestComments) {
      return Promise.resolve();
    }

    const inFlightKey = `${clean}:${cleanActor}:${scope}:${startCursor ?? "actions-end"}:${commentsCursor ?? "comments-end"}`;
    const existingRequest = inFlightRef.current[inFlightKey];
    if (existingRequest) return existingRequest;
    const requestKey = `${clean}:${scope}`;
    const requestId = (requestRef.current[requestKey] ?? 0) + 1;
    requestRef.current[requestKey] = requestId;
    setSnapshot(clean, {
      ...existingSnapshot,
      pages: {
        ...existingSnapshot.pages,
        [scope]: {
          loaded: existingPage?.loaded ?? false,
          loading: true,
          nextCursor: existingPage?.nextCursor ?? null,
          commentsNextCursor: existingPage?.commentsNextCursor ?? null
        }
      }
    });
    setActivityErrors((current) => {
      if (!current[clean]) return current;
      const next = { ...current };
      delete next[clean];
      return next;
    });

    const request = (async () => {
      const requestStartRevisions = { ...canonicalRevisionRef.current };
      const params = new URLSearchParams({
        limit: "50",
        actorHandle: cleanActor,
        actions: requestedActions.join(","),
        includeComments: String(requestComments),
        includeSummary: String(requestSummary)
      });
      if (startCursor) params.set("cursor", startCursor);
      if (commentsCursor) params.set("commentsCursor", commentsCursor);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      let data: Partial<ProfileActivityResponseContract>;
      try {
        data = await symposiumApi.request<
          Partial<ProfileActivityResponseContract>
        >(
          `/api/profiles/${encodeURIComponent(clean)}/activity?${params.toString()}`,
          { cache: "no-store", signal: controller.signal }
        );
      } finally {
        window.clearTimeout(timeout);
      }

      const entries = (data.entries ?? []).filter(isCanonicalActionActivity);
      const authoredComments = (data.authoredComments ?? []).filter(
        (
          activity
        ): activity is ProfileAuthoredCommentActivityContract =>
          Boolean(
            activity &&
              typeof activity.commentId === "string" &&
              typeof activity.postId === "string" &&
              typeof activity.occurredAt === "string" &&
              Number.isFinite(Date.parse(activity.occurredAt))
          )
      );
      if (data.items?.length || data.profiles) {
        inquiry.mergeBoundedRead({
          items: data.items ?? [],
          profiles: data.profiles ?? {}
        });
      } else {
        await Promise.all([
          inquiry.loadPostSubjects(
            entries.map((entry) => entry.postId),
            entries
              .filter((entry) => entry.subjectType === "comment")
              .map((entry) => entry.subjectId),
            cleanActor
          ),
          inquiry.loadPostSubjects(
            authoredComments.map((activity) => activity.postId),
            authoredComments.map((activity) => activity.commentId),
            cleanActor
          )
        ]);
      }

      if (requestRef.current[requestKey] !== requestId) return;
      const canonicalResponse = {
        entries,
        nextCursor:
          typeof data.nextCursor === "string" ? data.nextCursor : null,
        authoredComments,
        commentsNextCursor:
          typeof data.commentsNextCursor === "string"
            ? data.commentsNextCursor
            : null,
        hiddenCommunityCounts:
          data.hiddenCommunityCounts ??
          existingSnapshot.hiddenCommunityCounts ??
          emptyProfileActivityCounts(),
        totals: data.totals ?? existingSnapshot.totals,
        items: data.items,
        profiles: data.profiles
      } as ProfileActivityResponseContract;
      replaceCanonical(
        clean,
        scope,
        requestedActions,
        canonicalResponse,
        requestStartRevisions,
        append
      );
      if (!append && (canonicalResponse.items || canonicalResponse.profiles)) {
        persistCachedProfileActivity(window.localStorage, {
          viewerHandle: cleanActor,
          targetHandle: clean,
          scope,
          response: canonicalResponse
        });
      }
    })().catch((error) => {
      if (requestRef.current[requestKey] === requestId) {
        setActivityErrors((current) => ({ ...current, [clean]: true }));
        const latest =
          activityByHandleRef.current[clean] ??
          emptyProfileActivitySnapshot();
        setSnapshot(clean, {
          ...latest,
          pages: {
            ...latest.pages,
            [scope]: {
              loaded: latest.pages[scope]?.loaded ?? false,
              loading: false,
              nextCursor: latest.pages[scope]?.nextCursor ?? null,
              commentsNextCursor:
                latest.pages[scope]?.commentsNextCursor ?? null
            }
          }
        });
      }
      throw error;
    });

    const tracked = request.finally(() => {
      if (inFlightRef.current[inFlightKey] === tracked) {
        delete inFlightRef.current[inFlightKey];
      }
    });
    inFlightRef.current[inFlightKey] = tracked;
    return tracked;
  };

  const stage = (
    subjectType: "post" | "comment",
    subjectId: string,
    postId: string,
    actorHandle: string,
    action: ToggleActionContract,
    active: boolean
  ) => {
    const handle = cleanHandle(actorHandle);
    const current =
      activityByHandleRef.current[handle] ??
      emptyProfileActivitySnapshot();
    const previous = canonicalActionState(
      current.entries,
      subjectType,
      subjectId,
      handle,
      action
    );
    const key = canonicalActivityKey({
      subjectType,
      subjectId,
      actorHandle: handle,
      action
    });
    pendingCanonicalKeysRef.current.add(key);
    const optimistic = {
      ...createLocalCanonicalActivity({
        subjectType,
        subjectId,
        postId,
        actorHandle: handle,
        action,
        active
      }),
      revision: previous?.revision ?? 1
    };
    setSnapshot(handle, {
      ...current,
      entries: mergeCanonicalActivities(current.entries, [optimistic]),
      totals: current.totals
        ? applyProfileActivityActionTotalTransition(
            current.totals,
            action,
            previous?.active ?? false,
            active,
            reshareAddsToAll(optimistic)
          )
        : undefined
    });
    return previous;
  };

  const restore = (
    subjectType: "post" | "comment",
    subjectId: string,
    actorHandle: string,
    action: ToggleActionContract,
    previous: CanonicalActionActivityContract | undefined
  ) => {
    const handle = cleanHandle(actorHandle);
    const current = activityByHandleRef.current[handle];
    if (!current) return;
    const key = canonicalActivityKey({
      subjectType,
      subjectId,
      actorHandle: handle,
      action
    });
    pendingCanonicalKeysRef.current.delete(key);
    const optimistic = canonicalActionState(
      current.entries,
      subjectType,
      subjectId,
      handle,
      action
    );
    const subjectActivity = optimistic ?? previous;
    const entries = current.entries.filter(
      (activity) => canonicalActivityKey(activity) !== key
    );
    if (previous) entries.push(previous);
    setSnapshot(handle, {
      ...current,
      entries: mergeCanonicalActivities([], entries),
      totals: current.totals
        ? applyProfileActivityActionTotalTransition(
            current.totals,
            action,
            optimistic?.active ?? false,
            previous?.active ?? false,
            subjectActivity ? reshareAddsToAll(subjectActivity) : false
          )
        : undefined
    });
  };

  const committed = (
    subjectType: "post" | "comment",
    subjectId: string,
    actorHandle: string,
    action: ToggleActionContract,
    desiredActive: boolean | undefined,
    previous: CanonicalActionActivityContract | undefined
  ) => {
    if (desiredActive === undefined) return false;
    const handle = cleanHandle(actorHandle);
    const current = canonicalActionState(
      activityByHandleRef.current[handle]?.entries ?? [],
      subjectType,
      subjectId,
      handle,
      action
    );
    const revision =
      canonicalRevisionRef.current[
        canonicalActivityKey({
          subjectType,
          subjectId,
          actorHandle: handle,
          action
        })
      ] ?? 0;
    return (
      current?.active === desiredActive &&
      revision > (previous?.revision ?? 0)
    );
  };

  const finishWithoutCanonical = (
    subjectType: "post" | "comment",
    subjectId: string,
    actorHandle: string,
    action: ToggleActionContract
  ) => {
    pendingCanonicalKeysRef.current.delete(
      canonicalActivityKey({
        subjectType,
        subjectId,
        actorHandle,
        action
      })
    );
  };

  useLayoutEffect(() => {
    const {
      activeTab,
      currentProfileRef,
      inquiryRef,
      readsEnabled,
      selectedProfile
    } = inputRef.current;
    const inquiry = inquiryRef.current;
    if (!readsEnabled || !selectedProfile?.handle || !inquiry) return;
    const targetHandle = cleanHandle(selectedProfile.handle);
    const viewerHandle = cleanHandle(currentProfileRef.current.handle);
    const scope = profileActivityScopeForTab(activeTab);
    const cacheKey = `${viewerHandle}:${targetHandle}:${scope}`;
    if (cacheHydrationRef.current.has(cacheKey)) return;
    cacheHydrationRef.current.add(cacheKey);
    const currentPage =
      activityByHandleRef.current[targetHandle]?.pages[scope];
    if (currentPage?.loaded) return;
    const cached = readCachedProfileActivity(window.localStorage, {
      viewerHandle,
      targetHandle,
      scope
    });
    if (!cached) return;
    inquiry.mergeBoundedRead(
      {
        items: cached.items ?? [],
        profiles: cached.profiles ?? {}
      },
      { persist: false }
    );
    replaceCanonical(
      targetHandle,
      scope,
      profileActivityActionsForScope(scope),
      cached,
      {},
      false,
      true
    );
  }, [
    input.activeTab,
    input.currentProfileRef,
    input.inquiryRef,
    input.readsEnabled,
    input.selectedProfile?.handle
  ]);

  useEffect(() => {
    const currentHandle = input.currentProfileRef.current.handle;
    if (!input.readsEnabled || !currentHandle || input.selectedProfile?.handle) {
      return;
    }
    const page = activityByHandleRef.current[currentHandle]?.pages.all;
    if (page?.loaded && !page.stale) return;
    void refresh(currentHandle, currentHandle, "all").catch(() => undefined);
  }, [
    input.currentProfileRef,
    input.readsEnabled,
    input.selectedProfile?.handle,
    input.currentProfileRef.current.handle
  ]);

  useEffect(() => {
    if (!input.readsEnabled || !input.selectedProfile?.handle) return;
    const scope = profileActivityScopeForTab(input.activeTab);
    const page =
      activityByHandleRef.current[input.selectedProfile.handle]?.pages[scope];
    if (page?.loaded && !page.stale) return;
    void refresh(
      input.selectedProfile.handle,
      input.currentProfileRef.current.handle,
      scope,
      false,
      Boolean(page?.stale)
    ).catch(() => undefined);
  }, [
    input.activeTab,
    input.currentProfileRef,
    input.readsEnabled,
    input.selectedProfile?.handle,
    input.currentProfileRef.current.handle
  ]);

  const selectedScope = profileActivityScopeForTab(input.activeTab);
  const selectedSnapshot = input.selectedProfile?.handle
    ? activityByHandle[input.selectedProfile.handle]
    : undefined;
  const selectedPage = selectedSnapshot?.pages[selectedScope];

  return {
    acceptCanonical,
    activityByHandle,
    activityErrors,
    activityRevision,
    committed,
    finishWithoutCanonical,
    flushPendingRecency,
    getProfileCommentRecency,
    getProfileRecency,
    hydrateLocalRecency,
    refresh,
    restore,
    selectedPage,
    selectedScope,
    selectedSnapshot,
    stage,
    touchComment,
    touchItem,
    touchPost
  };
};
