"use client";

import Image from "next/image";
import { SignInButton, SignUpButton, useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BrainCircuit,
  Eye,
  Home,
  Image as ImageIcon,
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
  countComments,
  hasHandle,
  isSavedBy,
  mutateItemForActor,
  normalizeSearchPhrase,
  relativeDateScore
} from "@/lib/symposiumCore";

type Theme = "day" | "night";
type ProfileTab = "all" | "papers" | "thoughts" | "comments" | "reshares" | "likes" | "saved";
type EntryMode = "loading" | "approach" | "auth" | "complete";
type OfficeMode = "desk" | "saved" | "notes";
type PatronageMode = "lobby" | "civic" | "private";

type ViewSnapshot = {
  activeRoom: RoomId;
  selectedItemId: string | null;
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
      comment.authorHandle === person.handle ||
      comment.author === person.name ||
      commentTreeHasAuthor(comment.replies ?? [], person)
  );

const uniqueItemsById = (items: InquiryItem[]) => [...new Map(items.map((item) => [item.id, item])).values()];

const inferredLikesPublic = (person: ResearchProfile) => person.likesPublic ?? person.handle.length % 5 !== 0;
const inferredResharesPublic = (person: ResearchProfile) => person.resharesPublic ?? person.handle.length % 4 !== 0;

const fallbackCommunityCount = 8;

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
  const [feedScope, setFeedScope] = useState<FeedScope>("suggested");
  const [roomChip, setRoomChip] = useState(roomChips[0]);
  const [officeMode, setOfficeMode] = useState<OfficeMode>("desk");
  const [patronageMode, setPatronageMode] = useState<PatronageMode>("lobby");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
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
  const getPublishedRecency = (item: InquiryItem) => relativeDateScore(item.date);
  const getActivityRecency = (item: InquiryItem) => activityRecency[item.id] ?? getPublishedRecency(item);
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
            return item.authorHandle === currentProfile.handle || item.author === currentProfile.name || item.room === "office";
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
        if (feedScope === "following") return item.authorHandle === currentProfile.handle || item.author === currentProfile.name || isSavedBy(item, currentProfile.handle, profile.handle);
        if (feedScope === "rooms") return matchesTopic(item, roomChip);
        return true;
      });

    return sortByPublishedRecency(roomFiltered);
  }, [activeRoom, currentProfile.handle, currentProfile.name, feedScope, items, officeMode, patronageMode, roomChip]);

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

    setItems(data.items);
    setProfiles(loadedProfiles);
    setCurrentProfile(nextProfile);
    persistLocalSnapshot(data.items, loadedProfiles, nextProfile);
    setSyncStatus("Live data connected");
  };

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
      setProfiles(fallbackProfiles);
      setItems(local?.items ?? inquiryItems);
      setCurrentProfile(fallbackProfile);
      setSyncStatus("Using seed data");
    });
  }, []);

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

  const snapshotView = (): ViewSnapshot => ({
    activeRoom,
    selectedItemId,
    selectedProfileName,
    officeMode,
    patronageMode,
    selectedCommunityId,
    scrollY: window.scrollY
  });

  const restoreView = (snapshot: ViewSnapshot) => {
    setActiveRoom(snapshot.activeRoom);
    setSelectedItemId(snapshot.selectedItemId);
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
      selectedProfileName: null,
      officeMode: "desk",
      patronageMode: "lobby",
      selectedCommunityId: null
    });
  };

  const openProfile = (profileKey: string) => {
    navigateView({ selectedProfileName: profileKey, selectedItemId: null });
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
    const nextItems = [data.item, ...items.filter((item) => item.id !== data.item.id)];
    touchActivity(data.item.id);
    setItems(nextItems);
    persistLocalSnapshot(nextItems, profiles);
    navigateView({
      activeRoom: data.item.room,
      selectedItemId: data.item.id,
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
        createdAt: "Just now",
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
      setSyncStatus(parentId ? "Reply saved locally" : "Comment saved locally");
      return;
    }

    touchActivity(itemId);
    await refreshData(currentProfile.handle);
    setSelectedItemId(itemId);
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
    setSelectedProfileName(null);
    setViewHistory([]);
    setViewFuture([]);
    window.sessionStorage.setItem("symposium-entry-complete", "true");
    window.localStorage.setItem("symposium-profile-handle", previewProfile.handle);
    persistLocalSnapshot(items, fallbackProfiles, previewProfile);
    setSyncStatus("Local preview");
  };

  const saveProfileSettings = async (draft: ProfileSettingsDraft) => {
    const cleanName = draft.name.trim() || currentProfile.name;
    const updatedProfile: ResearchProfile = {
      ...currentProfile,
      name: cleanName,
      avatarUrl: draft.avatarUrl?.trim() || undefined,
      bio: draft.bio.trim() || currentProfile.bio,
      likesPublic: draft.likesPublic,
      resharesPublic: draft.resharesPublic
    };
    const nextProfiles = { ...profiles, [updatedProfile.handle]: updatedProfile };
    const nextItems = items.map((item) =>
      item.authorHandle === updatedProfile.handle ? { ...item, author: updatedProfile.name } : item
    );

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
      const committedItems = nextItems.map((item) =>
        item.authorHandle === committedProfile.handle ? { ...item, author: committedProfile.name } : item
      );
      setCurrentProfile(committedProfile);
      setProfiles(committedProfiles);
      setItems(committedItems);
      persistLocalSnapshot(committedItems, committedProfiles, committedProfile);
      setSyncStatus("Profile settings saved");
    } else {
      setSyncStatus("Profile saved locally");
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
    if (action !== "read") touchActivity(itemId);
    const response = await fetch(`/api/posts/${itemId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, actorHandle: currentProfile.handle })
    });
    if (response.ok) {
      const data = (await response.json()) as { item: InquiryItem };
      const updatedItems = items.map((item) => (item.id === itemId ? data.item : item));
      setItems(updatedItems);
      persistLocalSnapshot(updatedItems, profiles);
      return;
    }

    const nextItems = items.map((item) =>
      item.id === itemId ? mutateItemForActor(item, action, currentProfile.handle, profile.handle) : item
    );
    setItems(nextItems);
    persistLocalSnapshot(nextItems, profiles);
  };

  const openPost = (id: string) => {
    navigateView({ selectedItemId: id, selectedProfileName: null });
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
            actorHandle={currentProfile.handle}
            getRecency={getActivityRecency}
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
  onBack,
  onSelect,
  onOpenProfile,
  onAction,
  onDummyCall
}: {
  community: ResearchCommunity;
  items: InquiryItem[];
  currentProfile: ResearchProfile;
  onBack: () => void;
  onSelect: (id: string) => void;
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
  [...items].sort((a, b) => relativeDateScore(b.date) - relativeDateScore(a.date));

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
  actorHandle
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
  onSelect: (id: string) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
  onOpenNotes: () => void;
  onOpenSaved: () => void;
  actorHandle: string;
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
  actorHandle
}: {
  item: InquiryItem;
  onSelect: (id: string) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
  actorHandle: string;
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
  onOpenProfile,
  onClickStop
}: {
  item: InquiryItem;
  onOpenProfile: (name: string) => void;
  onClickStop?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      className="post-author"
      type="button"
      onClick={(event) => {
        onClickStop?.(event);
        onOpenProfile(item.author);
      }}
    >
      <span className="avatar">{initial(item.author)}</span>
      <span>
        <strong>{item.author}</strong>
        <small>
          {item.affiliation} · {item.date}
        </small>
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
            <strong>{action.value}</strong>
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
  actorHandle
}: {
  item: InquiryItem;
  room: Room;
  onBack: () => void;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onAction: (itemId: string, action: PostAction) => void;
  actorHandle: string;
}) {
  const isPaper = item.kind === "paper";
  const doiSlug = item.id.replace(/[^a-z0-9]+/gi, ".").replace(/\.+/g, ".").replace(/\.$/, "");
  const codeSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44);

  return (
    <article className={`detail-layout ${isPaper ? "paper-detail" : "simple-detail"}`}>
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back to {room.feedLabel}
      </button>

      <section className="detail-main">
        <p className="eyebrow">{kindLabels[item.kind]}</p>
        <h1>{item.title}</h1>
        <button className="detail-byline-button" type="button" onClick={() => onOpenProfile(item.author)}>
          <span className="avatar">{initial(item.author)}</span>
          <span>
            <strong>{item.author}</strong>
            <small>
              {item.affiliation} · {item.date}
            </small>
          </span>
        </button>
        <p className="detail-body">{item.body}</p>
        <SocialActions item={item} commentCount={countComments(item.comments)} onAction={onAction} actorHandle={actorHandle} />

        <section className="comments-section">
          <h2>Discussion</h2>
          <CommentComposer itemId={item.id} onAddComment={onAddComment} />
          <CommentThread comments={item.comments} itemId={item.id} onOpenProfile={onOpenProfile} onAddComment={onAddComment} />
        </section>
      </section>

      {isPaper ? (
        <aside className="paper-side">
          <section>
            <h2>Paper</h2>
            <div>
              <span>Collaborators</span>
              <strong>{item.author}</strong>
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
  onOpenProfile,
  onAddComment,
  depth = 0
}: {
  comments: InquiryComment[];
  itemId: string;
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
  onOpenProfile,
  onAddComment,
  depth
}: {
  comment: InquiryComment;
  itemId: string;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  depth: number;
}) {
  const [replyOpen, setReplyOpen] = useState(false);

  return (
    <article className="comment">
      <button type="button" onClick={() => onOpenProfile(comment.author)}>
        <span className="avatar small">{initial(comment.author)}</span>
        <span>
          <strong>{comment.author}</strong>
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
      {comment.replies?.length ? (
        <CommentThread
          comments={comment.replies}
          itemId={itemId}
          onOpenProfile={onOpenProfile}
          onAddComment={onAddComment}
          depth={depth + 1}
        />
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
  onSelect,
  onOpenProfile,
  onAction,
  onOpenSettings,
  actorHandle,
  getRecency
}: {
  person: ResearchProfile;
  items: InquiryItem[];
  isOwnProfile: boolean;
  onSelect: (id: string) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
  onOpenSettings: () => void;
  actorHandle: string;
  getRecency: (item: InquiryItem) => number;
}) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("all");
  const byRecency = (nextItems: InquiryItem[]) => [...nextItems].sort((a, b) => getRecency(b) - getRecency(a));
  const isAuthor = (item: InquiryItem) => item.authorHandle === person.handle || item.author === person.name;
  const canShowLikes = actorHandle === person.handle || inferredLikesPublic(person);
  const canShowReshares = actorHandle === person.handle || inferredResharesPublic(person);
  const canShowSaved = actorHandle === person.handle;
  const authored = byRecency(items.filter(isAuthor));
  const papers = authored.filter((item) => item.kind === "paper");
  const thoughts = authored.filter((item) => item.kind === "thought" || item.kind === "note");
  const comments = byRecency(items.filter((item) => !isAuthor(item) && commentTreeHasAuthor(item.comments, person)));
  const reshares = canShowReshares
    ? byRecency(items.filter((item) => !isAuthor(item) && hasHandle(item.forkedBy, person.handle)))
    : [];
  const likes = canShowLikes
    ? byRecency(items.filter((item) => !isAuthor(item) && hasHandle(item.signaledBy, person.handle)))
    : [];
  const saved = canShowSaved ? byRecency(items.filter((item) => !isAuthor(item) && isSavedBy(item, person.handle, profile.handle))) : [];
  const allActivity = byRecency(uniqueItemsById([...authored, ...comments, ...reshares, ...likes, ...saved]));

  const tabItems: Record<ProfileTab, InquiryItem[]> = {
    all: allActivity,
    papers,
    thoughts,
    comments,
    reshares,
    likes,
    saved
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
          ) : null}
          <h1>{person.name}</h1>
          <p>{person.handle}</p>
          <p>
            {person.role} · {person.location}
          </p>
          <p>{person.bio}</p>
          <div className="profile-fields">
            {person.fields.map((field) => (
              <span key={field}>{field}</span>
            ))}
          </div>
          <div className="profile-metrics" aria-label={`${person.name} activity totals`}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                <strong>{tabItems[tab.id].length}</strong>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="feed-stream profile-stream" aria-label={`${person.name} profile feed`}>
        {tabItems[activeTab].length ? (
          tabItems[activeTab].map((item) => (
            <FeedPost
              key={item.id}
              item={item}
              onSelect={onSelect}
              onOpenProfile={onOpenProfile}
              onAction={onAction}
              actorHandle={actorHandle}
            />
          ))
        ) : (
          <div className="empty-feed">
            <strong>No items here yet.</strong>
            <span>This section will fill as the profile has more activity.</span>
          </div>
        )}
      </section>
    </article>
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
  onSignOut
}: {
  currentProfile: ResearchProfile;
  onClose: () => void;
  onSave: (draft: ProfileSettingsDraft) => void;
  onSignOut: () => void;
}) {
  const [avatarUrl, setAvatarUrl] = useState(currentProfile.avatarUrl ?? "");
  const [name, setName] = useState(currentProfile.name);
  const [bio, setBio] = useState(currentProfile.bio);
  const [likesPublic, setLikesPublic] = useState(inferredLikesPublic(currentProfile));
  const [resharesPublic, setResharesPublic] = useState(inferredResharesPublic(currentProfile));

  useEffect(() => {
    setAvatarUrl(currentProfile.avatarUrl ?? "");
    setName(currentProfile.name);
    setBio(currentProfile.bio);
    setLikesPublic(inferredLikesPublic(currentProfile));
    setResharesPublic(inferredResharesPublic(currentProfile));
  }, [currentProfile]);

  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ avatarUrl, name, bio, likesPublic, resharesPublic });
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
          <span className="avatar large profile-avatar">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : initial(name || currentProfile.name)}
          </span>
          <div>
            <strong>{name || currentProfile.name}</strong>
            <small>{currentProfile.handle}</small>
          </div>
        </section>

        <label>
          Profile photo URL
          <span>
            <ImageIcon size={15} />
            <input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://..." />
          </span>
        </label>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Bio
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} />
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
