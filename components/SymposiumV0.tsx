"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  BrainCircuit,
  MessageCircle,
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
  researchCommunities,
  roomChips,
  rooms,
  type FeedScope,
  type InquiryAttachment,
  type InquiryComment,
  type InquiryItem,
  type ResearchProfile,
  type RoomId
} from "@/lib/mockData";
import type { CommentAction, PostAction } from "@/lib/dataStore";
import type {
  CanonicalActionActivityContract,
  ProfileActivityResponseContract,
  ToggleActionContract
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
  tombstoneCommentInItem,
  tombstonePost,
  updateSignalValue
} from "@/lib/symposiumCore";
import {
  canonicalActionState,
  canonicalActivityKey,
  createLocalCanonicalActivity,
  isCanonicalActionActivity,
  mergeCanonicalActivities,
  reconcileCanonicalActivityRefresh
} from "@/lib/profileActivity";
import {
  beginItemMutation,
  captureItemMutationSnapshot,
  completeItemMutation,
  createItemMutationGuard,
  itemChangedSinceSnapshot,
  itemMutationIsPending,
  reconcileItemsAgainstMutations
} from "@/features/live-sync/itemMutationGuard";
import {
  createInquiryActionReconciler,
  type ProtectedActionMetricState
} from "@/features/live-sync/inquiryActionReconciler";
import type { CanonicalRoute, ProfileSocialView } from "@/features/navigation/canonicalRoute";
import {
  canonicalRouteForView as routeForViewSnapshot,
  officeModeForCanonicalRoute,
  patronageModeForCanonicalRoute,
  roomForCanonicalRoute,
  snapshotForCanonicalRoute,
  type OfficeMode,
  type PatronageMode,
  type ViewSnapshot
} from "@/features/navigation/viewState";
import { selectActiveProfile } from "@/features/identity/selectActiveProfile";
import { useInquiryEntityStore } from "@/features/entities/useInquiryEntityStore";
import {
  AttachmentPreviewModal,
  buildPostAttachmentMetadata,
  type AttachmentPreviewHandler
} from "@/features/attachments/AttachmentViews";
import {
  confirmAttachmentUpload,
  prepareAttachmentUpload,
  uploadConfirmedPostAttachment,
  type AttachmentConfirmResponse,
  type AttachmentUploadResponse
} from "@/features/attachments/attachmentUploadClient";
import {
  EntrySequence,
  HallView,
  OfficeDeskView,
  PatronageLobbyView,
  RenderPreloadDeck,
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
import {
  CommunitiesDirectoryView,
  SelectedCommunityView
} from "@/features/communities/CommunityViews";
import {
  matchesPatronageMode,
  matchesTopic,
  searchableContentText
} from "@/features/discovery/discoveryPolicy";
import { NotebookPanel, TabletPanel } from "@/features/workspace/WorkspacePanels";
import { SearchModal } from "@/features/search/SearchModal";
import { MessagesModal } from "@/features/messages/MessagesModal";
import { RoomView } from "@/features/rooms/RoomView";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";
import { useCanonicalBrowserHistory } from "@/features/navigation/useCanonicalBrowserHistory";
import { useBrowserSessionEntrance } from "@/features/entrance/useBrowserSessionEntrance";
import { entryModeForBrowserSession } from "@/features/entrance/browserSession";
import {
  persistCachedBootstrap,
  readCachedBootstrapSnapshot,
  resolveCachedBootstrap
} from "@/features/bootstrap/cachedBootstrap";

type Theme = "day" | "night";
type EntryMode = "loading" | "approach" | "auth" | "complete";
type ViewTargetType = "post" | "comment";
type EditingCommentTarget = {
  itemId: string;
  commentId: string;
};

type ProfileFollowRecord = {
  followerHandle?: string;
  followingHandle?: string;
  status?: string;
};

type ProfileFollowResponse = {
  following?: ProfileFollowRecord[];
  followers?: ProfileFollowRecord[];
};

type AttachmentPreviewTarget = {
  itemId: string;
  attachmentId: string;
};

type LiveEventPayload = {
  item?: unknown;
  follow?: ProfileFollowRecord;
  action?: PostAction;
  activity?: unknown;
  itemId?: string;
  commentId?: string;
};

type ProfileActivitySnapshot = {
  entries: CanonicalActionActivityContract[];
  loaded: boolean;
  nextCursor: string | null;
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
  isSignedIn: boolean;
  userId: string | null;
  signOut: () => Promise<void>;
};

const liveStatus = {
  loading: "Loading live data",
  connected: "Live data connected",
  reconnecting: "Live updates reconnecting",
  legacyConnected: "Live updates connected"
} as const;

const entranceRenders: Record<Theme, string> = {
  day: "/symposium-renders/entrance.png",
  night: "/symposium-renders/entrance-night.png"
};

const roomRenders: Record<Theme, Record<RoomId, string>> = {
  day: {
    hall: "/symposium-renders/main-hall-updated.png",
    office: "/symposium-renders/office.png",
    symposium: "/symposium-renders/symposium.png",
    library: "/symposium-renders/library-1.png",
    amphitheater: "/symposium-renders/amphitheatre-2.png",
    funding: "/symposium-renders/patronage.png",
    communities: "/symposium-renders/communities.png",
    opportunities: "/symposium-renders/opportunities.png"
  },
  night: {
    hall: "/symposium-renders/main-hall-night.png",
    office: "/symposium-renders/office-night.png",
    symposium: "/symposium-renders/symposium-night.png",
    library: "/symposium-renders/library-night.png",
    amphitheater: "/symposium-renders/amphitheatre-night.png",
    funding: "/symposium-renders/patronage-night.png",
    communities: "/symposium-renders/communities-night.png",
    opportunities: "/symposium-renders/opportunities-night.png"
  }
};

const patronageRenders: Record<Theme, Record<PatronageMode, string>> = {
  day: {
    lobby: "/symposium-renders/patronage.png",
    civic: "/symposium-renders/patronage-civic.png",
    private: "/symposium-renders/patronage-private.png"
  },
  night: {
    lobby: "/symposium-renders/patronage-night.png",
    civic: "/symposium-renders/patronage-civic-night.png",
    private: "/symposium-renders/patronage-private-night.png"
  }
};

const communityRenders: Record<Theme, { directory: string; selected: string }> = {
  day: {
    directory: "/symposium-renders/communities.png",
    selected: "/symposium-renders/community-selected.png"
  },
  night: {
    directory: "/symposium-renders/communities-night.png",
    selected: "/symposium-renders/community-selected-night.png"
  }
};

const preloadRenders = Array.from(
  new Set([
    ...Object.values(entranceRenders),
    ...Object.values(roomRenders.day),
    ...Object.values(roomRenders.night),
    ...Object.values(patronageRenders.day),
    ...Object.values(patronageRenders.night),
    ...Object.values(communityRenders.day),
    ...Object.values(communityRenders.night)
  ])
);

const getThemePreloadRenders = (theme: Theme) =>
  Array.from(
    new Set([
      entranceRenders[theme],
      ...Object.values(roomRenders[theme]),
      ...Object.values(patronageRenders[theme]),
      ...Object.values(communityRenders[theme])
    ])
  );

const getRoom = (roomId: RoomId) => rooms.find((room) => room.id === roomId) ?? rooms[0];

const clientId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const clientMutationId = (scope: string) =>
  `symposium:${scope}:${
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : clientId("mutation")
  }`;

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

function useSymposiumRenderPreload(primaryRenders: string[], activeRender: string) {
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;

    const cache = imageCacheRef.current;
    const preloadSource = (source: string, priority: "high" | "low") => {
      if (cache[source]) return;
      const image = new window.Image();
      image.decoding = "async";
      image.setAttribute("fetchpriority", priority);
      image.src = source;
      cache[source] = image;
    };

    const urgentRenders = Array.from(new Set([activeRender, ...primaryRenders]));
    urgentRenders.forEach((source) => preloadSource(source, "high"));

    const remainingRenders = preloadRenders.filter((source) => !urgentRenders.includes(source));
    const preloadRemainingRenders = () => {
      remainingRenders.forEach((source) => preloadSource(source, "low"));
    };
    const idleWindow = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      };

    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(preloadRemainingRenders, { timeout: 2500 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(preloadRemainingRenders, 900);
    return () => window.clearTimeout(timeoutId);
  }, [activeRender, primaryRenders]);
}

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

const isLiveInquiryItem = (value: unknown): value is InquiryItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as InquiryItem).id === "string" &&
  typeof (value as InquiryItem).title === "string" &&
  typeof (value as InquiryItem).kind === "string" &&
  typeof (value as InquiryItem).room === "string" &&
  typeof (value as InquiryItem).metrics === "object";

const clientSeedItemById = new Map(inquiryItems.map((item) => [item.id, item]));
const clientSeedCommentById = new Map<string, InquiryComment>();
for (const item of inquiryItems) {
  const visit = (comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (comment.id) clientSeedCommentById.set(comment.id, comment);
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

const normalizeClientSeedCommentTimes = (comments: InquiryComment[]): InquiryComment[] =>
  comments.map((comment) => ({
    ...comment,
    createdAt: stableSeedCreatedAt(
      comment.id ? clientSeedCommentById.get(comment.id)?.createdAt ?? comment.createdAt : comment.createdAt,
      legacyLiveSeedCreatedAt(comment.id, 1)
    ),
    replies: normalizeClientSeedCommentTimes(comment.replies ?? [])
  }));

const normalizeClientSeedTimes = (items: InquiryItem[]): InquiryItem[] =>
  items.map((item) => {
    const seedItem = clientSeedItemById.get(item.id);
    return {
      ...item,
      createdAt: stableSeedCreatedAt(seedItem?.createdAt ?? item.createdAt, legacyLiveSeedCreatedAt(item.id)),
      comments: normalizeClientSeedCommentTimes(item.comments ?? [])
    };
  });

const normalizeClientItem = (item: InquiryItem) => normalizeClientSeedTimes([item])[0] ?? item;

const preservePublishedPosition = (incoming: InquiryItem, existing?: InquiryItem): InquiryItem => {
  const normalized = normalizeClientItem(incoming);
  if (!existing) return normalized;

  return {
    ...normalized,
    date: existing.date,
    createdAt: existing.createdAt,
    attachments: normalized.attachments ?? existing.attachments
  };
};

const localPreviewAuth: SymposiumAuthState = {
  clerkEnabled: false,
  authLoaded: true,
  isSignedIn: false,
  userId: null,
  signOut: async () => undefined
};

export function SymposiumV0({
  clerkEnabled = false,
  initialRoute = { kind: "hall" },
  initialShouldPlayEntrance = null
}: {
  clerkEnabled?: boolean;
  initialRoute?: CanonicalRoute;
  initialShouldPlayEntrance?: boolean | null;
}) {
  if (clerkEnabled) {
    return <ClerkSymposiumV0 initialRoute={initialRoute} initialShouldPlayEntrance={initialShouldPlayEntrance} />;
  }
  return (
    <SymposiumExperience
      auth={localPreviewAuth}
      initialRoute={initialRoute}
      initialShouldPlayEntrance={initialShouldPlayEntrance}
    />
  );
}

function ClerkSymposiumV0({
  initialRoute,
  initialShouldPlayEntrance
}: {
  initialRoute: CanonicalRoute;
  initialShouldPlayEntrance: boolean | null;
}) {
  const { isLoaded: authLoaded, isSignedIn, signOut: clerkSignOut } = useAuth();
  const { user } = useUser();

  return (
    <SymposiumExperience
      initialRoute={initialRoute}
      initialShouldPlayEntrance={initialShouldPlayEntrance}
      auth={{
        clerkEnabled: true,
        authLoaded,
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
  initialRoute,
  initialShouldPlayEntrance
}: {
  auth: SymposiumAuthState;
  initialRoute: CanonicalRoute;
  initialShouldPlayEntrance: boolean | null;
}) {
  const { authLoaded, clerkEnabled, isSignedIn, userId } = auth;
  const [theme, setTheme] = useState<Theme>("day");
  const [entryMode, setEntryMode] = useState<EntryMode>(() => entryModeForBrowserSession(initialShouldPlayEntrance));
  const [signedIn, setSignedIn] = useState(false);
  const shouldPlayEntrance = useBrowserSessionEntrance(initialShouldPlayEntrance);
  const [activeRoom, setActiveRoom] = useState<RoomId>(roomForCanonicalRoute(initialRoute));
  const { items, itemsRef, replaceItems } = useInquiryEntityStore(inquiryItems);
  const [profiles, setProfiles] = useState<Record<string, ResearchProfile>>({});
  const [currentProfile, setCurrentProfile] = useState<ResearchProfile>(profile);
  const [followingHandles, setFollowingHandles] = useState<string[]>([]);
  const [profileSocialLists, setProfileSocialLists] = useState<Record<string, ProfileSocialLists>>({});
  const [feedScope, setFeedScope] = useState<FeedScope>("suggested");
  const [roomChip, setRoomChip] = useState(roomChips[0]);
  const [officeMode, setOfficeMode] = useState<OfficeMode>(officeModeForCanonicalRoute(initialRoute));
  const [patronageMode, setPatronageMode] = useState<PatronageMode>(patronageModeForCanonicalRoute(initialRoute));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    initialRoute.kind === "post" ? initialRoute.postId : null
  );
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    initialRoute.kind === "post" ? initialRoute.commentId ?? null : null
  );
  const [commentSegmentStacks, setCommentSegmentStacks] = useState<CommentSegmentStacks>({});
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(
    initialRoute.kind === "community" ? initialRoute.communityId : null
  );
  const [communitiesExpanded, setCommunitiesExpanded] = useState(false);
  const [communityQuery, setCommunityQuery] = useState("");
  const [tabletOpen, setTabletOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(initialRoute.kind === "messages");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialRoute.kind === "messages" ? initialRoute.conversationId ?? null : null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(
    initialRoute.kind === "profile" ? initialRoute.handle : null
  );
  const [profileSocialView, setProfileSocialView] = useState<ProfileSocialView | null>(
    initialRoute.kind === "profile" ? initialRoute.social ?? null : null
  );
  const [profileActiveTabs, setProfileActiveTabs] = useState<Record<string, ProfileTab>>({});
  const [profileActivityRevision, setProfileActivityRevision] = useState(0);
  const [profileActivityByHandle, setProfileActivityByHandle] = useState<
    Record<string, ProfileActivitySnapshot>
  >({});
  const [editingPost, setEditingPost] = useState<InquiryItem | null>(null);
  const [editingComment, setEditingComment] = useState<EditingCommentTarget | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewTarget | null>(null);
  const [activityRecency, setActivityRecency] = useState<Record<string, number>>({});
  const [syncStatus, setSyncStatus] = useState<string>(liveStatus.loading);
  const [authError, setAuthError] = useState("");
  const profilesRef = useRef(profiles);
  const currentProfileRef = useRef(currentProfile);
  const selectedProfileNameRef = useRef(selectedProfileName);
  const selectedItemIdRef = useRef(selectedItemId);
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
  const canonicalActionRevisionRef = useRef<Record<string, number>>({});
  const pendingCanonicalActionKeysRef = useRef(new Set<string>());
  const profileActivityRequestRef = useRef<Record<string, number>>({});
  const retryMutationKeysRef = useRef<Record<string, string>>({});
  const pendingActivityRecencyRef = useRef<Record<string, number>>({});
  const liveEventCursorRef = useRef("");
  const liveRefreshTimerRef = useRef<number | null>(null);
  const itemMutationGuardRef = useRef(createItemMutationGuard());
  const authenticatedProfileHandleRef = useRef<string | null>(null);
  const entranceStartedAtRef = useRef<number | null>(null);
  const entryAuthStateRef = useRef({ browserSignedIn: Boolean(isSignedIn), profileSynced: signedIn });
  entryAuthStateRef.current = { browserSignedIn: Boolean(isSignedIn), profileSynced: signedIn };
  const [syncedClerkUserId, setSyncedClerkUserId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState(
    "First note: make the thing feel alive without pretending the whole world is built yet."
  );

  const activeRoomData = getRoom(activeRoom);
  const themedRoomRenders = roomRenders[theme];
  const themedPatronageRenders = patronageRenders[theme];
  const themedCommunityRenders = communityRenders[theme];
  const activeRoomRender =
    activeRoom === "funding"
      ? themedPatronageRenders[patronageMode]
      : activeRoom === "communities" && selectedCommunityId
        ? themedCommunityRenders.selected
        : themedRoomRenders[activeRoom];
  const themePreloadRenders = useMemo(() => getThemePreloadRenders(theme), [theme]);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const attachmentPreviewItem = attachmentPreview
    ? items.find((item) => item.id === attachmentPreview.itemId) ?? null
    : null;
  const activeItems = useMemo(() => items.filter((item) => !isDeletedPost(item)), [items]);
  const editingPostItem = editingPost ? items.find((item) => item.id === editingPost.id) ?? editingPost : null;
  const editingCommentItem = editingComment ? items.find((item) => item.id === editingComment.itemId) ?? null : null;
  const editingCommentValue =
    editingComment && editingCommentItem
      ? findCommentById(editingCommentItem.comments, editingComment.commentId) ?? null
      : null;
  const selectedCommunity =
    selectedCommunityId ? researchCommunities.find((community) => community.id === selectedCommunityId) ?? null : null;
  const profileList = useMemo(() => Object.values(profiles), [profiles]);
  const findProfile = (nameOrHandle: string) =>
    profileList.find((person) => person.handle === nameOrHandle) ??
    profileList.find((person) => person.name === nameOrHandle) ??
    getProfileForName(nameOrHandle);
  const selectedProfile = selectedProfileName ? findProfile(selectedProfileName) : null;

  useSymposiumRenderPreload(themePreloadRenders, activeRoomRender);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

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
    const patronageItems = activeItems.filter((item) => item.room === "funding");
    const selectedPatronageItems =
      patronageMode === "lobby"
        ? []
        : patronageItems.filter((item) => matchesPatronageMode(item, patronageMode));
    const patronageFallbackItems =
      patronageMode === "lobby" || selectedPatronageItems.length ? selectedPatronageItems : patronageItems;
    const patronageIds = new Set(patronageFallbackItems.map((item) => item.id));

    const roomFiltered = activeItems
      .filter((item) => {
        if (activeRoom === "hall") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "office") {
          if (officeMode === "saved") return isSavedBy(item, currentProfile.handle, profile.handle);
          if (officeMode === "notes") {
            return itemAuthoredByProfile(item, currentProfile) || item.room === "office";
          }
          return false;
        }
        if (activeRoom === "symposium") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "library") return item.kind === "paper";
        if (activeRoom === "amphitheater") return item.kind === "thought" || item.kind === "note";
        if (activeRoom === "funding") return patronageIds.has(item.id);
        if (activeRoom === "communities") return item.room === "communities";
        if (activeRoom === "opportunities") return item.room === "opportunities";
        return true;
      })
      .filter((item) => {
        if (feedScope === "following") {
          return (
            itemAuthoredByProfile(item, currentProfile) ||
            Boolean(item.authorHandle && followingHandles.includes(item.authorHandle)) ||
            isSavedBy(item, currentProfile.handle, profile.handle)
          );
        }
        if (feedScope === "rooms") return matchesTopic(item, roomChip);
        return true;
      });

    return sortByPublishedRecency(roomFiltered);
  }, [activeItems, activeRoom, currentProfile, feedScope, followingHandles, officeMode, patronageMode, roomChip]);

  const persistLocalSnapshot = (
    nextItems = items,
    nextProfiles = profiles,
    nextProfile = currentProfile
  ) => {
    persistCachedBootstrap(
      window.localStorage,
      { items: nextItems, profiles: nextProfiles },
      nextProfile.handle
    );
  };

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

  const applySocialLists = (handle: string, lists: ProfileSocialLists) => {
    setProfileSocialLists((current) => ({
      ...current,
      [handle]: {
        following: Array.from(new Set(lists.following.map(cleanHandle).filter(Boolean))),
        followers: Array.from(new Set(lists.followers.map(cleanHandle).filter(Boolean)))
      }
    }));
  };

  const socialListsFromResponse = (data: ProfileFollowResponse): ProfileSocialLists => ({
    following: Array.from(
      new Set((data.following ?? []).map((follow) => cleanHandle(String(follow.followingHandle ?? ""))).filter(Boolean))
    ),
    followers: Array.from(
      new Set((data.followers ?? []).map((follow) => cleanHandle(String(follow.followerHandle ?? ""))).filter(Boolean))
    )
  });

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
    const mutationSnapshot = captureItemMutationSnapshot(itemMutationGuardRef.current);
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load Symposium data.");
    const data = (await response.json()) as {
      items: InquiryItem[];
      profiles: Record<string, ResearchProfile>;
      defaultProfile: ResearchProfile;
    };
    const loadedProfiles = Object.keys(data.profiles).length
      ? data.profiles
      : { [data.defaultProfile.handle]: data.defaultProfile };
    const nextProfile = selectActiveProfile({
      profiles: loadedProfiles,
      defaultProfile: data.defaultProfile,
      authenticatedHandle: authenticatedProfileHandleRef.current,
      authenticatedProfile: currentProfileRef.current,
      preferredHandle
    });

    const normalizedItems = sortByPublishedRecency(normalizeClientSeedTimes(data.items));
    for (const incoming of normalizedItems) {
      if (!itemChangedSinceSnapshot(itemMutationGuardRef.current, mutationSnapshot, incoming.id)) {
        settleFreshItemActionState(incoming, nextProfile.handle);
      }
    }
    const mutationSafeItems = sortByPublishedRecency(
      reconcileItemsAgainstMutations(
        normalizedItems,
        itemsRef.current,
        itemMutationGuardRef.current,
        mutationSnapshot
      )
    );
    const loadedItems = protectItemsFromStaleActionState(
      mutationSafeItems,
      itemsRef.current,
      nextProfile.handle
    );
    profilesRef.current = loadedProfiles;
    currentProfileRef.current = nextProfile;
    replaceItems(loadedItems);
    setProfiles(loadedProfiles);
    setCurrentProfile(nextProfile);
    persistLocalSnapshot(loadedItems, loadedProfiles, nextProfile);
    setSyncStatus(liveStatus.connected);
  };

  const refreshFollowing = async (actorHandle = currentProfile.handle) => {
    const cached = readLocalFollowing(actorHandle);
    if (cached.length) setFollowingHandles(cached);

    const response = await fetch(`/api/follows?actorHandle=${encodeURIComponent(actorHandle)}`, { cache: "no-store" });
    if (!response.ok) return;

    const data = (await response.json()) as ProfileFollowResponse;
    const lists = socialListsFromResponse(data);
    const remoteHandles = lists.following;

    setFollowingHandles(remoteHandles);
    applySocialLists(actorHandle, lists);
    persistLocalFollowing(actorHandle, remoteHandles);
  };

  const refreshProfileFollows = async (handle: string) => {
    const normalizedHandle = cleanHandle(handle);
    if (!normalizedHandle) return;

    const response = await fetch(`/api/profiles/${encodeURIComponent(normalizedHandle)}/follows`, { cache: "no-store" });
    if (!response.ok) return;

    const data = (await response.json()) as ProfileFollowResponse;
    applySocialLists(normalizedHandle, socialListsFromResponse(data));
  };

  const mergeLiveItem = (incoming: InquiryItem) => {
    const currentItems = itemsRef.current;
    const existingIndex = currentItems.findIndex((item) => item.id === incoming.id);
    const currentItem = existingIndex >= 0 ? currentItems[existingIndex] : undefined;
    if (currentItem && itemMutationIsPending(itemMutationGuardRef.current, incoming.id)) {
      scheduleLiveRefresh();
      return false;
    }
    const protectedIncoming = protectItemFromStaleActionState(incoming, currentItem, currentProfileRef.current.handle);
    const nextItem = preservePublishedPosition(protectedIncoming, currentItem);
    const nextItems =
      existingIndex >= 0
        ? currentItems.map((item) => (item.id === incoming.id ? nextItem : item))
        : sortByPublishedRecency([nextItem, ...currentItems]);

    replaceItems(nextItems);
    persistLocalSnapshot(nextItems, profilesRef.current, currentProfileRef.current);
    return true;
  };

  const mergeLiveFollow = (record: ProfileFollowRecord | undefined, active: boolean) => {
    const followerHandle = cleanHandle(String(record?.followerHandle ?? ""));
    const followingHandle = cleanHandle(String(record?.followingHandle ?? ""));
    if (!followerHandle || !followingHandle || followerHandle === "@" || followingHandle === "@") return;

    setProfileSocialLists((current) => {
      const followerLists = current[followerHandle] ?? { following: [], followers: [] };
      const followingLists = current[followingHandle] ?? { following: [], followers: [] };
      const nextFollowerFollowing = active
        ? Array.from(new Set([...followerLists.following, followingHandle]))
        : followerLists.following.filter((handle) => handle !== followingHandle);
      const nextFollowingFollowers = active
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
        const next = active
          ? Array.from(new Set([...merged, followingHandle]))
          : merged.filter((handle) => handle !== followingHandle);
        persistLocalFollowing(followerHandle, next);
        return next;
      });
    }
  };

  const scheduleLiveRefresh = () => {
    if (liveRefreshTimerRef.current) return;

    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      const handle = currentProfileRef.current.handle;
      refreshData(handle).catch(() => undefined);
      refreshFollowing(handle).catch(() => undefined);
      const selectedKey = selectedProfileNameRef.current;
      const selected = selectedKey
        ? profilesRef.current[selectedKey] ??
          Object.values(profilesRef.current).find((person) => person.name === selectedKey) ??
          getProfileForName(selectedKey)
        : null;
      if (selected?.handle) refreshProfileFollows(selected.handle).catch(() => undefined);
    }, 650);
  };

  const mergeLiveEvent = (event: SymposiumLiveEvent) => {
    if (event.cursor) liveEventCursorRef.current = event.cursor;

    const payload = event.payload ?? {};
    if (event.kind === "post.deleted") {
      if (isLiveInquiryItem(payload.item)) {
        const deletedItem = payload.item;
        mergeLiveItem(deletedItem);
        setEditingPost((current) => (current?.id === deletedItem.id ? null : current));
        setEditingComment((current) => (current?.itemId === deletedItem.id ? null : current));
      } else {
        scheduleLiveRefresh();
      }
      return;
    }

    if (event.kind === "comment.deleted" && typeof payload.commentId === "string") {
      setEditingComment((current) => (current?.commentId === payload.commentId ? null : current));
    }

    if (payload.follow || event.kind === "profile.followed" || event.kind === "profile.unfollowed") {
      mergeLiveFollow(payload.follow, event.kind !== "profile.unfollowed");
    }

    if (isLiveInquiryItem(payload.item)) {
      const action = payload.action;
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
        if (typeof payload.commentId === "string" && action !== "read") {
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
      return;
    }

    if (
      event.kind.startsWith("post.") ||
      event.kind.startsWith("comment.") ||
      event.kind.startsWith("profile.") ||
      event.kind.startsWith("community.") ||
      event.kind.startsWith("note.")
    ) {
      scheduleLiveRefresh();
    }
  };

  const fetchLiveEvents = async () => {
    const cursor = liveEventCursorRef.current;
    const response = await fetch(`/api/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {
      cache: "no-store"
    });
    if (!response.ok) return;

    const data = (await response.json()) as { events?: SymposiumLiveEvent[]; cursor?: string | null };
    for (const event of data.events ?? []) mergeLiveEvent(event);
    if (data.cursor) liveEventCursorRef.current = data.cursor;
    markLiveDataConnected();
  };

  const applyInitialRouteState = () => {
    const snapshot = snapshotForCanonicalRoute(initialRoute);
    setActiveRoom(snapshot.activeRoom);
    setSelectedItemId(snapshot.selectedItemId);
    setSelectedCommentId(snapshot.selectedCommentId);
    setSelectedProfileName(snapshot.selectedProfileName);
    setProfileSocialView(snapshot.profileSocialView);
    setOfficeMode(snapshot.officeMode);
    setPatronageMode(snapshot.patronageMode);
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
      seedItems: inquiryItems,
      snapshot: readCachedBootstrapSnapshot(window.localStorage)
    });
    const cachedItems = sortByPublishedRecency(normalizeClientSeedTimes(cached.items));
    profilesRef.current = cached.profiles;
    currentProfileRef.current = cached.currentProfile;
    setProfiles(cached.profiles);
    replaceItems(cachedItems);
    setCurrentProfile(cached.currentProfile);
  };

  useEffect(() => {
    if (entryMode === "loading") return undefined;

    let closed = false;
    let pollTimer: number | null = null;
    let source: EventSource | null = null;

    const startPolling = () => {
      if (pollTimer) return;
      void fetchLiveEvents().catch(() => undefined);
      pollTimer = window.setInterval(() => {
        if (!closed) void fetchLiveEvents().catch(() => undefined);
      }, 2500);
    };

    startPolling();

    if ("EventSource" in window) {
      const cursor = liveEventCursorRef.current;
      source = new EventSource(`/api/events/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      source.onopen = () => {
        if (!closed) markLiveDataConnected();
      };
      source.addEventListener("symposium-ready", () => {
        if (!closed) markLiveDataConnected();
      });
      source.addEventListener("symposium-heartbeat", () => {
        if (!closed) markLiveDataConnected();
      });
      source.addEventListener("symposium-event", (message) => {
        if (closed) return;
        try {
          mergeLiveEvent(JSON.parse((message as MessageEvent<string>).data) as SymposiumLiveEvent);
        } catch {
          scheduleLiveRefresh();
        }
      });
      source.onerror = () => {
        if (!closed) {
          markLiveUpdatesReconnecting();
          startPolling();
        }
      };
    }

    return () => {
      closed = true;
      source?.close();
      if (pollTimer) window.clearInterval(pollTimer);
      if (liveRefreshTimerRef.current) {
        window.clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
    };
  }, [entryMode]);

  useEffect(() => {
    if (shouldPlayEntrance === null) return;
    const storedTheme = window.localStorage.getItem("symposium-theme") as Theme | null;
    const storedNote = window.localStorage.getItem("symposium-notebook");
    const storedProfileHandle = window.localStorage.getItem("symposium-profile-handle");

    if (storedTheme === "day" || storedTheme === "night") {
      setTheme(storedTheme);
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setTheme("night");
    }
    if (storedNote) setNoteText(storedNote);
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

    refreshData(storedProfileHandle ?? undefined).catch(() => {
      setSyncStatus("Using seed data");
    });
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
    if (!selectedProfile?.handle) return;
    void refreshProfileFollows(selectedProfile.handle);
  }, [selectedProfile?.handle]);

  useEffect(() => {
    if (entryMode !== "approach" || shouldPlayEntrance !== true) return undefined;

    const startedAt = entranceStartedAtRef.current ?? Date.now();
    entranceStartedAtRef.current = startedAt;
    const timer = window.setTimeout(() => {
      const latestAuth = entryAuthStateRef.current;
      if (latestAuth.profileSynced || latestAuth.browserSignedIn) {
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
      if (entryMode === "complete") {
        window.sessionStorage.removeItem("symposium-entry-complete");
        setEntryMode("auth");
      }
      return;
    }

    if (!userId || syncedClerkUserId === userId) return;

    let cancelled = false;

    const syncAccount = async () => {
      setSyncStatus("Syncing account");
      setAuthError("");
      const response = await fetch("/api/auth/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        throw new Error("Could not sync your Symposium account.");
      }

      const data = (await response.json()) as { profile: ResearchProfile };
      if (cancelled) return;

      authenticatedProfileHandleRef.current = data.profile.handle;
      currentProfileRef.current = data.profile;
      const nextProfiles = { ...profiles, [data.profile.handle]: data.profile };
      setProfiles(nextProfiles);
      setCurrentProfile(data.profile);
      setSignedIn(true);
      setSyncedClerkUserId(userId);
      if (entryMode !== "complete" && shouldPlayEntrance === false) {
        setEntryMode("complete");
        applyInitialRouteState();
      }
      window.sessionStorage.setItem("symposium-entry-complete", "true");
      window.localStorage.setItem("symposium-profile-handle", data.profile.handle);
      await refreshData(data.profile.handle);
      setSyncStatus("Signed in");
    };

    syncAccount().catch((error) => {
      if (cancelled) return;
      setAuthError(error instanceof Error ? error.message : "Could not sync your account.");
      setSyncStatus("Account sync failed");
    });

    return () => {
      cancelled = true;
    };
  }, [authLoaded, clerkEnabled, entryMode, isSignedIn, profiles, syncedClerkUserId, userId]);

  useEffect(() => {
    window.localStorage.setItem("symposium-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("symposium-notebook", noteText);
  }, [noteText]);

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

  const acceptCanonicalActivity = (activity: CanonicalActionActivityContract) => {
    const key = canonicalActivityKey(activity);
    const currentRevision = canonicalActionRevisionRef.current[key] ?? 0;
    if (activity.revision < currentRevision) return false;

    pendingCanonicalActionKeysRef.current.delete(key);
    canonicalActionRevisionRef.current[key] = activity.revision;
    const handle = cleanHandle(activity.actorHandle);
    const current = profileActivityByHandleRef.current[handle] ?? {
      entries: [],
      loaded: false,
      nextCursor: null
    };
    setProfileActivitySnapshot(handle, {
      ...current,
      entries: mergeCanonicalActivities(current.entries, [activity])
    });
    recordCanonicalActivityRecency(activity);
    return true;
  };

  const replaceCanonicalProfileActivity = (
    handle: string,
    response: ProfileActivityResponseContract,
    requestStartRevisions: Record<string, number>
  ) => {
    const clean = cleanHandle(handle);
    const currentEntries = profileActivityByHandleRef.current[clean]?.entries ?? [];
    const entries = reconcileCanonicalActivityRefresh({
      current: currentEntries,
      incoming: response.entries,
      pendingKeys: pendingCanonicalActionKeysRef.current,
      currentRevisions: canonicalActionRevisionRef.current,
      requestStartRevisions
    });
    const finalKeys = new Set(entries.map(canonicalActivityKey));
    for (const activity of currentEntries) {
      const key = canonicalActivityKey(activity);
      if (!finalKeys.has(key)) delete canonicalActionRevisionRef.current[key];
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
      entries,
      loaded: true,
      nextCursor: response.nextCursor
    });
  };

  const refreshProfileActivity = async (handle: string, actorHandle = currentProfileRef.current.handle) => {
    const clean = cleanHandle(handle);
    if (!clean || clean === "@") return;
    const requestId = (profileActivityRequestRef.current[clean] ?? 0) + 1;
    profileActivityRequestRef.current[clean] = requestId;
    const requestStartRevisions = { ...canonicalActionRevisionRef.current };
    const entries: CanonicalActionActivityContract[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ limit: "500", actorHandle });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(
        `/api/profiles/${encodeURIComponent(clean)}/activity?${params.toString()}`,
        { cache: "no-store" }
      );
      if (!response.ok) return;
      const data = (await response.json()) as Partial<ProfileActivityResponseContract>;
      entries.push(...(data.entries ?? []).filter(isCanonicalActionActivity));
      const nextCursor = typeof data.nextCursor === "string" ? data.nextCursor : null;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        cursor = null;
      } else {
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
    } while (cursor);

    if (profileActivityRequestRef.current[clean] !== requestId) return;
    replaceCanonicalProfileActivity(clean, {
      entries,
      nextCursor: null
    }, requestStartRevisions);
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
    const current = profileActivityByHandleRef.current[handle] ?? {
      entries: [],
      loaded: false,
      nextCursor: null
    };
    const previous = canonicalActionState(current.entries, subjectType, subjectId, handle, action);
    const key = canonicalActivityKey({ subjectType, subjectId, actorHandle: handle, action });
    pendingCanonicalActionKeysRef.current.add(key);
    const optimistic = {
      ...createLocalCanonicalActivity({ subjectType, subjectId, postId, actorHandle: handle, action, active }),
      revision: previous?.revision ?? 1
    };
    setProfileActivitySnapshot(handle, {
      ...current,
      entries: mergeCanonicalActivities(current.entries, [optimistic])
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
    const entries = current.entries.filter((activity) => canonicalActivityKey(activity) !== key);
    if (previous) entries.push(previous);
    setProfileActivitySnapshot(handle, { ...current, entries: mergeCanonicalActivities([], entries) });
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

  useEffect(() => {
    if (!signedIn || !currentProfile.handle) return;
    void refreshProfileActivity(currentProfile.handle, currentProfile.handle);
  }, [currentProfile.handle, signedIn]);

  useEffect(() => {
    if (!selectedProfile?.handle) return;
    void refreshProfileActivity(selectedProfile.handle, currentProfile.handle);
  }, [currentProfile.handle, selectedProfile?.handle]);

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
      selectedCommentId,
      selectedProfileName,
      profileSocialView,
      officeMode,
      patronageMode,
      selectedCommunityId,
      messagesOpen,
      selectedConversationId,
      commentSegmentStacks: cloneCommentSegmentStacks({
        ...commentSegmentStacksRef.current,
        ...visibleCommentSegmentStacksRef.current,
        ...domSegmentStacks
      }),
      scrollAnchor,
      scrollY: window.scrollY
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
    setSelectedCommentId(snapshot.selectedCommentId);
    setSelectedProfileName(snapshot.selectedProfileName);
    setProfileSocialView(snapshot.profileSocialView ?? null);
    setOfficeMode(snapshot.officeMode);
    setPatronageMode(snapshot.patronageMode);
    setSelectedCommunityId(snapshot.selectedCommunityId);
    const restoredSegmentStacks = cloneCommentSegmentStacks(snapshot.commentSegmentStacks ?? {});
    commentSegmentStacksRef.current = restoredSegmentStacks;
    visibleCommentSegmentStacksRef.current = {};
    setCommentSegmentStacks(restoredSegmentStacks);
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
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
      scrollY: scrollY ?? currentSnapshot.scrollY
    };
    recordNavigation(currentSnapshot, nextSnapshot);
    if (next.activeRoom !== undefined) setActiveRoom(next.activeRoom);
    if (next.selectedItemId !== undefined) setSelectedItemId(next.selectedItemId);
    if (next.selectedCommentId !== undefined) setSelectedCommentId(next.selectedCommentId);
    if (next.selectedProfileName !== undefined) setSelectedProfileName(next.selectedProfileName);
    if (next.profileSocialView !== undefined) setProfileSocialView(next.profileSocialView);
    if (next.selectedItemId !== undefined && next.selectedItemId !== selectedItemId) {
      commentSegmentStacksRef.current = {};
      visibleCommentSegmentStacksRef.current = {};
      setCommentSegmentStacks({});
    }
    if (next.officeMode !== undefined) setOfficeMode(next.officeMode);
    if (next.patronageMode !== undefined) setPatronageMode(next.patronageMode);
    if (next.selectedCommunityId !== undefined) setSelectedCommunityId(next.selectedCommunityId);
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
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
      selectedCommentId: null,
      selectedProfileName: null,
      profileSocialView: null,
      officeMode: roomId === "office" ? mode : "desk",
      patronageMode: roomId === "funding" ? "lobby" : patronageMode,
      selectedCommunityId: null
    });
  };

  const toggleOfficeMode = (mode: Exclude<OfficeMode, "desk">) => {
    enterRoom("office", activeRoom === "office" && officeMode === mode ? "desk" : mode);
  };

  const openPatronageMode = (mode: PatronageMode) => {
    navigateView({
      activeRoom: "funding",
      selectedItemId: null,
      selectedCommentId: null,
      selectedProfileName: null,
      profileSocialView: null,
      officeMode: "desk",
      patronageMode: mode,
      selectedCommunityId: null
    });
  };

  const openCommunity = (communityId: string) => {
    navigateView({
      activeRoom: "communities",
      selectedItemId: null,
      selectedCommentId: null,
      selectedProfileName: null,
      profileSocialView: null,
      officeMode: "desk",
      patronageMode: "lobby",
      selectedCommunityId: communityId
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
      patronageMode: "lobby",
      selectedCommunityId: null
    });
  };

  const openProfile = (profileKey: string) => {
    flushPendingActivityRecency();
    navigateView({
      selectedProfileName: profileKey,
      profileSocialView: null,
      selectedItemId: null,
      selectedCommentId: null
    });
  };

  const changeProfileSocialView = (view: ProfileSocialView | null) => {
    if (!selectedProfileName) return;
    navigateView({ profileSocialView: view }, null);
  };

  const changeProfileTab = (handle: string, tab: ProfileTab) => {
    flushPendingActivityRecency();
    setProfileActiveTabs((current) => ({ ...current, [handle]: tab }));
  };

  const openNotebook = () => {
    setTabletOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesOpen(false);
    setNotebookOpen(true);
  };

  const openTablet = () => {
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesOpen(false);
    setTabletOpen(true);
  };

  const openSearch = () => {
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setMessagesOpen(false);
    setSearchOpen(true);
  };

  const openAttachmentPreview: AttachmentPreviewHandler = (item, attachmentId) => {
    setAttachmentPreview({ itemId: item.id, attachmentId });
  };

  const routePostRoom = (kind: PostDraft["kind"]): Exclude<RoomId, "hall" | "office"> =>
    kind === "paper" ? "library" : "amphitheater";

  const uploadPostAttachment = async (file: File): Promise<InquiryAttachment> => {
    const contentType = file.type || "application/octet-stream";
    const metadata = await buildPostAttachmentMetadata(file, contentType);
    return uploadConfirmedPostAttachment({
      actorHandle: currentProfile.handle,
      file,
      idempotencyKey: clientMutationId("attachment-prepare"),
      metadata
    });
  };

  const retryMutationKey = (scope: string, fingerprint: string) => {
    const key = `${scope}:${fingerprint}`;
    const current = retryMutationKeysRef.current[key];
    if (current) return { fingerprintKey: key, idempotencyKey: current };
    const idempotencyKey = clientMutationId(scope);
    retryMutationKeysRef.current[key] = idempotencyKey;
    return { fingerprintKey: key, idempotencyKey };
  };

  const clearRetryMutationKey = (fingerprintKey: string) => {
    delete retryMutationKeysRef.current[fingerprintKey];
  };

  const createPost = async ({ title, body, kind, attachments }: PostDraft) => {
    const routedRoom = routePostRoom(kind);
    const createdAt = new Date().toISOString();
    const postPayload = {
      title,
      body,
      kind,
      room: routedRoom,
      authorHandle: currentProfile.handle,
      attachmentIds: attachments.map((attachment) => attachment.id)
    };
    const mutation = retryMutationKey("post-create", JSON.stringify(postPayload));
    setSyncStatus("Posting");
    let response: Response;
    try {
      response = await fetch("/api/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": mutation.idempotencyKey
        },
        body: JSON.stringify(postPayload)
      });
    } catch {
      setSyncStatus("Post could not reach the live service");
      return { ok: false as const, error: "Post could not reach the live service" };
    }

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status < 500 && response.status !== 409) clearRetryMutationKey(mutation.fingerprintKey);
      setSyncStatus(error?.error ?? "Post could not be saved");
      return { ok: false as const, error: error?.error ?? "Post could not be saved" };
    }

    const data = (await response.json()) as { item: InquiryItem };
    clearRetryMutationKey(mutation.fingerprintKey);
    const committedItem = { ...data.item, createdAt: data.item.createdAt ?? createdAt };
    const nextItems = sortByPublishedRecency([committedItem, ...items.filter((item) => item.id !== committedItem.id)]);
    touchActivity(committedItem.id);
    replaceItems(nextItems);
    persistLocalSnapshot(nextItems, profiles);
    navigateView({
      activeRoom: committedItem.room,
      selectedItemId: committedItem.id,
      selectedCommentId: null,
      selectedProfileName: null,
      officeMode: "desk"
    });
    setComposerOpen(false);
    setSyncStatus("Post saved");
    return { ok: true as const };
  };

  const addComment = async (itemId: string, body: string, stance: string, parentId?: string | null) => {
    const previousItems = itemsRef.current;
    const previousSelectedItemId = selectedItemId;
    const previousSelectedCommentId = selectedCommentId;
    const existing = previousItems.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing)) {
      setSyncStatus("This post cannot accept comments");
      return;
    }

    if (parentId && !findCommentById(existing.comments, parentId)) {
      setSyncStatus("Reply target is no longer available");
      return;
    }

    setSyncStatus(parentId ? "Saving reply" : "Saving comment");

    const optimisticComment: InquiryComment = {
      id: clientId("comment"),
      parentId: parentId ?? null,
      author: currentProfile.name,
      authorHandle: currentProfile.handle,
      stance: stance.trim() || "Comment",
      body,
      createdAt: new Date().toISOString(),
      metrics: { ...commentMetricsFallback },
      savedBy: [],
      signaledBy: [],
      forkedBy: [],
      replies: []
    };
    const appended = appendCommentToTree(existing.comments, optimisticComment);
    if (!appended.inserted) {
      setSyncStatus("Reply target is no longer available");
      return;
    }

    beginItemMutation(itemMutationGuardRef.current, itemId);
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

    const commentPayload = { body, stance, parentId: parentId ?? null, authorHandle: currentProfile.handle };
    const mutation = retryMutationKey(
      "comment-create",
      JSON.stringify({ itemId, ...commentPayload })
    );

    try {
      const response = await fetch(`/api/posts/${itemId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": mutation.idempotencyKey
        },
        body: JSON.stringify(commentPayload)
      });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status < 500 && response.status !== 409) clearRetryMutationKey(mutation.fingerprintKey);
        rollbackOptimisticComment(
          errorData.error ?? (parentId ? "Reply could not be saved" : "Comment could not be saved")
        );
        return;
      }

      const data = (await response.json().catch(() => ({}))) as { comment?: InquiryComment; item?: InquiryItem };
      clearRetryMutationKey(mutation.fingerprintKey);
      if (data.item) {
        const currentItem = itemsRef.current.find((item) => item.id === itemId);
        const committedItem = preservePublishedPosition(
          protectItemFromStaleActionState(data.item, currentItem, currentProfile.handle),
          currentItem
        );
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
    } catch {
      rollbackOptimisticComment(
        parentId ? "Reply could not reach the live service" : "Comment could not reach the live service"
      );
    } finally {
      completeItemMutation(itemMutationGuardRef.current, itemId);
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

    if (!allowedImageTypes.has(file.type)) {
      throw new Error("Choose a PNG, JPG, JPEG, WEBP, GIF, or AVIF image.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Profile photos must be 5 MB or smaller.");
    }

    setSyncStatus("Preparing profile photo");
    const uploadResponse = await prepareAttachmentUpload({
        actorHandle: currentProfile.handle,
        fileName: file.name,
        contentType: file.type,
        byteSize: file.size,
        ownerType: "profile",
        ownerId: currentProfile.handle
    }, clientMutationId("attachment-prepare"));

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
    const putResponse = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file
    });

    if (!putResponse.ok) {
      throw new Error("Could not upload the profile photo.");
    }

    const confirmResponse = await confirmAttachmentUpload({
        actorHandle: currentProfile.handle,
        attachmentId: upload.attachmentId,
        byteSize: file.size
    });

    if (!confirmResponse.ok) {
      throw new Error("Could not confirm the profile photo upload.");
    }

    const confirmed = (await confirmResponse.json()) as AttachmentConfirmResponse;
    const publicUrl = confirmed.publicUrl ?? upload.publicUrl;
    if (!publicUrl) throw new Error("The confirmed profile photo does not have a persistent URL.");

    setSyncStatus("Profile photo ready");
    return publicUrl;
  };

  const saveProfileSettings = async (draft: ProfileSettingsDraft) => {
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

    setCurrentProfile(updatedProfile);
    setProfiles(nextProfiles);
    replaceItems(nextItems);
    if (selectedProfileName === currentProfile.name || selectedProfileName === currentProfile.handle) {
      setSelectedProfileName(updatedProfile.handle);
    }
    persistLocalSnapshot(nextItems, nextProfiles, updatedProfile);
    setSettingsOpen(false);
    setSyncStatus("Saving profile settings");

    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: updatedProfile.name,
        handle: updatedProfile.handle,
        email: updatedProfile.email,
        avatarUrl: updatedProfile.avatarUrl,
        likesPublic: updatedProfile.likesPublic,
        resharesPublic: updatedProfile.resharesPublic,
        role: updatedProfile.role,
        location: updatedProfile.location,
        bio: updatedProfile.bio,
        fields: updatedProfile.fields
      })
    });

    if (response.ok) {
      const data = (await response.json()) as { profile: ResearchProfile };
      const committedProfile = { ...updatedProfile, ...data.profile };
      const committedProfiles = { ...nextProfiles, [committedProfile.handle]: committedProfile };
      const committedItems = nextItems.map((item) => ({
        ...item,
        author: item.authorHandle === committedProfile.handle ? committedProfile.name : item.author,
        comments: updateCommentsForProfile(item.comments, committedProfile)
      }));
      setCurrentProfile(committedProfile);
      setProfiles(committedProfiles);
      replaceItems(committedItems);
      persistLocalSnapshot(committedItems, committedProfiles, committedProfile);
      setSyncStatus("Profile settings saved");
    } else {
      setSyncStatus("Profile saved locally");
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

    setFollowingHandles(nextHandles);
    applySocialLists(currentProfile.handle, { ...currentSocial, following: nextHandles });
    applySocialLists(normalizedTarget, { ...targetSocial, followers: nextTargetFollowers });
    persistLocalFollowing(currentProfile.handle, nextHandles);
    setSyncStatus(wasFollowing ? "Unfollowing profile" : "Following profile");

    try {
      const response = await fetch(`/api/profiles/${encodeURIComponent(normalizedTarget)}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Follow action failed.");
      setSyncStatus(wasFollowing ? "Profile unfollowed" : "Following profile");
    } catch {
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
    setEntryMode("auth");
  };

  const applyAction = async (itemId: string, action: PostAction, options: ViewActionOptions = {}) => {
    const isViewAction = action === "read";
    if (isViewAction && !claimClientView("post", itemId)) return;

    const actorHandle = currentProfile.handle;
    const actionKey = `${itemId}:${action}:${actorHandle}`;
    const version = (actionVersionsRef.current[actionKey] ?? 0) + 1;
    actionVersionsRef.current[actionKey] = version;
    const mutationKey = clientMutationId("post-action");

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
    beginItemMutation(itemMutationGuardRef.current, itemId);
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
      const response = await fetch(`/api/posts/${itemId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": mutationKey },
        body: JSON.stringify({ action, actorHandle, active: desiredActive, trigger: options.trigger, surface: options.surface })
      });

      if (!response.ok) throw new Error("Post action failed.");

      const data = (await response.json()) as { item: InquiryItem; activity?: unknown };
      if (actionVersionsRef.current[actionKey] !== version) {
        const latestActive = protectedDesiredActionState(actionKey);
        if (latestActive !== undefined) {
          void fetch(`/api/posts/${itemId}/actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, actorHandle, active: latestActive, trigger: options.trigger, surface: options.surface })
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
          ? preservePublishedPosition(protectItemFromStaleActionState(data.item, item, actorHandle), item)
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
      completeItemMutation(itemMutationGuardRef.current, itemId);
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
    const actionKey = `${itemId}:${commentId}:${action}:${actorHandle}`;
    const version = (actionVersionsRef.current[actionKey] ?? 0) + 1;
    actionVersionsRef.current[actionKey] = version;
    const mutationKey = clientMutationId("comment-action");

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
    beginItemMutation(itemMutationGuardRef.current, itemId);
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
      const response = await fetch(`/api/posts/${itemId}/comments/${commentId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": mutationKey },
        body: JSON.stringify({ action, actorHandle, active: desiredActive, trigger: options.trigger, surface: options.surface })
      });

      if (!response.ok) throw new Error("Comment action failed.");

      const data = (await response.json()) as { item: InquiryItem; activity?: unknown };
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
          ? preservePublishedPosition(protectItemFromStaleActionState(data.item, item, actorHandle), item)
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
      completeItemMutation(itemMutationGuardRef.current, itemId);
    }
  };

  const savePostEdit = async (itemId: string, draft: { title: string; body: string }) => {
    const cleanTitle = draft.title.trim();
    const cleanBody = draft.body.trim();
    if (!cleanTitle || !cleanBody) return;

    const previousItems = itemsRef.current;
    const existing = previousItems.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing)) return;
    beginItemMutation(itemMutationGuardRef.current, itemId);
    const editedAt = new Date().toISOString();
    const optimisticItems = previousItems.map((item) =>
      item.id === itemId
        ? { ...item, title: cleanTitle, body: cleanBody, excerpt: cleanBody, claims: [cleanBody], editedAt }
        : item
    );

    replaceItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    setEditingPost(null);
    setSyncStatus("Saving post edit");

    try {
      const response = await fetch(`/api/posts/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: cleanTitle, body: cleanBody, actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Post edit failed.");

      const data = (await response.json()) as { item: InquiryItem };
      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId ? preservePublishedPosition(data.item, item) : item
      );
      replaceItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setSyncStatus("Post edited");
    } catch {
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Post edit could not sync");
    } finally {
      completeItemMutation(itemMutationGuardRef.current, itemId);
    }
  };

  const deletePost = async (itemId: string) => {
    const item = itemsRef.current.find((current) => current.id === itemId);
    if (!item || isDeletedPost(item) || cleanHandle(item.authorHandle ?? item.author) !== currentProfile.handle) return;
    if (!window.confirm(`Delete "${item.title}"?`)) return;

    beginItemMutation(itemMutationGuardRef.current, itemId);
    const previousItems = itemsRef.current;
    const deleted = tombstonePost(item);
    const nextItems = previousItems.map((current) => (current.id === itemId ? deleted : current));
    replaceItems(nextItems);
    persistLocalSnapshot(nextItems, profilesRef.current);
    setEditingPost(null);
    setSyncStatus("Deleting post");

    try {
      const response = await fetch(`/api/posts/${itemId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Post delete failed.");
      const data = (await response.json()) as { item?: InquiryItem };
      if (data.item) {
        const committedItems = itemsRef.current.map((current) =>
          current.id === itemId ? preservePublishedPosition(data.item!, current) : current
        );
        replaceItems(committedItems);
        persistLocalSnapshot(committedItems, profilesRef.current);
      }
      setSyncStatus("Post deleted");
    } catch {
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Post delete could not sync");
    } finally {
      completeItemMutation(itemMutationGuardRef.current, itemId);
    }
  };

  const saveCommentEdit = async (itemId: string, commentId: string, body: string) => {
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

    beginItemMutation(itemMutationGuardRef.current, itemId);
    const editedAt = new Date().toISOString();
    const optimisticItems = previousItems.map((item) => {
      if (item.id !== itemId) return item;
      const mapped = mapCommentTree(item.comments, commentId, (comment) => ({
        ...comment,
        body: cleanBody,
        editedAt
      }));
      return mapped.updated ? { ...item, comments: mapped.comments } : item;
    });

    replaceItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    setEditingComment(null);
    setSyncStatus("Saving comment edit");

    try {
      const response = await fetch(`/api/posts/${itemId}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: cleanBody, actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Comment edit failed.");

      const data = (await response.json()) as { item: InquiryItem };
      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId ? preservePublishedPosition(data.item, item) : item
      );
      replaceItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setSyncStatus("Comment edited");
    } catch {
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Comment edit could not sync");
    } finally {
      completeItemMutation(itemMutationGuardRef.current, itemId);
    }
  };

  const deleteComment = async (itemId: string, commentId: string) => {
    const item = itemsRef.current.find((current) => current.id === itemId);
    const comment = item ? findCommentById(item.comments, commentId) : undefined;
    if (
      !item ||
      !comment ||
      isDeletedComment(comment) ||
      cleanHandle(comment.authorHandle ?? comment.author) !== currentProfile.handle
    ) {
      return;
    }
    if (!window.confirm("Delete this comment?")) return;

    beginItemMutation(itemMutationGuardRef.current, itemId);
    const previousItems = itemsRef.current;
    const nextItems = previousItems.map((current) => {
      if (current.id !== itemId) return current;
      return tombstoneCommentInItem(current, commentId).item;
    });
    replaceItems(nextItems);
    persistLocalSnapshot(nextItems, profilesRef.current);
    setEditingComment((current) =>
      current?.itemId === itemId && current.commentId === commentId ? null : current
    );
    setSyncStatus("Deleting comment");

    try {
      const response = await fetch(`/api/posts/${itemId}/comments/${commentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Comment delete failed.");
      const data = (await response.json()) as { item?: InquiryItem };
      if (data.item) {
        const committedItems = itemsRef.current.map((current) =>
          current.id === itemId ? preservePublishedPosition(data.item!, current) : current
        );
        replaceItems(committedItems);
        persistLocalSnapshot(committedItems, profilesRef.current);
      }
      setSyncStatus("Comment deleted");
    } catch {
      replaceItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Comment delete could not sync");
    } finally {
      completeItemMutation(itemMutationGuardRef.current, itemId);
    }
  };

  const openPost = (id: string, commentId?: string | null, sourceSurface?: ViewSurface) => {
    navigateView(
      {
        selectedItemId: id,
        selectedCommentId: commentId ?? null,
        selectedProfileName: null,
        profileSocialView: null
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

  const currentContext = selectedItem
    ? `${selectedItem.title}: ${selectedItem.gatheringReason}`
    : `${activeRoomData.name}: ${activeRoomData.description}`;

  const searchResults = useMemo(() => {
    const term = normalizeSearchPhrase(searchQuery);
    if (!term) return { titleMatches: [] as InquiryItem[], contentMatches: [] as InquiryItem[], profileMatches: [] as ResearchProfile[] };

    const titleMatches = sortByPublishedRecency(
      activeItems.filter((item) => normalizeSearchPhrase(item.title).includes(term))
    );
    const titleIds = new Set(titleMatches.map((item) => item.id));
    const contentMatches = sortByPublishedRecency(
      activeItems.filter((item) => !titleIds.has(item.id) && normalizeSearchPhrase(searchableContentText(item)).includes(term))
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

  if (entryMode !== "complete") {
    return (
      <EntrySequence
        theme={theme}
        entranceRender={entranceRenders[theme]}
        mode={entryMode}
        authError={authError}
        authLoaded={authLoaded}
        clerkEnabled={clerkEnabled}
        onLocalPreview={enterLocalPreview}
        preloadRenders={themePreloadRenders}
        playApproach={shouldPlayEntrance === true}
      />
    );
  }

  return (
    <main
      className={`symposium-shell ${theme}`}
      data-room={activeRoom}
      data-patronage-mode={activeRoom === "funding" ? patronageMode : undefined}
      data-community-selected={selectedCommunity ? "true" : undefined}
      data-view={selectedProfile ? "profile" : selectedItem ? "detail" : activeRoom === "hall" ? "hall" : "room"}
      style={{ "--room-bg": `url(${activeRoomRender})` } as CSSProperties}
    >
      <div className="ambient-layer" aria-hidden="true" />
      <RenderPreloadDeck sources={themePreloadRenders} />

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
            Boolean(selectedItemId || selectedProfileName || selectedCommunityId || messagesOpen)
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
          <CanonicalLink
            className="icon-button"
            title="Messages"
            route={{ kind: "messages" }}
            onNavigate={() => {
              navigateView({ messagesOpen: true, selectedConversationId: null });
            }}
          >
            <MessageCircle size={18} />
          </CanonicalLink>
          <CanonicalLink
            className="profile-button"
            title="Open your profile"
            route={{ kind: "profile", handle: currentProfile.handle }}
            onNavigate={() => openProfile(currentProfile.handle)}
          >
            <UserRound size={18} />
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
        {selectedProfile ? (
          <ProfileView
            person={selectedProfile}
            items={items}
            isOwnProfile={selectedProfile.handle === currentProfile.handle}
            isFollowing={followingHandles.includes(selectedProfile.handle)}
            onSelect={openPost}
            onOpenProfile={openProfile}
            onAction={applyAction}
            onCommentAction={applyCommentAction}
            onEditComment={(itemId, commentId) => setEditingComment({ itemId, commentId })}
            onDeleteComment={deleteComment}
            onOpenSettings={() => {
              setNotebookOpen(false);
              setTabletOpen(false);
              setComposerOpen(false);
              setSearchOpen(false);
              setMessagesOpen(false);
              setSettingsOpen(true);
            }}
            onToggleFollow={toggleFollow}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            socialLists={profileSocialLists[selectedProfile.handle] ?? { following: [], followers: [] }}
            socialView={profileSocialView}
            getProfileRecency={getProfileRecency}
            getProfileCommentRecency={getProfileCommentRecency}
            activeTab={profileActiveTabs[selectedProfile.handle] ?? "all"}
            activityRevision={profileActivityRevision}
            canonicalActivities={profileActivityByHandle[selectedProfile.handle]?.entries ?? []}
            canonicalActivityLoaded={profileActivityByHandle[selectedProfile.handle]?.loaded ?? false}
            onActiveTabChange={(tab) => changeProfileTab(selectedProfile.handle, tab)}
            onSocialViewChange={changeProfileSocialView}
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
            onOpenAttachmentPreview={openAttachmentPreview}
          />
        ) : selectedItem ? (
          <DetailView
            item={selectedItem}
            room={activeRoomData}
            onBack={goBack}
            onOpenProfile={openProfile}
            onAddComment={addComment}
            onAction={applyAction}
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
          />
        ) : activeRoom === "hall" ? (
          <HallView onEnter={enterRoom} />
        ) : activeRoom === "office" && officeMode === "desk" ? (
          <OfficeDeskView
            room={activeRoomData}
            onOpenSaved={() => toggleOfficeMode("saved")}
            onOpenNotes={() => toggleOfficeMode("notes")}
          />
        ) : activeRoom === "funding" && patronageMode === "lobby" ? (
          <PatronageLobbyView
            room={activeRoomData}
            onOpenCivic={() => openPatronageMode("civic")}
            onOpenPrivate={() => openPatronageMode("private")}
          />
        ) : activeRoom === "communities" && selectedCommunity ? (
          <SelectedCommunityView
            community={selectedCommunity}
            items={items}
            currentProfile={currentProfile}
            profiles={profiles}
            onBack={closeCommunity}
            onSelect={openPost}
            onOpenProfile={openProfile}
            onAction={applyAction}
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
            onOpenAttachmentPreview={openAttachmentPreview}
            onDummyCall={(mode) => setSyncStatus(`${mode} call placeholder`)}
          />
        ) : activeRoom === "communities" ? (
          <CommunitiesDirectoryView
            communities={researchCommunities}
            items={items}
            currentProfile={currentProfile}
            query={communityQuery}
            onQuery={setCommunityQuery}
            expanded={communitiesExpanded}
            onExpanded={setCommunitiesExpanded}
            onOpenCommunity={openCommunity}
          />
        ) : (
          <RoomView
            room={activeRoomData}
            items={visibleItems}
            officeMode={activeRoom === "office" ? officeMode : undefined}
            patronageMode={activeRoom === "funding" ? patronageMode : undefined}
            feedScope={feedScope}
            roomChip={roomChip}
            onFeedScope={setFeedScope}
            onRoomChip={setRoomChip}
            onPatronageMode={openPatronageMode}
            onSelect={openPost}
            onOpenProfile={openProfile}
            onAction={applyAction}
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
            onOpenNotes={() => toggleOfficeMode("notes")}
            onOpenSaved={() => toggleOfficeMode("saved")}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            onOpenAttachmentPreview={openAttachmentPreview}
          />
        )}
      </section>

      <button
        className="new-post-launcher bottom-action bottom-action-new"
        type="button"
        onClick={() => {
          setNotebookOpen(false);
          setTabletOpen(false);
          setSettingsOpen(false);
          setSearchOpen(false);
          setMessagesOpen(false);
          setComposerOpen(true);
        }}
      >
        <NotebookPen size={18} />
        <span>New post</span>
      </button>

      <button
        className="pocket pocket-left bottom-action bottom-action-notebook"
        type="button"
        title="Notebook"
        onClick={openNotebook}
      >
        <NotebookPen size={18} />
        <span>Notebook</span>
      </button>

      <button
        className="pocket pocket-right bottom-action bottom-action-tablet"
        type="button"
        title="AI tablet"
        onClick={openTablet}
      >
        <BrainCircuit size={18} />
        <span>AI Tablet</span>
      </button>

      {notebookOpen ? (
        <NotebookPanel
          noteText={noteText}
          setNoteText={setNoteText}
          context={selectedItem?.title ?? activeRoomData.name}
          onClose={() => setNotebookOpen(false)}
        />
      ) : null}

      {tabletOpen ? (
        <TabletPanel
          context={currentContext}
          selectedItem={selectedItem}
          room={activeRoomData}
          onClose={() => setTabletOpen(false)}
        />
      ) : null}

      {messagesOpen ? (
        <MessagesModal
          activeConversationId={selectedConversationId}
          onClose={goBack}
          onOpenConversation={(conversationId) =>
            navigateView({ messagesOpen: true, selectedConversationId: conversationId }, null)
          }
        />
      ) : null}

      {composerOpen ? (
        <PostComposerModal
          onClose={() => setComposerOpen(false)}
          onCreatePost={createPost}
          onUploadAttachment={uploadPostAttachment}
        />
      ) : null}

      {editingPostItem ? (
        <PostEditModal
          key={editingPostItem.id}
          item={editingPostItem}
          onClose={() => setEditingPost(null)}
          onSave={savePostEdit}
          onDelete={deletePost}
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
        />
      ) : null}

      {attachmentPreview && attachmentPreviewItem ? (
        <AttachmentPreviewModal
          item={attachmentPreviewItem}
          attachmentId={attachmentPreview.attachmentId}
          onClose={() => setAttachmentPreview(null)}
        />
      ) : null}

      {searchOpen ? (
        <SearchModal
          query={searchQuery}
          setQuery={setSearchQuery}
          results={searchResults}
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
  );
}
