"use client";

import Image from "next/image";
import { SignInButton, SignUpButton, useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BrainCircuit,
  Eye,
  Home,
  MessageCircle,
  Moon,
  NotebookPen,
  Pencil,
  Repeat2,
  Search,
  Send,
  Sparkles,
  Settings,
  Sun,
  ThumbsUp,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import {
  feedScopes,
  getProfileForName,
  inquiryItems,
  profile,
  researchCommunities,
  roomChips,
  rooms,
  type FeedScope,
  type InquiryComment,
  type InquiryItem,
  type ResearchCommunity,
  type ResearchProfile,
  type Room,
  type RoomId
} from "@/lib/mockData";
import type { CommentAction, PostAction } from "@/lib/dataStore";
import {
  cleanHandle,
  countComments,
  formatMetric,
  hasHandle,
  incrementMetric,
  itemTimestampScore,
  isSavedBy,
  localDateTimeLabel,
  metricNumber,
  mutateItemForActor,
  normalizeSearchPhrase,
  relativeTimeLabel,
  toggleHandle
} from "@/lib/symposiumCore";

type Theme = "day" | "night";
type ProfileTab = "all" | "papers" | "thoughts" | "comments" | "reshares" | "likes" | "saved";
type ProfileActivityKind = "authored" | "comments" | "fork" | "signal" | "save";
type ProfileCommentActivityKind = Exclude<ProfileActivityKind, "authored">;
type EntryMode = "loading" | "approach" | "auth" | "complete";
type OfficeMode = "desk" | "saved" | "notes";
type PatronageMode = "lobby" | "civic" | "private";
type CommentSegmentStacks = Record<string, string[]>;

type ViewSnapshot = {
  activeRoom: RoomId;
  selectedItemId: string | null;
  selectedCommentId: string | null;
  selectedProfileName: string | null;
  officeMode: OfficeMode;
  patronageMode: PatronageMode;
  selectedCommunityId: string | null;
  commentSegmentStacks: CommentSegmentStacks;
  scrollY: number;
};

type LocalSnapshot = {
  profiles: Record<string, ResearchProfile>;
  items: InquiryItem[];
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

type ProfileSocialLists = {
  following: string[];
  followers: string[];
};

type ProfileCommentActivity = {
  id: string;
  item: InquiryItem;
  comment: InquiryComment;
  kind: ProfileCommentActivityKind;
  label: string;
  recency: number;
};

type ProfileActivityEntry =
  | { id: string; type: "post"; item: InquiryItem; recency: number }
  | { id: string; type: "comment"; activity: ProfileCommentActivity; recency: number };

type ProfileActivitySlot =
  | { id: string; type: "post"; itemId: string; recency: number }
  | {
      id: string;
      type: "comment";
      itemId: string;
      commentId: string;
      kind: ProfileCommentActivityKind;
      label: string;
      recency: number;
    };

type PostDraft = {
  title: string;
  body: string;
  kind: Extract<InquiryItem["kind"], "paper" | "thought">;
};

type ProfileSettingsDraft = {
  avatarUrl?: string;
  name: string;
  bio: string;
  likesPublic: boolean;
  resharesPublic: boolean;
};

type AttachmentUploadResponse = {
  attachmentId?: string;
  uploadUrl?: string;
  publicUrl?: string | null;
};

type LiveEventPayload = {
  item?: unknown;
  follow?: ProfileFollowRecord;
  action?: PostAction;
  itemId?: string;
  commentId?: string;
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

const kindLabels: Record<InquiryItem["kind"], string> = {
  paper: "Paper",
  thought: "Thought",
  draft: "Draft",
  note: "Note",
  code: "Code"
};

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

const getRoom = (roomId: RoomId) => rooms.find((room) => room.id === roomId) ?? rooms[0];

const topicTerms: Record<string, string[]> = {
  "Frontier Physics": ["physics", "hidden", "oscillator", "law", "apparatus"],
  "AI Metascience": ["ai", "agent", "agents", "metascience", "benchmark", "simulation"],
  "Rogue Youth Labs": ["youth lab", "youth labs", "pilot", "proof-of-work"],
  "History Of Discovery": ["history", "discovery", "accident", "anomaly", "prepared"],
  "Tools And Instruments": ["tool", "tools", "code", "instrument", "runner", "notebook"],
  Patronage: ["funding", "grant", "backer", "budget", "patronage", "civic", "private"],
  Communities: ["community", "communities", "events", "calls", "groups"],
  Opportunities: ["opportunity", "opportunities", "call", "fellowship", "role", "residency"]
};

const patronageTerms: Record<Exclude<PatronageMode, "lobby">, string[]> = {
  civic: ["civic", "crowdfund", "crowdfunding", "bounty", "bounties", "donation", "donations", "microgrant", "microgrants", "public", "stipend", "stipends"],
  private: ["private", "investor", "investors", "grant", "grants", "family office", "funds", "patron", "patronage", "backer", "backers", "tranche"]
};

const commentSearchText = (comments: InquiryComment[]): string =>
  comments
    .flatMap((comment) => [
      comment.author,
      comment.stance,
      comment.body,
      commentSearchText(comment.replies ?? [])
    ])
    .join(" ");

const searchableText = (item: InquiryItem) =>
  [
    item.title,
    item.author,
    item.affiliation,
    item.status,
    item.excerpt,
    item.body,
    ...item.tags,
    ...item.claims,
    ...item.objections,
    ...item.evidence,
    ...item.tests,
    ...item.forks,
    commentSearchText(item.comments)
  ]
    .join(" ")
    .toLowerCase();

const searchableContentText = (item: InquiryItem) =>
  [
    item.author,
    item.affiliation,
    item.status,
    item.excerpt,
    item.body,
    ...item.tags,
    ...item.claims,
    ...item.objections,
    ...item.evidence,
    ...item.tests,
    ...item.forks,
    commentSearchText(item.comments)
  ]
    .join(" ")
    .toLowerCase();

const matchesTopic = (item: InquiryItem, chip: string) => {
  const terms = topicTerms[chip] ?? [];
  const text = searchableText(item);
  return terms.some((term) => text.includes(term));
};

const matchesPatronageMode = (item: InquiryItem, mode: PatronageMode) => {
  if (mode === "lobby") return false;
  const text = searchableText(item);
  return patronageTerms[mode].some((term) => {
    if (term.includes(" ")) return text.includes(term);
    return new RegExp(`\\b${term}\\b`, "i").test(text);
  });
};

const matchesCommunity = (item: InquiryItem, community: ResearchCommunity) => {
  const text = searchableText(item);
  return community.keywords.some((keyword) => text.includes(normalizeSearchPhrase(keyword)));
};

const getCommunityItems = (items: InquiryItem[], community: ResearchCommunity) =>
  items.filter((item) => matchesCommunity(item, community));

const getCommunityStats = (items: InquiryItem[], community: ResearchCommunity) => {
  const communityItems = getCommunityItems(items, community);
  const papers = communityItems.filter((item) => item.kind === "paper").length;
  const thoughts = communityItems.filter((item) => item.kind === "thought" || item.kind === "note").length;
  const opportunities = communityItems.filter((item) => item.room === "opportunities").length;

  return {
    papers: Math.max(papers, community.seedCounts.papers),
    thoughts: Math.max(thoughts, community.seedCounts.thoughts),
    opportunities: Math.max(opportunities, community.seedCounts.opportunities)
  };
};

const communitySearchText = (community: ResearchCommunity) =>
  normalizeSearchPhrase(
    [
      community.name,
      community.field,
      community.summary,
      community.visibility,
      community.callStatus,
      ...community.keywords
    ].join(" ")
  );

const clientId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const commentSegmentStackKey = (itemId: string, rootCommentId?: string | null) =>
  `${itemId}:${rootCommentId ?? "root-comment"}`;

const cloneCommentSegmentStacks = (stacks: CommentSegmentStacks): CommentSegmentStacks =>
  Object.fromEntries(Object.entries(stacks).map(([key, stack]) => [key, [...stack]]));

const findCommentById = (comments: InquiryComment[], id: string): InquiryComment | undefined => {
  for (const comment of comments) {
    if (comment.id === id) return comment;
    const found = findCommentById(comment.replies ?? [], id);
    if (found) return found;
  }
  return undefined;
};

const findCommentPathById = (comments: InquiryComment[], id: string): InquiryComment[] | null => {
  for (const comment of comments) {
    if (comment.id === id) return [comment];
    const childPath = findCommentPathById(comment.replies ?? [], id);
    if (childPath) return [comment, ...childPath];
  }
  return null;
};

const commentAuthoredByProfile = (comment: InquiryComment, person: ResearchProfile) =>
  comment.authorHandle ? cleanHandle(comment.authorHandle) === person.handle : comment.author === person.name;

const commentTimestampScore = (comment: InquiryComment) => {
  const parsed = comment.createdAt ? Date.parse(comment.createdAt) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

const profileCommentActivityLabels: Record<ProfileCommentActivityKind, string> = {
  comments: "Comment",
  fork: "Reshared comment",
  signal: "Liked comment",
  save: "Saved comment"
};

const commentMatchesProfileActivity = (
  comment: InquiryComment,
  person: ResearchProfile,
  kind: ProfileCommentActivityKind
) => {
  if (kind === "comments") return commentAuthoredByProfile(comment, person);
  if (kind === "fork") return hasHandle(comment.forkedBy, person.handle);
  if (kind === "signal") return hasHandle(comment.signaledBy, person.handle);
  if (kind === "save") return hasHandle(comment.savedBy, person.handle);
  return false;
};

const collectProfileComments = (
  items: InquiryItem[],
  person: ResearchProfile,
  kind: ProfileCommentActivityKind = "comments",
  recencyForComment?: (item: InquiryItem, comment: InquiryComment, kind: ProfileCommentActivityKind) => number
): ProfileCommentActivity[] => {
  const activities: ProfileCommentActivity[] = [];

  const visit = (item: InquiryItem, comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (commentMatchesProfileActivity(comment, person, kind) && comment.id) {
        activities.push({
          id: `${kind}:${item.id}:${comment.id}`,
          item,
          comment,
          kind,
          label: profileCommentActivityLabels[kind],
          recency:
            recencyForComment?.(item, comment, kind) ??
            (commentTimestampScore(comment) || itemTimestampScore(item))
        });
      }
      visit(item, comment.replies ?? []);
    }
  };

  for (const item of items) visit(item, item.comments);
  return activities.sort((a, b) => b.recency - a.recency);
};

const updateCommentsForProfile = (
  comments: InquiryComment[],
  person: ResearchProfile
): InquiryComment[] =>
  comments.map((comment) => ({
    ...comment,
    author: comment.authorHandle && cleanHandle(comment.authorHandle) === person.handle ? person.name : comment.author,
    replies: updateCommentsForProfile(comment.replies ?? [], person)
  }));

const itemAuthoredByProfile = (item: InquiryItem, person: ResearchProfile) =>
  item.authorHandle ? item.authorHandle === person.handle : item.author === person.name;

const isLiveInquiryItem = (value: unknown): value is InquiryItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as InquiryItem).id === "string" &&
  typeof (value as InquiryItem).title === "string" &&
  typeof (value as InquiryItem).kind === "string" &&
  typeof (value as InquiryItem).room === "string" &&
  typeof (value as InquiryItem).metrics === "object";

const profileForHandle = (profiles: Record<string, ResearchProfile>, handleOrName?: string) => {
  if (!handleOrName) return undefined;
  return profiles[cleanHandle(handleOrName)] ?? Object.values(profiles).find((person) => person.name === handleOrName);
};

const inferredLikesPublic = (person: ResearchProfile) => person.likesPublic ?? person.handle.length % 5 !== 0;
const inferredResharesPublic = (person: ResearchProfile) => person.resharesPublic ?? person.handle.length % 4 !== 0;

const fallbackCommunityCount = 8;
const commentsSectionTargetId = "__symposium-comments-section__";
const commentMetricsFallback = { signal: "0", forks: "0", saves: "0", reads: "0" };
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

const commentActionActive = (comment: InquiryComment, action: CommentAction, handle: string) => {
  if (action === "save") return hasHandle(comment.savedBy, handle);
  if (action === "signal") return hasHandle(comment.signaledBy, handle);
  if (action === "fork") return hasHandle(comment.forkedBy, handle);
  return undefined;
};

const mutateCommentForActor = (
  comment: InquiryComment,
  action: CommentAction,
  actorHandle: string,
  active?: boolean
): InquiryComment => {
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

const maxVisibleCommentPathLength = 6;

const communityMembershipIds = (communities: ResearchCommunity[], person: ResearchProfile) => {
  const explicit = communities.filter((community) => community.memberHandles.includes(person.handle));
  if (explicit.length > 0) return new Set(explicit.map((community) => community.id));

  const maxOffset = Math.max(1, communities.length - fallbackCommunityCount + 1);
  const offset =
    Array.from(person.handle).reduce((total, character) => total + character.charCodeAt(0), 0) % maxOffset;
  const fallback = communities.slice(offset, offset + fallbackCommunityCount);
  return new Set(fallback.map((community) => community.id));
};

const initial = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const localPreviewAuth: SymposiumAuthState = {
  clerkEnabled: false,
  authLoaded: true,
  isSignedIn: false,
  userId: null,
  signOut: async () => undefined
};

export function SymposiumV0({ clerkEnabled = false }: { clerkEnabled?: boolean }) {
  if (clerkEnabled) return <ClerkSymposiumV0 />;
  return <SymposiumExperience auth={localPreviewAuth} />;
}

function ClerkSymposiumV0() {
  const { isLoaded: authLoaded, isSignedIn, signOut: clerkSignOut } = useAuth();
  const { user } = useUser();

  return (
    <SymposiumExperience
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

function SymposiumExperience({ auth }: { auth: SymposiumAuthState }) {
  const { authLoaded, clerkEnabled, isSignedIn, userId } = auth;
  const [theme, setTheme] = useState<Theme>("day");
  const [entryMode, setEntryMode] = useState<EntryMode>("loading");
  const [signedIn, setSignedIn] = useState(false);
  const [activeRoom, setActiveRoom] = useState<RoomId>("hall");
  const [items, setItems] = useState<InquiryItem[]>(inquiryItems);
  const [profiles, setProfiles] = useState<Record<string, ResearchProfile>>({});
  const [currentProfile, setCurrentProfile] = useState<ResearchProfile>(profile);
  const [followingHandles, setFollowingHandles] = useState<string[]>([]);
  const [profileSocialLists, setProfileSocialLists] = useState<Record<string, ProfileSocialLists>>({});
  const [feedScope, setFeedScope] = useState<FeedScope>("suggested");
  const [roomChip, setRoomChip] = useState(roomChips[0]);
  const [officeMode, setOfficeMode] = useState<OfficeMode>("desk");
  const [patronageMode, setPatronageMode] = useState<PatronageMode>("lobby");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [commentSegmentStacks, setCommentSegmentStacks] = useState<CommentSegmentStacks>({});
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [communitiesExpanded, setCommunitiesExpanded] = useState(false);
  const [communityQuery, setCommunityQuery] = useState("");
  const [tabletOpen, setTabletOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(null);
  const [viewHistory, setViewHistory] = useState<ViewSnapshot[]>([]);
  const [viewFuture, setViewFuture] = useState<ViewSnapshot[]>([]);
  const [profileActiveTabs, setProfileActiveTabs] = useState<Record<string, ProfileTab>>({});
  const [profileActivityRevision, setProfileActivityRevision] = useState(0);
  const [editingPost, setEditingPost] = useState<InquiryItem | null>(null);
  const [activityRecency, setActivityRecency] = useState<Record<string, number>>({});
  const [syncStatus, setSyncStatus] = useState("Loading live data");
  const [authError, setAuthError] = useState("");
  const itemsRef = useRef(items);
  const profilesRef = useRef(profiles);
  const currentProfileRef = useRef(currentProfile);
  const selectedProfileNameRef = useRef(selectedProfileName);
  const commentSegmentStacksRef = useRef<CommentSegmentStacks>({});
  const actionVersionsRef = useRef<Record<string, number>>({});
  const actionDesiredStateRef = useRef<Record<string, boolean | undefined>>({});
  const activityRecencyRef = useRef(activityRecency);
  const pendingActivityRecencyRef = useRef<Record<string, number>>({});
  const liveEventCursorRef = useRef("");
  const liveRefreshTimerRef = useRef<number | null>(null);
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
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const selectedCommunity =
    selectedCommunityId ? researchCommunities.find((community) => community.id === selectedCommunityId) ?? null : null;
  const profileList = useMemo(() => Object.values(profiles), [profiles]);
  const findProfile = (nameOrHandle: string) =>
    profileList.find((person) => person.handle === nameOrHandle) ??
    profileList.find((person) => person.name === nameOrHandle) ??
    getProfileForName(nameOrHandle);
  const selectedProfile = selectedProfileName ? findProfile(selectedProfileName) : null;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    currentProfileRef.current = currentProfile;
  }, [currentProfile]);

  useEffect(() => {
    selectedProfileNameRef.current = selectedProfileName;
  }, [selectedProfileName]);

  useEffect(() => {
    commentSegmentStacksRef.current = commentSegmentStacks;
  }, [commentSegmentStacks]);

  useEffect(() => {
    if (!selectedCommentId || selectedCommentId === commentsSectionTargetId) return;
    const highlightedCommentId = selectedCommentId;
    const timer = window.setTimeout(() => {
      setSelectedCommentId((current) => (current === highlightedCommentId ? null : current));
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [selectedCommentId]);

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
    const patronageItems = items.filter((item) => item.room === "funding");
    const selectedPatronageItems =
      patronageMode === "lobby"
        ? []
        : patronageItems.filter((item) => matchesPatronageMode(item, patronageMode));
    const patronageFallbackItems =
      patronageMode === "lobby" || selectedPatronageItems.length ? selectedPatronageItems : patronageItems;
    const patronageIds = new Set(patronageFallbackItems.map((item) => item.id));

    const roomFiltered = items
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
  }, [activeRoom, currentProfile.handle, currentProfile.name, feedScope, followingHandles, items, officeMode, patronageMode, roomChip]);

  const readLocalSnapshot = (): LocalSnapshot | null => {
    try {
      const raw = window.localStorage.getItem("symposium-local-snapshot");
      if (!raw) return null;
      const snapshot = JSON.parse(raw) as LocalSnapshot;
      return { ...snapshot, items: normalizeClientSeedTimes(snapshot.items ?? []) };
    } catch {
      return null;
    }
  };

  const persistLocalSnapshot = (
    nextItems = items,
    nextProfiles = profiles,
    nextProfile = currentProfile
  ) => {
    window.localStorage.setItem(
      "symposium-local-snapshot",
      JSON.stringify({ items: nextItems, profiles: nextProfiles })
    );
    window.localStorage.setItem("symposium-profile-handle", nextProfile.handle);
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

  const refreshData = async (preferredHandle = currentProfile.handle) => {
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
    const nextProfile = loadedProfiles[preferredHandle] ?? loadedProfiles[data.defaultProfile.handle] ?? data.defaultProfile;

    const loadedItems = sortByPublishedRecency(normalizeClientSeedTimes(data.items));
    setItems(loadedItems);
    setProfiles(loadedProfiles);
    setCurrentProfile(nextProfile);
    persistLocalSnapshot(loadedItems, loadedProfiles, nextProfile);
    setSyncStatus("Live data connected");
  };

  const refreshFollowing = async (actorHandle = currentProfile.handle) => {
    const cached = readLocalFollowing(actorHandle);
    if (cached.length) setFollowingHandles(cached);

    const response = await fetch("/api/follows", { cache: "no-store" });
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
    const nextItems =
      existingIndex >= 0
        ? currentItems.map((item) => (item.id === incoming.id ? incoming : item))
        : [incoming, ...currentItems];
    const sortedItems = sortByPublishedRecency(nextItems);

    itemsRef.current = sortedItems;
    setItems(sortedItems);
    persistLocalSnapshot(sortedItems, profilesRef.current, currentProfileRef.current);
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

  const itemActionActive = (item: InquiryItem, action: PostAction, handle: string) => {
    if (action === "save") return isSavedBy(item, handle, profile.handle);
    if (action === "signal") return hasHandle(item.signaledBy, handle);
    if (action === "fork") return hasHandle(item.forkedBy, handle);
    return undefined;
  };

  const mergeLiveEvent = (event: SymposiumLiveEvent) => {
    if (event.cursor) liveEventCursorRef.current = event.cursor;

    const payload = event.payload ?? {};
    if (event.kind === "post.deleted" && typeof payload.itemId === "string") {
      const nextItems = itemsRef.current.filter((item) => item.id !== payload.itemId);
      itemsRef.current = nextItems;
      setItems(nextItems);
      persistLocalSnapshot(nextItems, profilesRef.current, currentProfileRef.current);
      setSelectedItemId((current) => (current === payload.itemId ? null : current));
      return;
    }

    if (payload.follow || event.kind === "profile.followed" || event.kind === "profile.unfollowed") {
      mergeLiveFollow(payload.follow, event.kind !== "profile.unfollowed");
    }

    if (isLiveInquiryItem(payload.item)) {
      const action = payload.action;
      if (action && event.actorHandle === currentProfileRef.current.handle) {
        if (typeof payload.commentId === "string" && action !== "read") {
          const key = `${payload.item.id}:${payload.commentId}:${action}:${currentProfileRef.current.handle}`;
          const desired = actionDesiredStateRef.current[key];
          const eventComment = findCommentById(payload.item.comments, payload.commentId);
          const serverActive = eventComment
            ? commentActionActive(eventComment, action, currentProfileRef.current.handle)
            : undefined;
          if (desired !== undefined && serverActive !== desired) return;
          touchProfileCommentAction(payload.item.id, payload.commentId, action, currentProfileRef.current.handle);
        } else {
          const key = `${payload.item.id}:${action}:${currentProfileRef.current.handle}`;
          const desired = actionDesiredStateRef.current[key];
          const serverActive = itemActionActive(payload.item, action, currentProfileRef.current.handle);
          if (desired !== undefined && serverActive !== desired) return;
          touchProfileAction(payload.item.id, action, currentProfileRef.current.handle);
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
        if (!closed) setSyncStatus((status) => (status === "Loading live data" ? "Live updates connected" : status));
      };
      source.addEventListener("symposium-ready", () => {
        if (!closed) setSyncStatus((status) => (status === "Loading live data" ? "Live updates connected" : status));
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
          setSyncStatus("Live updates reconnecting");
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
    setEntryMode("approach");

    refreshData(storedProfileHandle ?? undefined).catch(() => {
      const local = readLocalSnapshot();
      const fallbackProfiles = local?.profiles ?? { [profile.handle]: profile };
      const fallbackProfile = fallbackProfiles[storedProfileHandle ?? profile.handle] ?? profile;
      const fallbackItems = sortByPublishedRecency(normalizeClientSeedTimes(local?.items ?? inquiryItems));
      setProfiles(fallbackProfiles);
      setItems(fallbackItems);
      setCurrentProfile(fallbackProfile);
      setSyncStatus("Using seed data");
    });
  }, []);

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
    if (entryMode !== "approach" || !authLoaded || (Boolean(isSignedIn) && !signedIn)) return undefined;

    const timer = window.setTimeout(() => {
      if (signedIn) {
        window.sessionStorage.setItem("symposium-entry-complete", "true");
        setEntryMode("complete");
        setActiveRoom("hall");
      } else {
        setEntryMode("auth");
      }
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [authLoaded, entryMode, isSignedIn, signedIn]);

  useEffect(() => {
    if (!clerkEnabled) return;
    if (!authLoaded) return;

    if (!isSignedIn) {
      setSignedIn(false);
      setSyncedClerkUserId(null);
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

      const nextProfiles = { ...profiles, [data.profile.handle]: data.profile };
      setProfiles(nextProfiles);
      setCurrentProfile(data.profile);
      setSignedIn(true);
      setSyncedClerkUserId(userId);
      setEntryMode("complete");
      setActiveRoom("hall");
      setOfficeMode("desk");
      setPatronageMode("lobby");
      setSelectedCommunityId(null);
      setSelectedItemId(null);
      setSelectedCommentId(null);
      setSelectedProfileName(null);
      setViewHistory([]);
      setViewFuture([]);
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

  const snapshotView = (): ViewSnapshot => ({
    activeRoom,
    selectedItemId,
    selectedCommentId: null,
    selectedProfileName,
    officeMode,
    patronageMode,
    selectedCommunityId,
    commentSegmentStacks: cloneCommentSegmentStacks(commentSegmentStacksRef.current),
    scrollY: window.scrollY
  });

  const restoreView = (snapshot: ViewSnapshot) => {
    if (snapshot.selectedProfileName) flushPendingActivityRecency();
    setActiveRoom(snapshot.activeRoom);
    setSelectedItemId(snapshot.selectedItemId);
    setSelectedCommentId(snapshot.selectedCommentId);
    setSelectedProfileName(snapshot.selectedProfileName);
    setOfficeMode(snapshot.officeMode);
    setPatronageMode(snapshot.patronageMode);
    setSelectedCommunityId(snapshot.selectedCommunityId);
    const restoredSegmentStacks = cloneCommentSegmentStacks(snapshot.commentSegmentStacks ?? {});
    commentSegmentStacksRef.current = restoredSegmentStacks;
    setCommentSegmentStacks(restoredSegmentStacks);
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesOpen(false);
    window.setTimeout(() => window.scrollTo({ top: snapshot.scrollY, behavior: "auto" }), 0);
  };

  const navigateView = (
    next: Partial<Omit<ViewSnapshot, "scrollY">>,
    scrollY: number | null = 0
  ) => {
    if (next.selectedProfileName) flushPendingActivityRecency();
    setViewHistory((history) => [...history, snapshotView()]);
    setViewFuture([]);
    if (next.activeRoom !== undefined) setActiveRoom(next.activeRoom);
    if (next.selectedItemId !== undefined) setSelectedItemId(next.selectedItemId);
    if (next.selectedCommentId !== undefined) setSelectedCommentId(next.selectedCommentId);
    if (next.selectedProfileName !== undefined) setSelectedProfileName(next.selectedProfileName);
    if (next.selectedItemId !== undefined && next.selectedItemId !== selectedItemId) {
      commentSegmentStacksRef.current = {};
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
    setMessagesOpen(false);
    if (scrollY !== null) {
      window.setTimeout(() => window.scrollTo({ top: scrollY, behavior: "auto" }), 0);
    }
  };

  const goBack = () => {
    setViewHistory((history) => {
      if (!history.length) return history;
      const previous = history[history.length - 1];
      setViewFuture((future) => [snapshotView(), ...future]);
      restoreView(previous);
      return history.slice(0, -1);
    });
  };

  const goForward = () => {
    setViewFuture((future) => {
      if (!future.length) return future;
      const next = future[0];
      setViewHistory((history) => [...history, snapshotView()]);
      restoreView(next);
      return future.slice(1);
    });
  };

  const enterRoom = (roomId: RoomId, mode: OfficeMode = roomId === "office" ? "desk" : officeMode) => {
    navigateView({
      activeRoom: roomId,
      selectedItemId: null,
      selectedCommentId: null,
      selectedProfileName: null,
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
      officeMode: "desk",
      patronageMode: "lobby",
      selectedCommunityId: null
    });
  };

  const openProfile = (profileKey: string) => {
    flushPendingActivityRecency();
    navigateView({ selectedProfileName: profileKey, selectedItemId: null, selectedCommentId: null });
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

  const routePostRoom = (kind: PostDraft["kind"]): Exclude<RoomId, "hall" | "office"> =>
    kind === "paper" ? "library" : "amphitheater";

  const createPost = async ({ title, body, kind }: PostDraft) => {
    const routedRoom = routePostRoom(kind);
    const createdAt = new Date().toISOString();
    setSyncStatus("Posting");
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, kind, room: routedRoom, authorHandle: currentProfile.handle })
    });
    const fallbackItem: InquiryItem = {
      id: clientId("post"),
      kind,
      room: routedRoom,
      title,
      author: currentProfile.name,
      authorHandle: currentProfile.handle,
      affiliation: currentProfile.location,
      date: "Just now",
      createdAt,
      status: "New",
      metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
      gatheringReason: "",
      excerpt: body,
      body,
      tags: [],
      signals: [],
      claims: [],
      objections: [],
      evidence: [],
      tests: [],
      forks: [],
      comments: [],
      saved: false,
      savedBy: [],
      signaledBy: [],
      forkedBy: []
    };
    const data = response.ok ? ((await response.json()) as { item: InquiryItem }) : { item: fallbackItem };
    const committedItem = { ...data.item, createdAt: data.item.createdAt ?? createdAt };
    const nextItems = sortByPublishedRecency([committedItem, ...items.filter((item) => item.id !== committedItem.id)]);
    touchActivity(committedItem.id);
    setItems(nextItems);
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
  };

  const addComment = async (itemId: string, body: string, stance: string, parentId?: string | null) => {
    setSyncStatus(parentId ? "Saving reply" : "Saving comment");
    const response = await fetch(`/api/posts/${itemId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, stance, parentId: parentId ?? null, authorHandle: currentProfile.handle })
    });
    if (!response.ok) {
      const comment: InquiryComment = {
        id: clientId("comment"),
        parentId: parentId ?? null,
        author: currentProfile.name,
        authorHandle: currentProfile.handle,
        stance: "Comment",
        body,
        createdAt: new Date().toISOString(),
        replies: []
      };
      const addToTree = (comments: InquiryComment[]): InquiryComment[] => {
        if (!comment.parentId) return [...comments, comment];
        return comments.map((current) =>
          current.id === comment.parentId
            ? { ...current, replies: [...(current.replies ?? []), comment] }
            : { ...current, replies: addToTree(current.replies ?? []) }
        );
      };
      const nextItems = items.map((item) =>
        item.id === itemId ? { ...item, comments: addToTree(item.comments) } : item
      );
      touchActivity(itemId);
      setItems(nextItems);
      persistLocalSnapshot(nextItems, profiles);
      setSelectedItemId(itemId);
      setSelectedCommentId(comment.id ?? null);
      setSyncStatus(parentId ? "Reply saved locally" : "Comment saved locally");
      return;
    }

    const data = (await response.json().catch(() => ({}))) as { comment?: InquiryComment };
    touchActivity(itemId);
    await refreshData(currentProfile.handle);
    setSelectedItemId(itemId);
    setSelectedCommentId(data.comment?.id ?? null);
    setSyncStatus(parentId ? "Reply saved" : "Comment saved");
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
    setActiveRoom("hall");
    setOfficeMode("desk");
    setPatronageMode("lobby");
    setSelectedCommunityId(null);
    setSelectedItemId(null);
    setSelectedCommentId(null);
    setSelectedProfileName(null);
    setViewHistory([]);
    setViewFuture([]);
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
    const uploadResponse = await fetch("/api/attachments/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorHandle: currentProfile.handle,
        fileName: file.name,
        contentType: file.type,
        byteSize: file.size,
        ownerType: "profile",
        ownerId: currentProfile.handle
      })
    });

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

    const confirmResponse = await fetch("/api/attachments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorHandle: currentProfile.handle,
        attachmentId: upload.attachmentId,
        byteSize: file.size
      })
    });

    if (!confirmResponse.ok) {
      throw new Error("Could not confirm the profile photo upload.");
    }

    setSyncStatus("Profile photo ready");
    return upload.publicUrl;
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
    setItems(nextItems);
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
      setItems(committedItems);
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

  const applyAction = async (itemId: string, action: PostAction) => {
    const actorHandle = currentProfile.handle;
    const actionKey = `${itemId}:${action}:${actorHandle}`;
    const version = (actionVersionsRef.current[actionKey] ?? 0) + 1;
    actionVersionsRef.current[actionKey] = version;

    const previousItems = itemsRef.current;
    let actionApplied = false;
    let desiredActive: boolean | undefined;
    const optimisticItems = previousItems.map((item) => {
      if (item.id !== itemId) return item;
      actionApplied = true;
      const nextItem = mutateItemForActor(item, action, actorHandle, profile.handle);
      if (action === "save") desiredActive = isSavedBy(nextItem, actorHandle, profile.handle);
      if (action === "signal") desiredActive = hasHandle(nextItem.signaledBy, actorHandle);
      if (action === "fork") desiredActive = hasHandle(nextItem.forkedBy, actorHandle);
      return nextItem;
    });

    if (!actionApplied) return;
    actionDesiredStateRef.current[actionKey] = desiredActive;

    itemsRef.current = optimisticItems;
    setItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    touchProfileAction(itemId, action);

    try {
      const response = await fetch(`/api/posts/${itemId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actorHandle, active: desiredActive })
      });

      if (!response.ok) throw new Error("Post action failed.");

      const data = (await response.json()) as { item: InquiryItem };
      if (actionVersionsRef.current[actionKey] !== version) {
        const latestActive = actionDesiredStateRef.current[actionKey];
        if (latestActive !== undefined) {
          void fetch(`/api/posts/${itemId}/actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, actorHandle, active: latestActive })
          }).catch(() => undefined);
        }
        return;
      }

      const committedItems = itemsRef.current.map((item) => (item.id === itemId ? data.item : item));
      itemsRef.current = committedItems;
      setItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setSyncStatus("Action synced");
    } catch {
      if (actionVersionsRef.current[actionKey] !== version) return;
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Action could not sync");
    }
  };

  const applyCommentAction = async (itemId: string, commentId: string, action: CommentAction) => {
    const actorHandle = currentProfile.handle;
    const actionKey = `${itemId}:${commentId}:${action}:${actorHandle}`;
    const version = (actionVersionsRef.current[actionKey] ?? 0) + 1;
    actionVersionsRef.current[actionKey] = version;

    const previousItems = itemsRef.current;
    let actionApplied = false;
    let desiredActive: boolean | undefined;
    const optimisticItems = previousItems.map((item) => {
      if (item.id !== itemId) return item;
      const mapped = mapCommentTree(item.comments, commentId, (comment) =>
        mutateCommentForActor(comment, action, actorHandle)
      );
      if (!mapped.updated) return item;
      actionApplied = true;
      desiredActive = commentActionActive(mapped.updated, action, actorHandle);
      return { ...item, comments: mapped.comments };
    });

    if (!actionApplied) return;
    actionDesiredStateRef.current[actionKey] = desiredActive;
    itemsRef.current = optimisticItems;
    setItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    touchProfileCommentAction(itemId, commentId, action);

    try {
      const response = await fetch(`/api/posts/${itemId}/comments/${commentId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actorHandle, active: desiredActive })
      });

      if (!response.ok) throw new Error("Comment action failed.");

      const data = (await response.json()) as { item: InquiryItem };
      if (actionVersionsRef.current[actionKey] !== version) return;

      const committedItems = itemsRef.current.map((item) => (item.id === itemId ? data.item : item));
      itemsRef.current = committedItems;
      setItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setSyncStatus("Comment action synced");
    } catch {
      if (actionVersionsRef.current[actionKey] !== version) return;
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Comment action could not sync");
    }
  };

  const savePostEdit = async (itemId: string, draft: { title: string; body: string }) => {
    const cleanTitle = draft.title.trim();
    const cleanBody = draft.body.trim();
    if (!cleanTitle || !cleanBody) return;

    const previousItems = itemsRef.current;
    const editedAt = new Date().toISOString();
    const optimisticItems = previousItems.map((item) =>
      item.id === itemId
        ? { ...item, title: cleanTitle, body: cleanBody, excerpt: cleanBody, claims: [cleanBody], editedAt }
        : item
    );

    itemsRef.current = optimisticItems;
    setItems(optimisticItems);
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
      const committedItems = itemsRef.current.map((item) => (item.id === itemId ? data.item : item));
      itemsRef.current = committedItems;
      setItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setSyncStatus("Post edited");
    } catch {
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Post edit could not sync");
    }
  };

  const deletePost = async (itemId: string) => {
    const item = itemsRef.current.find((current) => current.id === itemId);
    if (!item || cleanHandle(item.authorHandle ?? item.author) !== currentProfile.handle) return;
    if (!window.confirm(`Delete "${item.title}"?`)) return;

    const previousItems = itemsRef.current;
    const nextItems = previousItems.filter((current) => current.id !== itemId);
    itemsRef.current = nextItems;
    setItems(nextItems);
    persistLocalSnapshot(nextItems, profilesRef.current);
    setEditingPost(null);
    setSelectedItemId((current) => (current === itemId ? null : current));
    setSyncStatus("Deleting post");

    try {
      const response = await fetch(`/api/posts/${itemId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Post delete failed.");
      setSyncStatus("Post deleted");
    } catch {
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Post delete could not sync");
    }
  };

  const openPost = (id: string, commentId?: string | null) => {
    navigateView(
      { selectedItemId: id, selectedCommentId: commentId ?? null, selectedProfileName: null },
      commentId ? null : 0
    );
    void applyAction(id, "read");
  };

  const currentContext = selectedItem
    ? `${selectedItem.title}: ${selectedItem.gatheringReason}`
    : `${activeRoomData.name}: ${activeRoomData.description}`;

  const searchResults = useMemo(() => {
    const term = normalizeSearchPhrase(searchQuery);
    if (!term) return { titleMatches: [] as InquiryItem[], contentMatches: [] as InquiryItem[], profileMatches: [] as ResearchProfile[] };

    const titleMatches = sortByPublishedRecency(
      items.filter((item) => normalizeSearchPhrase(item.title).includes(term))
    );
    const titleIds = new Set(titleMatches.map((item) => item.id));
    const contentMatches = sortByPublishedRecency(
      items.filter((item) => !titleIds.has(item.id) && normalizeSearchPhrase(searchableContentText(item)).includes(term))
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
  }, [items, profileList, searchQuery]);

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
      <div className="render-preload" aria-hidden="true">
        {preloadRenders.map((render) => (
          <Image key={render} src={render} alt="" width={16} height={10} priority />
        ))}
      </div>

      <header className="topbar">
        <button className="brand" type="button" onClick={() => enterRoom("hall")}>
          {activeRoom !== "hall" && <ArrowLeft size={18} />}
          <span>
            <strong>{activeRoom === "hall" ? "SYMPOSIUM" : "Exit"}</strong>
            {activeRoom !== "hall" && <small>Main hall</small>}
          </span>
        </button>

        <ViewNav
          canGoBack={viewHistory.length > 0}
          canGoForward={viewFuture.length > 0}
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
          <button
            className="icon-button"
            type="button"
            title="Messages"
            onClick={() => {
              setNotebookOpen(false);
              setTabletOpen(false);
              setComposerOpen(false);
              setSettingsOpen(false);
              setSearchOpen(false);
              setMessagesOpen(true);
            }}
          >
            <MessageCircle size={18} />
          </button>
          <button
            className="profile-button"
            type="button"
            title="Open your profile"
            onClick={() => openProfile(currentProfile.handle)}
          >
            <UserRound size={18} />
            <span>{currentProfile.name}</span>
          </button>
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
            getProfileRecency={getProfileRecency}
            getProfileCommentRecency={getProfileCommentRecency}
            activeTab={profileActiveTabs[selectedProfile.handle] ?? "all"}
            activityRevision={profileActivityRevision}
            onActiveTabChange={(tab) => changeProfileTab(selectedProfile.handle, tab)}
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
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
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            selectedCommentId={selectedCommentId}
            onClearSelectedComment={() => setSelectedCommentId(null)}
            commentSegmentStacks={commentSegmentStacks}
            onCommentSegmentStackChange={updateCommentSegmentStack}
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

      {messagesOpen ? <MessagesModal onClose={() => setMessagesOpen(false)} /> : null}

      {composerOpen ? (
        <PostComposerModal
          onClose={() => setComposerOpen(false)}
          onCreatePost={createPost}
        />
      ) : null}

      {editingPost ? (
        <PostEditModal
          item={items.find((item) => item.id === editingPost.id) ?? editingPost}
          onClose={() => setEditingPost(null)}
          onSave={savePostEdit}
          onDelete={deletePost}
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
            openPost(id);
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

function EntrySequence({
  theme,
  entranceRender,
  mode,
  authError,
  authLoaded,
  clerkEnabled,
  onLocalPreview
}: {
  theme: Theme;
  entranceRender: string;
  mode: EntryMode;
  authError: string;
  authLoaded: boolean;
  clerkEnabled: boolean;
  onLocalPreview: () => void;
}) {
  return (
    <main className={`entry-sequence ${theme}`} aria-label="Approaching Symposium">
      <Image
        src={entranceRender}
        alt="Greco-futurist Symposium building above the Aegean sea"
        fill
        priority
        sizes="100vw"
        className="entry-image"
      />
      <div className="entry-veil" />
      <div className="entry-stair-lines" aria-hidden="true">
        {Array.from({ length: 9 }).map((_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="entry-copy">
        <p>Welcome to the Symposium</p>
      </div>
      {mode === "auth" ? (
        <EntryAuthPanel
          authError={authError}
          authLoaded={authLoaded}
          clerkEnabled={clerkEnabled}
          onLocalPreview={onLocalPreview}
        />
      ) : null}
    </main>
  );
}

function EntryAuthPanel({
  authError,
  authLoaded,
  clerkEnabled,
  onLocalPreview
}: {
  authError: string;
  authLoaded: boolean;
  clerkEnabled: boolean;
  onLocalPreview: () => void;
}) {
  return (
    <section className="entry-auth" aria-label="Symposium sign in">
      {clerkEnabled ? (
        <div className="entry-auth-form clerk-auth-actions">
          <SignInButton mode="modal">
            <button type="button" disabled={!authLoaded}>
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button type="button" disabled={!authLoaded}>
              Create account
            </button>
          </SignUpButton>
        </div>
      ) : (
        <div className="entry-auth-form">
          <button type="button" onClick={onLocalPreview} disabled={!authLoaded}>
            Enter local preview
          </button>
        </div>
      )}

      {authError ? <p className="auth-error">{authError}</p> : null}
    </section>
  );
}

function HallView({ onEnter }: { onEnter: (roomId: RoomId) => void }) {
  const doorIds: Array<Exclude<RoomId, "hall">> = [
    "office",
    "amphitheater",
    "funding",
    "library",
    "communities",
    "symposium",
    "opportunities"
  ];

  return (
    <div className="hall-layout">
      <section className="hall-world" aria-label="Main hall">
        {doorIds.map((roomId) => {
          const room = getRoom(roomId);
          return (
            <button
              key={room.id}
              className={`hall-door hall-door-${room.id}`}
              type="button"
              aria-label={`Enter ${room.name}`}
              onClick={() => onEnter(room.id)}
            >
              <span className="hall-hover-label">{room.name}</span>
            </button>
          );
        })}
      </section>
    </div>
  );
}

function ViewNav({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onHome
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onHome: () => void;
}) {
  return (
    <nav className="view-nav" aria-label="View history">
      <button type="button" title="Back" disabled={!canGoBack} onClick={onBack}>
        <ArrowLeft size={17} />
      </button>
      <button type="button" title="Forward" disabled={!canGoForward} onClick={onForward}>
        <ArrowRight size={17} />
      </button>
      <button type="button" title="Main hall" onClick={onHome}>
        <Home size={17} />
      </button>
    </nav>
  );
}

function OfficeDeskView({
  room,
  onOpenSaved,
  onOpenNotes
}: {
  room: Room;
  onOpenSaved: () => void;
  onOpenNotes: () => void;
}) {
  return (
    <div className="office-desk-view">
      <RoomRender room={room} onOpenNotebook={onOpenNotes} onOpenSaved={onOpenSaved} />
    </div>
  );
}

function PatronageLobbyView({
  room,
  onOpenCivic,
  onOpenPrivate
}: {
  room: Room;
  onOpenCivic: () => void;
  onOpenPrivate: () => void;
}) {
  return (
    <div className="patronage-lobby-view">
      <RoomRender
        room={room}
        onOpenNotebook={() => undefined}
        onOpenCivic={onOpenCivic}
        onOpenPrivate={onOpenPrivate}
        showPatronageHotspots
      />
    </div>
  );
}

function CommunitiesDirectoryView({
  communities,
  items,
  currentProfile,
  query,
  onQuery,
  expanded,
  onExpanded,
  onOpenCommunity
}: {
  communities: ResearchCommunity[];
  items: InquiryItem[];
  currentProfile: ResearchProfile;
  query: string;
  onQuery: (query: string) => void;
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
  onOpenCommunity: (communityId: string) => void;
}) {
  const term = normalizeSearchPhrase(query);
  const matches = (community: ResearchCommunity) => !term || communitySearchText(community).includes(term);
  const memberships = communityMembershipIds(communities, currentProfile);
  const myCommunities = communities.filter((community) => memberships.has(community.id) && matches(community));
  const discoverCommunities = communities
    .filter((community) => !memberships.has(community.id) && matches(community))
    .sort((a, b) => b.online - a.online);
  const canExpandMyCommunities = myCommunities.length > 6;
  const visibleMyCommunities = expanded ? myCommunities : myCommunities.slice(0, 6);
  const visibleDiscover = discoverCommunities;

  return (
    <section className="communities-layout" aria-label="Communities">
      <aside className="communities-context">
        <p className="eyebrow">Directory</p>
        <h1>Communities</h1>
        <p>Find the groups around shared work, live calls, and public artifacts.</p>
      </aside>
      <div className="communities-panel">
        <label className="communities-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search communities"
            aria-label="Search communities"
          />
        </label>

        <CommunityLayer
          title="Your communities"
          communities={visibleMyCommunities}
          items={items}
          expanded={expanded}
          total={myCommunities.length}
          onToggle={canExpandMyCommunities ? () => onExpanded(!expanded) : undefined}
          onOpenCommunity={onOpenCommunity}
          emptyText="Join communities to keep them here."
        />

        <CommunityLayer
          title="Discover"
          communities={visibleDiscover}
          items={items}
          total={discoverCommunities.length}
          onOpenCommunity={onOpenCommunity}
          emptyText="No community matches yet."
        />
      </div>
    </section>
  );
}

function CommunityLayer({
  title,
  communities,
  items,
  total,
  expanded,
  onToggle,
  onOpenCommunity,
  emptyText
}: {
  title: string;
  communities: ResearchCommunity[];
  items: InquiryItem[];
  total: number;
  expanded?: boolean;
  onToggle?: () => void;
  onOpenCommunity: (communityId: string) => void;
  emptyText: string;
}) {
  return (
    <section className="community-layer">
      <header>
        <button type="button" onClick={onToggle ?? (() => undefined)} disabled={!onToggle}>
          {onToggle ? <ArrowRight size={16} className={expanded ? "expanded" : ""} /> : null}
          <span>{title}</span>
          <small>{total}</small>
        </button>
      </header>
      {communities.length ? (
        <div className="community-grid">
          {communities.map((community) => (
            <CommunityCard
              key={community.id}
              community={community}
              stats={getCommunityStats(items, community)}
              onOpenCommunity={onOpenCommunity}
            />
          ))}
        </div>
      ) : (
        <p className="community-empty">{emptyText}</p>
      )}
    </section>
  );
}

function CommunityCard({
  community,
  stats,
  onOpenCommunity
}: {
  community: ResearchCommunity;
  stats: ReturnType<typeof getCommunityStats>;
  onOpenCommunity: (communityId: string) => void;
}) {
  return (
    <button
      className={`community-card community-card-${community.visibility}`}
      type="button"
      onClick={() => onOpenCommunity(community.id)}
    >
      <span className="community-card-topline">
        <strong>{community.name}</strong>
        <small>{community.visibility}</small>
      </span>
      <span className="community-field">{community.field}</span>
      <span className="community-summary">{community.summary}</span>
      <span className="community-stats">
        <small>{community.online} online</small>
        <small>{stats.papers} papers</small>
        <small>{stats.thoughts} thoughts</small>
        <small>{stats.opportunities} opportunities</small>
      </span>
    </button>
  );
}

function SelectedCommunityView({
  community,
  items,
  currentProfile,
  profiles,
  onBack,
  onSelect,
  onOpenProfile,
  onAction,
  onEditPost,
  onDeletePost,
  onDummyCall
}: {
  community: ResearchCommunity;
  items: InquiryItem[];
  currentProfile: ResearchProfile;
  profiles: Record<string, ResearchProfile>;
  onBack: () => void;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onDummyCall: (mode: "Voice" | "Video") => void;
}) {
  const memberships = communityMembershipIds(researchCommunities, currentProfile);
  const isMember = memberships.has(community.id);
  const relatedItems = sortCommunityItems(getCommunityItems(items, community));

  return (
    <section className="selected-community-layout" aria-label={community.name}>
      <div className="selected-community-panel">
        <button className="community-back" type="button" onClick={onBack}>
          <ArrowLeft size={17} />
          Communities
        </button>
        <header className="selected-community-header">
          <p className="eyebrow">{community.visibility} community</p>
          <h1>{community.name}</h1>
          <p>{community.summary}</p>
          <span>{community.field}</span>
        </header>

        <section className="community-call-panel" aria-label="Community calls">
          <div>
            <strong>Group call</strong>
            <span>{isMember ? `${community.online} online · ${community.callStatus}` : "members only"}</span>
          </div>
          <button type="button" disabled={!isMember} onClick={() => onDummyCall("Voice")}>
            Voice
          </button>
          <button type="button" disabled={!isMember} onClick={() => onDummyCall("Video")}>
            Video
          </button>
        </section>
      </div>

      <section className="selected-community-work" aria-label={`${community.name} shared work`}>
        {relatedItems.length ? (
          relatedItems.slice(0, 8).map((item) => (
            <FeedPost
              key={item.id}
              item={item}
              onSelect={onSelect}
              onOpenProfile={onOpenProfile}
              onAction={onAction}
              onEditPost={onEditPost}
              onDeletePost={onDeletePost}
              actorHandle={currentProfile.handle}
              profiles={profiles}
            />
          ))
        ) : (
          <div className="empty-feed">
            <strong>No shared work yet.</strong>
            <span>This community will fill as linked papers, thoughts, and opportunities appear.</span>
          </div>
        )}
      </section>
    </section>
  );
}

const sortCommunityItems = (items: InquiryItem[]) =>
  [...items].sort((a, b) => itemTimestampScore(b) - itemTimestampScore(a));

function RoomView({
  room,
  items,
  officeMode,
  patronageMode,
  feedScope,
  roomChip,
  onFeedScope,
  onRoomChip,
  onPatronageMode,
  onSelect,
  onOpenProfile,
  onAction,
  onEditPost,
  onDeletePost,
  onOpenNotes,
  onOpenSaved,
  actorHandle,
  profiles
}: {
  room: Room;
  items: InquiryItem[];
  officeMode?: OfficeMode;
  patronageMode?: PatronageMode;
  feedScope: FeedScope;
  roomChip: string;
  onFeedScope: (scope: FeedScope) => void;
  onRoomChip: (chip: string) => void;
  onPatronageMode: (mode: PatronageMode) => void;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenNotes: () => void;
  onOpenSaved: () => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
}) {
  const roomTitle =
    room.id === "funding" && patronageMode === "civic"
      ? "Civic Patronage"
      : room.id === "funding" && patronageMode === "private"
        ? "Private Patronage"
        : officeMode === "saved"
          ? "Saved for later"
          : officeMode === "notes"
            ? "Notes"
            : room.name;
  const roomDescription =
    room.id === "funding" && patronageMode === "civic"
      ? "Crowdfunding, bounties, donations, microgrants, and public backing for work that deserves early oxygen."
      : room.id === "funding" && patronageMode === "private"
        ? "Investors, grants, family offices, funds, and larger patronage routes for serious research and institutions."
        : officeMode === "saved"
          ? "Work you marked for return."
          : officeMode === "notes"
            ? "Your desk notes and authored fragments."
            : room.description;

  return (
    <div className="room-layout">
      <RoomRender room={room} onOpenNotebook={onOpenNotes} onOpenSaved={onOpenSaved} />

      <section className="feed-toolbar" aria-label="Feed controls">
        {room.id === "funding" && patronageMode !== "lobby" ? (
          <button className="community-back patronage-back" type="button" onClick={() => onPatronageMode("lobby")}>
            <ArrowLeft size={16} />
            Patronage
          </button>
        ) : null}

        <div className="room-mini-title">
          <p className="eyebrow">{room.eyebrow}</p>
          <h1>{roomTitle}</h1>
          <p>{roomDescription}</p>
        </div>

        {room.id === "funding" ? (
          <div className="segmented patronage-switch" aria-label="Patronage section">
            <button
              type="button"
              className={patronageMode === "civic" ? "active" : ""}
              onClick={() => onPatronageMode("civic")}
            >
              Civic
            </button>
            <button
              type="button"
              className={patronageMode === "private" ? "active" : ""}
              onClick={() => onPatronageMode("private")}
            >
              Private
            </button>
          </div>
        ) : null}

        <div className="segmented">
          {feedScopes.map((scope) => (
            <button
              key={scope.id}
              type="button"
              className={feedScope === scope.id ? "active" : ""}
              onClick={() => onFeedScope(scope.id)}
            >
              {scope.label}
            </button>
          ))}
        </div>

        {feedScope === "rooms" ? (
          <label className="topic-select">
            <span>Topic</span>
            <select value={roomChip} onChange={(event) => onRoomChip(event.target.value)}>
              {roomChips.map((chip) => (
                <option key={chip} value={chip}>
                  {chip}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {room.id === "office" ? (
          <div className="office-feed-note">
            {officeMode === "saved" ? "Saved items are sorted by your latest action." : "Notes are local for now."}
          </div>
        ) : null}
      </section>

      <section className="feed-stream" aria-label={`${room.name} feed`}>
        {items.length ? (
          items.map((item) => (
            <FeedPost
              key={item.id}
              item={item}
              onSelect={onSelect}
              onOpenProfile={onOpenProfile}
              onAction={onAction}
              onEditPost={onEditPost}
              onDeletePost={onDeletePost}
              actorHandle={actorHandle}
              profiles={profiles}
            />
          ))
        ) : (
          <div className="empty-feed">
            <strong>No work in this slice yet.</strong>
            <span>Try another room, topic, or search.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function RoomRender({
  room,
  onOpenNotebook,
  onOpenSaved,
  onOpenCivic,
  onOpenPrivate,
  showPatronageHotspots = false
}: {
  room: Room;
  onOpenNotebook: () => void;
  onOpenSaved?: () => void;
  onOpenCivic?: () => void;
  onOpenPrivate?: () => void;
  showPatronageHotspots?: boolean;
}) {
  const isOffice = room.id === "office";
  const isPatronage = room.id === "funding";

  return (
    <section
      className={`room-render room-render-${room.id}`}
      aria-label={`${room.name} rendered room`}
    >
      {isOffice ? (
        <div className="room-hotspots" aria-label="Office desk areas">
          <>
            <button
              className="office-hotspot office-hotspot-notes"
              type="button"
              onClick={onOpenNotebook}
              aria-label="Open notes"
            >
              <span>Notes</span>
            </button>
            <button
              className="office-hotspot office-hotspot-saved"
              type="button"
              onClick={onOpenSaved}
              aria-label="Saved for later"
            >
              <span>Saved for later</span>
            </button>
          </>
        </div>
      ) : null}
      {isPatronage && showPatronageHotspots ? (
        <div className="room-hotspots patronage-hotspots" aria-label="Patronage sections">
          <button
            className="patronage-hotspot patronage-hotspot-civic"
            type="button"
            onClick={onOpenCivic}
            aria-label="Open Civic Patronage"
          >
            <span>Civic</span>
          </button>
          <button
            className="patronage-hotspot patronage-hotspot-private"
            type="button"
            onClick={onOpenPrivate}
            aria-label="Open Private Patronage"
          >
            <span>Private</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

const postKindOptions: PostDraft["kind"][] = ["thought", "paper"];

function PostComposerModal({
  onClose,
  onCreatePost
}: {
  onClose: () => void;
  onCreatePost: (draft: PostDraft) => void;
}) {
  const [kind, setKind] = useState<PostDraft["kind"]>("thought");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const submitPost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle || !cleanBody) return;

    onCreatePost({ title: cleanTitle, body: cleanBody, kind });
    setTitle("");
    setBody("");
    setKind("thought");
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-composer-modal" onSubmit={submitPost} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>New post</span>
            <strong>{kindLabels[kind]}</strong>
          </div>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="composer-topline">
          <select value={kind} onChange={(event) => setKind(event.target.value as PostDraft["kind"])}>
            {postKindOptions.map((option) => (
              <option key={option} value={option}>
                {kindLabels[option]}
              </option>
            ))}
          </select>
          <button type="submit">Post</button>
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write the thing itself"
        />
      </form>
    </div>
  );
}

function PostEditModal({
  item,
  onClose,
  onSave,
  onDelete
}: {
  item: InquiryItem;
  onClose: () => void;
  onSave: (itemId: string, draft: { title: string; body: string }) => void;
  onDelete: (itemId: string) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);

  useEffect(() => {
    setTitle(item.title);
    setBody(item.body);
  }, [item]);

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(item.id, { title, body });
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-edit-modal" onSubmit={submitEdit} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>Edit post</span>
            <strong>{kindLabels[item.kind]}</strong>
          </div>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="composer-topline">
          <button className="danger-action" type="button" onClick={() => onDelete(item.id)}>
            <Trash2 size={16} />
            Delete
          </button>
          <button type="submit">Save</button>
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write the thing itself"
        />
      </form>
    </div>
  );
}

function PostTimeFooter({ item }: { item: InquiryItem }) {
  const created = localDateTimeLabel(item.createdAt);
  const edited = localDateTimeLabel(item.editedAt);

  if (!created && !edited) return null;

  return (
    <footer className="post-time-footer">
      {created ? <span>Posted {created}</span> : null}
      {edited ? <span>Edited {relativeTimeLabel(item.editedAt)} · {edited}</span> : null}
    </footer>
  );
}

function PostOwnerControls({
  item,
  actorHandle,
  onEditPost,
  onDeletePost
}: {
  item: InquiryItem;
  actorHandle: string;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
}) {
  if (cleanHandle(item.authorHandle ?? item.author) !== actorHandle) return null;

  return (
    <div className="post-owner-actions" aria-label="Post owner actions">
      <button
        type="button"
        title="Edit post"
        onClick={(event) => {
          event.stopPropagation();
          onEditPost(item);
        }}
      >
        <Pencil size={16} />
      </button>
      <button
        type="button"
        title="Delete post"
        onClick={(event) => {
          event.stopPropagation();
          onDeletePost(item.id);
        }}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function FeedPost({
  item,
  onSelect,
  onOpenProfile,
  onAction,
  onEditPost,
  onDeletePost,
  actorHandle,
  profiles
}: {
  item: InquiryItem;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
}) {
  const openPost = () => onSelect(item.id);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPost();
    }
  };

  return (
    <article
      className={`feed-post post-kind-${item.kind}`}
      data-testid={`feed-card-${item.id}`}
      role="button"
      tabIndex={0}
      onClick={openPost}
      onKeyDown={onKeyDown}
    >
      <PostOwnerControls item={item} actorHandle={actorHandle} onEditPost={onEditPost} onDeletePost={onDeletePost} />
      <PostAuthor
        item={item}
        profiles={profiles}
        onOpenProfile={onOpenProfile}
        onClickStop={(event) => event.stopPropagation()}
      />
      <div className="post-body">
        <h2>{item.title}</h2>
        <p>{item.excerpt}</p>
        <PostTimeFooter item={item} />
        <SocialActions
          item={item}
          commentCount={countComments(item.comments)}
          onAction={onAction}
          onCommentsClick={() => onSelect(item.id, commentsSectionTargetId)}
          actorHandle={actorHandle}
        />
      </div>
    </article>
  );
}

function PostAuthor({
  item,
  profiles,
  onOpenProfile,
  onClickStop
}: {
  item: InquiryItem;
  profiles: Record<string, ResearchProfile>;
  onOpenProfile: (name: string) => void;
  onClickStop?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const authorProfile = profileForHandle(profiles, item.authorHandle ?? item.author);
  const authorName = authorProfile?.name ?? item.author;

  return (
    <button
      className="post-author"
      type="button"
      onClick={(event) => {
        onClickStop?.(event);
        onOpenProfile(authorProfile?.handle ?? item.authorHandle ?? item.author);
      }}
    >
      <span className="avatar">
        {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
      </span>
      <span>
        <strong>{authorName}</strong>
        <small>{relativeTimeLabel(item.createdAt, item.date)}</small>
      </span>
    </button>
  );
}

function SocialActions({
  item,
  commentCount,
  onAction,
  onCommentsClick,
  actorHandle
}: {
  item: InquiryItem;
  commentCount: number;
  onAction: (itemId: string, action: PostAction) => void;
  onCommentsClick?: () => void;
  actorHandle: string;
}) {
  const savedByActor = isSavedBy(item, actorHandle, profile.handle);
  const signaledByActor = hasHandle(item.signaledBy, actorHandle);
  const forkedByActor = hasHandle(item.forkedBy, actorHandle);
  const actions = [
    { label: "Likes", active: signaledByActor, value: item.metrics.signal, icon: ThumbsUp, action: "signal" as PostAction },
    { label: "Comments", value: String(commentCount), icon: MessageCircle, action: null },
    { label: "Reshares", active: forkedByActor, value: item.metrics.forks, icon: Repeat2, action: "fork" as PostAction },
    { label: "Saves", active: savedByActor, value: item.metrics.saves, icon: Bookmark, action: "save" as PostAction },
    { label: "Views", value: item.metrics.reads, icon: Eye, action: null }
  ];

  return (
    <div className="social-actions" aria-label="Post actions">
      {actions.map((action) => {
        const Icon = action.icon;
        const fillActiveIcon = action.active && (action.label === "Likes" || action.label === "Saves");
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            className={action.active ? "active" : ""}
            onClick={(event) => {
              event.stopPropagation();
              if (action.action) onAction(item.id, action.action);
              else if (action.label === "Comments") onCommentsClick?.();
            }}
          >
            <Icon size={16} fill={fillActiveIcon ? "currentColor" : "none"} />
            <span className="metric-label">{action.label}</span>
            <strong>{formatMetric(metricNumber(action.value))}</strong>
          </button>
        );
      })}
    </div>
  );
}

function DetailView({
  item,
  room,
  onBack,
  onOpenProfile,
  onAddComment,
  onAction,
  onCommentAction,
  onEditPost,
  onDeletePost,
  actorHandle,
  profiles,
  selectedCommentId,
  onClearSelectedComment,
  commentSegmentStacks,
  onCommentSegmentStackChange
}: {
  item: InquiryItem;
  room: Room;
  onBack: () => void;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onAction: (itemId: string, action: PostAction) => void;
  onCommentAction: (itemId: string, commentId: string, action: CommentAction) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onClearSelectedComment: () => void;
  commentSegmentStacks: CommentSegmentStacks;
  onCommentSegmentStackChange: (key: string, stack: string[]) => void;
}) {
  const isPaper = item.kind === "paper";
  const doiSlug = item.id.replace(/[^a-z0-9]+/gi, ".").replace(/\.+/g, ".").replace(/\.$/, "");
  const codeSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44);
  const authorProfile = profileForHandle(profiles, item.authorHandle ?? item.author);
  const authorName = authorProfile?.name ?? item.author;
  const commentsSectionId = `comments-${item.id}`;
  const scrollToComments = () => {
    document.getElementById(commentsSectionId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const threadSelectedCommentId = selectedCommentId === commentsSectionTargetId ? null : selectedCommentId;

  useEffect(() => {
    if (selectedCommentId !== commentsSectionTargetId) return;
    window.requestAnimationFrame(scrollToComments);
  }, [selectedCommentId, item.id]);

  return (
    <article className={`detail-layout ${isPaper ? "paper-detail" : "simple-detail"}`}>
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back to {room.feedLabel}
      </button>

      <section className="detail-main">
        <PostOwnerControls item={item} actorHandle={actorHandle} onEditPost={onEditPost} onDeletePost={onDeletePost} />
        <p className="eyebrow">{kindLabels[item.kind]}</p>
        <h1>{item.title}</h1>
        <button className="detail-byline-button" type="button" onClick={() => onOpenProfile(authorProfile?.handle ?? item.authorHandle ?? item.author)}>
          <span className="avatar">
            {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
          </span>
          <span>
            <strong>{authorName}</strong>
            <small>{relativeTimeLabel(item.createdAt, item.date)}</small>
          </span>
        </button>
        <p className="detail-body">{item.body}</p>
        <PostTimeFooter item={item} />
        <SocialActions
          item={item}
          commentCount={countComments(item.comments)}
          onAction={onAction}
          onCommentsClick={scrollToComments}
          actorHandle={actorHandle}
        />

        <section className="comments-section" id={commentsSectionId}>
          <h2>Discussion</h2>
          <CommentComposer itemId={item.id} onAddComment={onAddComment} />
          <CommentThread
            comments={item.comments}
            itemId={item.id}
            profiles={profiles}
            selectedCommentId={threadSelectedCommentId}
            onOpenProfile={onOpenProfile}
            onAddComment={onAddComment}
            onCommentAction={onCommentAction}
            actorHandle={actorHandle}
            onClearSelectedComment={onClearSelectedComment}
            commentSegmentStacks={commentSegmentStacks}
            onCommentSegmentStackChange={onCommentSegmentStackChange}
          />
        </section>
      </section>

      {isPaper ? (
        <aside className="paper-side">
          <section>
            <h2>Paper</h2>
            <div>
              <span>Collaborators</span>
              <strong>{authorName}</strong>
              <small>Independent reviewers pending</small>
            </div>
            <div>
              <span>DOI</span>
              <strong>10.0000/symposium.{doiSlug}</strong>
            </div>
            <div>
              <span>Code base</span>
              <strong>github.com/symposium-labs/{codeSlug || "paper"}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{item.status}</strong>
            </div>
          </section>
        </aside>
      ) : null}
    </article>
  );
}

function CommentComposer({
  itemId,
  onAddComment,
  parentId,
  compact = false
}: {
  itemId: string;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  parentId?: string | null;
  compact?: boolean;
}) {
  const [body, setBody] = useState("");

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanBody = body.trim();
    if (!cleanBody) return;

    onAddComment(itemId, cleanBody, "Comment", parentId ?? null);
    setBody("");
  };

  return (
    <form className={`comment-composer ${compact ? "compact" : ""}`} onSubmit={submitComment}>
      <div>
        <button type="submit">Add comment</button>
      </div>
        <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={compact ? "Write a reply" : "Add a critique, question, test, or reasoned response"}
      />
    </form>
  );
}

function CommentThread({
  comments,
  itemId,
  profiles,
  selectedCommentId,
  onOpenProfile,
  onAddComment,
  onCommentAction,
  actorHandle,
  onClearSelectedComment,
  commentSegmentStacks,
  onCommentSegmentStackChange,
  depth = 0
}: {
  comments: InquiryComment[];
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onCommentAction: (itemId: string, commentId: string, action: CommentAction) => void;
  actorHandle: string;
  onClearSelectedComment: () => void;
  commentSegmentStacks: CommentSegmentStacks;
  onCommentSegmentStackChange: (key: string, stack: string[]) => void;
  depth?: number;
}) {
  return (
    <div className={`comment-thread depth-${depth}`}>
      {comments.map((comment) => (
        <CommentRootSegment
          key={comment.id ?? `${comment.author}-${comment.stance}-${comment.body}`}
          comment={comment}
          itemId={itemId}
          profiles={profiles}
          selectedCommentId={selectedCommentId}
          onOpenProfile={onOpenProfile}
          onAddComment={onAddComment}
          onCommentAction={onCommentAction}
          actorHandle={actorHandle}
          onClearSelectedComment={onClearSelectedComment}
          segmentStack={commentSegmentStacks[commentSegmentStackKey(itemId, comment.id)] ?? null}
          onSegmentStackChange={(stack) =>
            onCommentSegmentStackChange(commentSegmentStackKey(itemId, comment.id), stack)
          }
          depth={depth}
        />
      ))}
    </div>
  );
}

function segmentStackForSelectedComment(root: InquiryComment, selectedCommentId: string | null) {
  if (!selectedCommentId) return [];
  const path = findCommentPathById([root], selectedCommentId);
  if (!path) return [];

  const stack: string[] = [];
  let segmentRootIndex = 0;
  while (path.length - segmentRootIndex > maxVisibleCommentPathLength) {
    segmentRootIndex += maxVisibleCommentPathLength - 1;
    const segmentRootId = path[segmentRootIndex]?.id;
    if (!segmentRootId) break;
    stack.push(segmentRootId);
  }

  return stack;
}

function CommentRootSegment({
  comment,
  itemId,
  profiles,
  selectedCommentId,
  onOpenProfile,
  onAddComment,
  onCommentAction,
  actorHandle,
  onClearSelectedComment,
  segmentStack,
  onSegmentStackChange,
  depth
}: {
  comment: InquiryComment;
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onCommentAction: (itemId: string, commentId: string, action: CommentAction) => void;
  actorHandle: string;
  onClearSelectedComment: () => void;
  segmentStack: string[] | null;
  onSegmentStackChange: (stack: string[]) => void;
  depth: number;
}) {
  const segmentRef = useRef<HTMLDivElement | null>(null);
  const pendingSegmentScrollRef = useRef(false);
  const selectedCommentRouteRef = useRef<string | null>(null);
  const selectedSegmentStack = segmentStackForSelectedComment(comment, selectedCommentId);
  const visibleSegmentStack = segmentStack ?? selectedSegmentStack;
  const activeSegmentId = visibleSegmentStack.at(-1);
  const activeComment = activeSegmentId ? findCommentById([comment], activeSegmentId) ?? comment : comment;

  useEffect(() => {
    if (!selectedCommentId) {
      selectedCommentRouteRef.current = null;
      return;
    }
    const selectedRoute = `${comment.id ?? "comment-root"}:${selectedCommentId}`;
    if (selectedCommentRouteRef.current === selectedRoute) return;
    selectedCommentRouteRef.current = selectedRoute;
    const selectedStack = segmentStackForSelectedComment(comment, selectedCommentId);
    const currentStack = segmentStack ?? [];
    if (selectedStack.join("|") === currentStack.join("|")) return;
    pendingSegmentScrollRef.current = true;
    onSegmentStackChange(selectedStack);
  }, [comment, onSegmentStackChange, selectedCommentId, segmentStack]);

  useLayoutEffect(() => {
    if (!pendingSegmentScrollRef.current || !segmentRef.current) return;
    pendingSegmentScrollRef.current = false;
    segmentRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [visibleSegmentStack]);

  const openReplySegment = (commentId: string) => {
    onClearSelectedComment();
    pendingSegmentScrollRef.current = true;
    if (visibleSegmentStack.at(-1) === commentId) return;
    onSegmentStackChange([...visibleSegmentStack, commentId]);
  };

  const showPreviousSegment = () => {
    onClearSelectedComment();
    pendingSegmentScrollRef.current = true;
    onSegmentStackChange(visibleSegmentStack.slice(0, -1));
  };

  return (
    <div className="comment-segment" ref={segmentRef}>
      {visibleSegmentStack.length ? (
        <button
          className="reply-window-button reply-window-button-previous"
          type="button"
          onClick={showPreviousSegment}
        >
          Show previous replies
        </button>
      ) : null}
      <CommentNode
        comment={activeComment}
        itemId={itemId}
        profiles={profiles}
        selectedCommentId={selectedCommentId}
        onOpenProfile={onOpenProfile}
        onAddComment={onAddComment}
        onCommentAction={onCommentAction}
        actorHandle={actorHandle}
        depth={depth}
        segmentDepth={1}
        onOpenReplySegment={openReplySegment}
        onClearSelectedComment={onClearSelectedComment}
      />
    </div>
  );
}

function CommentNode({
  comment,
  itemId,
  profiles,
  selectedCommentId,
  onOpenProfile,
  onAddComment,
  onCommentAction,
  actorHandle,
  depth,
  segmentDepth,
  onOpenReplySegment,
  onClearSelectedComment
}: {
  comment: InquiryComment;
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onCommentAction: (itemId: string, commentId: string, action: CommentAction) => void;
  actorHandle: string;
  depth: number;
  segmentDepth: number;
  onOpenReplySegment: (commentId: string) => void;
  onClearSelectedComment: () => void;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const replies = comment.replies ?? [];
  const nodeRef = useRef<HTMLElement | null>(null);
  const authorProfile = profileForHandle(profiles, comment.authorHandle ?? comment.author);
  const authorName = authorProfile?.name ?? comment.author;
  const highlighted = Boolean(selectedCommentId && comment.id === selectedCommentId);
  const canShowReplies = segmentDepth < maxVisibleCommentPathLength;
  const shouldHideReplies = replies.length > 0 && !canShowReplies;

  useLayoutEffect(() => {
    if (!highlighted) return;
    window.requestAnimationFrame(() => {
      nodeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [highlighted, selectedCommentId]);

  return (
    <article
      ref={nodeRef}
      id={comment.id ? `comment-${comment.id}` : undefined}
      className="comment"
    >
      <div className={`comment-card ${highlighted ? "highlighted" : ""}`}>
        <button type="button" className="comment-author" onClick={() => onOpenProfile(authorProfile?.handle ?? comment.authorHandle ?? comment.author)}>
          <span className="avatar small">
            {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
          </span>
          <span>
            <strong>{authorName}</strong>
            {comment.createdAt ? <small>{relativeTimeLabel(comment.createdAt)}</small> : null}
          </span>
        </button>
        <p>{comment.body}</p>
        <CommentTimeFooter comment={comment} />
        <CommentActions
          comment={comment}
          itemId={itemId}
          actorHandle={actorHandle}
          onAction={onCommentAction}
        />
        <button className="reply-button" type="button" onClick={() => setReplyOpen((open) => !open)}>
          Reply
        </button>
        {replyOpen ? (
          <CommentComposer
            itemId={itemId}
            parentId={comment.id ?? null}
            compact
            onAddComment={(id, body, stance, parentId) => {
              onAddComment(id, body, stance, parentId);
              setReplyOpen(false);
            }}
          />
        ) : null}
      </div>
      {shouldHideReplies ? (
        <div className="reply-window">
          {comment.id ? (
            <button
              className="reply-window-button"
              type="button"
              onClick={() => onOpenReplySegment(comment.id as string)}
            >
              Show more replies
            </button>
          ) : null}
        </div>
      ) : replies.length ? (
        <div className="reply-window">
          <div className={`comment-thread depth-${depth + 1}`}>
            {replies.map((reply) => (
              <CommentNode
                key={reply.id ?? `${reply.author}-${reply.stance}-${reply.body}`}
                comment={reply}
                itemId={itemId}
                profiles={profiles}
                selectedCommentId={selectedCommentId}
                onOpenProfile={onOpenProfile}
                onAddComment={onAddComment}
                onCommentAction={onCommentAction}
                actorHandle={actorHandle}
                depth={depth + 1}
                segmentDepth={segmentDepth + 1}
                onOpenReplySegment={onOpenReplySegment}
                onClearSelectedComment={onClearSelectedComment}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CommentTimeFooter({ comment }: { comment: InquiryComment }) {
  const created = localDateTimeLabel(comment.createdAt);
  if (!created) return null;

  return <footer className="comment-time-footer">Posted {created}</footer>;
}

function CommentActions({
  comment,
  itemId,
  actorHandle,
  onAction
}: {
  comment: InquiryComment;
  itemId: string;
  actorHandle: string;
  onAction: (itemId: string, commentId: string, action: CommentAction) => void;
}) {
  if (!comment.id) return null;

  const metrics = { ...commentMetricsFallback, ...(comment.metrics ?? {}) };
  const actions = [
    { label: "Likes", active: commentActionActive(comment, "signal", actorHandle), value: metrics.signal, icon: ThumbsUp, action: "signal" as CommentAction },
    { label: "Reshares", active: commentActionActive(comment, "fork", actorHandle), value: metrics.forks, icon: Repeat2, action: "fork" as CommentAction },
    { label: "Saves", active: commentActionActive(comment, "save", actorHandle), value: metrics.saves, icon: Bookmark, action: "save" as CommentAction },
    { label: "Views", value: metrics.reads, icon: Eye, action: "read" as CommentAction }
  ];

  return (
    <div className="comment-actions" aria-label="Comment actions">
      {actions.map((action) => {
        const Icon = action.icon;
        const fillActiveIcon = action.active && (action.label === "Likes" || action.label === "Saves");
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            className={action.active ? "active" : ""}
            onClick={() => onAction(itemId, comment.id as string, action.action)}
          >
            <Icon size={15} fill={fillActiveIcon ? "currentColor" : "none"} />
            <span>{action.label}</span>
            <strong>{formatMetric(metricNumber(action.value))}</strong>
          </button>
        );
      })}
    </div>
  );
}

function NotebookPanel({
  noteText,
  setNoteText,
  context,
  onClose
}: {
  noteText: string;
  setNoteText: (text: string) => void;
  context: string;
  onClose: () => void;
}) {
  return (
    <aside className="side-panel notebook-panel">
      <PanelHeader icon={<NotebookPen size={18} />} title="Notebook" onClose={onClose} />
      <p className="panel-context">{context}</p>
      <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} />
      <div className="note-stack">
        <span>Draft paper margin</span>
        <span>Objection smell test</span>
        <span>Saved replication idea</span>
      </div>
    </aside>
  );
}

function TabletPanel({
  context,
  selectedItem,
  room,
  onClose
}: {
  context: string;
  selectedItem: InquiryItem | null;
  room: Room;
  onClose: () => void;
}) {
  const prompts = selectedItem
    ? [
        "Find the strongest unresolved objection.",
        "Suggest the next test.",
        "Map the forks worth opening."
      ]
    : [
        `Summarize the live work in ${room.name}.`,
        "What should be saved for later?",
        "Which claim needs critique first?"
      ];

  return (
    <aside className="side-panel tablet-panel">
      <PanelHeader icon={<BrainCircuit size={18} />} title="AI Tablet" onClose={onClose} />
      <p className="panel-context">{context}</p>
      <section className="tablet-lens">
        <span>Context lens</span>
        <strong>{selectedItem ? selectedItem.status : room.feedLabel}</strong>
      </section>
      <div className="prompt-stack">
        {prompts.map((prompt) => (
          <button type="button" key={prompt}>
            <Sparkles size={15} />
            {prompt}
          </button>
        ))}
      </div>
      <form className="tablet-input">
        <input placeholder="Ask from the current room" />
        <button type="button" title="Send">
          <Send size={17} />
        </button>
      </form>
    </aside>
  );
}

function ProfileView({
  person,
  items,
  isOwnProfile,
  isFollowing,
  onSelect,
  onOpenProfile,
  onAction,
  onOpenSettings,
  onToggleFollow,
  actorHandle,
  profiles,
  socialLists,
  getProfileRecency,
  getProfileCommentRecency,
  activeTab,
  activityRevision,
  onActiveTabChange,
  onEditPost,
  onDeletePost
}: {
  person: ResearchProfile;
  items: InquiryItem[];
  isOwnProfile: boolean;
  isFollowing: boolean;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
  onOpenSettings: () => void;
  onToggleFollow: (handle: string) => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  socialLists: ProfileSocialLists;
  getProfileRecency: (item: InquiryItem, handle: string, kind: ProfileActivityKind) => number;
  getProfileCommentRecency: (
    item: InquiryItem,
    comment: InquiryComment,
    handle: string,
    kind: ProfileCommentActivityKind
  ) => number;
  activeTab: ProfileTab;
  activityRevision: number;
  onActiveTabChange: (tab: ProfileTab) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
}) {
  const [activeSocialList, setActiveSocialList] = useState<"following" | "followers" | null>(null);
  const [visibleSlots, setVisibleSlots] = useState<ProfileActivitySlot[]>([]);
  const byPublishedRecency = (nextItems: InquiryItem[]) =>
    [...nextItems].sort((a, b) => getProfileRecency(b, person.handle, "authored") - getProfileRecency(a, person.handle, "authored"));
  const byProfileRecency = (nextItems: InquiryItem[], kind: ProfileActivityKind) =>
    [...nextItems].sort((a, b) => getProfileRecency(b, person.handle, kind) - getProfileRecency(a, person.handle, kind));
  const postEntry = (item: InquiryItem, recency: number): ProfileActivityEntry => ({
    id: `post:${item.id}`,
    type: "post",
    item,
    recency
  });
  const commentEntry = (activity: ProfileCommentActivity): ProfileActivityEntry => ({
    id: `comment:${activity.id}`,
    type: "comment",
    activity,
    recency: activity.recency
  });
  const sortEntries = (entries: ProfileActivityEntry[]) => [...entries].sort((a, b) => b.recency - a.recency);
  const entryToSlot = (entry: ProfileActivityEntry): ProfileActivitySlot =>
    entry.type === "post"
      ? { id: entry.id, type: "post", itemId: entry.item.id, recency: entry.recency }
      : {
          id: entry.id,
          type: "comment",
          itemId: entry.activity.item.id,
          commentId: entry.activity.comment.id as string,
          kind: entry.activity.kind,
          label: entry.activity.label,
          recency: entry.recency
        };
  const isAuthor = (item: InquiryItem) => itemAuthoredByProfile(item, person);
  const canShowLikes = actorHandle === person.handle || inferredLikesPublic(person);
  const canShowReshares = actorHandle === person.handle || inferredResharesPublic(person);
  const canShowSaved = actorHandle === person.handle;
  const authored = byPublishedRecency(items.filter(isAuthor));
  const papers = authored.filter((item) => item.kind === "paper");
  const thoughts = authored.filter((item) => item.kind === "thought" || item.kind === "note");
  const commentRecency = (item: InquiryItem, comment: InquiryComment, kind: ProfileCommentActivityKind) =>
    getProfileCommentRecency(item, comment, person.handle, kind);
  const commentActivities = collectProfileComments(items, person, "comments", commentRecency);
  const commentReshares = canShowReshares ? collectProfileComments(items, person, "fork", commentRecency) : [];
  const commentLikes = canShowLikes ? collectProfileComments(items, person, "signal", commentRecency) : [];
  const commentSaved = canShowSaved ? collectProfileComments(items, person, "save", commentRecency) : [];
  const reshares = canShowReshares
    ? byProfileRecency(items.filter((item) => !isAuthor(item) && hasHandle(item.forkedBy, person.handle)), "fork")
    : [];
  const likes = canShowLikes
    ? byProfileRecency(items.filter((item) => !isAuthor(item) && hasHandle(item.signaledBy, person.handle)), "signal")
    : [];
  const saved = canShowSaved ? byProfileRecency(items.filter((item) => !isAuthor(item) && isSavedBy(item, person.handle, profile.handle)), "save") : [];
  const authoredEntries = authored.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const paperEntries = papers.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const thoughtEntries = thoughts.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const reshareEntries = reshares.map((item) => postEntry(item, getProfileRecency(item, person.handle, "fork")));
  const likeEntries = likes.map((item) => postEntry(item, getProfileRecency(item, person.handle, "signal")));
  const savedEntries = saved.map((item) => postEntry(item, getProfileRecency(item, person.handle, "save")));
  const commentEntries = commentActivities.map(commentEntry);
  const commentReshareEntries = commentReshares.map(commentEntry);
  const commentLikeEntries = commentLikes.map(commentEntry);
  const commentSavedEntries = commentSaved.map(commentEntry);
  const allActivity = sortEntries([
    ...authoredEntries,
    ...commentEntries,
    ...reshareEntries,
    ...commentReshareEntries
  ]);

  const tabEntries: Record<ProfileTab, ProfileActivityEntry[]> = {
    all: allActivity,
    papers: paperEntries,
    thoughts: thoughtEntries,
    comments: commentEntries,
    reshares: sortEntries([...reshareEntries, ...commentReshareEntries]),
    likes: sortEntries([...likeEntries, ...commentLikeEntries]),
    saved: sortEntries([...savedEntries, ...commentSavedEntries])
  };

  const tabCounts: Record<ProfileTab, number> = {
    all: allActivity.length,
    papers: papers.length,
    thoughts: thoughts.length,
    comments: commentActivities.length,
    reshares: reshareEntries.length + commentReshareEntries.length,
    likes: likeEntries.length + commentLikeEntries.length,
    saved: savedEntries.length + commentSavedEntries.length
  };

  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "all", label: "All" },
    { id: "papers", label: "Papers" },
    { id: "thoughts", label: "Thoughts" },
    { id: "comments", label: "Comments" },
    ...(canShowReshares ? [{ id: "reshares" as const, label: "Reshares" }] : []),
    ...(canShowLikes ? [{ id: "likes" as const, label: "Likes" }] : []),
    ...(canShowSaved ? [{ id: "saved" as const, label: "Saved" }] : [])
  ];

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) onActiveTabChange("all");
  }, [activeTab, onActiveTabChange, tabs]);

  useLayoutEffect(() => {
    setVisibleSlots(tabEntries[activeTab].map(entryToSlot));
  }, [activeTab, person.handle, activityRevision]);

  const resolveSlot = (slot: ProfileActivitySlot): ProfileActivityEntry | null => {
    const item = items.find((candidate) => candidate.id === slot.itemId);
    if (!item) return null;

    if (slot.type === "post") {
      return { id: slot.id, type: "post", item, recency: slot.recency };
    }

    const comment = findCommentById(item.comments, slot.commentId);
    if (!comment) return null;

    return {
      id: slot.id,
      type: "comment",
      activity: {
        id: `${slot.kind}:${item.id}:${comment.id}`,
        item,
        comment,
        kind: slot.kind,
        label: slot.label,
        recency: slot.recency
      },
      recency: slot.recency
    };
  };

  const visibleEntries = visibleSlots.map(resolveSlot).filter((entry): entry is ProfileActivityEntry => Boolean(entry));

  return (
    <article className="profile-page">
      <section className="profile-hero">
        <span className="avatar large profile-avatar">
          {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initial(person.name)}
        </span>
        <div>
          {isOwnProfile ? (
            <button className="profile-settings-button" type="button" onClick={onOpenSettings}>
              <Settings size={17} />
              <span>Edit profile</span>
            </button>
          ) : (
            <button
              className={`profile-follow-button ${isFollowing ? "active" : ""}`}
              type="button"
              onClick={() => onToggleFollow(person.handle)}
            >
              <UserRound size={17} />
              <span>{isFollowing ? "Following" : "Follow"}</span>
            </button>
          )}
          <h1>{person.name}</h1>
          <p className="profile-handle">{person.handle}</p>
          <p className="profile-bio">{person.bio.slice(0, 200)}</p>
          <div className="profile-social-counts" aria-label={`${person.name} social graph`}>
            <button type="button" onClick={() => setActiveSocialList("following")}>
              <strong>{socialLists.following.length}</strong>
              <span>Following</span>
            </button>
            <button type="button" onClick={() => setActiveSocialList("followers")}>
              <strong>{socialLists.followers.length}</strong>
              <span>Followers</span>
            </button>
          </div>
          <div className="profile-metrics" aria-label={`${person.name} activity totals`}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => onActiveTabChange(tab.id)}
              >
                <strong>{tabCounts[tab.id]}</strong>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="feed-stream profile-stream" aria-label={`${person.name} profile feed`}>
        {visibleEntries.length ? (
          visibleEntries.map((entry) =>
            entry.type === "comment" ? (
              <ProfileCommentCard
                key={entry.id}
                activity={entry.activity}
                profiles={profiles}
                onSelect={onSelect}
                onOpenProfile={onOpenProfile}
              />
            ) : (
              <FeedPost
                key={entry.id}
                item={entry.item}
                onSelect={onSelect}
                onOpenProfile={onOpenProfile}
                onAction={onAction}
                onEditPost={onEditPost}
                onDeletePost={onDeletePost}
                actorHandle={actorHandle}
                profiles={profiles}
              />
            )
          )
        ) : (
          <div className="empty-feed">
            <strong>No items here yet.</strong>
            <span>This section will fill as the profile has more activity.</span>
          </div>
        )}
      </section>

      {activeSocialList ? (
        <ProfileSocialListModal
          title={activeSocialList === "following" ? "Following" : "Followers"}
          handles={socialLists[activeSocialList]}
          profiles={profiles}
          onClose={() => setActiveSocialList(null)}
          onOpenProfile={(handle) => {
            setActiveSocialList(null);
            onOpenProfile(handle);
          }}
        />
      ) : null}
    </article>
  );
}

function ProfileCommentCard({
  activity,
  profiles,
  onSelect,
  onOpenProfile
}: {
  activity: ProfileCommentActivity;
  profiles: Record<string, ResearchProfile>;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
}) {
  const authorProfile = profileForHandle(profiles, activity.comment.authorHandle ?? activity.comment.author);
  const authorName = authorProfile?.name ?? activity.comment.author;

  return (
    <article
      className="profile-comment-card"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(activity.item.id, activity.comment.id ?? null)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(activity.item.id, activity.comment.id ?? null);
        }
      }}
    >
      <header>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProfile(authorProfile?.handle ?? activity.comment.authorHandle ?? activity.comment.author);
          }}
        >
          <span className="avatar small">
            {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
          </span>
          <span>
            <strong>{authorName}</strong>
            <small>{relativeTimeLabel(activity.comment.createdAt, "Comment")}</small>
          </span>
        </button>
        <span>
          <MessageCircle size={15} />
          {activity.label}
        </span>
      </header>
      <p>{activity.comment.body}</p>
      <footer>
        <span>On</span>
        <strong>{activity.item.title}</strong>
        {activity.comment.createdAt ? <em>{localDateTimeLabel(activity.comment.createdAt)}</em> : null}
      </footer>
    </article>
  );
}

function ProfileSocialListModal({
  title,
  handles,
  profiles,
  onClose,
  onOpenProfile
}: {
  title: string;
  handles: string[];
  profiles: Record<string, ResearchProfile>;
  onClose: () => void;
  onOpenProfile: (handle: string) => void;
}) {
  return (
    <div className="modal-backdrop social-list-backdrop" role="presentation" onClick={onClose}>
      <section className="social-list-modal" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="social-list-body">
          {handles.length ? (
            handles.map((handle) => {
              const person = profiles[handle];
              return (
                <button type="button" key={handle} onClick={() => onOpenProfile(handle)}>
                  <span className="avatar small">
                    {person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initial(person?.name ?? handle)}
                  </span>
                  <span>
                    <strong>{person?.name ?? handle}</strong>
                    <small>{handle}</small>
                  </span>
                </button>
              );
            })
          ) : (
            <p>No profiles here yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function SearchModal({
  query,
  setQuery,
  results,
  onClose,
  onOpenPost,
  onOpenProfile
}: {
  query: string;
  setQuery: (query: string) => void;
  results: {
    titleMatches: InquiryItem[];
    contentMatches: InquiryItem[];
    profileMatches: ResearchProfile[];
  };
  onClose: () => void;
  onOpenPost: (id: string) => void;
  onOpenProfile: (name: string) => void;
}) {
  const hasQuery = query.trim().length > 0;
  const hasResults =
    results.titleMatches.length || results.contentMatches.length || results.profileMatches.length;

  return (
    <div className="modal-backdrop search-backdrop" role="presentation" onClick={onClose}>
      <section className="search-modal" aria-label="Search Symposium" onClick={(event) => event.stopPropagation()}>
        <header>
          <label>
            <Search size={18} />
            <input
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search posts, comments, people"
            />
          </label>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="search-results">
          {!hasQuery ? (
            <p>Start typing to search across titles, bodies, comments, and profiles.</p>
          ) : hasResults ? (
            <>
              {results.titleMatches.length ? (
                <SearchResultGroup title="Title matches" items={results.titleMatches} onOpenPost={onOpenPost} />
              ) : null}
              {results.contentMatches.length ? (
                <SearchResultGroup title="Content and comments" items={results.contentMatches} onOpenPost={onOpenPost} />
              ) : null}
              {results.profileMatches.length ? (
                <section className="search-group">
                  <h2>People</h2>
                  {results.profileMatches.map((person) => (
                    <button key={person.handle} type="button" onClick={() => onOpenProfile(person.name)}>
                      <span className="avatar small">{initial(person.name)}</span>
                      <span>
                        <strong>{person.name}</strong>
                        <small>{person.role}</small>
                      </span>
                    </button>
                  ))}
                </section>
              ) : null}
            </>
          ) : (
            <p>No results yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function SearchResultGroup({
  title,
  items,
  onOpenPost
}: {
  title: string;
  items: InquiryItem[];
  onOpenPost: (id: string) => void;
}) {
  return (
    <section className="search-group">
      <h2>{title}</h2>
      {items.slice(0, 8).map((item) => (
        <button key={item.id} type="button" onClick={() => onOpenPost(item.id)}>
          <span>{kindLabels[item.kind]}</span>
          <strong>{item.title}</strong>
          <small>
            {item.author} · {item.date}
          </small>
        </button>
      ))}
    </section>
  );
}

function MessagesModal({ onClose }: { onClose: () => void }) {
  const threads = [
    {
      name: "AI Metascience Lab",
      type: "Group",
      preview: "Mira shared the benchmark notes for tomorrow's review.",
      time: "12m"
    },
    {
      name: "Niko Varga",
      type: "Direct",
      preview: "Can you look over the hidden-law task stub?",
      time: "31m"
    },
    {
      name: "Campus Events Board",
      type: "Group",
      preview: "Office hours moved to the civic patronage table.",
      time: "1h"
    },
    {
      name: "Salma Idris",
      type: "Direct",
      preview: "The youth-lab call notes are ready when you are.",
      time: "3h"
    }
  ];

  return (
    <div className="modal-backdrop messages-backdrop" role="presentation" onClick={onClose}>
      <section className="messages-modal" aria-label="Messages" onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <MessageCircle size={18} />
            Messages
          </span>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="message-list">
          {threads.map((thread) => (
            <button className="message-thread" type="button" key={`${thread.type}-${thread.name}`}>
              <span className="avatar small">{initial(thread.name)}</span>
              <span>
                <strong>{thread.name}</strong>
                <small>
                  {thread.type} · {thread.time}
                </small>
                <em>{thread.preview}</em>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProfileSettingsModal({
  currentProfile,
  onClose,
  onSave,
  onUploadAvatar,
  onSignOut
}: {
  currentProfile: ResearchProfile;
  onClose: () => void;
  onSave: (draft: ProfileSettingsDraft) => void;
  onUploadAvatar: (file: File) => Promise<string>;
  onSignOut: () => void;
}) {
  const [avatarUrl, setAvatarUrl] = useState(currentProfile.avatarUrl ?? "");
  const [name, setName] = useState(currentProfile.name);
  const [bio, setBio] = useState(currentProfile.bio.slice(0, 200));
  const [likesPublic, setLikesPublic] = useState(inferredLikesPublic(currentProfile));
  const [resharesPublic, setResharesPublic] = useState(inferredResharesPublic(currentProfile));
  const [avatarUploadStatus, setAvatarUploadStatus] = useState("");

  useEffect(() => {
    setAvatarUrl(currentProfile.avatarUrl ?? "");
    setName(currentProfile.name);
    setBio(currentProfile.bio.slice(0, 200));
    setLikesPublic(inferredLikesPublic(currentProfile));
    setResharesPublic(inferredResharesPublic(currentProfile));
    setAvatarUploadStatus("");
  }, [currentProfile]);

  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ avatarUrl, name, bio, likesPublic, resharesPublic });
  };

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAvatarUploadStatus("Uploading photo");
    try {
      const nextAvatarUrl = await onUploadAvatar(file);
      setAvatarUrl(nextAvatarUrl);
      setAvatarUploadStatus("Photo ready");
    } catch (error) {
      setAvatarUploadStatus(error instanceof Error ? error.message : "Could not upload this photo.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form className="profile-settings-modal" onSubmit={submitProfile} onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <Settings size={18} />
            Profile settings
          </span>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <section className="settings-preview">
          <label className="profile-photo-edit">
            <span className="avatar large profile-avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : initial(name || currentProfile.name)}
              <span className="profile-photo-edit-overlay">Edit</span>
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/avif"
              onChange={uploadAvatar}
            />
          </label>
          <div>
            <strong>{name || currentProfile.name}</strong>
            <small>{currentProfile.handle}</small>
            {avatarUploadStatus ? <em>{avatarUploadStatus}</em> : null}
          </div>
        </section>

        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Bio
          <textarea value={bio} maxLength={200} onChange={(event) => setBio(event.target.value.slice(0, 200))} />
          <small>{bio.length}/200</small>
        </label>
        <label className="setting-toggle">
          <input type="checkbox" checked={likesPublic} onChange={(event) => setLikesPublic(event.target.checked)} />
          Share likes on profile
        </label>
        <label className="setting-toggle">
          <input type="checkbox" checked={resharesPublic} onChange={(event) => setResharesPublic(event.target.checked)} />
          Share reshares on profile
        </label>
        <div className="settings-actions">
          <button type="submit">Save settings</button>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </form>
    </div>
  );
}

function PanelHeader({
  icon,
  title,
  onClose
}: {
  icon: ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="panel-header">
      <span>
        {icon}
        {title}
      </span>
      <button type="button" title="Close" onClick={onClose}>
        <X size={17} />
      </button>
    </header>
  );
}
