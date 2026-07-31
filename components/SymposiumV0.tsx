"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  BrainCircuit,
  Moon,
  NotebookPen,
  Search,
  Sun,
  UserRound
} from "lucide-react";
import {
  inquiryItems,
  profile,
  rooms,
  type FeedScope,
  type ContentQuoteSource,
  type InquiryAttachment,
  type InquiryComment,
  type InquiryItem,
  type RoomId
} from "@/lib/mockData";
import type {
  AssistantMessageInputContract,
  OpportunityPostInputContract,
  PatronageProposalInputContract,
  PostPageQueryContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";
import {
  cleanHandle,
  findCommentInTree,
  isDeletedComment,
  isDeletedPost,
  itemTimestampScore
} from "@/lib/symposiumCore";
import { emptyProfileActivityCounts } from "@/lib/profileActivity";
import { useSymposiumLiveController } from "@/features/live-sync/useSymposiumLiveController";
import {
  dispatchPendingContentAnalytics,
  queuePendingContentAnalytics,
  type PendingContentAnalytics
} from "@/features/analytics/contentAnalyticsNavigation";
import {
  createClientMutationId,
  createRetryMutationRegistry,
  symposiumApi
} from "@/features/api/symposiumApiClient";
import {
  browserRecoveryCoordinator
} from "@/features/recovery/browserRecoveryCoordinator";
import {
  parseCanonicalRoute,
  type CanonicalRoute,
  type ProfileSocialView
} from "@/features/navigation/canonicalRoute";
import {
  assistantBackdropForView,
  canonicalRouteForView as routeForViewSnapshot,
  detailOriginFromSnapshot,
  nextViewSnapshot,
  snapshotForCanonicalRoute,
  type OfficeMode,
  type ViewSnapshot
} from "@/features/navigation/viewState";
import { useSymposiumViewController } from "@/features/navigation/useSymposiumViewController";
import { useInquiryController } from "@/features/inquiry/useInquiryController";
import {
  buildPostAttachmentMetadata,
  type AttachmentPreviewHandler
} from "@/features/attachments/AttachmentViews";
import type { PdfAttachmentViewContext } from "@/features/attachments/pdfAttachmentClient";
import { buildTabletAttachmentContext } from "@/features/assistant/tabletAttachmentContext";
import { AssistantExperience } from "@/features/assistant/AssistantExperience";
import { useAssistantController } from "@/features/assistant/useAssistantController";
import {
  confirmAttachmentUpload,
  prepareAttachmentUpload,
  uploadPreparedAttachmentContent,
  uploadConfirmedAttachment,
  uploadConfirmedPostAttachment,
  type AttachmentConfirmResponse,
  type AttachmentUploadResponse
} from "@/features/attachments/attachmentUploadClient";
import { inferAttachmentContentType } from "@/lib/attachmentRules";
import { useDedicatedAttachmentViewer } from "@/features/attachments/useDedicatedAttachmentViewer";
import { ScribbleLauncher, ScribbleProvider } from "@/features/scribble/ScribbleContext";
import { ScribbleAttachmentPreview } from "@/features/scribble/ScribbleAttachmentPreview";
import { NativeCitationProvider } from "@/features/citations/NativeCitationContext";
import {
  EntrySequence,
  HallView,
  OfficeDeskView,
  ViewNav
} from "@/features/shell/SymposiumShellViews";
import {
  isPersistentSyncStatus,
  syncStatusAfterNavigation,
  syncStatusExpiryMs
} from "@/features/shell/syncStatusState";
import { useSymposiumSurfaceController } from "@/features/shell/useSymposiumSurfaceController";
import type { ViewSurface } from "@/features/actions/actionTypes";
import {
  type CommentSegmentStacks
} from "@/features/comments/CommentThread";
import {
  CommentEditModal,
  DetailView,
  PostComposerModal,
  PostEditModal,
  type PostDraft
} from "@/features/posts/PostViews";
import {
  QuoteComposerModal,
  type QuoteSelection
} from "@/features/quotes/QuoteViews";
import { resolveQuoteLink, type QuoteLinkResolver } from "@/features/quotes/quoteLinks";
import { resolveLocalContentQuote } from "@/lib/contentQuotes";
import { postContextLabel } from "@/lib/postSemantics";
import { selectVisibleFeedItems } from "@/features/feeds/feedVisibility";
import {
  ProfileSettingsModal,
  ProfileView,
  type ProfileTab
} from "@/features/profiles/ProfileViews";
import {
  profileActivityActionsForScope,
  profileActivityScopeIncludesComments,
  profileTabUsesAuthoredPosts
} from "@/features/profiles/profileActivityModel";
import type { ProfileSettingsDraft } from "@/features/profiles/profileTypes";
import type {
  ProfileEnvironmentPort,
  ProfileInquiryPort
} from "@/features/profiles/profileControllerPorts";
import {
  useProfileController
} from "@/features/profiles/useProfileController";
import {
  CommunitiesStage
} from "@/features/communities/CommunityViews";
import { useDiscoveryController } from "@/features/discovery/useDiscoveryController";
import { canParticipateInCommunity } from "@/features/communities/communityPolicy";
import { useCommunityState } from "@/features/communities/useCommunityState";
import { createCommunityController } from "@/features/communities/communityController";
import { CommunityGovernanceProvider } from "@/features/communities/CommunityGovernanceContext";
import { WorkspaceView } from "@/features/workspace/WorkspaceView";
import { savePostDraftToWorkspace } from "@/features/workspace/savePostDraftToWorkspace";
import type { WorkspaceDocument, WorkspacePublicationResponse } from "@/lib/workspaceTypes";
import { SearchModal } from "@/features/search/SearchModal";
import { MessagesQuickAccess, MessagesStage } from "@/features/messages/MessagesSection";
import { MessagesUnreadButton } from "@/features/messages/MessagesUnreadButton";
import { NotificationsControl } from "@/features/notifications/NotificationsPanel";
import { RoomView } from "@/features/rooms/RoomView";
import { opportunityApplicationsView, opportunityPostView, OpportunityApplicationsStage, useOpportunityApplicationComposer } from "@/features/opportunities/OpportunityExperience";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";
import { useCanonicalBrowserHistory } from "@/features/navigation/useCanonicalBrowserHistory";
import {
  useSymposiumSessionController,
  type SymposiumAuthState,
  type SymposiumSessionEnvironmentPort,
  type SymposiumSessionIdentityPort
} from "@/features/session/useSymposiumSessionController";
import { cachedBootstrapItemLimit } from "@/features/bootstrap/cachedBootstrap";
import {
  assistantBackdropRender,
  communityRenders,
  entranceRenders,
  getThemePreloadRenders,
  messageRenders,
  roomRenders,
  useSymposiumRenderPreload,
  type Theme
} from "@/features/rooms/roomRenderAssets";

const initialBoundedInquiryItems = [...inquiryItems]
  .sort((left, right) => itemTimestampScore(right) - itemTimestampScore(left))
  .slice(0, cachedBootstrapItemLimit);

const liveStatus = {
  loading: "Loading live data",
  connected: "Live data connected",
  reconnecting: "Live updates reconnecting",
  legacyConnected: "Live updates connected"
} as const;

const getRoom = (roomId: RoomId) => rooms.find((room) => room.id === roomId) ?? rooms[0];

const cloneCommentSegmentStacks = (stacks: CommentSegmentStacks): CommentSegmentStacks =>
  Object.fromEntries(Object.entries(stacks).map(([key, stack]) => [key, [...stack]]));

const parseCommentSegmentStack = (value: string | undefined) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
};

const findCommentById = (comments: InquiryComment[], id: string): InquiryComment | undefined => {
  return findCommentInTree(comments, id) ?? undefined;
};

const findCommentPathById = (comments: InquiryComment[], id: string): InquiryComment[] | null => {
  for (const comment of comments) {
    if (comment.id === id) return [comment];
    const childPath = findCommentPathById(comment.replies ?? [], id);
    if (childPath) return [comment, ...childPath];
  }
  return null;
};

const tabletItemLine = (item: InquiryItem) =>
  [
    `${item.kind}: ${postContextLabel(item)}`,
    `By ${item.author}${item.affiliation ? ` · ${item.affiliation}` : ""}`,
    item.excerpt || item.body
  ].filter(Boolean).join("\n");

const tabletDiscussionText = (
  comments: InquiryComment[],
  selectedCommentId: string | null,
  depth = 0,
  lines: string[] = []
) => {
  for (const comment of comments) {
    if (lines.length >= 40) break;
    if (!isDeletedComment(comment)) {
      const selected = comment.id && comment.id === selectedCommentId ? " [SELECTED]" : "";
      const attachments = (comment.attachments ?? []).map((attachment) => buildTabletAttachmentContext(attachment));
      lines.push([
        `[Comment ${comment.id} · revision ${comment.revision ?? 1}]`,
        `${"  ".repeat(Math.min(depth, 4))}${comment.author} · ${comment.stance}${selected}`,
        comment.body,
        attachments.length ? `Attachments:\n${attachments.join("\n\n")}` : ""
      ].filter(Boolean).join("\n"));
    }
    tabletDiscussionText(comment.replies ?? [], selectedCommentId, depth + 1, lines);
  }
  return lines;
};

const localPreviewAuth: SymposiumAuthState = {
  clerkEnabled: false,
  authLoaded: true,
  getAccessToken: async () => null,
  isSignedIn: false,
  userId: null,
  signOut: async () => undefined
};

export function SymposiumV0({
  clerkEnabled = false,
  initialIsSignedIn = null,
  initialRoute = { kind: "hall" },
  initialShouldPlayEntrance = null,
  liveBackendUrl = null
}: {
  clerkEnabled?: boolean;
  initialIsSignedIn?: boolean | null;
  initialRoute?: CanonicalRoute;
  initialShouldPlayEntrance?: boolean | null;
  liveBackendUrl?: string | null;
}) {
  if (clerkEnabled) {
    return (
      <ClerkSymposiumV0
        initialIsSignedIn={initialIsSignedIn}
        initialRoute={initialRoute}
        initialShouldPlayEntrance={initialShouldPlayEntrance}
        liveBackendUrl={liveBackendUrl}
      />
    );
  }
  return (
    <SymposiumExperience
      auth={localPreviewAuth}
      initialIsSignedIn={initialIsSignedIn}
      initialRoute={initialRoute}
      initialShouldPlayEntrance={initialShouldPlayEntrance}
      liveBackendUrl={liveBackendUrl}
    />
  );
}

function ClerkSymposiumV0({
  initialIsSignedIn,
  initialRoute,
  initialShouldPlayEntrance,
  liveBackendUrl
}: {
  initialIsSignedIn: boolean | null;
  initialRoute: CanonicalRoute;
  initialShouldPlayEntrance: boolean | null;
  liveBackendUrl: string | null;
}) {
  const { getToken, isLoaded: authLoaded, isSignedIn, signOut: clerkSignOut } = useAuth();
  const { user } = useUser();

  return (
    <SymposiumExperience
      initialIsSignedIn={initialIsSignedIn}
      initialRoute={initialRoute}
      initialShouldPlayEntrance={initialShouldPlayEntrance}
      liveBackendUrl={liveBackendUrl}
      auth={{
        clerkEnabled: true,
        authLoaded,
        getAccessToken: () => getToken(),
        isSignedIn: Boolean(isSignedIn),
        userId: user?.id ?? null,
        signOut: async () => {
          await clerkSignOut();
        }
      }}
    />
  );
}

function SymposiumExperience({
  auth,
  initialIsSignedIn,
  initialRoute,
  initialShouldPlayEntrance,
  liveBackendUrl
}: {
  auth: SymposiumAuthState;
  initialIsSignedIn: boolean | null;
  initialRoute: CanonicalRoute;
  initialShouldPlayEntrance: boolean | null;
  liveBackendUrl: string | null;
}) {
  const { authLoaded, clerkEnabled } = auth;
  symposiumApi.configure({
    accessTokenRequired: clerkEnabled && auth.isSignedIn,
    backendUrl: liveBackendUrl,
    getAccessToken: auth.getAccessToken,
    onRecoverableFailure:
      browserRecoveryCoordinator.reportTransportFailure,
    onTransportSuccess:
      browserRecoveryCoordinator.reportTransportSuccess
  });
  const [theme, setTheme] = useState<Theme>("day");
  const [syncStatus, setSyncStatus] = useState<string>(liveStatus.loading);
  const sessionIdentityRef =
    useRef<SymposiumSessionIdentityPort | null>(null);
  const sessionEnvironmentRef =
    useRef<SymposiumSessionEnvironmentPort | null>(null);
  const sessionController = useSymposiumSessionController({
    auth,
    environmentRef: sessionEnvironmentRef,
    identityRef: sessionIdentityRef,
    initialIsSignedIn,
    initialShouldPlayEntrance,
    onStatus: setSyncStatus
  });
  const {
    entryMode,
    readSessionReady
  } = sessionController;
  const {
    state: viewState,
    replaceSnapshot: replaceViewSnapshot,
    setField: setViewField,
    setWorkspaceView
  } = useSymposiumViewController(
    initialRoute,
    (postId) => inquiryItems.find((item) => item.id === postId)?.room
  );
  const {
    activeRoom,
    applicationReviewPostId,
    assistantBackdrop,
    assistantOpen,
    assistantThreadId,
    commentSegmentStacks,
    messagesOpen,
    officeMode,
    profileSocialView,
    profileTab: profileActiveTab,
    selectedApplicationId,
    selectedCommentId,
    selectedCommunityId,
    selectedConversationId,
    selectedItemId,
    selectedProfileName,
    workspaceView
  } = viewState;
  const retryMutationRegistryRef = useRef(createRetryMutationRegistry());
  const profileEnvironmentRef = useRef<ProfileEnvironmentPort | null>(null);
  const profileInquiryRef = useRef<ProfileInquiryPort | null>(null);
  const profileController = useProfileController({
    activeTab: profileActiveTab,
    cacheScopeKey: sessionController.bootstrapCacheScopeKey,
    environmentRef: profileEnvironmentRef,
    inquiryRef: profileInquiryRef,
    localPreview: !liveBackendUrl,
    onStatus: setSyncStatus,
    readsEnabled: sessionController.readsEnabled,
    retryMutation: {
      acquire: (scope, fingerprint) =>
        retryMutationRegistryRef.current.acquire(scope, fingerprint),
      clear: (fingerprintKey) =>
        retryMutationRegistryRef.current.clear(fingerprintKey)
    },
    selectedProfileName,
    socialHydrationEnabled: sessionController.socialHydrationEnabled
  });
  const {
    activity: profileActivity,
    currentProfile,
    currentProfileRef,
    followingHandles,
    profiles,
    profilesRef,
    selectedProfile,
    selectedProfileHandle,
    socialLists: profileSocialLists
  } = profileController;
  sessionIdentityRef.current = {
    clearAuthenticatedIdentity:
      profileController.clearAuthenticatedIdentity,
    enterLocalPreview: profileController.enterLocalPreview,
    hydrateCachedBootstrap: profileController.hydrateCachedBootstrap,
    hydrateCachedIdentity: profileController.hydrateCachedIdentity,
    refreshData: profileController.refreshData,
    syncAuthenticatedAccount:
      profileController.syncAuthenticatedAccount
  };
  const [feedScope, setFeedScope] = useState<FeedScope>("suggested");
  const [communitiesExpanded, setCommunitiesExpanded] = useState(false);
  const [communityQuery, setCommunityQuery] = useState("");
  const {
    communities,
    communitiesRef,
    setCommunities,
    communityCalls,
    setCommunityCalls,
    communityMembershipBusy,
    setCommunityMembershipBusy,
    selectedCommunity,
    selectedCommunityFeedView,
    setSelectedCommunityFeedView
  } = useCommunityState(currentProfile.handle, selectedCommunityId);
  profileEnvironmentRef.current = {
    applyBootstrap: ({ communities: incomingCommunities, communityCalls: incomingCalls }) => {
      if (incomingCommunities?.length) {
        communitiesRef.current = incomingCommunities;
        setCommunities(incomingCommunities);
      }
      if (incomingCalls) setCommunityCalls(incomingCalls);
    }
  };
  const surfaceController = useSymposiumSurfaceController(
    initialRoute.kind === "assistant"
  );
  const {
    assistantOriginContext,
    attachmentPreview,
    closeCommentEditor,
    closeComposer,
    closePostEditor,
    closeQuickMessages,
    closeQuote,
    closeSettings,
    closeTablet,
    collapseAssistant,
    composerCommunityId,
    composerOpen,
    editingComment,
    editingPost,
    expandAssistant,
    initialRouteApplied,
    messagesQuickOpen,
    navigationCommitted,
    navigationRestored,
    openCommentEditor,
    openComposer,
    openGlobalComposer,
    openPostEditor,
    openQuickMessages,
    openQuote,
    openSettings,
    openTablet,
    prepareSearch,
    quickConversationId,
    quoteSelection,
    selectQuickConversation,
    setAttachmentPreview,
    setComposerCommunityId,
    settingsOpen,
    tabletOpen
  } = surfaceController;
  const assistantCollapseThreadIdRef = useRef<string | null | undefined>(undefined);
  const [messageTabletContext, setMessageTabletContext] = useState<{
    conversationId: string;
    title: string;
    content: string;
    revision: number;
  } | null>(null);
  const [workspaceTabletDocument, setWorkspaceTabletDocument] = useState<WorkspaceDocument | null>(null);
  const [postAttachmentViewContext, setPostAttachmentViewContext] = useState<PdfAttachmentViewContext | null>(null);
  const [attachmentPreviewViewContext, setAttachmentPreviewViewContext] = useState<PdfAttachmentViewContext | null>(null);
  const selectedItemIdRef = useRef(selectedItemId);
  const selectedItemFallbackRef = useRef<InquiryItem | null>(null);
  const selectedCommentIdRef = useRef(selectedCommentId);
  const connectionSyncStatusRef = useRef<string>(liveStatus.loading);
  const commentSegmentStacksRef = useRef<CommentSegmentStacks>({});
  const visibleCommentSegmentStacksRef = useRef<CommentSegmentStacks>({});
  const inquiryController = useInquiryController({
    actorHandle: currentProfile.handle,
    cacheScopeKey: sessionController.bootstrapCacheScopeKey,
    communitiesRef,
    currentProfileRef,
    initialItems: initialBoundedInquiryItems,
    profilesRef,
    retryMutation: {
      acquire: (scope, fingerprint) =>
        retryMutationRegistryRef.current.acquire(scope, fingerprint),
      clear: (fingerprintKey) =>
        retryMutationRegistryRef.current.clear(fingerprintKey)
    },
    activity: {
      acceptCanonical: profileActivity.acceptCanonical,
      committed: profileActivity.committed,
      finishWithoutCanonical: (subjectType, subjectId, actorHandle, action) =>
        profileActivity.finishWithoutCanonical(
          subjectType,
          subjectId,
          actorHandle,
          action
        ),
      restore: profileActivity.restore,
      stage: profileActivity.stage,
      touchComment: profileActivity.touchComment,
      touchPost: profileActivity.touchPost
    },
    onProfilesDiscovered: profileController.mergeDiscoveredProfiles,
    onStaleLiveState: () => scheduleLiveRefresh(),
    onStatus: setSyncStatus,
    onTouchItem: profileActivity.touchItem,
    clearPostEditor: () => closePostEditor(),
    clearCommentEditor: (itemId, commentId) =>
      closeCommentEditor({ itemId, commentId })
  });
  const {
    feedPages,
    feedPagesRef,
    items,
    itemsRef
  } = inquiryController;
  profileInquiryRef.current = {
    beginRefresh: () => {
      const snapshot = inquiryController.captureRefresh();
      return (incomingItems, actorHandle) => {
        inquiryController.commitRefresh(incomingItems, actorHandle, snapshot);
      };
    },
    findItem: (itemId) =>
      itemsRef.current.find((candidate) => candidate.id === itemId),
    hydrateCachedSnapshot: inquiryController.hydrateCachedSnapshot,
    loadPostPage: inquiryController.loadPostPage,
    loadPostSubjects: inquiryController.loadPostSubjects,
    mergeBoundedRead: (data, options) =>
      inquiryController.mergeBoundedRead(data, options),
    persistSnapshot: inquiryController.persistSnapshot,
    projectProfile: inquiryController.projectProfile
  };
  const closeAttachmentPreview = useDedicatedAttachmentViewer(items, setAttachmentPreview);

  const activeRoomData = getRoom(activeRoom);
  const themedRoomRenders = roomRenders[theme];
  const themedCommunityRenders = communityRenders[theme];
  const activeRoomRender =
    activeRoom === "communities" && selectedCommunityId
        ? themedCommunityRenders.selected
        : themedRoomRenders[activeRoom];
  const activeAssistantBackdrop = assistantOpen
    ? assistantBackdrop ?? assistantBackdropForView({ activeRoom, messagesOpen, selectedCommunityId })
    : null;
  const activeShellRender = activeAssistantBackdrop
    ? assistantBackdropRender(theme, activeAssistantBackdrop)
    : messagesOpen
      ? messageRenders[theme]
      : activeRoomRender;
  const themePreloadRenders = useMemo(
    () => activeAssistantBackdrop
      ? [assistantBackdropRender(theme === "day" ? "night" : "day", activeAssistantBackdrop)]
      : messagesOpen
        ? [messageRenders[theme === "day" ? "night" : "day"]]
        : getThemePreloadRenders(theme, activeRoom),
    [activeAssistantBackdrop, activeRoom, messagesOpen, theme]
  );
  const selectedItemCandidate = items.find((item) => item.id === selectedItemId) ?? null;
  if (selectedItemCandidate) selectedItemFallbackRef.current = selectedItemCandidate;
  if (!selectedItemId) selectedItemFallbackRef.current = null;
  const selectedItem = selectedItemCandidate
    ?? (selectedItemFallbackRef.current?.id === selectedItemId ? selectedItemFallbackRef.current : null);
  const applicationReviewItem = items.find((item) => item.id === applicationReviewPostId && item.opportunity) ?? null;
  const { beginApplication: beginOpportunityApplication, applicationComposer: opportunityApplicationComposer } = useOpportunityApplicationComposer(currentProfile.handle, () => setSyncStatus("Application submitted"));
  const attachmentPreviewBaseItem = attachmentPreview
    ? items.find((item) => item.id === attachmentPreview.itemId) ?? null
    : null;
  const attachmentPreviewComment = attachmentPreviewBaseItem && attachmentPreview?.commentId
    ? findCommentById(attachmentPreviewBaseItem.comments, attachmentPreview.commentId)
    : null;
  const attachmentPreviewAttachment = attachmentPreviewBaseItem && attachmentPreview
    ? (attachmentPreviewComment?.attachments ?? attachmentPreviewBaseItem.attachments ?? []).find((entry) => entry.id === attachmentPreview.attachmentId) ?? null
    : null;

  const activeItems = useMemo(() => items.filter((item) => !isDeletedPost(item)), [items]);
  const discoveryController = useDiscoveryController({
    actorHandle: currentProfile.handle,
    activeRoom,
    communityId: selectedCommunityId,
    communityQuery: selectedCommunityFeedView.query,
    items: activeItems,
    mergeBoundedRead: inquiryController.mergeBoundedRead,
    profiles
  });
  const {
    communityResultIds: communitySearchResultIds,
    communitySearchLoading,
    loading: searchLoading,
    open: searchOpen,
    query: searchQuery,
    results: searchResults,
    setOpen: setSearchOpen,
    setQuery: setSearchQuery
  } = discoveryController;
  const editingPostItem = editingPost ? items.find((item) => item.id === editingPost.id) ?? editingPost : null;
  const editingCommentItem = editingComment ? items.find((item) => item.id === editingComment.itemId) ?? null : null;
  const editingCommentValue =
    editingComment && editingCommentItem
      ? findCommentById(editingCommentItem.comments, editingComment.commentId) ?? null
      : null;
  const quotePreview = quoteSelection
    ? (() => {
        try {
          return resolveLocalContentQuote(items, quoteSelection);
        } catch {
          return undefined;
        }
      })()
    : undefined;
  const resolveComposerQuoteLink: QuoteLinkResolver = (link, owner) =>
    resolveQuoteLink(itemsRef.current, link, owner);
  const selectedProfileActivityScope = profileActivity.selectedScope;
  const selectedProfileActivitySnapshot = profileActivity.selectedSnapshot;
  const selectedProfileActivityPage = profileActivity.selectedPage;
  const findProfile = profileController.findProfile;

  useSymposiumRenderPreload(themePreloadRenders, activeShellRender);

  useEffect(() => {
    if (isPersistentSyncStatus(syncStatus)) {
      connectionSyncStatusRef.current = syncStatus;
      return undefined;
    }
    const expiry = syncStatusExpiryMs(syncStatus);
    if (expiry === null) return undefined;
    const timer = window.setTimeout(() => {
      setSyncStatus((current) =>
        current === syncStatus ? connectionSyncStatusRef.current : current
      );
    }, expiry);
    return () => window.clearTimeout(timer);
  }, [syncStatus]);

  const dismissTransientSyncStatus = () => {
    setSyncStatus((current) =>
      syncStatusAfterNavigation(current, connectionSyncStatusRef.current)
    );
  };

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId;
  }, [selectedItemId]);

  useEffect(() => {
    selectedCommentIdRef.current = selectedCommentId;
  }, [selectedCommentId]);

  useEffect(() => {
    commentSegmentStacksRef.current = commentSegmentStacks;
  }, [commentSegmentStacks]);

  const getPublishedRecency = (item: InquiryItem) => itemTimestampScore(item);
  const sortByPublishedRecency = (nextItems: InquiryItem[]) =>
    [...nextItems].sort((a, b) => getPublishedRecency(b) - getPublishedRecency(a));

  const visibleItems = useMemo(() => {
    return sortByPublishedRecency(selectVisibleFeedItems({
      items: activeItems,
      activeRoom,
      officeMode,
      feedScope,
      currentProfile,
      fallbackProfile: profile,
      followingHandles
    }));
  }, [activeItems, activeRoom, currentProfile, feedScope, followingHandles, officeMode]);

  const activeFeedRequest = useMemo<{
    key: string;
    query: PostPageQueryContract;
  } | null>(() => {
    const following = feedScope === "following" ? true : undefined;
    if (activeRoom === "communities" && selectedCommunityId) {
      return {
        key: `community:${selectedCommunityId}`,
        query: { communityId: selectedCommunityId, limit: 24 }
      };
    }
    if (activeRoom === "office" && officeMode === "saved") {
      return { key: "office:saved", query: { saved: true, limit: 24 } };
    }
    if (activeRoom === "hall" || activeRoom === "office" || activeRoom === "communities") return null;
    if (activeRoom === "symposium") {
      return {
        key: `symposium:${feedScope}`,
        query: { postTypes: ["paper", "thought"], following, limit: 24 }
      };
    }
    const postType = activeRoom === "library"
      ? "paper" as const
      : activeRoom === "amphitheater"
        ? "thought" as const
        : activeRoom === "funding"
          ? "proposal" as const
          : "opportunity" as const;
    return {
      key: `${activeRoom}:${feedScope}`,
      query: { postType, following, limit: 24 }
    };
  }, [activeRoom, feedScope, officeMode, selectedCommunityId]);

  const markLiveDataConnected = () => {
    connectionSyncStatusRef.current = liveStatus.connected;
    setSyncStatus((status) =>
      status === liveStatus.loading ||
      status === liveStatus.reconnecting ||
      status === liveStatus.legacyConnected
        ? liveStatus.connected
        : status
    );
  };

  const markLiveUpdatesReconnecting = () => {
    connectionSyncStatusRef.current = liveStatus.reconnecting;
    setSyncStatus((status) =>
      status === liveStatus.loading ||
      status === liveStatus.connected ||
      status === liveStatus.reconnecting ||
      status === liveStatus.legacyConnected
        ? liveStatus.reconnecting
        : status
    );
  };

  const mergeLiveItem = inquiryController.mergeLiveItem;

  const loadPostPage = inquiryController.loadPostPage;
  const mergeLiveMetricPatch = inquiryController.mergeLiveMetricPatch;
  const scheduleLiveRefresh = profileController.scheduleLiveRefresh;
  const scheduleProfileActivityRefresh =
    profileController.scheduleActivityRefresh;

  const invalidateLiveQuotedSource = inquiryController.invalidateLiveQuotedSource;

  const {
    assistantEvents,
    messagingEvents,
    notificationEvents
  } = useSymposiumLiveController({
    authSessionKey: sessionController.authSessionKey,
    backendUrl: liveBackendUrl,
    enabled: sessionController.liveEventsEnabled,
    getAccessToken: auth.getAccessToken,
    onConnected: markLiveDataConnected,
    onReconnecting: markLiveUpdatesReconnecting,
    routing: {
      acceptCanonicalActivity: profileActivity.acceptCanonical,
      acceptLiveActionProjection: inquiryController.acceptLiveActionProjection,
      closeCommentEditor: (commentId) => {
        closeCommentEditor({ commentId });
      },
      closeCommentEditorsForPost: (itemId) => {
        closeCommentEditor({ itemId });
      },
      closePostEditor: (itemId) => {
        closePostEditor(itemId);
      },
      currentActorHandle: () => currentProfileRef.current.handle,
      invalidateQuotedSource: invalidateLiveQuotedSource,
      mergeLiveFollow: profileController.mergeLiveFollow,
      mergeLiveItem,
      mergeLiveMetricPatch,
      mergeLiveProfile: profileController.mergeLiveProfile,
      refreshActivity: scheduleProfileActivityRefresh,
      refreshAll: scheduleLiveRefresh,
      touchCommentActivity: (
        itemId,
        commentId,
        action,
        actorHandle,
        timestamp
      ) => {
        profileActivity.touchComment(
          itemId,
          commentId,
          action,
          actorHandle,
          timestamp
        );
      },
      touchPostActivity: profileActivity.touchPost
    }
  });

  const applyInitialRouteState = () => {
    dismissTransientSyncStatus();
    const snapshot = snapshotForCanonicalRoute(
      initialRoute,
      (postId) => itemsRef.current.find((item) => item.id === postId)?.room
    );
    replaceViewSnapshot(snapshot);
    initialRouteApplied();
    commentSegmentStacksRef.current = {};
    visibleCommentSegmentStacksRef.current = {};
    resetHistory();
  };

  sessionEnvironmentRef.current = {
    applyInitialRouteState,
    hydrateBrowserAppearance: () => {
      const storedTheme = window.localStorage.getItem(
        "symposium-theme"
      ) as Theme | null;
      if (storedTheme === "day" || storedTheme === "night") {
        setTheme(storedTheme);
      } else if (
        window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ) {
        setTheme("night");
      }
    },
    hydrateLocalRecency: profileActivity.hydrateLocalRecency
  };

  useEffect(() => {
    window.localStorage.setItem("symposium-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (entryMode !== "complete" || !readSessionReady || !activeFeedRequest) return;
    if (selectedItemId || applicationReviewPostId || selectedProfileName || messagesOpen) return;
    if (feedPagesRef.current[activeFeedRequest.key]?.initialized) return;
    void loadPostPage(activeFeedRequest.key, activeFeedRequest.query).catch(() => {
      setSyncStatus("Feed could not refresh");
    });
  }, [
    activeFeedRequest,
    applicationReviewPostId,
    entryMode,
    feedPages,
    messagesOpen,
    selectedItemId,
    selectedProfileName,
    readSessionReady
  ]);

  useEffect(() => {
    const postId = selectedItemId ?? applicationReviewPostId;
    if (!postId || !readSessionReady) return;
    const current = itemsRef.current.find((item) => item.id === postId);
    if (current?.detailLoaded) return;
    let cancelled = false;
    void inquiryController.loadPostDetail(
      postId,
      currentProfile.handle,
      () => !cancelled
    ).catch(() => {
      if (!cancelled) setSyncStatus("Post detail could not load");
    });
    return () => {
      cancelled = true;
    };
  }, [applicationReviewPostId, currentProfile.handle, readSessionReady, selectedItem?.detailLoaded, selectedItemId]);

  useEffect(() => {
    if (!readSessionReady || !selectedProfileHandle || selectedProfileHandle === "@") return;
    if (!profileTabUsesAuthoredPosts(profileActiveTab)) return;
    const key = `profile:${selectedProfileHandle}:authored`;
    if (feedPagesRef.current[key]?.initialized) return;
    void loadPostPage(key, { authorHandle: selectedProfileHandle, limit: 24 }).catch(() => undefined);
  }, [profileActiveTab, readSessionReady, selectedProfileHandle]);

  const updateCommentSegmentStack = (key: string, stack: string[]) => {
    setViewField("commentSegmentStacks", (current) => {
      const currentStack = current[key] ?? [];
      if (currentStack.join("|") === stack.join("|")) return current;

      const next = { ...current };
      if (stack.length) {
        next[key] = [...stack];
      } else {
        delete next[key];
      }
      commentSegmentStacksRef.current = next;
      return next;
    });
  };

  const registerVisibleCommentSegmentStack = (key: string, stack: string[]) => {
    const next = { ...visibleCommentSegmentStacksRef.current };
    next[key] = [...stack];
    visibleCommentSegmentStacksRef.current = next;
  };

  const visibleCommentSegmentStacksFromDom = () => {
    const stacks: CommentSegmentStacks = {};
    document.querySelectorAll<HTMLElement>(".comment-segment[data-comment-segment-key]").forEach((segment) => {
      const key = segment.dataset.commentSegmentKey;
      if (!key) return;
      stacks[key] = parseCommentSegmentStack(segment.dataset.commentSegmentStack);
    });
    return stacks;
  };

  const currentScrollAnchor = () => {
    const targetTop = 132;
    const comments = Array.from(document.querySelectorAll<HTMLElement>(".comment[id]"));
    const visibleComments = comments
      .map((comment) => ({ comment, rect: comment.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight);
    const anchor =
      visibleComments.find(({ rect }) => rect.top <= targetTop && rect.bottom >= targetTop) ??
      visibleComments.sort(
        (first, second) => Math.abs(first.rect.top - targetTop) - Math.abs(second.rect.top - targetTop)
      )[0];
    if (!anchor) return null;
    const segment = anchor.comment.closest<HTMLElement>(".comment-segment[data-comment-segment-key]");
    return {
      id: anchor.comment.id,
      top: anchor.rect.top,
      commentSegmentKey: segment?.dataset.commentSegmentKey,
      commentSegmentStack: parseCommentSegmentStack(segment?.dataset.commentSegmentStack)
    };
  };

  const snapshotView = (): ViewSnapshot => {
    const scrollAnchor = currentScrollAnchor();
    const domSegmentStacks = visibleCommentSegmentStacksFromDom();
    if (scrollAnchor?.commentSegmentKey) {
      domSegmentStacks[scrollAnchor.commentSegmentKey] = [...(scrollAnchor.commentSegmentStack ?? [])];
    }

    return {
      ...viewState,
      profileTab: selectedProfileName ? profileActiveTab : "all",
      commentSegmentStacks: cloneCommentSegmentStacks({
        ...commentSegmentStacksRef.current,
        ...visibleCommentSegmentStacksRef.current,
        ...domSegmentStacks
      }),
      scrollAnchor,
      scrollY: window.scrollY,
    };
  };

  const restoreScrollPosition = (snapshot: ViewSnapshot) => {
    const scroll = () => {
      if (snapshot.scrollAnchor) {
        const anchor = document.getElementById(snapshot.scrollAnchor.id);
        if (anchor) {
          const top = anchor.getBoundingClientRect().top;
          window.scrollBy({ top: top - snapshot.scrollAnchor.top, behavior: "auto" });
          return;
        }
      }
      window.scrollTo({ top: snapshot.scrollY, behavior: "auto" });
    };
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(scroll);
      });
    }, 0);
    window.setTimeout(scroll, 120);
    window.setTimeout(scroll, 320);
  };

  const restoreView = (snapshot: ViewSnapshot) => {
    const collapsedAssistantThreadId = assistantCollapseThreadIdRef.current;
    const isAssistantCollapse = collapsedAssistantThreadId !== undefined;
    assistantCollapseThreadIdRef.current = undefined;
    dismissTransientSyncStatus();
    if (snapshot.selectedProfileName) profileActivity.flushPendingRecency();
    const restoredSegmentStacks = cloneCommentSegmentStacks(snapshot.commentSegmentStacks ?? {});
    commentSegmentStacksRef.current = restoredSegmentStacks;
    visibleCommentSegmentStacksRef.current = {};
    const defaultWorkspaceView = snapshotForCanonicalRoute({ kind: "hall" }).workspaceView;
    replaceViewSnapshot({
      ...snapshot,
      applicationReviewPostId: snapshot.applicationReviewPostId ?? null,
      selectedApplicationId: snapshot.selectedApplicationId ?? null,
      detailOrigin: snapshot.detailOrigin ?? null,
      profileSocialView: snapshot.profileSocialView ?? null,
      workspaceView: snapshot.workspaceView ?? defaultWorkspaceView,
      commentSegmentStacks: restoredSegmentStacks,
      selectedConversationId: snapshot.selectedConversationId ?? null,
      assistantOpen: isAssistantCollapse ? false : snapshot.assistantOpen ?? false,
      assistantThreadId: isAssistantCollapse
        ? collapsedAssistantThreadId
        : snapshot.assistantThreadId ?? null,
      assistantBackdrop: snapshot.assistantBackdrop ?? null
    });
    navigationRestored();
    setSearchOpen(false);
    restoreScrollPosition(snapshot);
  };

  const {
    canGoBack: hasViewHistory,
    canGoForward: hasViewFuture,
    goBack,
    goForward,
    recordNavigation,
    replaceCanonicalRoute,
    resetHistory
  } = useCanonicalBrowserHistory({
    snapshotView,
    restoreView,
    routeForView: (snapshot) =>
      routeForViewSnapshot(
        snapshot,
        (nameOrHandle) => findProfile(nameOrHandle)?.handle ?? nameOrHandle
      )
  });

  const collapseAssistantToTablet = (threadId: string | null) => {
    assistantCollapseThreadIdRef.current = threadId;
    collapseAssistant();
    goBack();
  };

  const navigateView = (
    next: Partial<Omit<ViewSnapshot, "scrollY">>,
    scrollY: number | null = 0
  ) => {
    dismissTransientSyncStatus();
    if (next.selectedProfileName) profileActivity.flushPendingRecency();
    const currentSnapshot = snapshotView();
    let nextSnapshot = nextViewSnapshot(currentSnapshot, next, scrollY);
    if (next.selectedItemId !== undefined && next.selectedItemId !== selectedItemId) {
      nextSnapshot = { ...nextSnapshot, commentSegmentStacks: {} };
      commentSegmentStacksRef.current = {};
      visibleCommentSegmentStacksRef.current = {};
    }
    recordNavigation(currentSnapshot, nextSnapshot);
    replaceViewSnapshot(nextSnapshot);
    navigationCommitted(nextSnapshot.assistantOpen);
    setSearchOpen(false);
    if (scrollY !== null) {
      window.setTimeout(() => window.scrollTo({ top: scrollY, behavior: "auto" }), 0);
    }
  };

  const enterRoom = (roomId: RoomId, mode: OfficeMode = roomId === "office" ? "desk" : officeMode) => {
    navigateView({
      activeRoom: roomId,
      selectedItemId: null,
      applicationReviewPostId: null,
      selectedApplicationId: null,
      selectedCommentId: null,
      selectedProfileName: null,
      profileSocialView: null,
      officeMode: roomId === "office" ? mode : "desk",
      selectedCommunityId: null,
      detailOrigin: null
    });
  };

  const toggleOfficeMode = (mode: Exclude<OfficeMode, "desk">) => {
    enterRoom("office", activeRoom === "office" && officeMode === mode ? "desk" : mode);
  };

  const openCommunity = (communityId: string) => {
    navigateView({
      activeRoom: "communities",
      selectedItemId: null,
      selectedCommentId: null,
      selectedProfileName: null,
      profileSocialView: null,
      officeMode: "desk",
      selectedCommunityId: communityId,
      detailOrigin: null
    });
  };

  const closeCommunity = () => {
    navigateView({
      activeRoom: "communities",
      selectedItemId: null,
      selectedCommentId: null,
      selectedProfileName: null,
      profileSocialView: null,
      officeMode: "desk",
      selectedCommunityId: null,
      detailOrigin: null
    });
  };

  const openProfile = (profileKey: string) => {
    profileActivity.flushPendingRecency();
    navigateView({ selectedProfileName: profileKey, profileSocialView: null, profileTab: "all", selectedItemId: null, selectedCommentId: null });
  };

  const changeProfileSocialView = (view: ProfileSocialView | null) => {
    if (!selectedProfileName) return;
    navigateView({ profileSocialView: view }, null);
  };

  const changeProfileTab = (tab: ProfileTab) => {
    if (profileActiveTab === tab && !profileSocialView) return;
    profileActivity.flushPendingRecency();
    navigateView({ profileSocialView: null, profileTab: tab }, null);
  };
  const toggleTablet = () => {
    if (assistantOpen) {
      collapseAssistantToTablet(assistantThreadId);
      return;
    }
    if (tabletOpen) {
      expandAssistant(tabletContext);
      navigateView({
        assistantOpen: true,
        assistantThreadId
      }, null);
      return;
    }
    openTablet();
    setSearchOpen(false);
  };

  const openSearch = () => {
    prepareSearch();
    setSearchOpen(true);
  };

  const openAttachmentPreview: AttachmentPreviewHandler = (item, attachmentId) => {
    setAttachmentPreviewViewContext(null);
    setAttachmentPreview({ itemId: item.id, attachmentId });
  };

  const openCommentAttachmentPreview = (itemId: string, commentId: string, attachmentId: string) => {
    setAttachmentPreviewViewContext(null);
    setAttachmentPreview({ itemId, commentId, attachmentId });
  };

  const uploadPostAttachment = async (file: File): Promise<InquiryAttachment> => {
    const contentType = file.type || "application/octet-stream";
    const metadata = await buildPostAttachmentMetadata(file, contentType);
    return uploadConfirmedPostAttachment({
      actorHandle: currentProfile.handle,
      file,
      idempotencyKey: createClientMutationId("attachment-prepare"),
      metadata
    });
  };

  const uploadCommentAttachment = async (file: File): Promise<InquiryAttachment> => {
    const contentType = file.type || "application/octet-stream";
    const metadata = await buildPostAttachmentMetadata(file, contentType);
    return uploadConfirmedAttachment({
      actorHandle: currentProfile.handle,
      file,
      idempotencyKey: createClientMutationId("comment-attachment-prepare"),
      metadata,
      ownerType: "comment"
    });
  };

  const retryMutationKey = (scope: string, fingerprint: string) => {
    return retryMutationRegistryRef.current.acquire(scope, fingerprint);
  };

  const clearRetryMutationKey = (fingerprintKey: string) => {
    retryMutationRegistryRef.current.clear(fingerprintKey);
  };

  const communityController = createCommunityController({
    currentProfileHandle: currentProfile.handle,
    communitiesRef,
    setCommunities,
    setCommunityCalls,
    setMembershipBusy: setCommunityMembershipBusy,
    membershipBusy: communityMembershipBusy,
    selectedCommunity,
    retryMutationKey,
    clearRetryMutationKey,
    persist: inquiryController.persistSnapshot,
    openCommunity,
    refresh: scheduleLiveRefresh,
    setStatus: setSyncStatus
  });

  const savePostDraft = (draft: PostDraft) => savePostDraftToWorkspace({
    actorHandle: currentProfile.handle,
    draft,
    acquireMutation: (fingerprint) => retryMutationKey("workspace-document-create", fingerprint),
    clearMutation: clearRetryMutationKey,
    onStatus: setSyncStatus
  });

  const createPost = async (draft: PostDraft) => {
    const result = await inquiryController.createPost(draft, composerCommunityId);
    if (!result.ok) return result;
    const committedItem = result.item;
    navigateView({
      activeRoom: committedItem.communityId ? "communities" : committedItem.room,
      selectedItemId: committedItem.id,
      selectedCommentId: null,
      selectedProfileName: null,
      officeMode: "desk",
      selectedCommunityId: committedItem.communityId ?? null
    });
    closeComposer();
    return { ok: true as const };
  };

  const addComment = async (
    itemId: string,
    body: string,
    document: VersionedDocumentContract,
    stance: string,
    parentId: string | null,
    attachments: InquiryAttachment[],
    quoteSource?: ContentQuoteSource
  ) => {
    const previousSelectedItemId = selectedItemId;
    const previousSelectedCommentId = selectedCommentId;
    return inquiryController.addComment({
      itemId,
      body,
      document,
      stance,
      parentId: parentId ?? null,
      attachments,
      quoteSource,
      onOptimistic: (commentId) => {
        setViewField("selectedItemId", itemId);
        setViewField("selectedCommentId", commentId);
      },
      onRollback: () => {
        setViewField("selectedItemId", previousSelectedItemId);
        setViewField("selectedCommentId", previousSelectedCommentId);
      },
      onCommitted: (committedCommentId) => {
        setViewField("selectedCommentId", committedCommentId);
        if (committedCommentId) {
          replaceCanonicalRoute({
            kind: "post",
            postId: itemId,
            commentId: committedCommentId
          });
        }
      }
    });
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
      reader.addEventListener("error", () => reject(new Error("Could not read this image.")));
      reader.readAsDataURL(file);
    });

  const uploadProfileAvatar = async (file: File) => {
    const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);
    const contentType = inferAttachmentContentType(file.name, file.type);

    if (!allowedImageTypes.has(contentType)) {
      throw new Error("Choose a PNG, JPG, JPEG, WEBP, GIF, or AVIF image.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Profile photos must be 5 MB or smaller.");
    }

    setSyncStatus("Preparing profile photo");
    const uploadResponse = await prepareAttachmentUpload({
        actorHandle: currentProfile.handle,
        fileName: file.name,
        contentType,
        byteSize: file.size,
        ownerType: "profile",
        ownerId: currentProfile.handle
    }, createClientMutationId("attachment-prepare"));

    if (!uploadResponse.ok) {
      const error = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
      if (uploadResponse.status === 412 && error?.error?.includes("local preview")) {
        setSyncStatus("Profile photo previewed locally");
        return readFileAsDataUrl(file);
      }
      throw new Error(error?.error ?? "Could not prepare this profile photo.");
    }

    const upload = (await uploadResponse.json()) as AttachmentUploadResponse;

    if (!upload.uploadUrl || !upload.attachmentId) {
      throw new Error("Could not prepare this profile photo upload.");
    }

    if (!upload.publicUrl) {
      throw new Error("Profile photo storage needs a public R2 URL before photos can persist.");
    }

    setSyncStatus("Uploading profile photo");
    await uploadPreparedAttachmentContent({
      actorHandle: currentProfile.handle,
      contentType,
      file,
      upload
    });

    const confirmResponse = await confirmAttachmentUpload({
        actorHandle: currentProfile.handle,
        attachmentId: upload.attachmentId,
        byteSize: file.size
    });

    if (!confirmResponse.ok) {
      const error = (await confirmResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error ?? "Could not confirm the profile photo upload.");
    }

    const confirmed = (await confirmResponse.json()) as AttachmentConfirmResponse;
    const publicUrl = confirmed.publicUrl ?? upload.publicUrl;
    if (!publicUrl) throw new Error("The confirmed profile photo does not have a persistent URL.");

    setSyncStatus("Profile photo ready");
    return publicUrl;
  };

  const saveProfileSettings = async (draft: ProfileSettingsDraft) => {
    if (
      selectedProfileName === currentProfile.name ||
      selectedProfileName === currentProfile.handle
    ) {
      setViewField("selectedProfileName", currentProfile.handle);
    }
    const committedProfile = await profileController.saveSettings(draft);
    if (committedProfile) {
      closeSettings();
    }
  };

  const toggleFollow = profileController.toggleFollow;

  const signOut = async () => {
    closeSettings();
    await sessionController.signOut();
  };

  const applyAction = inquiryController.applyAction;

  const applyCommentAction = inquiryController.applyCommentAction;

  const savePostEdit = async (
    itemId: string,
    draft: {
      title: string;
      body: string;
      document: VersionedDocumentContract;
      attachments: InquiryAttachment[];
      quote: InquiryItem["quote"] | null;
      patronage?: PatronageProposalInputContract;
      opportunity?: OpportunityPostInputContract;
    }
  ) => {
    if (await inquiryController.savePostEdit(itemId, draft)) {
      closePostEditor();
    }
  };

  const { deletePost, deleteComment } = inquiryController;

  const saveCommentEdit = async (
    itemId: string,
    commentId: string,
    body: string,
    document: VersionedDocumentContract,
    attachments: InquiryAttachment[],
    quote: InquiryComment["quote"] | null
  ) => {
    if (await inquiryController.saveCommentEdit({
      itemId,
      commentId,
      body,
      document,
      attachments,
      quote
    })) {
      closeCommentEditor();
    }
  };

  const openPost = (id: string, commentId?: string | null, sourceSurface?: ViewSurface) => {
    const currentSnapshot = snapshotView();
    const journeyOrigin = currentSnapshot.detailOrigin ?? detailOriginFromSnapshot(currentSnapshot);
    navigateView(
      {
        selectedItemId: id,
        selectedCommentId: commentId ?? null,
        selectedProfileName: null,
        profileSocialView: null,
        detailOrigin: journeyOrigin
      },
      commentId ? null : 0
    );
    const targetItem = itemsRef.current.find((item) => item.id === id);
    if (targetItem && !isDeletedPost(targetItem)) {
      void applyAction(id, "read", {
        trigger: "click",
        surface: sourceSurface ?? (selectedProfileName ? "profile" : "feed")
      });
    }
  };

  const returnToDetailOrigin = () => {
    const currentSnapshot = snapshotView();
    const origin = currentSnapshot.detailOrigin;
    if (!origin) {
      goBack();
      return;
    }
    const target: ViewSnapshot = { ...origin, detailOrigin: null };
    recordNavigation(currentSnapshot, target);
    restoreView(target);
  };

  const acceptWorkspacePublication = (result: WorkspacePublicationResponse) => {
    mergeLiveItem(result.item);
    setSyncStatus("Published and moved out of the workspace");
    openPost(result.item.id, result.comment?.id ?? null, result.comment ? "thread" : "detail");
  };

  const beginQuote = (selection: QuoteSelection) => {
    setSearchOpen(false);
    setViewField("messagesOpen", false);
    openQuote(selection);
  };

  const openQuotedSource = (selection: QuoteSelection) => {
    closeQuote();
    openPost(
      selection.sourcePostId,
      selection.sourceType === "comment" ? selection.sourceId : null,
      "thread"
    );
  };

  const tabletContext = ((): NonNullable<AssistantMessageInputContract["context"]> => {
    const trimContent = (value: string) => {
      const limit = 12000;
      if (value.length <= limit) return value;
      const notice = "\n\n[Current-view context truncated at 12,000 characters.]";
      return `${value.slice(0, limit - notice.length)}${notice}`;
    };
    if (attachmentPreviewAttachment && attachmentPreviewBaseItem) {
      const activePdfView = attachmentPreviewViewContext?.attachmentId === attachmentPreviewAttachment.id
        ? attachmentPreviewViewContext
        : null;
      return {
        surface: "attachment",
        route: `/posts/${attachmentPreviewBaseItem.id}`,
        title: attachmentPreviewAttachment.fileName,
        summary: activePdfView
          ? `PDF page ${activePdfView.page} of ${activePdfView.pageCount} open inside “${postContextLabel(attachmentPreviewBaseItem)}”.`
          : `Attachment open inside “${postContextLabel(attachmentPreviewBaseItem)}”.`,
        content: trimContent([
          buildTabletAttachmentContext(attachmentPreviewAttachment, activePdfView),
          `Parent post context:\n${attachmentPreviewBaseItem.body}`
        ].join("\n\n")),
        entityType: "attachment",
        entityId: attachmentPreviewAttachment.id,
        selection: activePdfView?.selectedText,
        metadata: {
          postId: attachmentPreviewBaseItem.id,
          ...(activePdfView ? { pdfPage: activePdfView.page, pdfPageCount: activePdfView.pageCount } : {})
        }
      };
    }
    if (searchOpen) {
      return {
        surface: "search",
        route: "/search",
        title: searchQuery.trim() ? `Search: ${searchQuery.trim()}` : "Search",
        summary: "The global Symposium search overlay is open.",
        content: trimContent([
          searchQuery.trim() ? `Current search query: ${searchQuery.trim()}` : "No search query has been entered yet.",
          searchResults.titleMatches.length || searchResults.contentMatches.length
            ? [
                "Visible post results:",
                ...[...searchResults.titleMatches, ...searchResults.contentMatches]
                  .slice(0, 16)
                  .map(tabletItemLine)
              ].join("\n\n")
            : "No post results are currently visible.",
          searchResults.profileMatches.length
            ? [
                "Visible researcher results:",
                ...searchResults.profileMatches.slice(0, 8).map((person) =>
                  `${person.name} (${person.handle}) · ${person.role}\n${person.bio}`
                )
              ].join("\n\n")
            : "No researcher results are currently visible."
        ].join("\n\n")),
        metadata: {
          query: searchQuery.trim(),
          postResultCount: searchResults.titleMatches.length + searchResults.contentMatches.length,
          profileResultCount: searchResults.profileMatches.length,
          loading: searchLoading
        }
      };
    }
    if (messagesOpen) {
      return {
        surface: "messages",
        route: selectedConversationId ? `/messages/${selectedConversationId}` : "/messages",
        title: messageTabletContext?.title ?? "Messages",
        summary: messageTabletContext ? "The currently selected private conversation." : "The Messages conversation list.",
        content: trimContent(messageTabletContext?.content ?? "No conversation is selected."),
        entityType: messageTabletContext ? "conversation" : undefined,
        entityId: messageTabletContext?.conversationId,
        metadata: {
          privateConversation: Boolean(messageTabletContext),
          ...(messageTabletContext ? { revision: messageTabletContext.revision } : {})
        }
      };
    }
    if (applicationReviewItem) {
      return {
        surface: "opportunity",
        route: `/opportunities/${applicationReviewItem.id}/applications`,
        title: `${applicationReviewItem.title} · applications`,
        summary: applicationReviewItem.gatheringReason,
        content: trimContent(applicationReviewItem.body),
        entityType: "opportunity",
        entityId: applicationReviewItem.id,
        metadata: { selectedApplicationId: selectedApplicationId ?? "" }
      };
    }
    if (selectedProfile) {
      return {
        surface: "profile",
        route: `/profiles/${selectedProfile.handle}`,
        title: `${selectedProfile.name} (${selectedProfile.handle})`,
        summary: `${selectedProfile.role} · ${selectedProfile.location}`,
        content: trimContent([selectedProfile.bio, `Fields: ${selectedProfile.fields.join(", ")}`, `Open profile tab: ${profileActiveTab}`].join("\n\n")),
        entityType: "profile",
        entityId: selectedProfile.handle,
        metadata: { tab: profileActiveTab }
      };
    }
    if (selectedItem) {
      const discussion = tabletDiscussionText(selectedItem.comments, selectedCommentId);
      const activeAttachment = postAttachmentViewContext
        ? selectedItem.attachments?.find((attachment) => attachment.id === postAttachmentViewContext.attachmentId) ?? null
        : null;
      const activePdfView = activeAttachment ? postAttachmentViewContext : null;
      return {
        surface: activeAttachment ? "attachment" : "post",
        route: activeAttachment
          ? `/posts/${selectedItem.id}?attachment=${encodeURIComponent(activeAttachment.id)}`
          : `/posts/${selectedItem.id}`,
        title: activeAttachment?.fileName ?? postContextLabel(selectedItem),
        summary: activeAttachment && activePdfView
          ? `PDF page ${activePdfView.page} of ${activePdfView.pageCount} open inside “${postContextLabel(selectedItem)}”.`
          : selectedItem.gatheringReason,
        content: trimContent([
          activeAttachment && activePdfView
            ? `Currently visible attachment:\n\n${buildTabletAttachmentContext(activeAttachment, activePdfView)}`
            : "",
          selectedItem.body,
          selectedItem.claims.length ? `Claims:\n- ${selectedItem.claims.join("\n- ")}` : "",
          selectedItem.evidence.length ? `Evidence:\n- ${selectedItem.evidence.join("\n- ")}` : "",
          selectedItem.objections.length ? `Objections:\n- ${selectedItem.objections.join("\n- ")}` : "",
          selectedItem.tests.length ? `Tests:\n- ${selectedItem.tests.join("\n- ")}` : "",
          discussion.length ? `Visible discussion:\n\n${discussion.join("\n\n")}` : "No discussion is currently visible.",
          selectedItem.attachments?.length
            ? `Post attachments:\n\n${selectedItem.attachments
                .filter((attachment) => attachment.id !== activeAttachment?.id)
                .map((attachment) => buildTabletAttachmentContext(attachment))
                .join("\n\n")}`
            : ""
        ].filter(Boolean).join("\n\n")),
        entityType: activeAttachment ? "attachment" : "post",
        entityId: activeAttachment?.id ?? selectedItem.id,
        selection: activePdfView?.selectedText,
        metadata: {
          kind: selectedItem.kind,
          status: selectedItem.status,
          postId: selectedItem.id,
          selectedCommentId: selectedCommentId ?? "",
          visibleCommentCount: discussion.length,
          attachmentCount: selectedItem.attachments?.length ?? 0,
          revision: selectedItem.revision ?? 1,
          ...(activePdfView ? {
            visibleAttachmentId: activePdfView.attachmentId,
            pdfPage: activePdfView.page,
            pdfPageCount: activePdfView.pageCount
          } : {})
        }
      };
    }
    if (selectedCommunity) {
      return {
        surface: "community",
        route: `/communities/${selectedCommunity.id}`,
        title: selectedCommunity.name,
        summary: selectedCommunity.summary,
        content: trimContent([
          `Field: ${selectedCommunity.field}`,
          `Keywords: ${selectedCommunity.keywords.join(", ")}`,
          selectedCommunity.guidelines ? `Guidelines:\n${selectedCommunity.guidelines}` : ""
        ].filter(Boolean).join("\n\n")),
        entityType: "community",
        entityId: selectedCommunity.id,
        metadata: { visibility: selectedCommunity.visibility, membershipStatus: selectedCommunity.membershipStatus ?? "none" }
      };
    }
    if (activeRoom === "office" && officeMode === "notes") {
      return {
        surface: "workspace",
        route: workspaceTabletDocument
          ? `/workspace?view=notes&note=${encodeURIComponent(workspaceTabletDocument.id)}`
          : "/workspace?view=notes",
        title: workspaceTabletDocument?.title ?? "Workspace Notes",
        summary: workspaceTabletDocument
          ? `${workspaceTabletDocument.kind} draft · revision ${workspaceTabletDocument.revision}`
          : "Your private notes and drafts workspace.",
        content: trimContent(workspaceTabletDocument?.body ?? `Workspace section: ${workspaceView.section}. Search: ${workspaceView.query || "none"}.`),
        entityType: workspaceTabletDocument ? "note" : "workspace",
        entityId: workspaceTabletDocument?.id,
        metadata: {
          section: workspaceView.section,
          editing: workspaceView.editSelected,
          ...(workspaceTabletDocument ? { revision: workspaceTabletDocument.revision } : {})
        }
      };
    }
    const visibleFeedContext = visibleItems.slice(0, 12).map(tabletItemLine);
    return {
      surface: activeRoom === "hall" ? "hall" : "room",
      route: activeRoom === "hall" ? "/" : `/rooms/${activeRoom}`,
      title: activeRoomData.name,
      summary: activeRoomData.description,
      content: trimContent([
        activeRoomData.title,
        `Feed: ${activeRoomData.feedLabel}`,
        `Location: ${activeRoomData.location}`,
        `Ambient: ${activeRoomData.ambient}`,
        visibleFeedContext.length
          ? `Visible feed items:\n\n${visibleFeedContext.join("\n\n")}`
          : "No feed items are currently visible."
      ].join("\n\n")),
      entityType: "room",
      entityId: activeRoom,
      metadata: { feedScope, officeMode, visibleItemCount: visibleFeedContext.length }
    };
  })();

  const assistantVisibleContext =
    assistantOpen && assistantOriginContext
      ? assistantOriginContext
      : assistantOpen && assistantBackdrop === "messages"
        ? {
            surface: "messages" as const,
            route: "/messages",
            title: "Messages",
            summary: "The Messages conversation list.",
            content: "No conversation is selected.",
            metadata: { privateConversation: false }
          }
        : tabletContext;

  const assistantController = useAssistantController({
    actorHandle: currentProfile.handle,
    context: assistantVisibleContext,
    requestedConversationId: assistantThreadId,
    enabled:
      sessionController.readsEnabled &&
      (tabletOpen || assistantOpen),
    liveEvents: assistantEvents
  });

  useEffect(() => {
    const selectedThreadId = assistantController.conversationId ?? null;
    if (selectedThreadId === assistantThreadId) return;
    setViewField("assistantThreadId", selectedThreadId);
    if (assistantOpen) {
      replaceCanonicalRoute({
        kind: "assistant",
        threadId: selectedThreadId ?? undefined,
        backdrop: assistantBackdrop ?? undefined
      });
    }
  }, [
    assistantController.conversationId,
    assistantOpen,
    assistantBackdrop,
    assistantThreadId,
    replaceCanonicalRoute
  ]);

  if (sessionController.presentedEntryMode !== "complete") {
    return (
      <EntrySequence
        theme={theme}
        entranceRender={entranceRenders[theme]}
        mode={sessionController.presentedEntryMode}
        authError={sessionController.authError}
        authLoaded={authLoaded}
        clerkEnabled={clerkEnabled}
        onLocalPreview={sessionController.enterLocalPreview}
        playApproach={sessionController.playApproach}
      />
    );
  }

  return (
    <NativeCitationProvider>
    <ScribbleProvider actorHandle={currentProfile.handle} profiles={profiles} theme={theme}>
    <main
      className={`symposium-shell ${theme}`}
      data-room={activeRoom}
      data-community-selected={selectedCommunity ? "true" : undefined}
      data-assistant-backdrop={activeAssistantBackdrop ?? undefined}
      data-view={assistantOpen ? "assistant" : messagesOpen ? "messages" : applicationReviewItem ? "opportunity-applications" : selectedProfile ? "profile" : selectedItem ? "detail" : activeRoom === "hall" ? "hall" : "room"}
      style={{ "--room-bg": `url(${activeShellRender})` } as CSSProperties}
    >
      <div className="ambient-layer" aria-hidden="true" />

      <header className="topbar">
        <CanonicalLink className="brand" route={{ kind: "hall" }} onNavigate={() => enterRoom("hall")}>
          {activeRoom !== "hall" && <ArrowLeft size={18} />}
          <span>
            <strong>{activeRoom === "hall" ? "SYMPOSIUM" : "Exit"}</strong>
            {activeRoom !== "hall" && <small>Main hall</small>}
          </span>
        </CanonicalLink>

        <ViewNav
          canGoBack={
            hasViewHistory ||
            activeRoom !== "hall" ||
            Boolean(selectedItemId || applicationReviewPostId || selectedProfileName || selectedCommunityId || messagesOpen || assistantOpen)
          }
          canGoForward={hasViewFuture}
          onBack={goBack}
          onForward={goForward}
          onHome={() => enterRoom("hall")}
        />

        <nav className="topbar-actions" aria-label="Primary controls">
          <button
            className="icon-button"
            type="button"
            title={theme === "day" ? "Enter night mode" : "Enter day mode"}
            onClick={() => setTheme((value) => (value === "day" ? "night" : "day"))}
          >
            {theme === "day" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <NotificationsControl
            actorHandle={currentProfile.handle}
            liveEvents={notificationEvents}
            onOpenConversation={(conversationId) => {
              closeQuickMessages();
              navigateView({ messagesOpen: true, selectedConversationId: conversationId });
            }}
            onNavigate={(href) => {
              const url = new URL(href, window.location.origin);
              const analyticsView = url.searchParams.get("analytics");
              const pendingCommunityRequests = url.searchParams.get("requests") === "pending";
              const commentId = url.searchParams.get("comment")?.trim() || undefined;
              const route = parseCanonicalRoute(url.pathname, url.search);
              const { scrollY: _scrollY, ...target } = snapshotForCanonicalRoute(
                route,
                (postId) => itemsRef.current.find((item) => item.id === postId)?.room
              );
              navigateView(target);
              if (pendingCommunityRequests && route.kind === "community") {
                const detail = { communityId: route.communityId };
                try {
                  window.sessionStorage.setItem(
                    "symposium:pending-community-requests",
                    JSON.stringify(detail)
                  );
                } catch {
                  // The immediate event remains sufficient when browser storage is unavailable.
                }
                window.setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("symposium:open-community-requests", { detail }));
                }, 80);
              }
              const postId = route.kind === "post"
                ? route.postId
                : null;
              if (
                postId &&
                (analyticsView === "likes" || analyticsView === "reshares" || analyticsView === "quotes" || analyticsView === "overview")
              ) {
                const detail: PendingContentAnalytics = {
                  postId,
                  ...(commentId ? { commentId, subjectType: "comment" } : { subjectType: "post" }),
                  view: analyticsView
                };
                queuePendingContentAnalytics(detail);
                window.setTimeout(() => {
                  dispatchPendingContentAnalytics(detail);
                }, 80);
              }
            }}
          />
          <MessagesUnreadButton
            actorHandle={currentProfile.handle}
            expanded={messagesQuickOpen}
            liveEvents={messagingEvents}
            onOpen={openQuickMessages}
          />
          <CanonicalLink
            className="profile-button"
            title="Open your profile"
            route={{ kind: "profile", handle: currentProfile.handle }}
            onNavigate={() => openProfile(currentProfile.handle)}
          >
            {currentProfile.avatarUrl
              ? <img className="profile-button-avatar" src={currentProfile.avatarUrl} alt="" />
              : <UserRound size={18} />}
            <span>{currentProfile.name}</span>
          </CanonicalLink>
        </nav>
      </header>

      <div className="sync-status" role="status" aria-live="polite">
        {syncStatus}
      </div>

      <button className="search-launcher bottom-action bottom-action-search" type="button" onClick={openSearch}>
        <Search size={17} />
        <span>Search</span>
      </button>

      <section className="stage">
        <CommunityGovernanceProvider community={selectedCommunity} items={items}>
        {assistantOpen ? (
          <div className="assistant-stage-placeholder" aria-hidden="true" />
        ) : messagesOpen ? (
          <MessagesStage
            actor={currentProfile}
            profiles={profiles}
            selectedConversationId={selectedConversationId}
            onSelectConversation={(conversationId) =>
              navigateView({ messagesOpen: true, selectedConversationId: conversationId }, null)
            }
            onOpenProfile={openProfile}
            liveEvents={messagingEvents}
            onTabletContextChange={setMessageTabletContext}
          />
        ) : applicationReviewItem ? (
          <OpportunityApplicationsStage
            item={applicationReviewItem}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            selectedApplicationId={selectedApplicationId ?? undefined}
            onSelectApplication={(applicationId) => navigateView({ selectedApplicationId: applicationId })}
            onBack={(postId) => navigateView(opportunityPostView(postId))}
          />
        ) : selectedProfile ? (
          <ProfileView
            person={selectedProfile}
            items={items}
            isOwnProfile={selectedProfile.handle === currentProfile.handle}
            isFollowing={followingHandles.includes(selectedProfile.handle)}
            onSelect={openPost}
            onOpenProfile={openProfile}
            onAction={applyAction}
            onCommentAction={applyCommentAction}
            onQuote={beginQuote}
            onOpenQuote={openQuotedSource}
            onEditComment={(itemId, commentId) => openCommentEditor({ itemId, commentId })}
            onDeleteComment={deleteComment}
            onOpenSettings={() => {
              setSearchOpen(false);
              setViewField("messagesOpen", false);
              openSettings();
            }}
            onToggleFollow={toggleFollow}
            onMessage={(handle) => {
              const normalized = cleanHandle(handle);
              navigateView({ messagesOpen: true, selectedConversationId: `direct:${normalized}` }, null);
            }}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            socialLists={profileSocialLists[selectedProfile.handle] ?? { following: [], followers: [] }}
            socialView={profileSocialView}
            getProfileRecency={profileActivity.getProfileRecency}
            getProfileCommentRecency={profileActivity.getProfileCommentRecency}
            activeTab={profileActiveTab}
            activityRevision={profileActivity.activityRevision}
            canonicalActivities={selectedProfileActivitySnapshot?.entries ?? []}
            canonicalActivityLoaded={selectedProfileActivityPage?.loaded ?? false}
            canonicalActivityError={Boolean(profileActivity.activityErrors[selectedProfile.handle])}
            canonicalActivityComplete={Boolean(
              selectedProfileActivityPage?.loaded &&
              (!profileActivityActionsForScope(selectedProfileActivityScope).length || !selectedProfileActivityPage.nextCursor) &&
              (!profileActivityScopeIncludesComments(selectedProfileActivityScope) || !selectedProfileActivityPage.commentsNextCursor)
            )}
            canonicalActivityTotals={selectedProfileActivitySnapshot?.totals}
            authoredActivityComplete={
              !profileTabUsesAuthoredPosts(profileActiveTab) ||
              Boolean(feedPages[`profile:${selectedProfile.handle}:authored`]?.initialized && !feedPages[`profile:${selectedProfile.handle}:authored`]?.nextCursor)
            }
            activityLoadingMore={Boolean(
              selectedProfileActivityPage?.loading ||
              (profileTabUsesAuthoredPosts(profileActiveTab) && feedPages[`profile:${selectedProfile.handle}:authored`]?.loading)
            )}
            hiddenCommunityCounts={selectedProfileActivitySnapshot?.hiddenCommunityCounts ?? emptyProfileActivityCounts()}
            communities={communities}
            onOpenCommunity={openCommunity}
            onActiveTabChange={changeProfileTab}
            onRetryActivity={() => {
              void profileActivity.refresh(
                selectedProfile.handle,
                currentProfile.handle,
                selectedProfileActivityScope,
                false,
                true
              ).catch(() => undefined);
            }}
            onLoadMoreActivity={() => {
              const tasks: Promise<unknown>[] = [];
              if (selectedProfileActivityPage?.nextCursor || selectedProfileActivityPage?.commentsNextCursor) {
                tasks.push(profileActivity.refresh(
                  selectedProfile.handle,
                  currentProfile.handle,
                  selectedProfileActivityScope,
                  true
                ));
              }
              const postPageKey = `profile:${selectedProfile.handle}:authored`;
              if (profileTabUsesAuthoredPosts(profileActiveTab) && feedPages[postPageKey]?.nextCursor) {
                tasks.push(loadPostPage(postPageKey, { authorHandle: selectedProfile.handle, limit: 24 }, true));
              }
              void Promise.all(tasks).catch(() => setSyncStatus("More profile activity could not load"));
            }}
            onSocialViewChange={changeProfileSocialView}
            onEditPost={openPostEditor}
            onDeletePost={deletePost}
            onOpenAttachmentPreview={openAttachmentPreview}
            onOpenCommentAttachmentPreview={openCommentAttachmentPreview}
          />
        ) : selectedItem ? (
          <DetailView
            item={selectedItem}
            room={activeRoomData}
            onBack={returnToDetailOrigin}
            onOpenProfile={openProfile}
            onAddComment={addComment}
            onUploadCommentAttachment={uploadCommentAttachment}
            onResolveQuoteLink={resolveComposerQuoteLink}
            onOpenCommentAttachmentPreview={openCommentAttachmentPreview}
            onAction={applyAction}
            onQuote={beginQuote}
            onOpenQuote={openQuotedSource}
            onCommentAction={applyCommentAction}
            onEditComment={(itemId, commentId) => openCommentEditor({ itemId, commentId })}
            onDeleteComment={deleteComment}
            onEditPost={openPostEditor}
            onDeletePost={deletePost}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            selectedCommentId={selectedCommentId}
            onClearSelectedComment={() => {
              setViewField("selectedCommentId", null);
              replaceCanonicalRoute({ kind: "post", postId: selectedItem.id });
            }}
            onSelectComment={(commentId) => openPost(selectedItem.id, commentId, "thread")}
            commentSegmentStacks={commentSegmentStacks}
            onCommentSegmentStackChange={updateCommentSegmentStack}
            onVisibleCommentSegmentStackChange={registerVisibleCommentSegmentStack}
            onOpenAttachmentPreview={openAttachmentPreview}
            onAttachmentViewContextChange={setPostAttachmentViewContext}
            onApplyOpportunity={beginOpportunityApplication}
            onReviewOpportunity={(item) => navigateView(opportunityApplicationsView(item.id))}
          />
        ) : activeRoom === "hall" ? (
          <HallView onEnter={enterRoom} />
        ) : activeRoom === "office" && officeMode === "desk" ? (
          <OfficeDeskView
            room={activeRoomData}
            onOpenSaved={() => toggleOfficeMode("saved")}
            onOpenNotes={() => toggleOfficeMode("notes")}
          />
        ) : activeRoom === "office" && officeMode === "notes" ? (
          <WorkspaceView
            room={activeRoomData}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            onOpenSaved={() => toggleOfficeMode("saved")}
            onPublished={acceptWorkspacePublication}
            onOpenProfile={openProfile}
            initialDocumentId={workspaceView.selectedDocumentId ?? (initialRoute.kind === "workspace" ? initialRoute.noteId : undefined)}
            initialCommentId={initialRoute.kind === "workspace" ? initialRoute.commentId : undefined}
            initialViewState={workspaceView}
            onViewStateChange={setWorkspaceView}
            onTabletContextChange={setWorkspaceTabletDocument}
          />
        ) : activeRoom === "communities" ? (
          <CommunitiesStage
            state={{
              selectedCommunity,
              communities,
              items,
              calls: selectedCommunity ? communityCalls[selectedCommunity.id] ?? [] : [],
              currentProfile,
              profiles,
              membershipBusy: communityMembershipBusy,
              feedView: selectedCommunityFeedView,
              feedHasMore: Boolean(activeFeedRequest && feedPages[activeFeedRequest.key]?.nextCursor),
              feedLoadingMore: Boolean(activeFeedRequest && feedPages[activeFeedRequest.key]?.loading),
              feedSearchResultIds: communitySearchResultIds,
              feedSearchLoading: communitySearchLoading
            }}
            directory={{ query: communityQuery, onQuery: setCommunityQuery, expanded: communitiesExpanded, onExpanded: setCommunitiesExpanded }}
            actions={{
              onBack: closeCommunity, onMembership: communityController.changeMembership, onVisibility: communityController.changeVisibility,
              onUpdateSettings: communityController.updateSettings,
              onUpdateMemberRole: communityController.updateMemberRole,
              onRemoveMember: communityController.removeMember,
              onResolveRequest: communityController.resolveRequest,
              onCreateAnnouncement: communityController.createAnnouncement,
              onUpdateAnnouncement: communityController.updateAnnouncement,
              onDeleteAnnouncement: communityController.deleteAnnouncement,
              onCreatePost: () => {
                if (selectedCommunity) openComposer(selectedCommunity.id);
              },
              onCreateCall: communityController.createCall, onJoinCall: communityController.joinCall,
              onInvite: communityController.invite, onMessageModerator: (handle) => { const normalized = cleanHandle(handle); navigateView({ messagesOpen: true, selectedConversationId: `direct:${normalized}` }, null); },
              onOpenCommunity: openCommunity, onCreateCommunity: communityController.createCommunity,
              onSelect: openPost, onOpenProfile: openProfile, onAction: applyAction, onQuote: beginQuote,
              onOpenQuote: openQuotedSource, onEditPost: openPostEditor, onDeletePost: deletePost,
              onOpenAttachmentPreview: openAttachmentPreview,
              onFeedView: setSelectedCommunityFeedView,
              onLoadMore: () => activeFeedRequest
                ? loadPostPage(activeFeedRequest.key, activeFeedRequest.query, true).catch(() => {
                    setSyncStatus("More posts could not load");
                  })
                : Promise.resolve()
            }}
          />
        ) : (
          <RoomView
            room={activeRoomData}
            items={visibleItems}
            officeMode={activeRoom === "office" ? officeMode : undefined}
            feedScope={feedScope}
            onFeedScope={setFeedScope}
            onSelect={openPost}
            onOpenProfile={openProfile}
            onAction={applyAction}
            onQuote={beginQuote}
            onOpenQuote={openQuotedSource}
            onEditPost={openPostEditor}
            onDeletePost={deletePost}
            onOpenNotes={() => toggleOfficeMode("notes")}
            onOpenSaved={() => toggleOfficeMode("saved")}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            onOpenAttachmentPreview={openAttachmentPreview}
            hasMore={Boolean(activeFeedRequest && feedPages[activeFeedRequest.key]?.nextCursor)}
            loadingMore={Boolean(activeFeedRequest && feedPages[activeFeedRequest.key]?.loading)}
            onLoadMore={activeFeedRequest ? () =>
              loadPostPage(activeFeedRequest.key, activeFeedRequest.query, true).catch(() => {
                setSyncStatus("More posts could not load");
              }) : undefined}
          />
        )}
        </CommunityGovernanceProvider>
      </section>

      <button
        className="new-post-launcher bottom-action bottom-action-new"
        type="button"
        onClick={() => {
          setSearchOpen(false);
          openGlobalComposer(
            selectedCommunity &&
              canParticipateInCommunity(selectedCommunity, currentProfile)
              ? selectedCommunity.id
              : null
          );
        }}
      >
        <NotebookPen size={18} />
        <span>New post</span>
      </button>

      <ScribbleLauncher />

      <button
        className={`pocket pocket-right bottom-action bottom-action-tablet tablet-launcher${tabletOpen ? " active" : ""}`}
        type="button"
        title={assistantOpen ? "Collapse AI Workspace to Tablet" : tabletOpen ? "Expand AI Tablet" : "Open AI Tablet"}
        aria-expanded={tabletOpen || assistantOpen}
        onClick={toggleTablet}
      >
        <BrainCircuit size={18} />
        <span>AI Tablet</span>
      </button>

      {tabletOpen || assistantOpen ? (
        <AssistantExperience
          controller={assistantController}
          mode={assistantOpen ? "workspace" : "compact"}
          onClose={closeTablet}
          onExpand={() => {
            expandAssistant(tabletContext);
            navigateView({
              assistantOpen: true,
              assistantThreadId: assistantController.conversationId ?? null
            }, null);
          }}
          onCollapse={() => {
            collapseAssistantToTablet(assistantController.conversationId ?? null);
          }}
        />
      ) : null}

      {messagesQuickOpen ? (
        <MessagesQuickAccess
          actor={currentProfile}
          profiles={profiles}
          selectedConversationId={quickConversationId}
          onSelectConversation={selectQuickConversation}
          onOpenProfile={(handle) => {
            closeQuickMessages();
            openProfile(handle);
          }}
          onOpenFull={(conversationId) => {
            closeQuickMessages();
            navigateView({ messagesOpen: true, selectedConversationId: conversationId }, null);
          }}
          onClose={closeQuickMessages}
          liveEvents={messagingEvents}
        />
      ) : null}

      {composerOpen ? (
        <PostComposerModal
          onClose={closeComposer}
          onCreatePost={createPost}
          onSaveDraft={savePostDraft}
          onUploadAttachment={uploadPostAttachment}
          onResolveQuoteLink={resolveComposerQuoteLink}
          profiles={profiles}
          initialKind={activeRoom === "opportunities" ? "opportunity" : activeRoom === "funding" ? "proposal" : undefined}
          destination={{
            communityId: composerCommunityId,
            selectedCommunity: selectedCommunity ? {
              id: selectedCommunity.id,
              name: selectedCommunity.name,
              canPost: canParticipateInCommunity(selectedCommunity, currentProfile)
            } : undefined,
            onChange: setComposerCommunityId
          }}
        />
      ) : null}

      {opportunityApplicationComposer}

      {quoteSelection && quotePreview ? (
        <QuoteComposerModal
          key={`${quoteSelection.sourceType}:${quoteSelection.sourceId}`}
          quote={quotePreview}
          selection={quoteSelection}
          profiles={profiles}
          onClose={closeQuote}
          onCreatePost={createPost}
          onAddComment={addComment}
          onUploadPostAttachment={uploadPostAttachment}
          onUploadCommentAttachment={uploadCommentAttachment}
        />
      ) : null}

      {editingPostItem ? (
        <PostEditModal
          key={editingPostItem.id}
          item={editingPostItem}
          onClose={() => closePostEditor()}
          onSave={savePostEdit}
          onDelete={deletePost}
          onUploadAttachment={uploadPostAttachment}
          onResolveQuoteLink={resolveComposerQuoteLink}
          profiles={profiles}
        />
      ) : null}

      {editingComment && editingCommentItem && editingCommentValue && !isDeletedComment(editingCommentValue) ? (
        <CommentEditModal
          key={`${editingComment.itemId}:${editingComment.commentId}`}
          item={editingCommentItem}
          comment={editingCommentValue}
          onClose={() => closeCommentEditor()}
          onSave={saveCommentEdit}
          onDelete={deleteComment}
          onUploadAttachment={uploadCommentAttachment}
          onResolveQuoteLink={resolveComposerQuoteLink}
          profiles={profiles}
        />
      ) : null}

      {attachmentPreview && attachmentPreviewBaseItem && (!attachmentPreview.commentId || attachmentPreviewComment) ? (
        <ScribbleAttachmentPreview
          item={attachmentPreviewBaseItem}
          comment={attachmentPreviewComment}
          attachmentId={attachmentPreview.attachmentId}
          onClose={() => {
            setAttachmentPreviewViewContext(null);
            closeAttachmentPreview();
          }}
          onViewContextChange={setAttachmentPreviewViewContext}
        />
      ) : null}

      {searchOpen ? (
        <SearchModal
          query={searchQuery}
          setQuery={setSearchQuery}
          results={searchResults}
          loading={searchLoading}
          onClose={() => setSearchOpen(false)}
          onOpenPost={(id) => {
            setSearchOpen(false);
            openPost(id, null, "search");
          }}
          onOpenProfile={(name) => {
            setSearchOpen(false);
            openProfile(name);
          }}
        />
      ) : null}

      {settingsOpen ? (
        <ProfileSettingsModal
          currentProfile={currentProfile}
          onClose={closeSettings}
          onSave={saveProfileSettings}
          onUploadAvatar={uploadProfileAvatar}
          onSignOut={signOut}
        />
      ) : null}
    </main>
    </ScribbleProvider>
    </NativeCitationProvider>
  );
}
