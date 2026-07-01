"use client";

import Image from "next/image";
import { SignInButton, SignUpButton, useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
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
  Repeat2,
  Search,
  Send,
  Sparkles,
  Settings,
  Sun,
  ThumbsUp,
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
import type { PostAction } from "@/lib/dataStore";
import {
  cleanHandle,
  countComments,
  formatMetric,
  hasHandle,
  itemTimestampScore,
  isSavedBy,
  metricNumber,
  mutateItemForActor,
  normalizeSearchPhrase,
  relativeTimeLabel
} from "@/lib/symposiumCore";

type Theme = "day" | "night";
type ProfileTab = "all" | "papers" | "thoughts" | "comments" | "reshares" | "likes" | "saved";
type ProfileActivityKind = "authored" | "comments" | "fork" | "signal" | "save";
type EntryMode = "loading" | "approach" | "auth" | "complete";
type OfficeMode = "desk" | "saved" | "notes";
type PatronageMode = "lobby" | "civic" | "private";

type ViewSnapshot = {
  activeRoom: RoomId;
  selectedItemId: string | null;
  selectedCommentId: string | null;
  selectedProfileName: string | null;
  officeMode: OfficeMode;
  patronageMode: PatronageMode;
  selectedCommunityId: string | null;
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

const commentTreeHasAuthor = (comments: InquiryComment[], person: ResearchProfile): boolean =>
  comments.some(
    (comment) =>
      (comment.authorHandle ? comment.authorHandle === person.handle : comment.author === person.name) ||
      commentTreeHasAuthor(comment.replies ?? [], person)
  );

const commentTreeHasId = (comments: InquiryComment[], id: string): boolean =>
  comments.some((comment) => comment.id === id || commentTreeHasId(comment.replies ?? [], id));

const commentAuthoredByProfile = (comment: InquiryComment, person: ResearchProfile) =>
  comment.authorHandle ? cleanHandle(comment.authorHandle) === person.handle : comment.author === person.name;

const commentTimestampScore = (comment: InquiryComment) => {
  const parsed = comment.createdAt ? Date.parse(comment.createdAt) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

const collectProfileComments = (
  items: InquiryItem[],
  person: ResearchProfile
): ProfileCommentActivity[] => {
  const activities: ProfileCommentActivity[] = [];

  const visit = (item: InquiryItem, comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (commentAuthoredByProfile(comment, person) && comment.id) {
        activities.push({
          id: `${item.id}:${comment.id}`,
          item,
          comment,
          recency: commentTimestampScore(comment) || itemTimestampScore(item)
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

const uniqueItemsById = (items: InquiryItem[]) => [...new Map(items.map((item) => [item.id, item])).values()];

const profileForHandle = (profiles: Record<string, ResearchProfile>, handleOrName?: string) => {
  if (!handleOrName) return undefined;
  return profiles[cleanHandle(handleOrName)] ?? Object.values(profiles).find((person) => person.name === handleOrName);
};

const inferredLikesPublic = (person: ResearchProfile) => person.likesPublic ?? person.handle.length % 5 !== 0;
const inferredResharesPublic = (person: ResearchProfile) => person.resharesPublic ?? person.handle.length % 4 !== 0;

const fallbackCommunityCount = 8;
const commentReplyPageSize = 6;

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
  const [activityRecency, setActivityRecency] = useState<Record<string, number>>({});
  const [syncStatus, setSyncStatus] = useState("Loading live data");
  const [authError, setAuthError] = useState("");
  const itemsRef = useRef(items);
  const profilesRef = useRef(profiles);
  const currentProfileRef = useRef(currentProfile);
  const selectedProfileNameRef = useRef(selectedProfileName);
  const actionVersionsRef = useRef<Record<string, number>>({});
  const actionDesiredStateRef = useRef<Record<string, boolean | undefined>>({});
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
  const getPublishedRecency = (item: InquiryItem) => itemTimestampScore(item);
  const profileActivityKey = (handle: string, action: PostAction, itemId: string) =>
    `profile:${cleanHandle(handle)}:${action}:${itemId}`;
  const getProfileRecency = (item: InquiryItem, handle: string, kind: ProfileActivityKind) => {
    if (kind === "authored") return getPublishedRecency(item);
    if (kind === "comments") return activityRecency[item.id] ?? getPublishedRecency(item);
    return activityRecency[profileActivityKey(handle, kind, item.id)] ?? getPublishedRecency(item);
  };
  const getProfileAllRecency = (item: InquiryItem, handle: string) => {
    const recencies = [getPublishedRecency(item)];
    if (hasHandle(item.forkedBy, handle)) recencies.push(getProfileRecency(item, handle, "fork"));
    if (hasHandle(item.signaledBy, handle)) recencies.push(getProfileRecency(item, handle, "signal"));
    if (isSavedBy(item, handle, profile.handle)) recencies.push(getProfileRecency(item, handle, "save"));
    return Math.max(...recencies);
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
      return raw ? (JSON.parse(raw) as LocalSnapshot) : null;
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

    const loadedItems = sortByPublishedRecency(data.items);
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
    if (payload.follow || event.kind === "profile.followed" || event.kind === "profile.unfollowed") {
      mergeLiveFollow(payload.follow, event.kind !== "profile.unfollowed");
    }

    if (isLiveInquiryItem(payload.item)) {
      const action = payload.action;
      if (action && event.actorHandle === currentProfileRef.current.handle) {
        const key = `${payload.item.id}:${action}:${currentProfileRef.current.handle}`;
        const desired = actionDesiredStateRef.current[key];
        const serverActive = itemActionActive(payload.item, action, currentProfileRef.current.handle);
        if (desired !== undefined && serverActive !== desired) return;
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

    if ("EventSource" in window) {
      const cursor = liveEventCursorRef.current;
      source = new EventSource(`/api/events/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      source.onopen = () => {
        if (pollTimer) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
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
    } else {
      startPolling();
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
      setActivityRecency(JSON.parse(window.localStorage.getItem("symposium-activity-recency") ?? "{}") as Record<string, number>);
    } catch {
      setActivityRecency({});
    }
    setEntryMode("approach");

    refreshData(storedProfileHandle ?? undefined).catch(() => {
      const local = readLocalSnapshot();
      const fallbackProfiles = local?.profiles ?? { [profile.handle]: profile };
      const fallbackProfile = fallbackProfiles[storedProfileHandle ?? profile.handle] ?? profile;
      const fallbackItems = sortByPublishedRecency(local?.items ?? inquiryItems);
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

  const touchActivity = (itemId: string, timestamp = Date.now()) => {
    setActivityRecency((current) => {
      const next = { ...current, [itemId]: timestamp };
      window.localStorage.setItem("symposium-activity-recency", JSON.stringify(next));
      return next;
    });
  };

  const touchProfileAction = (itemId: string, action: PostAction, handle = currentProfile.handle, timestamp = Date.now()) => {
    if (action === "read") return;
    setActivityRecency((current) => {
      const next = { ...current, [profileActivityKey(handle, action, itemId)]: timestamp };
      window.localStorage.setItem("symposium-activity-recency", JSON.stringify(next));
      return next;
    });
  };

  const snapshotView = (): ViewSnapshot => ({
    activeRoom,
    selectedItemId,
    selectedCommentId,
    selectedProfileName,
    officeMode,
    patronageMode,
    selectedCommunityId,
    scrollY: window.scrollY
  });

  const restoreView = (snapshot: ViewSnapshot) => {
    setActiveRoom(snapshot.activeRoom);
    setSelectedItemId(snapshot.selectedItemId);
    setSelectedCommentId(snapshot.selectedCommentId);
    setSelectedProfileName(snapshot.selectedProfileName);
    setOfficeMode(snapshot.officeMode);
    setPatronageMode(snapshot.patronageMode);
    setSelectedCommunityId(snapshot.selectedCommunityId);
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
    scrollY = 0
  ) => {
    setViewHistory((history) => [...history, snapshotView()]);
    setViewFuture([]);
    if (next.activeRoom !== undefined) setActiveRoom(next.activeRoom);
    if (next.selectedItemId !== undefined) setSelectedItemId(next.selectedItemId);
    if (next.selectedCommentId !== undefined) setSelectedCommentId(next.selectedCommentId);
    if (next.selectedProfileName !== undefined) setSelectedProfileName(next.selectedProfileName);
    if (next.officeMode !== undefined) setOfficeMode(next.officeMode);
    if (next.patronageMode !== undefined) setPatronageMode(next.patronageMode);
    if (next.selectedCommunityId !== undefined) setSelectedCommunityId(next.selectedCommunityId);
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesOpen(false);
    window.setTimeout(() => window.scrollTo({ top: scrollY, behavior: "auto" }), 0);
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
    navigateView({ selectedProfileName: profileKey, selectedItemId: null, selectedCommentId: null });
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

  const openPost = (id: string, commentId?: string | null) => {
    navigateView({ selectedItemId: id, selectedCommentId: commentId ?? null, selectedProfileName: null });
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
            getProfileAllRecency={getProfileAllRecency}
          />
        ) : selectedItem ? (
          <DetailView
            item={selectedItem}
            room={activeRoomData}
            onBack={goBack}
            onOpenProfile={openProfile}
            onAddComment={addComment}
            onAction={applyAction}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            selectedCommentId={selectedCommentId}
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

function FeedPost({
  item,
  onSelect,
  onOpenProfile,
  onAction,
  actorHandle,
  profiles
}: {
  item: InquiryItem;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
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
      <PostAuthor
        item={item}
        profiles={profiles}
        onOpenProfile={onOpenProfile}
        onClickStop={(event) => event.stopPropagation()}
      />
      <div className="post-body">
        <h2>{item.title}</h2>
        <p>{item.excerpt}</p>
        <SocialActions item={item} commentCount={countComments(item.comments)} onAction={onAction} actorHandle={actorHandle} />
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
  actorHandle
}: {
  item: InquiryItem;
  commentCount: number;
  onAction: (itemId: string, action: PostAction) => void;
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
  actorHandle,
  profiles,
  selectedCommentId
}: {
  item: InquiryItem;
  room: Room;
  onBack: () => void;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onAction: (itemId: string, action: PostAction) => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
}) {
  const isPaper = item.kind === "paper";
  const doiSlug = item.id.replace(/[^a-z0-9]+/gi, ".").replace(/\.+/g, ".").replace(/\.$/, "");
  const codeSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44);
  const authorProfile = profileForHandle(profiles, item.authorHandle ?? item.author);
  const authorName = authorProfile?.name ?? item.author;

  return (
    <article className={`detail-layout ${isPaper ? "paper-detail" : "simple-detail"}`}>
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back to {room.feedLabel}
      </button>

      <section className="detail-main">
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
        <SocialActions item={item} commentCount={countComments(item.comments)} onAction={onAction} actorHandle={actorHandle} />

        <section className="comments-section">
          <h2>Discussion</h2>
          <CommentComposer itemId={item.id} onAddComment={onAddComment} />
          <CommentThread
            comments={item.comments}
            itemId={item.id}
            profiles={profiles}
            selectedCommentId={selectedCommentId}
            onOpenProfile={onOpenProfile}
            onAddComment={onAddComment}
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
  depth = 0
}: {
  comments: InquiryComment[];
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  depth?: number;
}) {
  return (
    <div className={`comment-thread depth-${depth}`}>
      {comments.map((comment) => (
        <CommentNode
          key={comment.id ?? `${comment.author}-${comment.stance}-${comment.body}`}
          comment={comment}
          itemId={itemId}
          profiles={profiles}
          selectedCommentId={selectedCommentId}
          onOpenProfile={onOpenProfile}
          onAddComment={onAddComment}
          depth={depth}
        />
      ))}
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
  depth
}: {
  comment: InquiryComment;
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  depth: number;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const replies = comment.replies ?? [];
  const [replyPage, setReplyPage] = useState(() => {
    if (!selectedCommentId) return 0;
    const selectedReplyIndex = replies.findIndex((reply) => commentTreeHasId([reply], selectedCommentId));
    return selectedReplyIndex >= 0 ? Math.floor(selectedReplyIndex / commentReplyPageSize) : 0;
  });
  const nodeRef = useRef<HTMLElement | null>(null);
  const authorProfile = profileForHandle(profiles, comment.authorHandle ?? comment.author);
  const authorName = authorProfile?.name ?? comment.author;
  const highlighted = Boolean(selectedCommentId && comment.id === selectedCommentId);
  const pageStart = replyPage * commentReplyPageSize;
  const visibleReplies = replies.slice(pageStart, pageStart + commentReplyPageSize);
  const hasPreviousReplies = replyPage > 0;
  const hasMoreReplies = pageStart + commentReplyPageSize < replies.length;

  useEffect(() => {
    if (!selectedCommentId || !replies.length) return;
    const selectedReplyIndex = replies.findIndex((reply) => commentTreeHasId([reply], selectedCommentId));
    if (selectedReplyIndex >= 0) setReplyPage(Math.floor(selectedReplyIndex / commentReplyPageSize));
  }, [replies, selectedCommentId]);

  useEffect(() => {
    if (!highlighted) return;
    nodeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  return (
    <article
      ref={nodeRef}
      id={comment.id ? `comment-${comment.id}` : undefined}
      className={`comment ${highlighted ? "highlighted" : ""}`}
    >
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
      {replies.length ? (
        <div className="reply-window">
          {hasPreviousReplies ? (
            <button className="reply-window-button" type="button" onClick={() => setReplyPage((page) => Math.max(0, page - 1))}>
              Show previous replies
            </button>
          ) : null}
          <CommentThread
            comments={visibleReplies}
            itemId={itemId}
            profiles={profiles}
            selectedCommentId={selectedCommentId}
            onOpenProfile={onOpenProfile}
            onAddComment={onAddComment}
            depth={depth + 1}
          />
          {hasMoreReplies ? (
            <button className="reply-window-button" type="button" onClick={() => setReplyPage((page) => page + 1)}>
              Show more replies
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
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
  getProfileAllRecency
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
  getProfileAllRecency: (item: InquiryItem, handle: string) => number;
}) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("all");
  const [activeSocialList, setActiveSocialList] = useState<"following" | "followers" | null>(null);
  const byPublishedRecency = (nextItems: InquiryItem[]) =>
    [...nextItems].sort((a, b) => getProfileRecency(b, person.handle, "authored") - getProfileRecency(a, person.handle, "authored"));
  const byProfileRecency = (nextItems: InquiryItem[], kind: ProfileActivityKind) =>
    [...nextItems].sort((a, b) => getProfileRecency(b, person.handle, kind) - getProfileRecency(a, person.handle, kind));
  const byAllProfileRecency = (nextItems: InquiryItem[]) =>
    [...nextItems].sort((a, b) => getProfileAllRecency(b, person.handle) - getProfileAllRecency(a, person.handle));
  const isAuthor = (item: InquiryItem) => itemAuthoredByProfile(item, person);
  const canShowLikes = actorHandle === person.handle || inferredLikesPublic(person);
  const canShowReshares = actorHandle === person.handle || inferredResharesPublic(person);
  const canShowSaved = actorHandle === person.handle;
  const authored = byPublishedRecency(items.filter(isAuthor));
  const papers = authored.filter((item) => item.kind === "paper");
  const thoughts = authored.filter((item) => item.kind === "thought" || item.kind === "note");
  const commentActivities = collectProfileComments(items, person);
  const commentedItems = byProfileRecency(items.filter((item) => !isAuthor(item) && commentTreeHasAuthor(item.comments, person)), "comments");
  const reshares = canShowReshares
    ? byProfileRecency(items.filter((item) => !isAuthor(item) && hasHandle(item.forkedBy, person.handle)), "fork")
    : [];
  const likes = canShowLikes
    ? byProfileRecency(items.filter((item) => !isAuthor(item) && hasHandle(item.signaledBy, person.handle)), "signal")
    : [];
  const saved = canShowSaved ? byProfileRecency(items.filter((item) => !isAuthor(item) && isSavedBy(item, person.handle, profile.handle)), "save") : [];
  const allActivity = byAllProfileRecency(uniqueItemsById([...authored, ...commentedItems, ...reshares, ...likes, ...saved]));

  const tabItems: Record<ProfileTab, InquiryItem[]> = {
    all: allActivity,
    papers,
    thoughts,
    comments: commentedItems,
    reshares,
    likes,
    saved
  };

  const tabCounts: Record<ProfileTab, number> = {
    all: allActivity.length,
    papers: papers.length,
    thoughts: thoughts.length,
    comments: commentActivities.length,
    reshares: reshares.length,
    likes: likes.length,
    saved: saved.length
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
    if (!tabs.some((tab) => tab.id === activeTab)) setActiveTab("all");
  }, [activeTab, tabs]);

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
                onClick={() => setActiveTab(tab.id)}
              >
                <strong>{tabCounts[tab.id]}</strong>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="feed-stream profile-stream" aria-label={`${person.name} profile feed`}>
        {activeTab === "comments" ? (
          commentActivities.length ? (
            commentActivities.map((activity) => (
              <ProfileCommentCard
                key={activity.id}
                activity={activity}
                profiles={profiles}
                onSelect={onSelect}
                onOpenProfile={onOpenProfile}
              />
            ))
          ) : (
            <div className="empty-feed">
              <strong>No comments here yet.</strong>
              <span>This section will fill as the profile joins discussion threads.</span>
            </div>
          )
        ) : tabItems[activeTab].length ? (
          tabItems[activeTab].map((item) => (
            <FeedPost
              key={item.id}
              item={item}
              onSelect={onSelect}
              onOpenProfile={onOpenProfile}
              onAction={onAction}
              actorHandle={actorHandle}
              profiles={profiles}
            />
          ))
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
          Comment
        </span>
      </header>
      <p>{activity.comment.body}</p>
      <footer>
        <span>On</span>
        <strong>{activity.item.title}</strong>
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
