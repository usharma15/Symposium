"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  getProfileForName,
  inquiryItems,
  profile,
  rooms,
  type FeedScope,
  type ContentQuoteSource,
  type InquiryAttachment,
  type InquiryComment,
  type InquiryItem,
  type ResearchCommunity,
  type ResearchProfile,
  type RoomId
} from "@/lib/mockData";
import type { CommentAction, PostAction } from "@/lib/dataStore";
import type {
  AssistantMessageInputContract,
  CanonicalActionActivityContract,
  OpportunityPostInputContract,
  PatronageProposalInputContract,
  PostPageResponseContract,
  PostPageQueryContract,
  ProfileActivityCountsContract,
  ProfileAuthoredCommentActivityContract,
  ProfileActivityResponseContract,
  SearchResponseContract,
  ToggleActionContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";
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
  itemTimestampScore,
  isSavedBy,
  mapCommentTree,
  mutateCommentForActor,
  mutateItemForActor,
  normalizeSearchPhrase,
  updateSignalValue
} from "@/lib/symposiumCore";
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
  isCrossTabItemMessage,
  type CrossTabItemMessage
} from "@/features/live-sync/crossTabItemSync";
import { createItemMutationCoordinator } from "@/features/mutations/itemMutationCoordinator";
import { compareEntityRevisions } from "@/features/live-sync/entityRevision";
import {
  createFollowMutationCoordinator,
  type RevisionedFollowRecord
} from "@/features/live-sync/followMutationCoordinator";
import { useCrossTabItemTransport } from "@/features/live-sync/useCrossTabItemTransport";
import { useLiveEventStream } from "@/features/live-sync/useLiveEventStream";
import { useCoalescedRefresh } from "@/features/live-sync/useCoalescedRefresh";
import { recordPassiveView } from "@/features/live-sync/recordPassiveView";
import {
  createClientMutationId,
  createRetryMutationRegistry,
  shouldRetainRetryMutation,
  symposiumApi,
  SymposiumApiError
} from "@/features/api/symposiumApiClient";
import {
  createInquiryActionReconciler,
  type ProtectedActionMetricState
} from "@/features/live-sync/inquiryActionReconciler";
import type { CanonicalRoute, ProfileSocialView } from "@/features/navigation/canonicalRoute";
import {
  canonicalRouteForView as routeForViewSnapshot,
  detailOriginFromSnapshot,
  officeModeForCanonicalRoute,
  roomForCanonicalRoute,
  snapshotForCanonicalRoute,
  type DetailOriginSnapshot,
  type WorkspaceViewSnapshot,
  type OfficeMode,
  type ViewSnapshot
} from "@/features/navigation/viewState";
import { selectActiveProfile } from "@/features/identity/selectActiveProfile";
import { persistCachedIdentity, readCachedIdentity } from "@/features/identity/cachedIdentity";
import { useInquiryEntityStore } from "@/features/entities/useInquiryEntityStore";
import {
  buildPostAttachmentMetadata,
  type AttachmentPreviewHandler
} from "@/features/attachments/AttachmentViews";
import type { PdfAttachmentViewContext } from "@/features/attachments/pdfAttachmentClient";
import { buildTabletAttachmentContext } from "@/features/assistant/tabletAttachmentContext";
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
import {
  EntrySequence,
  HallView,
  OfficeDeskView,
  ViewNav
} from "@/features/shell/SymposiumShellViews";
import type {
  ViewActionOptions,
  ViewSurface
} from "@/features/actions/actionTypes";
import {
  type CommentSegmentStacks
} from "@/features/comments/CommentThread";
import {
  CommentEditModal,
  DetailView,
  PostComposerModal,
  PostEditModal,
  commentsSectionTargetId,
  type PostDraft
} from "@/features/posts/PostViews";
import {
  QuoteComposerModal,
  type QuoteSelection
} from "@/features/quotes/QuoteViews";
import { resolveQuoteLink, type QuoteLinkResolver } from "@/features/quotes/quoteLinks";
import { invalidateQuotedSource, resolveLocalContentQuote } from "@/lib/contentQuotes";
import { communityViewerProjectionChanged } from "@/lib/communityContentProjection";
import { preservePostSemanticProjection } from "@/lib/postSemantics";
import { selectVisibleFeedItems } from "@/features/feeds/feedVisibility";
import {
  ProfileSettingsModal,
  ProfileView,
  commentTimestampScore,
  itemAuthoredByProfile,
  updateCommentsForProfile,
  type ProfileActivityKind,
  type ProfileCommentActivityKind,
  type ProfileSettingsDraft,
  type ProfileSocialLists,
  type ProfileTab
} from "@/features/profiles/ProfileViews";
import { profileAvatarForPersistence } from "@/features/profiles/profilePersistence";
import {
  persistCachedProfileActivity,
  persistCachedProfileSocial,
  readCachedProfileActivity,
  readCachedProfileSocial
} from "@/features/profiles/profileReadCache";
import {
  CommunitiesStage
} from "@/features/communities/CommunityViews";
import { searchableContentText } from "@/features/discovery/discoveryPolicy";
import { canParticipateInCommunity, communityPostIsExternallyDiscoverable } from "@/features/communities/communityPolicy";
import { useCommunityState } from "@/features/communities/useCommunityState";
import { createCommunityController } from "@/features/communities/communityController";
import { CommunityGovernanceProvider } from "@/features/communities/CommunityGovernanceContext";
import { createContentDeletionController } from "@/features/moderation/contentDeletionController";
import { TabletPanel } from "@/features/workspace/WorkspacePanels";
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
import { useBrowserSessionEntrance } from "@/features/entrance/useBrowserSessionEntrance";
import {
  entryModeForBrowserSession,
  resolvePresentedEntryMode,
  shouldCompleteEntryAfterAccountSync
} from "@/features/entrance/browserSession";
import {
  normalizeClientSeedTimes,
  preservePublishedPosition
} from "@/features/bootstrap/clientItemNormalization";
import {
  cachedBootstrapItemLimit,
  persistCachedBootstrap,
  readCachedBootstrapSnapshot,
  resolveCachedBootstrap
} from "@/features/bootstrap/cachedBootstrap";
import {
  communityRenders,
  entranceRenders,
  getThemePreloadRenders,
  messageRenders,
  roomRenders,
  useSymposiumRenderPreload,
  type Theme
} from "@/features/rooms/roomRenderAssets";

type EntryMode = "loading" | "approach" | "auth" | "complete";
type ViewTargetType = "post" | "comment";
type EditingCommentTarget = {
  itemId: string;
  commentId: string;
};

type ProfileFollowRecord = RevisionedFollowRecord;
type FeedPageState = {
  initialized: boolean;
  loading: boolean;
  nextCursor: string | null;
};
type SearchResults = {
  titleMatches: InquiryItem[];
  contentMatches: InquiryItem[];
  profileMatches: ResearchProfile[];
};
type ProfileFollowResponse = {
  following?: ProfileFollowRecord[];
  followers?: ProfileFollowRecord[];
};

type AttachmentPreviewTarget = {
  itemId: string;
  commentId?: string;
  attachmentId: string;
};

type ProfileSyncEntity = ResearchProfile & { id: string };
type LiveEventPayload = {
  [key: string]: unknown;
  item?: unknown;
  profile?: unknown;
  follow?: ProfileFollowRecord;
  action?: PostAction;
  activity?: unknown;
  itemId?: string;
  commentId?: string;
  commentRevision?: number;
  metrics?: Partial<InquiryItem["metrics"]>;
  revision?: number;
};

type ProfileActivityPageScope = "all" | "comments" | "reshares" | "likes" | "saved";
type ProfileActivityPageState = {
  loaded: boolean;
  loading: boolean;
  nextCursor: string | null;
  commentsNextCursor: string | null;
  stale?: boolean;
};
type ProfileActivitySnapshot = {
  entries: CanonicalActionActivityContract[];
  loaded: boolean;
  nextCursor: string | null;
  pages: Partial<Record<ProfileActivityPageScope, ProfileActivityPageState>>;
  hiddenCommunityCounts: ProfileActivityCountsContract;
  totals?: ProfileActivityCountsContract;
};

const profileActivityScopeForTab = (tab: ProfileTab): ProfileActivityPageScope => {
  if (tab === "comments" || tab === "reshares" || tab === "likes" || tab === "saved") return tab;
  return "all";
};

const profileActivityActionsForScope = (scope: ProfileActivityPageScope): ToggleActionContract[] => {
  if (scope === "likes") return ["signal"];
  if (scope === "saved") return ["save"];
  if (scope === "reshares" || scope === "all") return ["fork"];
  return [];
};

const profileActivityCommentModeForScope = (scope: ProfileActivityPageScope): "all" | "none" => {
  if (scope === "all" || scope === "comments") return "all";
  return "none";
};

const profileActivityScopeIncludesComments = (scope: ProfileActivityPageScope) =>
  profileActivityCommentModeForScope(scope) !== "none";

const profileTabUsesAuthoredPosts = (tab: ProfileTab) =>
  tab === "all" || tab === "papers" || tab === "thoughts" || tab === "proposals" ||
  tab === "opportunities" || tab === "reshares";

const emptyProfileActivitySnapshot = (): ProfileActivitySnapshot => ({
  entries: [],
  loaded: false,
  nextCursor: null,
  pages: {},
  hiddenCommunityCounts: emptyProfileActivityCounts()
});

const mergeSparseProfileComments = (
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

type SymposiumLiveEvent = {
  id?: string;
  cursor?: string;
  kind: string;
  actorHandle?: string;
  subjectType: string;
  subjectId: string;
  payload?: LiveEventPayload;
  createdAt?: string;
};

type SymposiumAuthState = {
  clerkEnabled: boolean;
  authLoaded: boolean;
  getAccessToken: () => Promise<string | null>;
  isSignedIn: boolean;
  userId: string | null;
  signOut: () => Promise<void>;
};

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

const clientId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

const viewDedupeWindowMs = 60 * 60 * 1000;

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
    `${item.kind}: ${item.title}`,
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
        `${"  ".repeat(Math.min(depth, 4))}${comment.author} · ${comment.stance}${selected}`,
        comment.body,
        attachments.length ? `Attachments:\n${attachments.join("\n\n")}` : ""
      ].filter(Boolean).join("\n"));
    }
    tabletDiscussionText(comment.replies ?? [], selectedCommentId, depth + 1, lines);
  }
  return lines;
};

const isLiveInquiryItem = (value: unknown): value is InquiryItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as InquiryItem).id === "string" &&
  typeof (value as InquiryItem).title === "string" &&
  typeof (value as InquiryItem).kind === "string" &&
  typeof (value as InquiryItem).room === "string" &&
  typeof (value as InquiryItem).metrics === "object";

const isLiveResearchProfile = (value: unknown): value is ResearchProfile =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ResearchProfile).handle === "string" &&
  typeof (value as ResearchProfile).name === "string" &&
  Array.isArray((value as ResearchProfile).fields);

const isCrossTabInquiryItemMessage = (value: unknown): value is CrossTabItemMessage<InquiryItem> =>
  isCrossTabItemMessage<InquiryItem>(value);

const isCrossTabProfileMessage = (value: unknown): value is CrossTabItemMessage<ProfileSyncEntity> =>
  isCrossTabItemMessage<ProfileSyncEntity>(value);

const profileSyncEntity = (person: ResearchProfile): ProfileSyncEntity => ({ ...person, id: person.handle });
const researchProfileFromSyncEntity = ({ id: _id, ...person }: ProfileSyncEntity): ResearchProfile => person;

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
  const { authLoaded, clerkEnabled, isSignedIn, userId } = auth;
  symposiumApi.configure({ backendUrl: liveBackendUrl, getAccessToken: auth.getAccessToken });
  const [theme, setTheme] = useState<Theme>("day");
  const [entryMode, setEntryMode] = useState<EntryMode>(() => entryModeForBrowserSession(initialShouldPlayEntrance));
  const [signedIn, setSignedIn] = useState(false);
  const [browserReadStateHydrated, setBrowserReadStateHydrated] = useState(false);
  const readSessionReady = browserReadStateHydrated && (
    !clerkEnabled || (authLoaded && (!isSignedIn || signedIn))
  );
  const { replayEntrance, shouldPlayEntrance } = useBrowserSessionEntrance(initialShouldPlayEntrance);
  const [activeRoom, setActiveRoom] = useState<RoomId>(() =>
    roomForCanonicalRoute(
      initialRoute,
      (postId) => inquiryItems.find((item) => item.id === postId)?.room
    )
  );
  const { items, itemsRef, replaceItems } = useInquiryEntityStore(initialBoundedInquiryItems);
  const [profiles, setProfiles] = useState<Record<string, ResearchProfile>>({});
  const [currentProfile, setCurrentProfile] = useState<ResearchProfile>(profile);
  const [followingHandles, setFollowingHandles] = useState<string[]>([]);
  const [profileSocialLists, setProfileSocialLists] = useState<Record<string, ProfileSocialLists>>({});
  const [feedScope, setFeedScope] = useState<FeedScope>("suggested");
  const [officeMode, setOfficeMode] = useState<OfficeMode>(officeModeForCanonicalRoute(initialRoute));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    initialRoute.kind === "post" ? initialRoute.postId : null
  );
  const [applicationReviewPostId, setApplicationReviewPostId] = useState<string | null>(initialRoute.kind === "opportunityApplications" ? initialRoute.postId : null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(initialRoute.kind === "opportunityApplications" ? initialRoute.applicationId ?? null : null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    initialRoute.kind === "post" ? initialRoute.commentId ?? null : null
  );
  const [detailOrigin, setDetailOrigin] = useState<DetailOriginSnapshot | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceViewSnapshot>(() => ({
    section: "all",
    selectedNotebookId: null,
    selectedDocumentId: initialRoute.kind === "workspace" ? initialRoute.noteId ?? null : null,
    editSelected: false,
    expandedNotebookIds: [],
    query: ""
  }));
  const [commentSegmentStacks, setCommentSegmentStacks] = useState<CommentSegmentStacks>({});
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(
    initialRoute.kind === "community" ? initialRoute.communityId : null
  );
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
    composerCommunityId,
    setComposerCommunityId,
    selectedCommunity,
    selectedCommunityFeedView,
    setSelectedCommunityFeedView
  } = useCommunityState(currentProfile.handle, selectedCommunityId);
  const [tabletOpen, setTabletOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [quoteSelection, setQuoteSelection] = useState<QuoteSelection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(initialRoute.kind === "messages");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialRoute.kind === "messages" ? initialRoute.conversationId ?? null : null);
  const [messagesQuickOpen, setMessagesQuickOpen] = useState(false);
  const [quickConversationId, setQuickConversationId] = useState<string | null>(null);
  const [messagingEvents, setMessagingEvents] = useState<SymposiumLiveEvent[]>([]);
  const [messageTabletContext, setMessageTabletContext] = useState<{ conversationId: string; title: string; content: string } | null>(null);
  const [workspaceTabletDocument, setWorkspaceTabletDocument] = useState<WorkspaceDocument | null>(null);
  const [notificationRevision, setNotificationRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [remoteSearchResults, setRemoteSearchResults] = useState<SearchResults | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [communitySearchResultIds, setCommunitySearchResultIds] = useState<string[] | null>(null);
  const [communitySearchLoading, setCommunitySearchLoading] = useState(false);
  const [feedPages, setFeedPages] = useState<Record<string, FeedPageState>>({});
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(
    initialRoute.kind === "profile" ? initialRoute.handle : null
  );
  const [profileSocialView, setProfileSocialView] = useState<ProfileSocialView | null>(
    initialRoute.kind === "profile" ? initialRoute.social ?? null : null
  );
  const [profileActiveTab, setProfileActiveTab] = useState<ProfileTab>(initialRoute.kind === "profile" ? initialRoute.tab ?? "all" : "all");
  const [profileActivityRevision, setProfileActivityRevision] = useState(0);
  const [profileActivityByHandle, setProfileActivityByHandle] = useState<
    Record<string, ProfileActivitySnapshot>
  >({});
  const [profileActivityErrors, setProfileActivityErrors] = useState<Record<string, boolean>>({});
  const [editingPost, setEditingPost] = useState<InquiryItem | null>(null);
  const [editingComment, setEditingComment] = useState<EditingCommentTarget | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewTarget | null>(null);
  const [postAttachmentViewContext, setPostAttachmentViewContext] = useState<PdfAttachmentViewContext | null>(null);
  const [attachmentPreviewViewContext, setAttachmentPreviewViewContext] = useState<PdfAttachmentViewContext | null>(null);
  const closeAttachmentPreview = useDedicatedAttachmentViewer(items, setAttachmentPreview);
  const [activityRecency, setActivityRecency] = useState<Record<string, number>>({});
  const [syncStatus, setSyncStatus] = useState<string>(liveStatus.loading);
  const [authError, setAuthError] = useState("");
  const profilesRef = useRef(profiles);
  const currentProfileRef = useRef(currentProfile);
  const selectedProfileNameRef = useRef(selectedProfileName);
  const selectedItemIdRef = useRef(selectedItemId);
  const selectedItemFallbackRef = useRef<InquiryItem | null>(null);
  const selectedCommentIdRef = useRef(selectedCommentId);
  const commentSegmentStacksRef = useRef<CommentSegmentStacks>({});
  const visibleCommentSegmentStacksRef = useRef<CommentSegmentStacks>({});
  const actionVersionsRef = useRef<Record<string, number>>({});
  const actionReconcilerRef = useRef(createInquiryActionReconciler());
  const {
    actionMetricStateFromValues,
    clearDesiredActionState,
    itemActionActive,
    protectItemFromStaleActionState,
    protectItemsFromStaleActionState,
    protectedDesiredActionState,
    setProtectedDesiredActionState,
    settleFreshItemActionState
  } = actionReconcilerRef.current;
  const viewDedupeRef = useRef<Record<string, number>>({});
  const activityRecencyRef = useRef(activityRecency);
  const profileActivityByHandleRef = useRef(profileActivityByHandle);
  const profileActivityInFlightRef = useRef<Record<string, Promise<void> | undefined>>({});
  const canonicalActionRevisionRef = useRef<Record<string, number>>({});
  const pendingCanonicalActionKeysRef = useRef(new Set<string>());
  const profileActivityRequestRef = useRef<Record<string, number>>({});
  const profileActivityCacheHydrationRef = useRef(new Set<string>());
  const feedPagesRef = useRef<Record<string, FeedPageState>>({});
  const feedActorHandleRef = useRef(currentProfile.handle);
  const retryMutationRegistryRef = useRef(createRetryMutationRegistry());
  const pendingActivityRecencyRef = useRef<Record<string, number>>({});
  const itemMutationCoordinatorRef = useRef(createItemMutationCoordinator<InquiryItem>({ equalRevisionProjectionChanged: communityViewerProjectionChanged }));
  const profileMutationCoordinatorRef = useRef(createItemMutationCoordinator<ProfileSyncEntity>());
  const followMutationCoordinatorRef = useRef(createFollowMutationCoordinator());
  const lastPersistedItemsRef = useRef<InquiryItem[]>(initialBoundedInquiryItems);
  const lastPersistedProfilesRef = useRef<ProfileSyncEntity[]>([]);
  const authenticatedProfileHandleRef = useRef<string | null>(null);
  const entranceStartedAtRef = useRef<number | null>(null);
  const entryModeRef = useRef(entryMode);
  entryModeRef.current = entryMode;
  const entryAuthStateRef = useRef({ accountSynced: signedIn, browserSignedIn: Boolean(isSignedIn) });
  entryAuthStateRef.current = { accountSynced: signedIn, browserSignedIn: Boolean(isSignedIn) };
  const [syncedClerkUserId, setSyncedClerkUserId] = useState<string | null>(null);

  const reconcileCommittedItem = (
    incoming: InquiryItem,
    current: InquiryItem | undefined,
    actorHandle = currentProfileRef.current.handle
  ) =>
    preservePublishedPosition(
      protectItemFromStaleActionState(
        itemMutationCoordinatorRef.current.protectIncomingItem(
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
    actorHandle = currentProfileRef.current.handle
  ) => {
    let next = reconcileCommittedItem(incoming, current, actorHandle);
    if (current?.detailLoaded && !incoming.detailLoaded) {
      next = {
        ...next,
        comments: mergeSparseProfileComments(current.comments, incoming.comments ?? []),
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
        comments: mergeSparseProfileComments(current?.comments ?? [], incoming.comments ?? [])
      };
    }
    return next;
  };

  const activeRoomData = getRoom(activeRoom);
  const themedRoomRenders = roomRenders[theme];
  const themedCommunityRenders = communityRenders[theme];
  const activeRoomRender =
    activeRoom === "communities" && selectedCommunityId
        ? themedCommunityRenders.selected
        : themedRoomRenders[activeRoom];
  const activeShellRender = messagesOpen ? messageRenders[theme] : activeRoomRender;
  const themePreloadRenders = useMemo(
    () => messagesOpen
      ? [messageRenders[theme === "day" ? "night" : "day"]]
      : getThemePreloadRenders(theme, activeRoom),
    [activeRoom, messagesOpen, theme]
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
  const profileList = useMemo(() => Object.values(profiles), [profiles]);
  const findProfile = (nameOrHandle: string) =>
    profileList.find((person) => person.handle === nameOrHandle) ??
    profileList.find((person) => person.name === nameOrHandle) ??
    getProfileForName(nameOrHandle);
  const selectedProfile = selectedProfileName ? findProfile(selectedProfileName) : null;
  const selectedProfileHandle = selectedProfileName
    ? selectedProfile?.handle ?? cleanHandle(selectedProfileName)
    : null;
  const selectedProfileActivityScope = profileActivityScopeForTab(profileActiveTab);
  const selectedProfileActivitySnapshot = selectedProfileHandle
    ? profileActivityByHandle[selectedProfileHandle]
    : undefined;
  const selectedProfileActivityPage = selectedProfileActivitySnapshot?.pages[selectedProfileActivityScope];

  useSymposiumRenderPreload(themePreloadRenders, activeShellRender);


  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    feedPagesRef.current = feedPages;
  }, [feedPages]);

  useEffect(() => {
    if (feedActorHandleRef.current === currentProfile.handle) return;
    feedActorHandleRef.current = currentProfile.handle;
    feedPagesRef.current = {};
    setFeedPages({});
  }, [currentProfile.handle]);

  useEffect(() => {
    profileActivityByHandleRef.current = profileActivityByHandle;
  }, [profileActivityByHandle]);

  useEffect(() => {
    currentProfileRef.current = currentProfile;
  }, [currentProfile]);


  const clientViewStorageKey = (handle: string) => `symposium-view-dedupe:${cleanHandle(handle)}`;
  const clientViewKey = (targetType: ViewTargetType, targetId: string) => `${targetType}:${targetId}`;
  const pruneClientViewDedupe = (dedupe: Record<string, number>, now = Date.now()) =>
    Object.fromEntries(
      Object.entries(dedupe).filter(([, timestamp]) => Number.isFinite(timestamp) && now - timestamp < viewDedupeWindowMs)
    );
  const persistClientViewDedupe = (dedupe: Record<string, number>, handle = currentProfileRef.current.handle) => {
    const pruned = pruneClientViewDedupe(dedupe);
    viewDedupeRef.current = pruned;
    window.localStorage.setItem(clientViewStorageKey(handle), JSON.stringify(pruned));
  };
  const readClientViewDedupe = (handle: string) => {
    try {
      const raw = window.localStorage.getItem(clientViewStorageKey(handle));
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, number>;
      return pruneClientViewDedupe(parsed);
    } catch {
      return {};
    }
  };
  const claimClientView = (targetType: ViewTargetType, targetId: string) => {
    const now = Date.now();
    const key = clientViewKey(targetType, targetId);
    const dedupe = pruneClientViewDedupe(viewDedupeRef.current, now);
    const lastViewedAt = dedupe[key];
    if (Number.isFinite(lastViewedAt) && now - lastViewedAt < viewDedupeWindowMs) {
      viewDedupeRef.current = dedupe;
      return false;
    }

    dedupe[key] = now;
    persistClientViewDedupe(dedupe);
    return true;
  };
  const releaseClientViewClaim = (targetType: ViewTargetType, targetId: string) => {
    const key = clientViewKey(targetType, targetId);
    const rest = { ...viewDedupeRef.current };
    delete rest[key];
    persistClientViewDedupe(rest);
  };

  useEffect(() => {
    const dedupe = readClientViewDedupe(currentProfile.handle);
    viewDedupeRef.current = dedupe;
    persistClientViewDedupe(dedupe, currentProfile.handle);
  }, [currentProfile.handle]);

  useEffect(() => {
    selectedProfileNameRef.current = selectedProfileName;
  }, [selectedProfileName]);

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId;
  }, [selectedItemId]);

  useEffect(() => {
    selectedCommentIdRef.current = selectedCommentId;
  }, [selectedCommentId]);

  useEffect(() => {
    commentSegmentStacksRef.current = commentSegmentStacks;
  }, [commentSegmentStacks]);

  useEffect(() => {
    activityRecencyRef.current = activityRecency;
  }, [activityRecency]);

  const getPublishedRecency = (item: InquiryItem) => itemTimestampScore(item);
  const profileActivityKey = (handle: string, action: PostAction, itemId: string) =>
    `profile:${cleanHandle(handle)}:${action}:${itemId}`;
  const profileCommentActivityKey = (
    handle: string,
    action: Exclude<ProfileCommentActivityKind, "comments">,
    itemId: string,
    commentId: string
  ) => `profile:${cleanHandle(handle)}:${action}:${itemId}:comment:${commentId}`;
  const getProfileRecency = (item: InquiryItem, handle: string, kind: ProfileActivityKind) => {
    if (kind === "authored") return getPublishedRecency(item);
    if (kind === "comments") return activityRecency[item.id] ?? getPublishedRecency(item);
    return activityRecency[profileActivityKey(handle, kind, item.id)] ?? getPublishedRecency(item);
  };
  const getProfileCommentRecency = (
    item: InquiryItem,
    comment: InquiryComment,
    handle: string,
    kind: ProfileCommentActivityKind
  ) => {
    if (kind === "comments" || !comment.id) {
      return commentTimestampScore(comment) || getPublishedRecency(item);
    }

    const fallbackRecency = commentTimestampScore(comment) || getPublishedRecency(item);
    return activityRecency[profileCommentActivityKey(handle, kind, item.id, comment.id)] ?? fallbackRecency;
  };
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

  const persistLocalSnapshot = (
    nextItems = items,
    nextProfiles = profiles,
    nextProfile = currentProfile,
    options?: { broadcastItemIds?: string[]; broadcastProfileHandles?: string[] }
  ) => {
    persistCachedBootstrap(
      window.localStorage,
      { items: nextItems, profiles: nextProfiles, communities: communitiesRef.current },
      nextProfile.handle
    );

    const messages = itemMutationCoordinatorRef.current.publishChanges(
      nextItems,
      lastPersistedItemsRef.current,
      options?.broadcastItemIds
    );
    lastPersistedItemsRef.current = nextItems;
    const profileEntities = Object.values(nextProfiles).map(profileSyncEntity);
    const profileMessages = profileMutationCoordinatorRef.current.publishChanges(
      profileEntities,
      lastPersistedProfilesRef.current,
      options?.broadcastProfileHandles
    );
    lastPersistedProfilesRef.current = profileEntities;

    for (const message of messages) {
      publishCrossTabItem(message);
    }
    for (const message of profileMessages) {
      publishCrossTabProfile(message);
    }
  };

  const publishCrossTabItem = useCrossTabItemTransport<CrossTabItemMessage<InquiryItem>>({
    channelName: "symposium-item-sync-v1",
    isMessage: isCrossTabInquiryItemMessage,
    onMessage: (message) => {
      const received = itemMutationCoordinatorRef.current.receive(message, itemsRef.current);
      if (!received.accepted) return;
      const nextItems = sortByPublishedRecency(received.items);
      replaceItems(nextItems);
      lastPersistedItemsRef.current = nextItems;
      persistCachedBootstrap(
        window.localStorage,
        { items: nextItems, profiles: profilesRef.current, communities: communitiesRef.current },
        currentProfileRef.current.handle
      );
    },
    storageKey: "symposium-cross-tab-item"
  });

  const publishCrossTabProfile = useCrossTabItemTransport<CrossTabItemMessage<ProfileSyncEntity>>({
    channelName: "symposium-profile-sync-v1",
    isMessage: isCrossTabProfileMessage,
    onMessage: (message) => {
      const currentEntities = Object.values(profilesRef.current).map(profileSyncEntity);
      const received = profileMutationCoordinatorRef.current.receive(message, currentEntities);
      if (!received.accepted) return;
      const nextProfiles = Object.fromEntries(
        received.items.map((entity) => [entity.handle, researchProfileFromSyncEntity(entity)])
      );
      const currentHandle = currentProfileRef.current.handle;
      const previousCurrent = profilesRef.current[currentHandle];
      const nextCurrent = nextProfiles[currentHandle] ?? currentProfileRef.current;
      profilesRef.current = nextProfiles;
      currentProfileRef.current = nextCurrent;
      setProfiles(nextProfiles);
      setCurrentProfile(nextCurrent);
      lastPersistedProfilesRef.current = received.items;

      let nextItems = itemsRef.current;
      if (JSON.stringify(previousCurrent) !== JSON.stringify(nextCurrent)) {
        nextItems = itemsRef.current.map((item) => ({
          ...item,
          author: item.authorHandle === nextCurrent.handle ? nextCurrent.name : item.author,
          comments: updateCommentsForProfile(item.comments, nextCurrent)
        }));
        replaceItems(nextItems);
        lastPersistedItemsRef.current = nextItems;
      }
      persistCachedBootstrap(
        window.localStorage,
        { items: nextItems, profiles: nextProfiles, communities: communitiesRef.current },
        nextCurrent.handle
      );
    },
    storageKey: "symposium-cross-tab-profile"
  });

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.newValue) return;
      if (
        event.key.startsWith("symposium-following-") &&
        !event.key.startsWith("symposium-following-lease:")
      ) {
        const handle = event.key.slice("symposium-following-".length);
        try {
          const storedHandles = (JSON.parse(event.newValue) as string[]).map(cleanHandle).filter(Boolean);
          const nextHandles = followMutationCoordinatorRef.current.protectFollowing(handle, storedHandles);
          setProfileSocialLists((current) => ({
            ...current,
            [handle]: { following: nextHandles, followers: current[handle]?.followers ?? [] }
          }));
          if (handle === currentProfileRef.current.handle) setFollowingHandles(nextHandles);
        } catch {
          // Ignore malformed following state.
        }
        return;
      }
      if (event.key === "symposium-local-snapshot") {
        const snapshot = readCachedBootstrapSnapshot(window.localStorage);
        if (!snapshot) return;
        if (snapshot.communities?.length) {
          communitiesRef.current = snapshot.communities;
          setCommunities(snapshot.communities);
        }
        const currentHandle = currentProfileRef.current.handle;
        const previousCurrent = profilesRef.current[currentHandle];
        const revisionSafeProfiles = Object.fromEntries(
          Object.entries(snapshot.profiles).map(([handle, incoming]) => [
            handle,
            researchProfileFromSyncEntity(
              profileMutationCoordinatorRef.current.protectIncomingItem(
                profileSyncEntity(incoming),
                profilesRef.current[handle] ? profileSyncEntity(profilesRef.current[handle]) : undefined
              )
            )
          ])
        );
        const nextProfiles = revisionSafeProfiles;
        profilesRef.current = nextProfiles;
        setProfiles(nextProfiles);
        const current = nextProfiles[currentHandle];
        if (current) {
          currentProfileRef.current = current;
          setCurrentProfile(current);
          if (JSON.stringify(previousCurrent) !== JSON.stringify(current)) {
            const nextItems = itemsRef.current.map((item) => ({
              ...item,
              author: item.authorHandle === current.handle ? current.name : item.author,
              comments: updateCommentsForProfile(item.comments, current)
            }));
            replaceItems(nextItems);
            lastPersistedItemsRef.current = nextItems;
          }
        }
        return;
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const followingStorageKey = (handle: string) => `symposium-following-${handle}`;

  const readLocalFollowing = (handle: string) => {
    try {
      const raw = window.localStorage.getItem(followingStorageKey(handle));
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      return parsed.map(cleanHandle).filter(Boolean);
    } catch {
      return [];
    }
  };

  const persistLocalFollowing = (handle: string, handles: string[]) => {
    window.localStorage.setItem(
      followingStorageKey(handle),
      JSON.stringify(Array.from(new Set(handles.map(cleanHandle).filter(Boolean))))
    );
  };

  const applySocialLists = (handle: string, lists: ProfileSocialLists, persist = true) => {
    const normalizedHandle = cleanHandle(handle);
    const normalizedLists = {
      following: Array.from(new Set(lists.following.map(cleanHandle).filter((candidate) => candidate !== "@"))),
      followers: Array.from(new Set(lists.followers.map(cleanHandle).filter((candidate) => candidate !== "@")))
    };
    setProfileSocialLists((current) => ({
      ...current,
      [normalizedHandle]: normalizedLists
    }));
    if (persist) {
      persistCachedProfileSocial(window.localStorage, {
        viewerHandle: currentProfileRef.current.handle,
        targetHandle: normalizedHandle,
        lists: normalizedLists
      });
    }
  };

  const captureFollowRevisions = (data: ProfileFollowResponse) => {
    for (const record of [...(data.following ?? []), ...(data.followers ?? [])]) {
      followMutationCoordinatorRef.current.observe({
        ...record,
        followerHandle: cleanHandle(String(record.followerHandle ?? "")),
        followingHandle: cleanHandle(String(record.followingHandle ?? ""))
      });
    }
  };

  const socialListsFromResponse = (data: ProfileFollowResponse, ownerHandle: string): ProfileSocialLists => {
    const coordinator = followMutationCoordinatorRef.current;
    const normalizedOwner = cleanHandle(ownerHandle);
    const following = Array.from(
      new Set(
        (data.following ?? []).flatMap((follow) => {
          const normalized = {
            ...follow,
            followerHandle: cleanHandle(String(follow.followerHandle ?? "")),
            followingHandle: cleanHandle(String(follow.followingHandle ?? ""))
          };
          if (!coordinator.observe(normalized) || normalized.status !== "active") return [];
          return normalized.followingHandle ? [normalized.followingHandle] : [];
        })
      )
    );
    const followers = Array.from(
      new Set(
        (data.followers ?? []).flatMap((follow) => {
          const normalized = {
            ...follow,
            followerHandle: cleanHandle(String(follow.followerHandle ?? "")),
            followingHandle: cleanHandle(String(follow.followingHandle ?? ""))
          };
          if (!coordinator.observe(normalized) || normalized.status !== "active") return [];
          return normalized.followerHandle ? [normalized.followerHandle] : [];
        })
      )
    );
    return {
      following: coordinator.protectFollowing(normalizedOwner, following),
      followers: coordinator.protectFollowers(normalizedOwner, followers)
    };
  };

  const markLiveDataConnected = () => {
    setSyncStatus((status) =>
      status === liveStatus.loading ||
      status === liveStatus.reconnecting ||
      status === liveStatus.legacyConnected
        ? liveStatus.connected
        : status
    );
  };

  const markLiveUpdatesReconnecting = () => {
    setSyncStatus((status) =>
      status === liveStatus.loading ||
      status === liveStatus.connected ||
      status === liveStatus.reconnecting ||
      status === liveStatus.legacyConnected
        ? liveStatus.reconnecting
        : status
    );
  };

  const refreshData = async (preferredHandle = currentProfile.handle) => {
    const mutationSnapshot = itemMutationCoordinatorRef.current.capture();
    const data = await symposiumApi.request<{
      items: InquiryItem[];
      profiles: Record<string, ResearchProfile>;
      communities?: ResearchCommunity[];
      communityCalls?: typeof communityCalls;
      defaultProfile: ResearchProfile;
    }>(`/api/bootstrap?actorHandle=${encodeURIComponent(preferredHandle)}`, { cache: "no-store" });
    const incomingProfiles = Object.keys(data.profiles).length
      ? data.profiles
      : { [data.defaultProfile.handle]: data.defaultProfile };
    let loadedProfiles = { ...profilesRef.current, ...incomingProfiles };
    loadedProfiles = Object.fromEntries(
      Object.entries(loadedProfiles).map(([handle, incoming]) => [
        handle,
        researchProfileFromSyncEntity(
          profileMutationCoordinatorRef.current.protectIncomingItem(
            profileSyncEntity(incoming),
            profilesRef.current[handle] ? profileSyncEntity(profilesRef.current[handle]) : undefined
          )
        )
      ])
    );
    const nextProfile = selectActiveProfile({
      profiles: loadedProfiles,
      defaultProfile: data.defaultProfile,
      authenticatedHandle: authenticatedProfileHandleRef.current,
      authenticatedProfile: currentProfileRef.current,
      preferredHandle
    });

    const currentById = new Map(itemsRef.current.map((item) => [item.id, item]));
    const normalizedItems = sortByPublishedRecency(
      normalizeClientSeedTimes(data.items).map((rawIncoming) => {
        const current = currentById.get(rawIncoming.id);
        const incoming = preservePostSemanticProjection(rawIncoming, current);
        const comparison = compareEntityRevisions(incoming, current);
        if (current && comparison !== null && comparison < 0) return current;
        return reconcileBoundedReadItem(incoming, current, nextProfile.handle);
      })
    );
    for (const incoming of normalizedItems) {
      if (!itemMutationCoordinatorRef.current.changedSince(mutationSnapshot, incoming.id)) {
        settleFreshItemActionState(incoming, nextProfile.handle);
      }
    }
    const incomingIds = new Set(normalizedItems.map((item) => item.id));
    const refreshInput = [
      ...normalizedItems,
      ...itemsRef.current.filter((item) => !incomingIds.has(item.id))
    ];
    const crossTabSafeItems = sortByPublishedRecency(
      itemMutationCoordinatorRef.current.reconcileRefresh(
        refreshInput,
        itemsRef.current,
        mutationSnapshot
      )
    );
    const loadedItems = protectItemsFromStaleActionState(
      crossTabSafeItems,
      itemsRef.current,
      nextProfile.handle
    );
    profilesRef.current = loadedProfiles;
    currentProfileRef.current = nextProfile;
    const loadedCommunities = data.communities?.length ? data.communities : communitiesRef.current;
    communitiesRef.current = loadedCommunities;
    replaceItems(loadedItems);
    setProfiles(loadedProfiles);
    setCurrentProfile(nextProfile);
    setCommunities(loadedCommunities);
    if (data.communityCalls) setCommunityCalls(data.communityCalls);
    persistLocalSnapshot(loadedItems, loadedProfiles, nextProfile);
    setSyncStatus(liveStatus.connected);
  };

  const refreshFollowing = async (actorHandle = currentProfile.handle) => {
    const cached = readLocalFollowing(actorHandle);
    if (cached.length) setFollowingHandles(cached);

    const data = await symposiumApi.request<ProfileFollowResponse>(
      `/api/follows?actorHandle=${encodeURIComponent(actorHandle)}`,
      { cache: "no-store" }
    );
    captureFollowRevisions(data);
    const lists = socialListsFromResponse(data, actorHandle);
    const remoteHandles = lists.following;

    setFollowingHandles(remoteHandles);
    applySocialLists(actorHandle, lists);
    persistLocalFollowing(actorHandle, remoteHandles);
  };

  const refreshProfileFollows = async (handle: string) => {
    const normalizedHandle = cleanHandle(handle);
    if (!normalizedHandle) return;

    const data = await symposiumApi.request<ProfileFollowResponse>(
      `/api/profiles/${encodeURIComponent(normalizedHandle)}/follows`,
      { cache: "no-store" }
    );
    captureFollowRevisions(data);
    applySocialLists(normalizedHandle, socialListsFromResponse(data, normalizedHandle));
  };

  const mergeLiveItem = (incoming: InquiryItem) => {
    const currentItems = itemsRef.current;
    const existingIndex = currentItems.findIndex((item) => item.id === incoming.id);
    const currentItem = existingIndex >= 0 ? currentItems[existingIndex] : undefined;
    const semanticIncoming = preservePostSemanticProjection(incoming, currentItem);
    const revisionComparison = compareEntityRevisions(semanticIncoming, currentItem);
    const canonicalIncomingIsNewer = (revisionComparison ?? 0) > 0;
    if (currentItem && revisionComparison === 0) return false;
    if (currentItem && itemMutationCoordinatorRef.current.isPending(incoming.id) && !canonicalIncomingIsNewer) {
      scheduleLiveRefresh();
      return false;
    }
    const crossTabProtected = itemMutationCoordinatorRef.current.protectIncomingItem(semanticIncoming, currentItem);
    const protectedIncoming = protectItemFromStaleActionState(
      crossTabProtected,
      currentItem,
      currentProfileRef.current.handle
    );
    const nextItem = preservePublishedPosition(protectedIncoming, currentItem);
    const nextItems =
      existingIndex >= 0
        ? currentItems.map((item) => (item.id === incoming.id ? nextItem : item))
        : sortByPublishedRecency([nextItem, ...currentItems]);

    replaceItems(nextItems);
    persistLocalSnapshot(nextItems, profilesRef.current, currentProfileRef.current);
    return true;
  };

  const mergeLiveProfile = (incoming: ResearchProfile) => {
    const handle = cleanHandle(incoming.handle);
    if (!handle || handle === "@") return false;
    const current = profilesRef.current[handle];
    const protectedEntity = profileMutationCoordinatorRef.current.protectIncomingItem(
      profileSyncEntity({ ...incoming, handle }),
      current ? profileSyncEntity(current) : undefined
    );
    const nextProfile = researchProfileFromSyncEntity(protectedEntity);
    if (current && JSON.stringify(current) === JSON.stringify(nextProfile)) return false;
    if ((compareEntityRevisions(nextProfile, current) ?? 0) > 0) {
      profileMutationCoordinatorRef.current.complete(handle);
    }

    const nextProfiles = { ...profilesRef.current, [handle]: nextProfile };
    const nextItems = itemsRef.current.map((item) => ({
      ...item,
      author: item.authorHandle === handle ? nextProfile.name : item.author,
      comments: updateCommentsForProfile(item.comments, nextProfile)
    }));
    profilesRef.current = nextProfiles;
    setProfiles(nextProfiles);
    if (currentProfileRef.current.handle === handle) {
      currentProfileRef.current = nextProfile;
      setCurrentProfile(nextProfile);
    }
    replaceItems(nextItems);
    persistLocalSnapshot(nextItems, nextProfiles, currentProfileRef.current, {
      broadcastProfileHandles: [handle]
    });
    return true;
  };

  const mergeBoundedRead = (data: {
    items: InquiryItem[];
    profiles?: Record<string, ResearchProfile>;
  }, options: { persist?: boolean } = {}) => {
    let nextProfiles = profilesRef.current;
    if (data.profiles && Object.keys(data.profiles).length) {
      nextProfiles = { ...profilesRef.current };
      for (const [rawHandle, incoming] of Object.entries(data.profiles)) {
        const handle = cleanHandle(rawHandle);
        if (!handle || handle === "@") continue;
        const current = nextProfiles[handle];
        const protectedEntity = profileMutationCoordinatorRef.current.protectIncomingItem(
          profileSyncEntity({ ...incoming, handle }),
          current ? profileSyncEntity(current) : undefined
        );
        nextProfiles[handle] = researchProfileFromSyncEntity(protectedEntity);
      }
    }

    const nextById = new Map(itemsRef.current.map((item) => [item.id, item]));
    for (const rawIncoming of normalizeClientSeedTimes(data.items)) {
      const current = nextById.get(rawIncoming.id);
      const incoming = preservePostSemanticProjection(rawIncoming, current);
      const comparison = compareEntityRevisions(incoming, current);
      if (current && comparison !== null && comparison < 0) continue;

      const next = reconcileBoundedReadItem(incoming, current, currentProfileRef.current.handle);
      nextById.set(next.id, next);
    }

    const nextItems = sortByPublishedRecency([...nextById.values()]);
    profilesRef.current = nextProfiles;
    setProfiles(nextProfiles);
    replaceItems(nextItems);
    if (options.persist !== false) {
      persistLocalSnapshot(nextItems, nextProfiles, currentProfileRef.current);
    }
  };

  const setFeedPageState = (key: string, next: FeedPageState) => {
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
        actorHandle: currentProfileRef.current.handle
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
      setFeedPageState(key, { initialized: true, loading: false, nextCursor: page.nextCursor });
    } catch (error) {
      setFeedPageState(key, {
        initialized: current?.initialized ?? false,
        loading: false,
        nextCursor: current?.nextCursor ?? null
      });
      throw error;
    }
  };

  const mergeLiveMetricPatch = (payload: LiveEventPayload) => {
    if (!payload.itemId || !payload.metrics || typeof payload.metrics !== "object") return false;
    const applyMetricPatch = <T extends { signal: string; forks: string; saves: string; reads: string }>(
      current: T
    ): T => ({
      ...current,
      signal: typeof payload.metrics?.signal === "string" ? payload.metrics.signal : current.signal,
      forks: typeof payload.metrics?.forks === "string" ? payload.metrics.forks : current.forks,
      saves: typeof payload.metrics?.saves === "string" ? payload.metrics.saves : current.saves,
      reads: typeof payload.metrics?.reads === "string" ? payload.metrics.reads : current.reads
    });
    let changed = false;
    const nextItems = itemsRef.current.map((item) => {
      if (item.id !== payload.itemId) return item;
      const itemRevision = item.revision ?? 0;
      if (typeof payload.revision === "number" && itemRevision > payload.revision) return item;
      if (!payload.commentId) {
        changed = true;
        return {
          ...item,
          metrics: applyMetricPatch(item.metrics),
          revision: typeof payload.revision === "number" ? Math.max(itemRevision, payload.revision) : item.revision
        };
      }
      const mapped = mapCommentTree(item.comments, payload.commentId, (comment) => {
        const commentRevision = comment.revision ?? 0;
        if (typeof payload.commentRevision === "number" && commentRevision > payload.commentRevision) return comment;
        changed = true;
        return {
          ...comment,
          metrics: applyMetricPatch({ ...commentMetricsFallback, ...(comment.metrics ?? {}) }),
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
        revision: typeof payload.revision === "number" ? Math.max(itemRevision, payload.revision) : item.revision
      };
    });
    if (!changed) return false;
    replaceItems(nextItems);
    persistLocalSnapshot(nextItems, profilesRef.current, currentProfileRef.current);
    return true;
  };

  const mergeLiveFollow = (record: ProfileFollowRecord | undefined, active: boolean) => {
    const followerHandle = cleanHandle(String(record?.followerHandle ?? ""));
    const followingHandle = cleanHandle(String(record?.followingHandle ?? ""));
    if (!followerHandle || !followingHandle || followerHandle === "@" || followingHandle === "@") return;
    const normalizedRecord = {
      ...record,
      followerHandle,
      followingHandle,
      status: record?.status ?? (active ? "active" : "none")
    };
    if (!followMutationCoordinatorRef.current.observe(normalizedRecord)) return;
    const canonicalActive = normalizedRecord.status === "active";

    setProfileSocialLists((current) => {
      const followerLists = current[followerHandle] ?? { following: [], followers: [] };
      const followingLists = current[followingHandle] ?? { following: [], followers: [] };
      const nextFollowerFollowing = canonicalActive
        ? Array.from(new Set([...followerLists.following, followingHandle]))
        : followerLists.following.filter((handle) => handle !== followingHandle);
      const nextFollowingFollowers = canonicalActive
        ? Array.from(new Set([...followingLists.followers, followerHandle]))
        : followingLists.followers.filter((handle) => handle !== followerHandle);

      return {
        ...current,
        [followerHandle]: { ...followerLists, following: nextFollowerFollowing },
        [followingHandle]: { ...followingLists, followers: nextFollowingFollowers }
      };
    });

    if (followerHandle === currentProfileRef.current.handle) {
      setFollowingHandles((currentHandles) => {
        const storedHandles = readLocalFollowing(followerHandle);
        const merged = Array.from(new Set([...currentHandles, ...storedHandles]));
        const next = canonicalActive
          ? Array.from(new Set([...merged, followingHandle]))
          : merged.filter((handle) => handle !== followingHandle);
        persistLocalFollowing(followerHandle, next);
        return next;
      });
    }
  };

  const scheduleLiveRefresh = useCoalescedRefresh(() => {
    const handle = currentProfileRef.current.handle;
    const selectedKey = selectedProfileNameRef.current;
    const selected = selectedKey
      ? profilesRef.current[selectedKey]
        ?? Object.values(profilesRef.current).find((person) => person.name === selectedKey)
        ?? getProfileForName(selectedKey)
      : null;
    return [refreshData(handle), refreshFollowing(handle), refreshProfileActivity(handle, handle, "all", false, true),
      ...(selected?.handle ? [
        refreshProfileFollows(selected.handle),
        refreshProfileActivity(selected.handle, handle, profileActivityScopeForTab(profileActiveTab), false, true)
      ] : [])];
  });

  const scheduleProfileActivityRefresh = useCoalescedRefresh(() => {
    const viewerHandle = currentProfileRef.current.handle;
    const selectedKey = selectedProfileNameRef.current;
    const selected = selectedKey
      ? profilesRef.current[selectedKey]
        ?? Object.values(profilesRef.current).find((person) => person.name === selectedKey)
        ?? getProfileForName(selectedKey)
      : null;
    const requests = [refreshProfileActivity(viewerHandle, viewerHandle, "all", false, true)];
    if (selected?.handle && cleanHandle(selected.handle) !== cleanHandle(viewerHandle)) {
      requests.push(refreshProfileActivity(
        selected.handle,
        viewerHandle,
        profileActivityScopeForTab(profileActiveTab),
        false,
        true
      ));
    }
    return requests;
  });

  const invalidateLiveQuotedSource = (source: QuoteSelection) => {
    const current = itemsRef.current;
    const next = invalidateQuotedSource(current, source);
    const changedItemIds = next
      .filter((item, index) => item !== current[index])
      .map((item) => item.id);
    if (!changedItemIds.length) return;
    replaceItems(next);
    persistLocalSnapshot(next, profilesRef.current, currentProfileRef.current, {
      broadcastItemIds: changedItemIds
    });
  };

  const mergeLiveEvent = (event: SymposiumLiveEvent) => {
    const payload = event.payload ?? {};
    if (
      event.kind.startsWith("notification.") ||
      event.kind === "conversation.participant.removed" ||
      event.kind === "note.access.granted" ||
      event.kind === "note.access.revoked"
    ) {
      setNotificationRevision((revision) => revision + 1);
    }
    if (
      event.kind.startsWith("message.") ||
      event.kind.startsWith("conversation.") ||
      event.kind === "profile.blocked" ||
      event.kind === "profile.unblocked"
    ) {
      setMessagingEvents((current) => [...current, event].slice(-100));
      return;
    }
    if (payload.action && payload.metrics && !isLiveInquiryItem(payload.item)) {
      mergeLiveMetricPatch(payload);
      return;
    }
    if (event.kind === "post.deleted") {
      const deletedPostId = isLiveInquiryItem(payload.item)
        ? payload.item.id
        : typeof payload.itemId === "string"
          ? payload.itemId
          : event.subjectId;
      if (deletedPostId) {
        invalidateLiveQuotedSource({ sourceType: "post", sourceId: deletedPostId, sourcePostId: deletedPostId });
      }
      if (isLiveInquiryItem(payload.item)) {
        const deletedItem = payload.item;
        mergeLiveItem(deletedItem);
        setEditingPost((current) => (current?.id === deletedItem.id ? null : current));
        setEditingComment((current) => (current?.itemId === deletedItem.id ? null : current));
      } else {
        scheduleLiveRefresh();
      }
      scheduleProfileActivityRefresh();
      return;
    }

    if (event.kind === "comment.deleted" && typeof payload.commentId === "string") {
      const sourcePostId = isLiveInquiryItem(payload.item)
        ? payload.item.id
        : typeof payload.itemId === "string"
          ? payload.itemId
          : "";
      if (sourcePostId) {
        invalidateLiveQuotedSource({
          sourceType: "comment",
          sourceId: payload.commentId,
          sourcePostId
        });
      }
      setEditingComment((current) => (current?.commentId === payload.commentId ? null : current));
    }

    if (payload.follow || event.kind === "profile.followed" || event.kind === "profile.unfollowed") {
      mergeLiveFollow(payload.follow, event.kind !== "profile.unfollowed");
    }

    if (event.kind === "profile.updated" && isLiveResearchProfile(payload.profile)) {
      mergeLiveProfile(payload.profile);
      return;
    }

    if (isLiveInquiryItem(payload.item)) {
      const action = payload.action;
      if (action === "read") {
        mergeLiveItem(payload.item);
        return;
      }
      const canonicalActivity = isCanonicalActionActivity(payload.activity) ? payload.activity : null;
      if (canonicalActivity && !acceptCanonicalActivity(canonicalActivity)) return;
      if (
        !canonicalActivity &&
        action &&
        event.actorHandle &&
        cleanHandle(event.actorHandle) === cleanHandle(currentProfileRef.current.handle)
      ) {
        const eventTimestamp = event.createdAt ? Date.parse(event.createdAt) : Number.NaN;
        const profileActivityTimestamp = Number.isFinite(eventTimestamp) ? eventTimestamp : Date.now();
        if (typeof payload.commentId === "string") {
          const key = `${payload.item.id}:${payload.commentId}:${action}:${currentProfileRef.current.handle}`;
          const desired = protectedDesiredActionState(key);
          const eventComment = findCommentById(payload.item.comments, payload.commentId);
          const serverActive = eventComment
            ? commentActionActive(eventComment, action, currentProfileRef.current.handle)
            : undefined;
          if (desired !== undefined && serverActive !== desired) return;
          touchProfileCommentAction(
            payload.item.id,
            payload.commentId,
            action,
            currentProfileRef.current.handle,
            profileActivityTimestamp
          );
        } else {
          const key = `${payload.item.id}:${action}:${currentProfileRef.current.handle}`;
          const desired = protectedDesiredActionState(key);
          const serverActive = itemActionActive(payload.item, action, currentProfileRef.current.handle);
          if (desired !== undefined && serverActive !== desired) return;
          touchProfileAction(
            payload.item.id,
            action,
            currentProfileRef.current.handle,
            profileActivityTimestamp
          );
        }
      }

      mergeLiveItem(payload.item);
      scheduleProfileActivityRefresh();
      return;
    }

    if (
      event.kind.startsWith("post.") ||
      event.kind.startsWith("comment.") ||
      event.kind.startsWith("profile.") ||
      event.kind.startsWith("community.") ||
      event.kind.startsWith("note.")
      || event.kind.startsWith("opportunity.application.")
      || event.kind.startsWith("scribble.")
    ) {
      if (event.kind.startsWith("note.")) {
        window.dispatchEvent(new Event("symposium-workspace-change"));
      }
      if (event.kind.startsWith("scribble.")) {
        const scribbleRevision = (payload as Record<string, unknown>).revision;
        window.dispatchEvent(new CustomEvent("symposium-scribble-change", {
          detail: { revision: typeof scribbleRevision === "number" ? scribbleRevision : undefined }
        }));
      }
      if (event.kind.startsWith("opportunity.application.")) {
        window.dispatchEvent(new Event("symposium-opportunity-applications-change"));
      }
      scheduleLiveRefresh();
    }
  };

  const applyInitialRouteState = () => {
    const snapshot = snapshotForCanonicalRoute(
      initialRoute,
      (postId) => itemsRef.current.find((item) => item.id === postId)?.room
    );
    setActiveRoom(snapshot.activeRoom);
    setSelectedItemId(snapshot.selectedItemId);
    setApplicationReviewPostId(snapshot.applicationReviewPostId);
    setSelectedApplicationId(snapshot.selectedApplicationId);
    setSelectedCommentId(snapshot.selectedCommentId);
    setDetailOrigin(snapshot.detailOrigin);
    setSelectedProfileName(snapshot.selectedProfileName);
    setProfileSocialView(snapshot.profileSocialView);
    setProfileActiveTab(snapshot.profileTab);
    setOfficeMode(snapshot.officeMode);
    setWorkspaceView(snapshot.workspaceView);
    setSelectedCommunityId(snapshot.selectedCommunityId);
    setMessagesOpen(snapshot.messagesOpen);
    setSelectedConversationId(snapshot.selectedConversationId);
    commentSegmentStacksRef.current = {};
    visibleCommentSegmentStacksRef.current = {};
    setCommentSegmentStacks({});
    resetHistory();
  };

  const hydrateCachedBootstrap = (storedProfileHandle: string | null) => {
    const cached = resolveCachedBootstrap({
      fallbackProfile: profile,
      preferredHandle: storedProfileHandle,
      seedItems: initialBoundedInquiryItems,
      snapshot: readCachedBootstrapSnapshot(window.localStorage)
    });
    const cachedItems = sortByPublishedRecency(normalizeClientSeedTimes(cached.items));
    lastPersistedItemsRef.current = cachedItems;
    profilesRef.current = cached.profiles;
    currentProfileRef.current = cached.currentProfile;
    if (cached.communities?.length) {
      communitiesRef.current = cached.communities;
      setCommunities(cached.communities);
    }
    setProfiles(cached.profiles);
    replaceItems(cachedItems);
    setCurrentProfile(cached.currentProfile);
  };

  useLiveEventStream<SymposiumLiveEvent>({
    authSessionKey: authLoaded ? (isSignedIn ? userId ?? "signed-in" : "anonymous") : "loading",
    backendUrl: liveBackendUrl,
    enabled: entryMode !== "loading",
    getAccessToken: auth.getAccessToken,
    onConnected: markLiveDataConnected,
    onEvent: mergeLiveEvent,
    onMalformedEvent: scheduleLiveRefresh,
    onReconnecting: markLiveUpdatesReconnecting
  });

  useLayoutEffect(() => {
    if (shouldPlayEntrance === null) return;
    const storedTheme = window.localStorage.getItem("symposium-theme") as Theme | null;
    const storedProfileHandle = window.localStorage.getItem("symposium-profile-handle");

    if (storedTheme === "day" || storedTheme === "night") {
      setTheme(storedTheme);
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setTheme("night");
    }
    try {
      const storedActivityRecency = JSON.parse(
        window.localStorage.getItem("symposium-activity-recency") ?? "{}"
      ) as Record<string, number>;
      activityRecencyRef.current = storedActivityRecency;
      setActivityRecency(storedActivityRecency);
    } catch {
      activityRecencyRef.current = {};
      setActivityRecency({});
    }
    hydrateCachedBootstrap(storedProfileHandle);
    const sessionEntryMode = entryModeForBrowserSession(shouldPlayEntrance);
    setEntryMode(sessionEntryMode);
    if (sessionEntryMode === "approach") entranceStartedAtRef.current = Date.now();
    if (sessionEntryMode === "complete") {
      applyInitialRouteState();
      window.sessionStorage.setItem("symposium-entry-complete", "true");
    }
    setBrowserReadStateHydrated(true);

    if (!clerkEnabled) {
      refreshData(storedProfileHandle ?? undefined).catch(() => {
        setSyncStatus("Using seed data");
      });
    }
  }, [shouldPlayEntrance]);

  useEffect(() => {
    if (!signedIn || !currentProfile.handle) return;

    let cancelled = false;
    const cached = readLocalFollowing(currentProfile.handle);
    setFollowingHandles(cached);
    applySocialLists(currentProfile.handle, {
      following: cached,
      followers: profileSocialLists[currentProfile.handle]?.followers ?? []
    });

    refreshFollowing(currentProfile.handle).catch(() => {
      if (!cancelled) setFollowingHandles(cached);
    });

    return () => {
      cancelled = true;
    };
  }, [currentProfile.handle, signedIn]);

  useEffect(() => {
    if (!readSessionReady || !selectedProfile?.handle) return;
    void refreshProfileFollows(selectedProfile.handle);
  }, [readSessionReady, selectedProfile?.handle]);

  useEffect(() => {
    if (entryMode !== "approach" || shouldPlayEntrance !== true) return undefined;

    const startedAt = entranceStartedAtRef.current ?? Date.now();
    entranceStartedAtRef.current = startedAt;
    const timer = window.setTimeout(() => {
      const latestAuth = entryAuthStateRef.current;
      if (latestAuth.accountSynced || latestAuth.browserSignedIn) {
        window.sessionStorage.setItem("symposium-entry-complete", "true");
        setEntryMode("complete");
        applyInitialRouteState();
      } else {
        setEntryMode("auth");
      }
    }, Math.max(0, startedAt + 5000 - Date.now()));

    return () => window.clearTimeout(timer);
  }, [entryMode, shouldPlayEntrance]);

  useEffect(() => {
    if (!clerkEnabled) return;
    if (!authLoaded) return;

    if (!isSignedIn) {
      setSignedIn(false);
      setSyncedClerkUserId(null);
      authenticatedProfileHandleRef.current = null;
      window.localStorage.removeItem("symposium-auth-handle");
      window.localStorage.removeItem("symposium-auth-records");
      return;
    }

    if (!userId || syncedClerkUserId === userId) return;

    let cancelled = false;
    const cachedIdentity = readCachedIdentity(window.localStorage, userId);
    if (cachedIdentity) {
      authenticatedProfileHandleRef.current = cachedIdentity.handle;
      currentProfileRef.current = cachedIdentity;
      const cachedProfiles = { ...profilesRef.current, [cachedIdentity.handle]: cachedIdentity };
      profilesRef.current = cachedProfiles;
      setProfiles(cachedProfiles);
      setCurrentProfile(cachedIdentity);
      setSignedIn(true);
    }

    const syncAccount = async () => {
      setSyncStatus("Syncing account");
      setAuthError("");
      const data = await symposiumApi.request<{ profile: ResearchProfile }>("/api/auth/sync", {
        method: "POST"
      });
      if (cancelled) return;

      authenticatedProfileHandleRef.current = data.profile.handle;
      currentProfileRef.current = data.profile;
      const nextProfiles = { ...profilesRef.current, [data.profile.handle]: data.profile };
      profilesRef.current = nextProfiles;
      setProfiles(nextProfiles);
      setCurrentProfile(data.profile);
      setSignedIn(true);
      setSyncedClerkUserId(userId);
      persistCachedIdentity(window.localStorage, userId, data.profile);
      if (shouldCompleteEntryAfterAccountSync(entryModeRef.current)) {
        setEntryMode("complete");
        applyInitialRouteState();
      }
      window.sessionStorage.setItem("symposium-entry-complete", "true");
      window.localStorage.setItem("symposium-profile-handle", data.profile.handle);
      setSyncStatus("Signed in");
      void refreshData(data.profile.handle).catch(() => {
        if (!cancelled) setSyncStatus("Using cached data");
      });
    };

    syncAccount().catch((error) => {
      if (cancelled) return;
      setAuthError(error instanceof Error ? error.message : "Could not sync your account.");
      setSyncStatus("Account sync failed");
    });

    return () => {
      cancelled = true;
    };
  }, [authLoaded, clerkEnabled, isSignedIn, syncedClerkUserId, userId]);

  useEffect(() => {
    if (!clerkEnabled || !authLoaded || isSignedIn || entryMode !== "complete") return;
    window.sessionStorage.removeItem("symposium-entry-complete");
    setEntryMode("auth");
  }, [authLoaded, clerkEnabled, entryMode, isSignedIn]);

  useEffect(() => {
    window.localStorage.setItem("symposium-theme", theme);
  }, [theme]);


  const persistActivityRecency = (next: Record<string, number>) => {
    activityRecencyRef.current = next;
    window.localStorage.setItem("symposium-activity-recency", JSON.stringify(next));
  };

  const recordActivityRecency = (updates: Record<string, number>, deferForProfile = false) => {
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => Number.isFinite(value))
    ) as Record<string, number>;
    if (!Object.keys(cleanUpdates).length) return;

    if (deferForProfile) {
      pendingActivityRecencyRef.current = { ...pendingActivityRecencyRef.current, ...cleanUpdates };
      persistActivityRecency({ ...activityRecencyRef.current, ...pendingActivityRecencyRef.current });
      return;
    }

    const pendingUpdates = pendingActivityRecencyRef.current;
    pendingActivityRecencyRef.current = {};
    setActivityRecency((current) => {
      const next = { ...current, ...pendingUpdates, ...cleanUpdates };
      persistActivityRecency(next);
      return next;
    });
  };

  const flushPendingActivityRecency = () => {
    const pendingUpdates = pendingActivityRecencyRef.current;
    if (!Object.keys(pendingUpdates).length) {
      setProfileActivityRevision((revision) => revision + 1);
      return;
    }

    pendingActivityRecencyRef.current = {};
    setActivityRecency((current) => {
      const next = { ...current, ...pendingUpdates };
      persistActivityRecency(next);
      return next;
    });
    setProfileActivityRevision((revision) => revision + 1);
  };

  const touchActivity = (itemId: string, timestamp = Date.now()) => {
    recordActivityRecency({ [itemId]: timestamp });
  };

  const touchProfileAction = (itemId: string, action: PostAction, handle = currentProfile.handle, timestamp = Date.now()) => {
    if (action === "read") return;
    recordActivityRecency(
      { [profileActivityKey(handle, action, itemId)]: timestamp },
      Boolean(selectedProfileNameRef.current)
    );
  };

  const touchProfileCommentAction = (
    itemId: string,
    commentId: string,
    action: CommentAction,
    handle = currentProfile.handle,
    timestamp = Date.now()
  ) => {
    if (action === "read") return;
    recordActivityRecency(
      { [profileCommentActivityKey(handle, action, itemId, commentId)]: timestamp },
      Boolean(selectedProfileNameRef.current)
    );
  };

  const setProfileActivitySnapshot = (handle: string, snapshot: ProfileActivitySnapshot) => {
    const clean = cleanHandle(handle);
    const next = { ...profileActivityByHandleRef.current, [clean]: snapshot };
    profileActivityByHandleRef.current = next;
    setProfileActivityByHandle(next);
  };

  const canonicalActivityRecencyUpdate = (activity: CanonicalActionActivityContract) => {
    if (!activity.active) return null;
    const timestamp = Date.parse(activity.occurredAt);
    if (!Number.isFinite(timestamp)) return null;
    if (activity.subjectType === "comment") {
      return {
        [profileCommentActivityKey(
          activity.actorHandle,
          activity.action,
          activity.postId,
          activity.subjectId
        )]: timestamp
      };
    }
    return { [profileActivityKey(activity.actorHandle, activity.action, activity.postId)]: timestamp };
  };

  const recordCanonicalActivityRecency = (activity: CanonicalActionActivityContract) => {
    const update = canonicalActivityRecencyUpdate(activity);
    if (update) recordActivityRecency(update, Boolean(selectedProfileNameRef.current));
  };

  const profileReshareAddsToAll = (activity: CanonicalActionActivityContract) => {
    if (activity.action !== "fork") return false;
    const item = itemsRef.current.find((candidate) => candidate.id === activity.postId);
    return Boolean(item && profileItemIsInActivityScope(item));
  };

  const acceptCanonicalActivity = (activity: CanonicalActionActivityContract) => {
    const key = canonicalActivityKey(activity);
    const currentRevision = canonicalActionRevisionRef.current[key] ?? 0;
    if (activity.revision < currentRevision) return false;

    pendingCanonicalActionKeysRef.current.delete(key);
    canonicalActionRevisionRef.current[key] = activity.revision;
    const handle = cleanHandle(activity.actorHandle);
    const current = profileActivityByHandleRef.current[handle]
      ?? emptyProfileActivitySnapshot();
    const previous = canonicalActionState(
      current.entries,
      activity.subjectType,
      activity.subjectId,
      handle,
      activity.action
    );
    setProfileActivitySnapshot(handle, {
      ...current,
      entries: mergeCanonicalActivities(current.entries, [activity]),
      totals: current.totals
        ? applyProfileActivityActionTotalTransition(
            current.totals,
            activity.action,
            previous?.active ?? false,
            activity.active,
            profileReshareAddsToAll(activity)
          )
        : undefined
    });
    recordCanonicalActivityRecency(activity);
    return true;
  };

  const replaceCanonicalProfileActivity = (
    handle: string,
    scope: ProfileActivityPageScope,
    requestedActions: ToggleActionContract[],
    response: ProfileActivityResponseContract,
    requestStartRevisions: Record<string, number>,
    append = false,
    stale = false
  ) => {
    const clean = cleanHandle(handle);
    const current = profileActivityByHandleRef.current[clean] ?? emptyProfileActivitySnapshot();
    const actionSet = new Set(requestedActions);
    const currentScopeEntries = current.entries.filter((activity) => actionSet.has(activity.action));
    const retainedEntries = current.entries.filter((activity) => !actionSet.has(activity.action));
    const reconciledScopeEntries = reconcileCanonicalActivityRefresh({
      current: currentScopeEntries,
      incoming: append ? mergeCanonicalActivities(currentScopeEntries, response.entries) : response.entries,
      pendingKeys: pendingCanonicalActionKeysRef.current,
      currentRevisions: canonicalActionRevisionRef.current,
      requestStartRevisions
    });
    const entries = mergeCanonicalActivities(retainedEntries, reconciledScopeEntries);
    const finalScopeKeys = new Set(reconciledScopeEntries.map(canonicalActivityKey));
    for (const activity of currentScopeEntries) {
      const key = canonicalActivityKey(activity);
      if (!finalScopeKeys.has(key)) delete canonicalActionRevisionRef.current[key];
    }
    const recencyUpdates: Record<string, number> = {};
    for (const activity of response.entries) {
      const key = canonicalActivityKey(activity);
      canonicalActionRevisionRef.current[key] = Math.max(
        canonicalActionRevisionRef.current[key] ?? 0,
        activity.revision
      );
      Object.assign(recencyUpdates, canonicalActivityRecencyUpdate(activity));
    }
    recordActivityRecency(recencyUpdates, Boolean(selectedProfileNameRef.current));
    setProfileActivitySnapshot(clean, {
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
      hiddenCommunityCounts: response.hiddenCommunityCounts ?? current.hiddenCommunityCounts,
      totals: response.totals ?? current.totals
    });
  };

  const refreshProfileActivity = (
    handle: string,
    actorHandle = currentProfileRef.current.handle,
    scope: ProfileActivityPageScope = "all",
    append = false,
    forceSummary = false
  ) => {
    const clean = cleanHandle(handle);
    const cleanActor = cleanHandle(actorHandle);
    if (!clean || clean === "@") return Promise.resolve();
    const existingSnapshot = profileActivityByHandleRef.current[clean] ?? emptyProfileActivitySnapshot();
    const existingPage = existingSnapshot.pages[scope];
    const configuredActions = profileActivityActionsForScope(scope);
    const commentMode = profileActivityCommentModeForScope(scope);
    const includeComments = commentMode !== "none";
    const startCursor = append ? existingPage?.nextCursor ?? null : null;
    const commentsCursor = append ? existingPage?.commentsNextCursor ?? null : null;
    const requestedActions = append && !startCursor ? [] : configuredActions;
    const requestComments = includeComments && (!append || Boolean(commentsCursor));
    const requestSummary = !append && (forceSummary || !existingSnapshot.totals);
    if (append && !requestedActions.length && !requestComments) return Promise.resolve();
    const inFlightKey = `${clean}:${cleanActor}:${scope}:${startCursor ?? "actions-end"}:${commentsCursor ?? "comments-end"}`;
    const existingRequest = profileActivityInFlightRef.current[inFlightKey];
    if (existingRequest) return existingRequest;
    const requestKey = `${clean}:${scope}`;
    const requestId = (profileActivityRequestRef.current[requestKey] ?? 0) + 1;
    profileActivityRequestRef.current[requestKey] = requestId;
    setProfileActivitySnapshot(clean, {
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
    setProfileActivityErrors((current) => {
      if (!current[clean]) return current;
      const next = { ...current };
      delete next[clean];
      return next;
    });

    const request = (async () => {
      const requestStartRevisions = { ...canonicalActionRevisionRef.current };
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
        data = await symposiumApi.request<Partial<ProfileActivityResponseContract>>(
          `/api/profiles/${encodeURIComponent(clean)}/activity?${params.toString()}`,
          { cache: "no-store", signal: controller.signal }
        );
      } finally {
        window.clearTimeout(timeout);
      }

      const entries = (data.entries ?? []).filter(isCanonicalActionActivity);
      const authoredComments = (data.authoredComments ?? []).filter(
        (activity): activity is ProfileAuthoredCommentActivityContract =>
          Boolean(
            activity &&
            typeof activity.commentId === "string" &&
            typeof activity.postId === "string" &&
            typeof activity.occurredAt === "string" &&
            Number.isFinite(Date.parse(activity.occurredAt))
          )
      );
      const hydrateSubjects = async (
        postIds: string[],
        commentIds: string[]
      ) => {
        if (!postIds.length) return;
        const postParameters = new URLSearchParams({
          ids: Array.from(new Set(postIds)).slice(0, 50).join(","),
          limit: String(postIds.length),
          actorHandle: cleanActor
        });
        if (commentIds.length) {
          postParameters.set("commentIds", Array.from(new Set(commentIds)).slice(0, 50).join(","));
        }
        return symposiumApi.request<PostPageResponseContract>(
          `/api/posts?${postParameters.toString()}`,
          { cache: "no-store" }
        );
      };
      if (data.items?.length || data.profiles) {
        mergeBoundedRead({
          items: data.items ?? [],
          profiles: data.profiles ?? {}
        });
      } else {
        const hydratedPages = await Promise.all([
          hydrateSubjects(
            entries.map((entry) => entry.postId),
            entries.filter((entry) => entry.subjectType === "comment").map((entry) => entry.subjectId)
          ),
          hydrateSubjects(
            authoredComments.map((activity) => activity.postId),
            authoredComments.map((activity) => activity.commentId)
          )
        ]);
        for (const page of hydratedPages) if (page) mergeBoundedRead(page);
      }

      if (profileActivityRequestRef.current[requestKey] !== requestId) return;
      const canonicalResponse = {
        entries,
        nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
        authoredComments,
        commentsNextCursor: typeof data.commentsNextCursor === "string" ? data.commentsNextCursor : null,
        hiddenCommunityCounts: data.hiddenCommunityCounts ?? existingSnapshot?.hiddenCommunityCounts ?? emptyProfileActivityCounts(),
        totals: data.totals ?? existingSnapshot?.totals,
        items: data.items,
        profiles: data.profiles
      } as ProfileActivityResponseContract;
      replaceCanonicalProfileActivity(clean, scope, requestedActions, canonicalResponse, requestStartRevisions, append);
      if (!append && (canonicalResponse.items || canonicalResponse.profiles)) {
        persistCachedProfileActivity(window.localStorage, {
          viewerHandle: cleanActor,
          targetHandle: clean,
          scope,
          response: canonicalResponse
        });
      }
    })().catch((error) => {
      if (profileActivityRequestRef.current[requestKey] === requestId) {
        setProfileActivityErrors((current) => ({ ...current, [clean]: true }));
        const latest = profileActivityByHandleRef.current[clean] ?? emptyProfileActivitySnapshot();
        setProfileActivitySnapshot(clean, {
          ...latest,
          pages: {
            ...latest.pages,
            [scope]: {
              loaded: latest.pages[scope]?.loaded ?? false,
              loading: false,
              nextCursor: latest.pages[scope]?.nextCursor ?? null,
              commentsNextCursor: latest.pages[scope]?.commentsNextCursor ?? null
            }
          }
        });
      }
      throw error;
    });

    const trackedRequest = request.finally(() => {
      if (profileActivityInFlightRef.current[inFlightKey] === trackedRequest) {
        delete profileActivityInFlightRef.current[inFlightKey];
      }
    });
    profileActivityInFlightRef.current[inFlightKey] = trackedRequest;
    return trackedRequest;
  };

  const stageOptimisticCanonicalActivity = (
    subjectType: "post" | "comment",
    subjectId: string,
    postId: string,
    actorHandle: string,
    action: ToggleActionContract,
    active: boolean
  ) => {
    const handle = cleanHandle(actorHandle);
    const current = profileActivityByHandleRef.current[handle]
      ?? emptyProfileActivitySnapshot();
    const previous = canonicalActionState(current.entries, subjectType, subjectId, handle, action);
    const key = canonicalActivityKey({ subjectType, subjectId, actorHandle: handle, action });
    pendingCanonicalActionKeysRef.current.add(key);
    const optimistic = {
      ...createLocalCanonicalActivity({ subjectType, subjectId, postId, actorHandle: handle, action, active }),
      revision: previous?.revision ?? 1
    };
    setProfileActivitySnapshot(handle, {
      ...current,
      entries: mergeCanonicalActivities(current.entries, [optimistic]),
      totals: current.totals
        ? applyProfileActivityActionTotalTransition(
            current.totals,
            action,
            previous?.active ?? false,
            active,
            profileReshareAddsToAll(optimistic)
          )
        : undefined
    });
    return previous;
  };

  const restoreOptimisticCanonicalActivity = (
    subjectType: "post" | "comment",
    subjectId: string,
    actorHandle: string,
    action: ToggleActionContract,
    previous: CanonicalActionActivityContract | undefined
  ) => {
    const handle = cleanHandle(actorHandle);
    const current = profileActivityByHandleRef.current[handle];
    if (!current) return;
    const key = canonicalActivityKey({ subjectType, subjectId, actorHandle: handle, action });
    pendingCanonicalActionKeysRef.current.delete(key);
    const optimistic = canonicalActionState(current.entries, subjectType, subjectId, handle, action);
    const subjectActivity = optimistic ?? previous;
    const entries = current.entries.filter((activity) => canonicalActivityKey(activity) !== key);
    if (previous) entries.push(previous);
    setProfileActivitySnapshot(handle, {
      ...current,
      entries: mergeCanonicalActivities([], entries),
      totals: current.totals
        ? applyProfileActivityActionTotalTransition(
            current.totals,
            action,
            optimistic?.active ?? false,
            previous?.active ?? false,
            subjectActivity ? profileReshareAddsToAll(subjectActivity) : false
          )
        : undefined
    });
  };

  const canonicalActionWasCommitted = (
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
      profileActivityByHandleRef.current[handle]?.entries ?? [],
      subjectType,
      subjectId,
      handle,
      action
    );
    const revision = canonicalActionRevisionRef.current[
      canonicalActivityKey({ subjectType, subjectId, actorHandle: handle, action })
    ] ?? 0;
    return current?.active === desiredActive && revision > (previous?.revision ?? 0);
  };

  useLayoutEffect(() => {
    if (entryMode !== "complete" || !readSessionReady || !selectedProfile?.handle) return;
    const targetHandle = cleanHandle(selectedProfile.handle);
    const viewerHandle = cleanHandle(currentProfile.handle);
    const scope = profileActivityScopeForTab(profileActiveTab);
    const cacheKey = `${viewerHandle}:${targetHandle}:${scope}`;
    if (profileActivityCacheHydrationRef.current.has(cacheKey)) return;
    profileActivityCacheHydrationRef.current.add(cacheKey);

    const social = readCachedProfileSocial(window.localStorage, { viewerHandle, targetHandle });
    if (social && !profileSocialLists[targetHandle]) applySocialLists(targetHandle, social, false);

    const currentPage = profileActivityByHandleRef.current[targetHandle]?.pages[scope];
    if (currentPage?.loaded) return;
    const cached = readCachedProfileActivity(window.localStorage, { viewerHandle, targetHandle, scope });
    if (!cached) return;
    mergeBoundedRead({ items: cached.items ?? [], profiles: cached.profiles ?? {} }, { persist: false });
    replaceCanonicalProfileActivity(
      targetHandle,
      scope,
      profileActivityActionsForScope(scope),
      cached,
      {},
      false,
      true
    );
  }, [
    currentProfile.handle,
    entryMode,
    profileActiveTab,
    profileSocialLists,
    readSessionReady,
    selectedProfile?.handle
  ]);

  useEffect(() => {
    if (entryMode !== "complete" || !readSessionReady || !currentProfile.handle) return;
    if (selectedProfile?.handle) return;
    const page = profileActivityByHandleRef.current[currentProfile.handle]?.pages.all;
    if (page?.loaded && !page.stale) return;
    void refreshProfileActivity(currentProfile.handle, currentProfile.handle, "all").catch(() => undefined);
  }, [currentProfile.handle, entryMode, readSessionReady, selectedProfile?.handle]);

  useEffect(() => {
    if (entryMode !== "complete" || !readSessionReady || !selectedProfile?.handle) return;
    const scope = profileActivityScopeForTab(profileActiveTab);
    const page = profileActivityByHandleRef.current[selectedProfile.handle]?.pages[scope];
    if (page?.loaded && !page.stale) return;
    void refreshProfileActivity(
      selectedProfile.handle,
      currentProfile.handle,
      scope,
      false,
      Boolean(page?.stale)
    ).catch(() => undefined);
  }, [currentProfile.handle, entryMode, profileActiveTab, readSessionReady, selectedProfile?.handle]);

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
    void symposiumApi.request<{ item: InquiryItem; profiles?: Record<string, ResearchProfile> }>(
      `/api/posts/${encodeURIComponent(postId)}?actorHandle=${encodeURIComponent(currentProfile.handle)}`,
      { cache: "no-store" }
    ).then((data) => {
      if (!cancelled) mergeBoundedRead({ items: [data.item], profiles: data.profiles });
    }).catch(() => {
      if (!cancelled) setSyncStatus("Post detail could not load");
    });
    return () => {
      cancelled = true;
    };
  }, [applicationReviewPostId, currentProfile.handle, readSessionReady, selectedItem?.detailLoaded, selectedItemId]);

  useEffect(() => {
    if (!readSessionReady || !selectedProfileHandle || selectedProfileHandle === "@") return;
    const stored = profilesRef.current[selectedProfileHandle];
    if (stored) return;
    let cancelled = false;
    void symposiumApi.request<{ profile: ResearchProfile }>(
      `/api/profiles/${encodeURIComponent(selectedProfileHandle)}`,
      { cache: "no-store" }
    ).then((data) => {
      if (!cancelled) mergeBoundedRead({ items: [], profiles: { [data.profile.handle]: data.profile } });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [readSessionReady, selectedProfileHandle]);

  useEffect(() => {
    if (!readSessionReady || !selectedProfileHandle || selectedProfileHandle === "@") return;
    if (!profileTabUsesAuthoredPosts(profileActiveTab)) return;
    const key = `profile:${selectedProfileHandle}:authored`;
    if (feedPagesRef.current[key]?.initialized) return;
    void loadPostPage(key, { authorHandle: selectedProfileHandle, limit: 24 }).catch(() => undefined);
  }, [profileActiveTab, readSessionReady, selectedProfileHandle]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || !query) {
      setRemoteSearchResults(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      const parameters = new URLSearchParams({
        q: query,
        limit: "16",
        actorHandle: currentProfile.handle
      });
      void symposiumApi.request<SearchResponseContract>(
        `/api/search?${parameters.toString()}`,
        { cache: "no-store" }
      ).then((data) => {
        if (cancelled) return;
        mergeBoundedRead({
          items: data.posts,
          profiles: Object.fromEntries(data.profiles.map((person) => [person.handle, person]))
        });
        const normalized = normalizeSearchPhrase(query);
        const titleMatches = data.posts.filter((item) => normalizeSearchPhrase(item.title).includes(normalized));
        const titleIds = new Set(titleMatches.map((item) => item.id));
        setRemoteSearchResults({
          titleMatches,
          contentMatches: data.posts.filter((item) => !titleIds.has(item.id)),
          profileMatches: data.profiles
        });
      }).catch(() => {
        if (!cancelled) setRemoteSearchResults(null);
      }).finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentProfile.handle, searchOpen, searchQuery]);

  useEffect(() => {
    const query = selectedCommunityFeedView.query.trim();
    if (activeRoom !== "communities" || !selectedCommunityId || !query) {
      setCommunitySearchResultIds(null);
      setCommunitySearchLoading(false);
      return;
    }

    let cancelled = false;
    setCommunitySearchResultIds(null);
    const timer = window.setTimeout(() => {
      setCommunitySearchLoading(true);
      const parameters = new URLSearchParams({
        q: query,
        limit: "50",
        communityId: selectedCommunityId,
        actorHandle: currentProfile.handle
      });
      void symposiumApi.request<SearchResponseContract>(
        `/api/search?${parameters.toString()}`,
        { cache: "no-store" }
      ).then((data) => {
        if (cancelled) return;
        mergeBoundedRead({
          items: data.posts,
          profiles: Object.fromEntries(data.profiles.map((person) => [person.handle, person]))
        });
        setCommunitySearchResultIds(data.posts.map((item) => item.id));
      }).catch(() => {
        if (!cancelled) setCommunitySearchResultIds(null);
      }).finally(() => {
        if (!cancelled) setCommunitySearchLoading(false);
      });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeRoom, currentProfile.handle, selectedCommunityFeedView.query, selectedCommunityId]);

  const updateCommentSegmentStack = (key: string, stack: string[]) => {
    setCommentSegmentStacks((current) => {
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
      activeRoom,
      selectedItemId,
      applicationReviewPostId,
      selectedApplicationId,
      selectedCommentId,
      selectedProfileName,
      profileSocialView,
      profileTab: selectedProfileName ? profileActiveTab : "all",
      officeMode,
      workspaceView,
      selectedCommunityId,
      messagesOpen,
      selectedConversationId,
      commentSegmentStacks: cloneCommentSegmentStacks({
        ...commentSegmentStacksRef.current,
        ...visibleCommentSegmentStacksRef.current,
        ...domSegmentStacks
      }),
      scrollAnchor,
      scrollY: window.scrollY,
      detailOrigin
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
    if (snapshot.selectedProfileName) flushPendingActivityRecency();
    setActiveRoom(snapshot.activeRoom);
    setSelectedItemId(snapshot.selectedItemId);
    setApplicationReviewPostId(snapshot.applicationReviewPostId ?? null);
    setSelectedApplicationId(snapshot.selectedApplicationId ?? null);
    setSelectedCommentId(snapshot.selectedCommentId);
    setDetailOrigin(snapshot.detailOrigin ?? null);
    setSelectedProfileName(snapshot.selectedProfileName);
    setProfileSocialView(snapshot.profileSocialView ?? null);
    setProfileActiveTab(snapshot.profileTab);
    setOfficeMode(snapshot.officeMode);
    setWorkspaceView(snapshot.workspaceView ?? {
      section: "all",
      selectedNotebookId: null,
      selectedDocumentId: null,
      editSelected: false,
      expandedNotebookIds: [],
      query: ""
    });
    setSelectedCommunityId(snapshot.selectedCommunityId);
    const restoredSegmentStacks = cloneCommentSegmentStacks(snapshot.commentSegmentStacks ?? {});
    commentSegmentStacksRef.current = restoredSegmentStacks;
    visibleCommentSegmentStacksRef.current = {};
    setCommentSegmentStacks(restoredSegmentStacks);
    setTabletOpen(false);
    setComposerOpen(false);
    setComposerCommunityId(null);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesQuickOpen(false);
    setMessagesOpen(snapshot.messagesOpen);
    setSelectedConversationId(snapshot.selectedConversationId ?? null);
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

  const navigateView = (
    next: Partial<Omit<ViewSnapshot, "scrollY">>,
    scrollY: number | null = 0
  ) => {
    if (next.selectedProfileName) flushPendingActivityRecency();
    const currentSnapshot = snapshotView();
    const nextSnapshot: ViewSnapshot = {
      ...currentSnapshot,
      ...next,
      selectedCommentId: next.selectedCommentId ?? (next.selectedItemId !== undefined ? null : currentSnapshot.selectedCommentId),
      applicationReviewPostId: next.applicationReviewPostId !== undefined
        ? next.applicationReviewPostId
        : next.selectedItemId !== undefined || next.selectedProfileName || next.selectedCommunityId || next.messagesOpen || (next.activeRoom && next.activeRoom !== "opportunities")
          ? null
          : currentSnapshot.applicationReviewPostId,
      selectedApplicationId: next.selectedApplicationId !== undefined
        ? next.selectedApplicationId
        : next.applicationReviewPostId !== undefined ? null : currentSnapshot.selectedApplicationId,
      profileSocialView:
        next.profileSocialView !== undefined
          ? next.profileSocialView
          : next.selectedProfileName !== undefined
            ? null
            : currentSnapshot.profileSocialView,
      messagesOpen: next.messagesOpen ?? false,
      selectedConversationId:
        next.selectedConversationId !== undefined
          ? next.selectedConversationId
          : next.messagesOpen
            ? currentSnapshot.selectedConversationId
            : null,
      scrollAnchor: null,
      scrollY: scrollY ?? currentSnapshot.scrollY,
      detailOrigin: next.detailOrigin !== undefined ? next.detailOrigin : currentSnapshot.detailOrigin
    };
    recordNavigation(currentSnapshot, nextSnapshot);
    if (next.activeRoom !== undefined) setActiveRoom(next.activeRoom);
    if (next.selectedItemId !== undefined) setSelectedItemId(next.selectedItemId);
    setApplicationReviewPostId(nextSnapshot.applicationReviewPostId);
    setSelectedApplicationId(nextSnapshot.selectedApplicationId);
    if (next.selectedCommentId !== undefined) setSelectedCommentId(next.selectedCommentId);
    if (next.detailOrigin !== undefined) setDetailOrigin(next.detailOrigin);
    if (next.selectedProfileName !== undefined) setSelectedProfileName(next.selectedProfileName);
    if (next.profileSocialView !== undefined) setProfileSocialView(next.profileSocialView);
    if (next.profileTab !== undefined) setProfileActiveTab(next.profileTab);
    if (next.selectedItemId !== undefined && next.selectedItemId !== selectedItemId) {
      commentSegmentStacksRef.current = {};
      visibleCommentSegmentStacksRef.current = {};
      setCommentSegmentStacks({});
    }
    if (next.officeMode !== undefined) setOfficeMode(next.officeMode);
    if (next.selectedCommunityId !== undefined) setSelectedCommunityId(next.selectedCommunityId);
    setTabletOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesQuickOpen(false);
    setMessagesOpen(next.messagesOpen ?? false);
    if (next.selectedConversationId !== undefined) setSelectedConversationId(next.selectedConversationId);
    else if (!next.messagesOpen) setSelectedConversationId(null);
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
    flushPendingActivityRecency();
    navigateView({ selectedProfileName: profileKey, profileSocialView: null, profileTab: "all", selectedItemId: null, selectedCommentId: null });
  };

  const changeProfileSocialView = (view: ProfileSocialView | null) => {
    if (!selectedProfileName) return;
    navigateView({ profileSocialView: view }, null);
  };

  const changeProfileTab = (tab: ProfileTab) => {
    if (profileActiveTab === tab && !profileSocialView) return;
    flushPendingActivityRecency();
    navigateView({ profileSocialView: null, profileTab: tab }, null);
  };
  const openTablet = () => {
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesQuickOpen(false);
    setTabletOpen(true);
  };

  const openSearch = () => {
    setTabletOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setMessagesQuickOpen(false);
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

  const routePostRoom = (kind: PostDraft["kind"]): Exclude<RoomId, "hall" | "office"> =>
    kind === "proposal" ? "funding" : kind === "opportunity" ? "opportunities" : kind === "paper" ? "library" : "amphitheater";

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
    persist: () => persistLocalSnapshot(itemsRef.current, profilesRef.current),
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

  const createPost = async ({ title, body, document, kind, patronage, opportunity, attachments, quoteSource }: PostDraft) => {
    const routedRoom = routePostRoom(kind);
    const contentKind = kind === "proposal" ? "paper" : kind === "opportunity" ? "thought" : kind;
    const createdAt = new Date().toISOString();
    const postPayload = {
      title,
      body,
      document,
      kind: contentKind,
      postType: kind,
      room: routedRoom,
      communityId: composerCommunityId ?? undefined,
      patronage,
      opportunity,
      authorHandle: currentProfile.handle,
      attachmentIds: attachments.map((attachment) => attachment.id),
      quoteSource: quoteSource
        ? { sourceType: quoteSource.sourceType, sourceId: quoteSource.sourceId }
        : undefined
    };
    const mutation = retryMutationKey("post-create", JSON.stringify(postPayload));
    setSyncStatus("Posting");
    let data: { item: InquiryItem };
    try {
      data = await symposiumApi.request<{ item: InquiryItem }>("/api/posts", {
        method: "POST",
        idempotencyKey: mutation.idempotencyKey,
        body: postPayload
      });
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) clearRetryMutationKey(mutation.fingerprintKey);
      const message =
        error instanceof SymposiumApiError && error.status === null
          ? "Post could not reach the live service"
          : error instanceof Error
            ? error.message
            : "Post could not be saved";
      setSyncStatus(message);
      return { ok: false as const, error: message };
    }

    clearRetryMutationKey(mutation.fingerprintKey);
    const existingCommittedItem = itemsRef.current.find((item) => item.id === data.item.id);
    const committedItem = reconcileCommittedItem(
      { ...data.item, createdAt: data.item.createdAt ?? createdAt },
      existingCommittedItem
    );
    const nextItems = sortByPublishedRecency([committedItem, ...items.filter((item) => item.id !== committedItem.id)]);
    touchActivity(committedItem.id);
    replaceItems(nextItems);
    persistLocalSnapshot(nextItems, profiles, currentProfile, { broadcastItemIds: [committedItem.id] });
    navigateView({
      activeRoom: committedItem.communityId ? "communities" : committedItem.room,
      selectedItemId: committedItem.id,
      selectedCommentId: null,
      selectedProfileName: null,
      officeMode: "desk",
      selectedCommunityId: committedItem.communityId ?? null
    });
    setComposerOpen(false);
    setComposerCommunityId(null);
    setSyncStatus("Post saved");
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
    const previousItems = itemsRef.current;
    const previousSelectedItemId = selectedItemId;
    const previousSelectedCommentId = selectedCommentId;
    const existing = previousItems.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing)) {
      setSyncStatus("This post cannot accept comments");
      return false;
    }

    if (parentId && !findCommentById(existing.comments, parentId)) {
      setSyncStatus("Reply target is no longer available");
      return false;
    }

    setSyncStatus(parentId ? "Saving reply" : "Saving comment");
    let quote: InquiryComment["quote"];
    try {
      quote = resolveLocalContentQuote(previousItems, quoteSource);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Quoted content is unavailable");
      return false;
    }

    const optimisticComment: InquiryComment = {
      id: clientId("comment"),
      parentId: parentId ?? null,
      author: currentProfile.name,
      authorHandle: currentProfile.handle,
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
      setSyncStatus("Reply target is no longer available");
      return false;
    }

    itemMutationCoordinatorRef.current.begin(itemId);
    const nextCritiques = incrementMetric(existing.metrics.critiques, 1);
    const optimisticItem: InquiryItem = {
      ...existing,
      metrics: { ...existing.metrics, critiques: nextCritiques },
      signals: updateSignalValue(existing.signals, "Critiques", nextCritiques),
      comments: appended.comments
    };
    const optimisticItems = previousItems.map((item) => (item.id === itemId ? optimisticItem : item));

    replaceItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    touchActivity(itemId);
    setSelectedItemId(itemId);
    setSelectedCommentId(optimisticComment.id ?? null);

    const rollbackOptimisticComment = (message: string) => {
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSelectedItemId(previousSelectedItemId);
      setSelectedCommentId(previousSelectedCommentId);
      setSyncStatus(message);
    };

    const commentPayload = {
      body,
      document,
      stance,
      parentId: parentId ?? null,
      authorHandle: currentProfile.handle,
      attachmentIds: attachments.map((attachment) => attachment.id),
      quoteSource
    };
    const mutation = retryMutationKey(
      "comment-create",
      JSON.stringify({ itemId, ...commentPayload })
    );

    try {
      const data = await symposiumApi.request<{ comment?: InquiryComment; item?: InquiryItem }>(
        `/api/posts/${itemId}/comments`,
        {
        method: "POST",
        idempotencyKey: mutation.idempotencyKey,
        body: commentPayload
        }
      );
      clearRetryMutationKey(mutation.fingerprintKey);
      if (data.item) {
        const currentItem = itemsRef.current.find((item) => item.id === itemId);
        const committedItem = reconcileCommittedItem(data.item, currentItem, currentProfile.handle);
        const committedItems = itemsRef.current.map((item) => (item.id === itemId ? committedItem : item));
        replaceItems(committedItems);
        persistLocalSnapshot(committedItems, profilesRef.current);
      }

      const committedCommentId = data.comment?.id ?? optimisticComment.id ?? null;
      setSelectedCommentId(committedCommentId);
      if (committedCommentId) {
        replaceCanonicalRoute({ kind: "post", postId: itemId, commentId: committedCommentId });
      }
      setSyncStatus(parentId ? "Reply saved" : "Comment saved");
      return true;
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) clearRetryMutationKey(mutation.fingerprintKey);
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
      rollbackOptimisticComment(message);
      return false;
    } finally {
      itemMutationCoordinatorRef.current.complete(itemId);
    }
  };

  const enterLocalPreview = () => {
    const fallbackProfiles = Object.keys(profiles).length ? profiles : { [profile.handle]: profile };
    const previewProfile =
      fallbackProfiles[currentProfile.handle] ?? fallbackProfiles[profile.handle] ?? currentProfile ?? profile;

    setProfiles(fallbackProfiles);
    setCurrentProfile(previewProfile);
    setSignedIn(true);
    setAuthError("");
    setEntryMode("complete");
    applyInitialRouteState();
    window.sessionStorage.setItem("symposium-entry-complete", "true");
    window.localStorage.setItem("symposium-profile-handle", previewProfile.handle);
    persistLocalSnapshot(items, fallbackProfiles, previewProfile);
    setSyncStatus("Local preview");
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
    const previousProfile = currentProfileRef.current;
    const previousProfiles = profilesRef.current;
    const previousItems = itemsRef.current;
    const cleanName = draft.name.trim() || currentProfile.name;
    const updatedProfile: ResearchProfile = {
      ...currentProfile,
      name: cleanName,
      avatarUrl: draft.avatarUrl?.trim() || undefined,
      bio: (draft.bio.trim() || currentProfile.bio).slice(0, 200),
      likesPublic: draft.likesPublic,
      resharesPublic: draft.resharesPublic
    };
    const nextProfiles = { ...profiles, [updatedProfile.handle]: updatedProfile };
    const nextItems = items.map((item) => ({
      ...item,
      author: item.authorHandle === updatedProfile.handle ? updatedProfile.name : item.author,
      comments: updateCommentsForProfile(item.comments, updatedProfile)
    }));

    profileMutationCoordinatorRef.current.begin(updatedProfile.handle);
    setCurrentProfile(updatedProfile);
    setProfiles(nextProfiles);
    replaceItems(nextItems);
    if (selectedProfileName === currentProfile.name || selectedProfileName === currentProfile.handle) {
      setSelectedProfileName(updatedProfile.handle);
    }
    persistLocalSnapshot(nextItems, nextProfiles, updatedProfile);
    setSyncStatus("Saving profile settings");
    const profilePayload = {
      name: updatedProfile.name,
      handle: updatedProfile.handle,
      email: updatedProfile.email,
      avatarUrl: profileAvatarForPersistence(updatedProfile.avatarUrl),
      likesPublic: updatedProfile.likesPublic,
      resharesPublic: updatedProfile.resharesPublic,
      role: updatedProfile.role,
      location: updatedProfile.location,
      bio: updatedProfile.bio,
      fields: updatedProfile.fields
    };
    const mutation = retryMutationKey("profile-upsert", JSON.stringify(profilePayload));

    try {
      const data = await symposiumApi.request<{ profile: ResearchProfile }>("/api/profiles", {
        method: "POST",
        idempotencyKey: mutation.idempotencyKey,
        body: profilePayload
      });
      clearRetryMutationKey(mutation.fingerprintKey);
      const committedEntity = profileMutationCoordinatorRef.current.protectIncomingItem(
        profileSyncEntity({ ...updatedProfile, ...data.profile }),
        profileSyncEntity(updatedProfile)
      );
      profileMutationCoordinatorRef.current.complete(updatedProfile.handle);
      const committedProfile = researchProfileFromSyncEntity(committedEntity);
      const committedProfiles = { ...nextProfiles, [committedProfile.handle]: committedProfile };
      const committedItems = nextItems.map((item) => ({
        ...item,
        author: item.authorHandle === committedProfile.handle ? committedProfile.name : item.author,
        comments: updateCommentsForProfile(item.comments, committedProfile)
      }));
      setCurrentProfile(committedProfile);
      setProfiles(committedProfiles);
      replaceItems(committedItems);
      persistLocalSnapshot(committedItems, committedProfiles, committedProfile, {
        broadcastProfileHandles: [committedProfile.handle]
      });
      setSettingsOpen(false);
      setSyncStatus("Profile settings saved");
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) clearRetryMutationKey(mutation.fingerprintKey);
      profileMutationCoordinatorRef.current.complete(updatedProfile.handle);
      currentProfileRef.current = previousProfile;
      profilesRef.current = previousProfiles;
      setCurrentProfile(previousProfile);
      setProfiles(previousProfiles);
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, previousProfiles, previousProfile, {
        broadcastProfileHandles: [updatedProfile.handle]
      });
      setSyncStatus("Profile settings could not sync");
    }
  };

  const toggleFollow = async (targetHandle: string) => {
    const normalizedTarget = cleanHandle(targetHandle);
    if (!normalizedTarget || normalizedTarget === currentProfile.handle) return;

    const wasFollowing = followingHandles.includes(normalizedTarget);
    const previousHandles = followingHandles;
    const nextHandles = wasFollowing
      ? previousHandles.filter((handle) => handle !== normalizedTarget)
      : Array.from(new Set([...previousHandles, normalizedTarget]));
    const currentSocial = profileSocialLists[currentProfile.handle] ?? { following: previousHandles, followers: [] };
    const targetSocial = profileSocialLists[normalizedTarget] ?? { following: [], followers: [] };
    const nextTargetFollowers = wasFollowing
      ? targetSocial.followers.filter((handle) => handle !== currentProfile.handle)
      : Array.from(new Set([...targetSocial.followers, currentProfile.handle]));
    const mutation = followMutationCoordinatorRef.current.begin(
      currentProfile.handle,
      normalizedTarget,
      !wasFollowing
    );
    const idempotencyKey = createClientMutationId(wasFollowing ? "profile-unfollow" : "profile-follow");

    setFollowingHandles(nextHandles);
    applySocialLists(currentProfile.handle, { ...currentSocial, following: nextHandles });
    applySocialLists(normalizedTarget, { ...targetSocial, followers: nextTargetFollowers });
    persistLocalFollowing(currentProfile.handle, nextHandles);
    setSyncStatus(wasFollowing ? "Unfollowing profile" : "Following profile");

    try {
      const data = await symposiumApi.request<{ follow?: ProfileFollowRecord }>(
        `/api/profiles/${encodeURIComponent(normalizedTarget)}/follow`,
        {
        method: wasFollowing ? "DELETE" : "POST",
        idempotencyKey,
        body: { actorHandle: currentProfile.handle }
        }
      );
      if (data.follow) {
        const normalizedFollow = {
          ...data.follow,
          followerHandle: cleanHandle(String(data.follow.followerHandle ?? currentProfile.handle)),
          followingHandle: cleanHandle(String(data.follow.followingHandle ?? normalizedTarget))
        };
        followMutationCoordinatorRef.current.complete(mutation, normalizedFollow);
        mergeLiveFollow(normalizedFollow, normalizedFollow.status === "active");
      }
      setSyncStatus(wasFollowing ? "Profile unfollowed" : "Following profile");
    } catch {
      if (!followMutationCoordinatorRef.current.fail(mutation)) {
        setSyncStatus("Follow state synced");
        return;
      }
      setFollowingHandles(previousHandles);
      applySocialLists(currentProfile.handle, { ...currentSocial, following: previousHandles });
      applySocialLists(normalizedTarget, { ...targetSocial });
      persistLocalFollowing(currentProfile.handle, previousHandles);
      setSyncStatus("Follow could not sync");
    }
  };

  const signOut = async () => {
    await auth.signOut().catch(() => undefined);
    window.localStorage.removeItem("symposium-auth-handle");
    window.localStorage.removeItem("symposium-auth-records");
    window.sessionStorage.removeItem("symposium-entry-complete");
    setSignedIn(false);
    setSyncedClerkUserId(null);
    setSettingsOpen(false);
    setAuthError("");
    entranceStartedAtRef.current = Date.now();
    replayEntrance();
    setEntryMode("approach");
  };

  const applyAction = async (itemId: string, action: PostAction, options: ViewActionOptions = {}) => {
    const isViewAction = action === "read";
    if (isViewAction && !claimClientView("post", itemId)) return;

    const actorHandle = currentProfile.handle;
    if (isViewAction) {
      const synced = await recordPassiveView("post", itemId, null, actorHandle, options);
      if (synced?.item) mergeLiveItem(synced.item);
      else if (synced?.itemId && synced.metrics) mergeLiveMetricPatch(synced);
      else releaseClientViewClaim("post", itemId);
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
      if (item.id !== itemId) return item;
      if (isDeletedPost(item)) return item;
      actionApplied = true;
      const nextItem = mutateItemForActor(item, action, actorHandle, profile.handle);
      protectedMetricState = actionMetricStateFromValues(item.metrics, nextItem.metrics, action);
      if (action === "save") desiredActive = isSavedBy(nextItem, actorHandle, profile.handle);
      if (action === "signal") desiredActive = hasHandle(nextItem.signaledBy, actorHandle);
      if (action === "fork") desiredActive = hasHandle(nextItem.forkedBy, actorHandle);
      return nextItem;
    });

    if (!actionApplied) {
      if (isViewAction) releaseClientViewClaim("post", itemId);
      return;
    }
    itemMutationCoordinatorRef.current.begin(itemId);
    setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
    if (!isViewAction && desiredActive !== undefined) {
      previousCanonicalActivity = stageOptimisticCanonicalActivity(
        "post",
        itemId,
        itemId,
        actorHandle,
        action as ToggleActionContract,
        desiredActive
      );
    }

    replaceItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);

    try {
      const data = await symposiumApi.request<{ item: InquiryItem; activity?: unknown }>(
        `/api/posts/${itemId}/actions`,
        {
        method: "POST",
        idempotencyKey: mutationKey,
        body: { action, actorHandle, active: desiredActive, trigger: options.trigger, surface: options.surface }
        }
      );
      if (actionVersionsRef.current[actionKey] !== version) {
        const latestActive = protectedDesiredActionState(actionKey);
        if (latestActive !== undefined) {
          void symposiumApi.request(`/api/posts/${itemId}/actions`, {
            method: "POST",
            idempotencyKey: createClientMutationId("post-action-converge"),
            body: { action, actorHandle, active: latestActive, trigger: options.trigger, surface: options.surface }
          }).catch(() => undefined);
        }
        return;
      }

      const committedActive = itemActionActive(data.item, action, actorHandle);
      if (desiredActive !== undefined && committedActive !== desiredActive) {
        setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
        setSyncStatus("Action syncing");
        return;
      }

      const canonicalActivity = isCanonicalActionActivity(data.activity) ? data.activity : null;
      if (canonicalActivity && !acceptCanonicalActivity(canonicalActivity)) {
        setSyncStatus("Action synced");
        return;
      }

      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId
          ? reconcileCommittedItem(data.item, item, actorHandle)
          : item
      );
      replaceItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
      if (!canonicalActivity) {
        if (!isViewAction) {
          pendingCanonicalActionKeysRef.current.delete(
            canonicalActivityKey({
              subjectType: "post",
              subjectId: itemId,
              actorHandle,
              action: action as ToggleActionContract
            })
          );
        }
        touchProfileAction(itemId, action, actorHandle);
      }
      setSyncStatus("Action synced");
    } catch {
      if (actionVersionsRef.current[actionKey] !== version) return;
      if (
        !isViewAction &&
        canonicalActionWasCommitted(
          "post",
          itemId,
          actorHandle,
          action as ToggleActionContract,
          desiredActive,
          previousCanonicalActivity
        )
      ) {
        clearDesiredActionState(actionKey);
        setSyncStatus("Action synced");
        return;
      }
      clearDesiredActionState(actionKey);
      if (isViewAction) releaseClientViewClaim("post", itemId);
      if (!isViewAction) {
        restoreOptimisticCanonicalActivity(
          "post",
          itemId,
          actorHandle,
          action as ToggleActionContract,
          previousCanonicalActivity
        );
      }
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Action could not sync");
    } finally {
      itemMutationCoordinatorRef.current.complete(itemId);
    }
  };

  const applyCommentAction = async (
    itemId: string,
    commentId: string,
    action: CommentAction,
    options: ViewActionOptions = {}
  ) => {
    const isViewAction = action === "read";
    if (isViewAction && !claimClientView("comment", commentId)) return;

    const actorHandle = currentProfile.handle;
    if (isViewAction) {
      const synced = await recordPassiveView("comment", itemId, commentId, actorHandle, options);
      if (synced?.item) mergeLiveItem(synced.item);
      else if (synced?.itemId && synced.metrics) mergeLiveMetricPatch(synced);
      else releaseClientViewClaim("comment", commentId);
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
        protectedMetricState = actionMetricStateFromValues(
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

    if (!actionApplied) {
      if (isViewAction) releaseClientViewClaim("comment", commentId);
      return;
    }
    itemMutationCoordinatorRef.current.begin(itemId);
    setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
    if (!isViewAction && desiredActive !== undefined) {
      previousCanonicalActivity = stageOptimisticCanonicalActivity(
        "comment",
        commentId,
        itemId,
        actorHandle,
        action as ToggleActionContract,
        desiredActive
      );
    }
    replaceItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);

    try {
      const data = await symposiumApi.request<{ item: InquiryItem; activity?: unknown }>(
        `/api/posts/${itemId}/comments/${commentId}/actions`,
        {
        method: "POST",
        idempotencyKey: mutationKey,
        body: { action, actorHandle, active: desiredActive, trigger: options.trigger, surface: options.surface }
        }
      );
      if (actionVersionsRef.current[actionKey] !== version) return;

      const committedComment = findCommentById(data.item.comments, commentId);
      const committedActive = committedComment
        ? commentActionActive(committedComment, action, actorHandle)
        : undefined;
      if (desiredActive !== undefined && committedActive !== desiredActive) {
        setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
        setSyncStatus("Comment action syncing");
        return;
      }

      const canonicalActivity = isCanonicalActionActivity(data.activity) ? data.activity : null;
      if (canonicalActivity && !acceptCanonicalActivity(canonicalActivity)) {
        setSyncStatus("Comment action synced");
        return;
      }

      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId
          ? reconcileCommittedItem(data.item, item, actorHandle)
          : item
      );
      replaceItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
      if (!canonicalActivity) {
        if (!isViewAction) {
          pendingCanonicalActionKeysRef.current.delete(
            canonicalActivityKey({
              subjectType: "comment",
              subjectId: commentId,
              actorHandle,
              action: action as ToggleActionContract
            })
          );
        }
        touchProfileCommentAction(itemId, commentId, action, actorHandle);
      }
      setSyncStatus("Comment action synced");
    } catch {
      if (actionVersionsRef.current[actionKey] !== version) return;
      if (
        !isViewAction &&
        canonicalActionWasCommitted(
          "comment",
          commentId,
          actorHandle,
          action as ToggleActionContract,
          desiredActive,
          previousCanonicalActivity
        )
      ) {
        clearDesiredActionState(actionKey);
        setSyncStatus("Comment action synced");
        return;
      }
      clearDesiredActionState(actionKey);
      if (isViewAction) releaseClientViewClaim("comment", commentId);
      if (!isViewAction) {
        restoreOptimisticCanonicalActivity(
          "comment",
          commentId,
          actorHandle,
          action as ToggleActionContract,
          previousCanonicalActivity
        );
      }
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Comment action could not sync");
    } finally {
      itemMutationCoordinatorRef.current.complete(itemId);
    }
  };

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
    const cleanTitle = draft.title.trim();
    const cleanBody = draft.body.trim();
    if (!cleanTitle || !cleanBody) return;

    const previousItems = itemsRef.current;
    const existing = previousItems.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing)) return;
    itemMutationCoordinatorRef.current.begin(itemId);
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
              ? { ...draft.patronage, raisedMinorUnits: existing.patronage?.raisedMinorUnits ?? 0, supporterCount: existing.patronage?.supporterCount ?? 0, topSupporters: existing.patronage?.topSupporters ?? [] }
              : existing.patronage,
            opportunity: draft.opportunity
              ? { ...draft.opportunity, applicationCount: existing.opportunity?.applicationCount ?? 0 }
              : existing.opportunity,
            editedAt
          }
        : item
    );

    replaceItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    setSyncStatus("Saving post edit");

    try {
      const data = await symposiumApi.request<{ item: InquiryItem }>(`/api/posts/${itemId}`, {
        method: "PATCH",
        idempotencyKey: createClientMutationId("post-update"),
        body: {
          title: cleanTitle,
          body: cleanBody,
          document: draft.document,
          actorHandle: currentProfile.handle,
          expectedEditedAt: existing.editedAt ?? null,
          attachmentIds: draft.attachments.map((attachment) => attachment.id),
          patronage: draft.patronage,
          opportunity: draft.opportunity,
          quoteSource: !draft.quote
            ? existing.quote ? null : undefined
            : !existing.quote ||
                existing.quote.sourceType !== draft.quote.sourceType ||
                existing.quote.sourceId !== draft.quote.sourceId
              ? { sourceType: draft.quote.sourceType, sourceId: draft.quote.sourceId }
              : undefined
        }
      });
      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId ? reconcileCommittedItem(data.item, item) : item
      );
      replaceItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setEditingPost(null);
      setSyncStatus("Post edited");
    } catch {
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Post edit could not sync");
    } finally {
      itemMutationCoordinatorRef.current.complete(itemId);
    }
  };

  const { deletePost, deleteComment } = createContentDeletionController({
    itemsRef,
    communitiesRef,
    actorHandle: currentProfile.handle,
    beginMutation: itemMutationCoordinatorRef.current.begin,
    completeMutation: itemMutationCoordinatorRef.current.complete,
    replaceItems,
    persistItems: (nextItems) => persistLocalSnapshot(nextItems, profilesRef.current),
    reconcileItem: reconcileCommittedItem,
    clearPostEditor: () => setEditingPost(null),
    clearCommentEditor: (itemId, commentId) => setEditingComment((current) =>
      current?.itemId === itemId && current.commentId === commentId ? null : current
    ),
    setStatus: setSyncStatus
  });

  const saveCommentEdit = async (
    itemId: string,
    commentId: string,
    body: string,
    document: VersionedDocumentContract,
    attachments: InquiryAttachment[],
    quote: InquiryComment["quote"] | null
  ) => {
    const cleanBody = body.trim();
    if (!cleanBody) return;

    const previousItems = itemsRef.current;
    const existing = previousItems.find((item) => item.id === itemId);
    const existingComment = existing ? findCommentById(existing.comments, commentId) : undefined;
    if (
      !existing ||
      !existingComment ||
      isDeletedComment(existingComment) ||
      cleanHandle(existingComment.authorHandle ?? existingComment.author) !== currentProfile.handle
    ) {
      return;
    }

    itemMutationCoordinatorRef.current.begin(itemId);
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

    replaceItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    setSyncStatus("Saving comment edit");

    try {
      const data = await symposiumApi.request<{ item: InquiryItem }>(
        `/api/posts/${itemId}/comments/${commentId}`,
        {
        method: "PATCH",
        idempotencyKey: createClientMutationId("comment-update"),
        body: {
          body: cleanBody,
          document,
          actorHandle: currentProfile.handle,
          expectedEditedAt: existingComment.editedAt ?? null,
          attachmentIds: attachments.map((attachment) => attachment.id),
          quoteSource: !quote
            ? existingComment.quote ? null : undefined
            : !existingComment.quote ||
                existingComment.quote.sourceType !== quote.sourceType ||
                existingComment.quote.sourceId !== quote.sourceId
              ? { sourceType: quote.sourceType, sourceId: quote.sourceId }
              : undefined
        }
        }
      );
      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId ? reconcileCommittedItem(data.item, item) : item
      );
      replaceItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setEditingComment(null);
      setSyncStatus("Comment edited");
    } catch {
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Comment edit could not sync");
    } finally {
      itemMutationCoordinatorRef.current.complete(itemId);
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
        surface: sourceSurface ?? (selectedProfileNameRef.current ? "profile" : "feed")
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
    setTabletOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesOpen(false);
    setComposerOpen(false);
    setComposerCommunityId(null);
    setQuoteSelection(selection);
  };

  const openQuotedSource = (selection: QuoteSelection) => {
    setQuoteSelection(null);
    openPost(
      selection.sourcePostId,
      selection.sourceType === "comment" ? selection.sourceId : null,
      "thread"
    );
  };

  const tabletContext = ((): AssistantMessageInputContract["context"] => {
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
          ? `PDF page ${activePdfView.page} of ${activePdfView.pageCount} open inside “${attachmentPreviewBaseItem.title}”.`
          : `Attachment open inside “${attachmentPreviewBaseItem.title}”.`,
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
      const term = normalizeSearchPhrase(searchQuery);
      const searchableItems = activeItems.filter(communityPostIsExternallyDiscoverable);
      const localTitleMatches = term
        ? sortByPublishedRecency(searchableItems.filter((item) => normalizeSearchPhrase(item.title).includes(term)))
        : [];
      const localTitleIds = new Set(localTitleMatches.map((item) => item.id));
      const localContentMatches = term
        ? sortByPublishedRecency(searchableItems.filter((item) =>
            !localTitleIds.has(item.id) && normalizeSearchPhrase(searchableContentText(item)).includes(term)
          ))
        : [];
      const localProfileMatches = term
        ? profileList.filter((person) =>
            normalizeSearchPhrase([person.name, person.handle, person.role, person.location, person.bio, ...person.fields].join(" ")).includes(term)
          ).slice(0, 8)
        : [];
      const visibleSearchResults = remoteSearchResults ?? {
        titleMatches: localTitleMatches,
        contentMatches: localContentMatches,
        profileMatches: localProfileMatches
      };
      return {
        surface: "search",
        route: "/search",
        title: searchQuery.trim() ? `Search: ${searchQuery.trim()}` : "Search",
        summary: "The global Symposium search overlay is open.",
        content: trimContent([
          searchQuery.trim() ? `Current search query: ${searchQuery.trim()}` : "No search query has been entered yet.",
          visibleSearchResults.titleMatches.length || visibleSearchResults.contentMatches.length
            ? [
                "Visible post results:",
                ...[...visibleSearchResults.titleMatches, ...visibleSearchResults.contentMatches]
                  .slice(0, 16)
                  .map(tabletItemLine)
              ].join("\n\n")
            : "No post results are currently visible.",
          visibleSearchResults.profileMatches.length
            ? [
                "Visible researcher results:",
                ...visibleSearchResults.profileMatches.slice(0, 8).map((person) =>
                  `${person.name} (${person.handle}) · ${person.role}\n${person.bio}`
                )
              ].join("\n\n")
            : "No researcher results are currently visible."
        ].join("\n\n")),
        metadata: {
          query: searchQuery.trim(),
          postResultCount: visibleSearchResults.titleMatches.length + visibleSearchResults.contentMatches.length,
          profileResultCount: visibleSearchResults.profileMatches.length,
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
        metadata: { privateConversation: Boolean(messageTabletContext) }
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
        title: activeAttachment?.fileName ?? selectedItem.title,
        summary: activeAttachment && activePdfView
          ? `PDF page ${activePdfView.page} of ${activePdfView.pageCount} open inside “${selectedItem.title}”.`
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
        route: workspaceTabletDocument ? `/workspace/notes/${workspaceTabletDocument.id}` : "/workspace/notes",
        title: workspaceTabletDocument?.title ?? "Workspace Notes",
        summary: workspaceTabletDocument
          ? `${workspaceTabletDocument.kind} draft · revision ${workspaceTabletDocument.revision}`
          : "Your private notes and drafts workspace.",
        content: trimContent(workspaceTabletDocument?.body ?? `Workspace section: ${workspaceView.section}. Search: ${workspaceView.query || "none"}.`),
        entityType: workspaceTabletDocument ? "note" : "workspace",
        entityId: workspaceTabletDocument?.id,
        metadata: { section: workspaceView.section, editing: workspaceView.editSelected }
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

  const localSearchResults = useMemo<SearchResults>(() => {
    const term = normalizeSearchPhrase(searchQuery);
    if (!term) return { titleMatches: [] as InquiryItem[], contentMatches: [] as InquiryItem[], profileMatches: [] as ResearchProfile[] };
    const searchableItems = activeItems.filter(communityPostIsExternallyDiscoverable);

    const titleMatches = sortByPublishedRecency(
      searchableItems.filter((item) => normalizeSearchPhrase(item.title).includes(term))
    );
    const titleIds = new Set(titleMatches.map((item) => item.id));
    const contentMatches = sortByPublishedRecency(
      searchableItems.filter((item) => !titleIds.has(item.id) && normalizeSearchPhrase(searchableContentText(item)).includes(term))
    );
    const profileMatches = profileList
      .filter((person) =>
        [person.name, person.handle, person.role, person.location, person.bio, ...person.fields]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
      .slice(0, 8);

    return { titleMatches, contentMatches, profileMatches };
  }, [activeItems, profileList, searchQuery]);
  const searchResults = useMemo<SearchResults>(() => {
    const base = remoteSearchResults ?? localSearchResults;
    return {
      ...base,
      profileMatches: base.profileMatches.map((person) => profiles[cleanHandle(person.handle)] ?? person)
    };
  }, [localSearchResults, profiles, remoteSearchResults]);

  const presentedEntryMode = resolvePresentedEntryMode({
    entryMode,
    clerkEnabled,
    authLoaded,
    initialIsSignedIn,
    isSignedIn: Boolean(isSignedIn),
    accountSynced: signedIn,
    authError
  });

  if (presentedEntryMode !== "complete") {
    return (
      <EntrySequence
        theme={theme}
        entranceRender={entranceRenders[theme]}
        mode={presentedEntryMode}
        authError={authError}
        authLoaded={authLoaded}
        clerkEnabled={clerkEnabled}
        onLocalPreview={enterLocalPreview}
        playApproach={shouldPlayEntrance === true}
      />
    );
  }

  return (
    <ScribbleProvider actorHandle={currentProfile.handle} profiles={profiles} theme={theme}>
    <main
      className={`symposium-shell ${theme}`}
      data-room={activeRoom}
      data-community-selected={selectedCommunity ? "true" : undefined}
      data-view={messagesOpen ? "messages" : applicationReviewItem ? "opportunity-applications" : selectedProfile ? "profile" : selectedItem ? "detail" : activeRoom === "hall" ? "hall" : "room"}
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
            Boolean(selectedItemId || applicationReviewPostId || selectedProfileName || selectedCommunityId || messagesOpen)
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
            liveRevision={notificationRevision}
            onOpenConversation={(conversationId) => {
              setMessagesQuickOpen(false);
              navigateView({ messagesOpen: true, selectedConversationId: conversationId });
            }}
          />
          <MessagesUnreadButton
            actorHandle={currentProfile.handle}
            expanded={messagesQuickOpen}
            liveEvents={messagingEvents}
            onOpen={() => {
              setQuickConversationId(null);
              setMessagesQuickOpen(true);
            }}
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

      <div className="sync-status" aria-live="polite">
        {syncStatus}
      </div>

      <button className="search-launcher bottom-action bottom-action-search" type="button" onClick={openSearch}>
        <Search size={17} />
        <span>Search</span>
      </button>

      <section className="stage">
        <CommunityGovernanceProvider community={selectedCommunity} items={items}>
        {messagesOpen ? (
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
            onEditComment={(itemId, commentId) => setEditingComment({ itemId, commentId })}
            onDeleteComment={deleteComment}
            onOpenSettings={() => {
              setTabletOpen(false);
              setComposerOpen(false);
              setSearchOpen(false);
              setMessagesOpen(false);
              setSettingsOpen(true);
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
            getProfileRecency={getProfileRecency}
            getProfileCommentRecency={getProfileCommentRecency}
            activeTab={profileActiveTab}
            activityRevision={profileActivityRevision}
            canonicalActivities={selectedProfileActivitySnapshot?.entries ?? []}
            canonicalActivityLoaded={selectedProfileActivityPage?.loaded ?? false}
            canonicalActivityError={Boolean(profileActivityErrors[selectedProfile.handle])}
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
              void refreshProfileActivity(
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
                tasks.push(refreshProfileActivity(
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
            onEditPost={setEditingPost}
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
            onEditComment={(itemId, commentId) => setEditingComment({ itemId, commentId })}
            onDeleteComment={deleteComment}
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            selectedCommentId={selectedCommentId}
            onClearSelectedComment={() => {
              setSelectedCommentId(null);
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
              onCreatePost: () => { if (selectedCommunity) { setComposerCommunityId(selectedCommunity.id); setComposerOpen(true); } },
              onCreateCall: communityController.createCall, onJoinCall: communityController.joinCall,
              onInvite: communityController.invite, onMessageModerator: (handle) => { const normalized = cleanHandle(handle); navigateView({ messagesOpen: true, selectedConversationId: `direct:${normalized}` }, null); },
              onOpenCommunity: openCommunity, onCreateCommunity: communityController.createCommunity,
              onSelect: openPost, onOpenProfile: openProfile, onAction: applyAction, onQuote: beginQuote,
              onOpenQuote: openQuotedSource, onEditPost: setEditingPost, onDeletePost: deletePost,
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
            onEditPost={setEditingPost}
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
          setTabletOpen(false);
          setSettingsOpen(false);
          setSearchOpen(false);
          setComposerCommunityId(selectedCommunity && canParticipateInCommunity(selectedCommunity, currentProfile) ? selectedCommunity.id : null);
          setComposerOpen(true);
        }}
      >
        <NotebookPen size={18} />
        <span>New post</span>
      </button>

      <ScribbleLauncher />

      <button
        className="pocket pocket-right bottom-action bottom-action-tablet"
        type="button"
        title="AI tablet"
        onClick={openTablet}
      >
        <BrainCircuit size={18} />
        <span>AI Tablet</span>
      </button>

      {tabletOpen ? (
        <TabletPanel
          actorHandle={currentProfile.handle}
          context={tabletContext}
          onClose={() => setTabletOpen(false)}
        />
      ) : null}

      {messagesQuickOpen ? (
        <MessagesQuickAccess
          actor={currentProfile}
          profiles={profiles}
          selectedConversationId={quickConversationId}
          onSelectConversation={setQuickConversationId}
          onOpenProfile={(handle) => {
            setMessagesQuickOpen(false);
            openProfile(handle);
          }}
          onOpenFull={(conversationId) => {
            setMessagesQuickOpen(false);
            navigateView({ messagesOpen: true, selectedConversationId: conversationId }, null);
          }}
          onClose={() => setMessagesQuickOpen(false)}
          liveEvents={messagingEvents}
        />
      ) : null}

      {composerOpen ? (
        <PostComposerModal
          onClose={() => {
            setComposerOpen(false);
            setComposerCommunityId(null);
          }}
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
          onClose={() => setQuoteSelection(null)}
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
          onClose={() => setEditingPost(null)}
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
          onClose={() => setEditingComment(null)}
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
          onClose={() => setSettingsOpen(false)}
          onSave={saveProfileSettings}
          onUploadAvatar={uploadProfileAvatar}
          onSignOut={signOut}
        />
      ) : null}
    </main>
    </ScribbleProvider>
  );
}
