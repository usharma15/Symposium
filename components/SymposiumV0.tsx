"use client";

import Image from "next/image";
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
  roomChips,
  rooms,
  type FeedScope,
  type InquiryComment,
  type InquiryItem,
  type ResearchProfile,
  type Room,
  type RoomId
} from "@/lib/mockData";
import type { CreateProfileInput, PostAction } from "@/lib/dataStore";

type Theme = "day" | "night";
type ProfileTab = "all" | "papers" | "thoughts" | "comments" | "reshares" | "likes" | "saved";
type EntryMode = "loading" | "approach" | "auth" | "complete";
type OfficeMode = "desk" | "saved" | "notes";

type ViewSnapshot = {
  activeRoom: RoomId;
  selectedItemId: string | null;
  selectedProfileName: string | null;
  officeMode: OfficeMode;
  scrollY: number;
};

type AuthRecord = {
  handle: string;
  identifier: string;
  password: string;
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

const kindLabels: Record<InquiryItem["kind"], string> = {
  paper: "Paper",
  thought: "Thought",
  draft: "Draft",
  note: "Note",
  code: "Code"
};

const roomRenders: Record<RoomId, string> = {
  hall: "/symposium-renders/main-hall-2.png",
  office: "/symposium-renders/office.png",
  symposium: "/symposium-renders/symposium.png",
  library: "/symposium-renders/library-1.png",
  amphitheater: "/symposium-renders/amphitheatre-2.png"
};

const getRoom = (roomId: RoomId) => rooms.find((room) => room.id === roomId) ?? rooms[0];

const countComments = (comments: InquiryComment[]): number =>
  comments.reduce((total, comment) => total + 1 + countComments(comment.replies ?? []), 0);

const topicTerms: Record<string, string[]> = {
  "Frontier Physics": ["physics", "hidden", "oscillator", "law", "apparatus"],
  "AI Metascience": ["ai", "agent", "agents", "metascience", "benchmark", "simulation"],
  "Rogue Youth Labs": ["youth lab", "youth labs", "pilot", "proof-of-work"],
  "History Of Discovery": ["history", "discovery", "accident", "anomaly", "prepared"],
  "Tools And Instruments": ["tool", "tools", "code", "instrument", "runner", "notebook"]
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

const normalizeSearchPhrase = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

const matchesTopic = (item: InquiryItem, chip: string) => {
  const terms = topicTerms[chip] ?? [];
  const text = searchableText(item);
  return terms.some((term) => text.includes(term));
};

const metricScore = (value: string) => {
  const normalized = value.toLowerCase().replace(/,/g, "");
  const multiplier = normalized.endsWith("k") ? 1000 : 1;
  return Number.parseFloat(normalized) * multiplier || 0;
};

const formatMetric = (value: number) => {
  if (value >= 1000) return `${Number(value / 1000).toFixed(value >= 10000 ? 1 : 0)}k`;
  return String(Math.max(0, value));
};

const incrementMetric = (value: string, amount: number) => formatMetric(metricScore(value) + amount);

const cleanHandle = (handle: string) => {
  const trimmed = handle.trim().toLowerCase();
  const withAt = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  return withAt.replace(/[^@a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^@_/, "@").replace(/_$/, "");
};

const handleFromName = (name: string) =>
  cleanHandle(name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));

const clientId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const hasHandle = (handles: string[] | undefined, handle: string) => (handles ?? []).includes(handle);

const isSavedBy = (item: InquiryItem, handle: string) =>
  hasHandle(item.savedBy, handle) || (Boolean(item.saved) && handle === profile.handle);

const relativeDateScore = (label: string) => {
  const normalized = label.trim().toLowerCase();
  const now = Date.now();
  if (!normalized || normalized === "just now" || normalized === "live now") return now - 10 * 60 * 1000;
  if (normalized === "today") return now - 60 * 60 * 1000;

  const minutes = normalized.match(/^(\d+)m ago$/);
  if (minutes) return now - Number(minutes[1]) * 60 * 1000;

  const hours = normalized.match(/^(\d+)h ago$/);
  if (hours) return now - Number(hours[1]) * 60 * 60 * 1000;

  if (normalized === "yesterday") return now - 24 * 60 * 60 * 1000;

  const parsed = Date.parse(`${label} ${new Date().getFullYear()}`);
  return Number.isNaN(parsed) ? 0 : parsed;
};

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

const toggleHandle = (handles: string[] | undefined, handle: string) => {
  const current = new Set(handles ?? []);
  if (current.has(handle)) {
    current.delete(handle);
    return { handles: [...current], delta: -1 };
  }
  current.add(handle);
  return { handles: [...current], delta: 1 };
};

const mutateItemForActor = (item: InquiryItem, action: PostAction, actorHandle: string): InquiryItem => {
  if (action === "save") {
    const next = toggleHandle(item.savedBy ?? (item.saved ? [profile.handle] : []), actorHandle);
    return {
      ...item,
      savedBy: next.handles,
      saved: next.handles.length > 0,
      metrics: { ...item.metrics, saves: incrementMetric(item.metrics.saves, next.delta) }
    };
  }

  if (action === "signal") {
    const next = toggleHandle(item.signaledBy, actorHandle);
    return {
      ...item,
      signaledBy: next.handles,
      metrics: { ...item.metrics, signal: incrementMetric(item.metrics.signal, next.delta) }
    };
  }

  if (action === "fork") {
    const next = toggleHandle(item.forkedBy, actorHandle);
    return {
      ...item,
      forkedBy: next.handles,
      metrics: { ...item.metrics, forks: incrementMetric(item.metrics.forks, next.delta) }
    };
  }

  return {
    ...item,
    metrics: { ...item.metrics, reads: incrementMetric(item.metrics.reads, 1) }
  };
};

const initial = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function SymposiumV0() {
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
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [tabletOpen, setTabletOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(null);
  const [viewHistory, setViewHistory] = useState<ViewSnapshot[]>([]);
  const [viewFuture, setViewFuture] = useState<ViewSnapshot[]>([]);
  const [activityRecency, setActivityRecency] = useState<Record<string, number>>({});
  const [syncStatus, setSyncStatus] = useState("Loading live data");
  const [authError, setAuthError] = useState("");
  const [noteText, setNoteText] = useState(
    "First note: make the thing feel alive without pretending the whole world is built yet."
  );

  const activeRoomData = getRoom(activeRoom);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const profileList = useMemo(() => Object.values(profiles), [profiles]);
  const findProfile = (nameOrHandle: string) =>
    profileList.find((person) => person.name === nameOrHandle || person.handle === nameOrHandle) ??
    getProfileForName(nameOrHandle);
  const selectedProfile = selectedProfileName ? findProfile(selectedProfileName) : null;
  const getPublishedRecency = (item: InquiryItem) => relativeDateScore(item.date);
  const getActivityRecency = (item: InquiryItem) => activityRecency[item.id] ?? getPublishedRecency(item);
  const sortByPublishedRecency = (nextItems: InquiryItem[]) =>
    [...nextItems].sort((a, b) => getPublishedRecency(b) - getPublishedRecency(a));

  const visibleItems = useMemo(() => {
    const roomFiltered = items
      .filter((item) => {
        if (activeRoom === "hall") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "office") {
          if (officeMode === "saved") return isSavedBy(item, currentProfile.handle);
          if (officeMode === "notes") {
            return item.authorHandle === currentProfile.handle || item.author === currentProfile.name || item.room === "office";
          }
          return false;
        }
        if (activeRoom === "symposium") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "library") return item.kind === "paper";
        if (activeRoom === "amphitheater") return item.kind === "thought" || item.kind === "note";
        return true;
      })
      .filter((item) => {
        if (feedScope === "following") return item.authorHandle === currentProfile.handle || item.author === currentProfile.name || isSavedBy(item, currentProfile.handle);
        if (feedScope === "rooms") return matchesTopic(item, roomChip);
        return true;
      });

    return sortByPublishedRecency(roomFiltered);
  }, [activeRoom, currentProfile.handle, currentProfile.name, feedScope, items, officeMode, roomChip]);

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

  const mergeSnapshot = (remote: LocalSnapshot, local: LocalSnapshot | null): LocalSnapshot => {
    if (!local) return remote;
    const itemMap = new Map(remote.items.map((item) => [item.id, item]));
    local.items.forEach((item) => itemMap.set(item.id, item));
    return {
      profiles: { ...remote.profiles, ...local.profiles },
      items: [...itemMap.values()]
    };
  };

  const refreshData = async (preferredHandle = currentProfile.handle) => {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load Symposium data.");
    const data = (await response.json()) as {
      items: InquiryItem[];
      profiles: Record<string, ResearchProfile>;
      defaultProfile: ResearchProfile;
    };
    const merged = mergeSnapshot({ items: data.items, profiles: data.profiles }, readLocalSnapshot());
    const loadedProfiles = Object.keys(merged.profiles).length
      ? merged.profiles
      : { [data.defaultProfile.handle]: data.defaultProfile };
    const nextProfile = loadedProfiles[preferredHandle] ?? loadedProfiles[data.defaultProfile.handle] ?? data.defaultProfile;

    setItems(merged.items);
    setProfiles(loadedProfiles);
    setCurrentProfile(nextProfile);
    persistLocalSnapshot(merged.items, loadedProfiles, nextProfile);
    setSyncStatus("Live data connected");
  };

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("symposium-theme") as Theme | null;
    const storedNote = window.localStorage.getItem("symposium-notebook");
    const storedProfileHandle = window.localStorage.getItem("symposium-profile-handle");
    const signedHandle = window.localStorage.getItem("symposium-auth-handle");
    const hasEntered = window.sessionStorage.getItem("symposium-entry-complete") === "true";

    if (storedTheme === "day" || storedTheme === "night") setTheme(storedTheme);
    if (storedNote) setNoteText(storedNote);
    try {
      setActivityRecency(JSON.parse(window.localStorage.getItem("symposium-activity-recency") ?? "{}") as Record<string, number>);
    } catch {
      setActivityRecency({});
    }
    setSignedIn(Boolean(signedHandle));
    setEntryMode(hasEntered && signedHandle ? "complete" : "approach");

    refreshData(signedHandle ?? storedProfileHandle ?? undefined).catch(() => {
      const local = readLocalSnapshot();
      const fallbackProfiles = local?.profiles ?? { [profile.handle]: profile };
      const fallbackProfile = fallbackProfiles[signedHandle ?? storedProfileHandle ?? profile.handle] ?? profile;
      setProfiles(fallbackProfiles);
      setItems(local?.items ?? inquiryItems);
      setCurrentProfile(fallbackProfile);
      setSyncStatus("Using seed data");
    });
  }, []);

  useEffect(() => {
    if (entryMode !== "approach") return undefined;

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
  }, [entryMode, signedIn]);

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
    scrollY: window.scrollY
  });

  const restoreView = (snapshot: ViewSnapshot) => {
    setActiveRoom(snapshot.activeRoom);
    setSelectedItemId(snapshot.selectedItemId);
    setSelectedProfileName(snapshot.selectedProfileName);
    setOfficeMode(snapshot.officeMode);
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
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
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
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
      officeMode: roomId === "office" ? mode : "desk"
    });
  };

  const toggleOfficeMode = (mode: Exclude<OfficeMode, "desk">) => {
    enterRoom("office", activeRoom === "office" && officeMode === mode ? "desk" : mode);
  };

  const openProfile = (name: string) => {
    navigateView({ selectedProfileName: name, selectedItemId: null });
  };

  const openNotebook = () => {
    setTabletOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setNotebookOpen(true);
  };

  const openTablet = () => {
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setTabletOpen(true);
  };

  const openSearch = () => {
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
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

  const authRecords = (): AuthRecord[] => {
    try {
      return JSON.parse(window.localStorage.getItem("symposium-auth-records") ?? "[]") as AuthRecord[];
    } catch {
      return [];
    }
  };

  const persistAuthRecords = (records: AuthRecord[]) => {
    window.localStorage.setItem("symposium-auth-records", JSON.stringify(records));
  };

  const completeSignIn = (person: ResearchProfile) => {
    const nextProfiles = { ...profiles, [person.handle]: person };
    setProfiles(nextProfiles);
    setCurrentProfile(person);
    setSignedIn(true);
    setSettingsOpen(false);
    setEntryMode("complete");
    setActiveRoom("hall");
    setOfficeMode("desk");
    setSelectedItemId(null);
    setSelectedProfileName(null);
    setViewHistory([]);
    setViewFuture([]);
    window.sessionStorage.setItem("symposium-entry-complete", "true");
    window.localStorage.setItem("symposium-auth-handle", person.handle);
    window.localStorage.setItem("symposium-profile-handle", person.handle);
    persistLocalSnapshot(items, nextProfiles, person);
  };

  const saveProfile = async (input: CreateProfileInput) => {
    setSyncStatus("Saving profile");
    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const fallbackProfile: ResearchProfile = {
      name: input.name.trim(),
      handle: cleanHandle(input.handle),
      email: input.email?.trim().toLowerCase() || undefined,
      role: input.role.trim() || "Symposium participant",
      location: input.location.trim() || "Public rooms",
      bio: input.bio.trim() || "A participant in the current inquiry thread.",
      fields: input.fields.map((field) => field.trim()).filter(Boolean)
    };
    const data = response.ok ? ((await response.json()) as { profile: ResearchProfile }) : { profile: fallbackProfile };
    const nextProfiles = { ...profiles, [data.profile.handle]: data.profile };
    setProfiles(nextProfiles);
    setCurrentProfile(data.profile);
    persistLocalSnapshot(items, nextProfiles, data.profile);
    setSyncStatus("Profile saved");
    return data.profile;
  };

  const saveProfileSettings = (draft: ProfileSettingsDraft) => {
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
      setSelectedProfileName(updatedProfile.name);
    }
    persistLocalSnapshot(nextItems, nextProfiles, updatedProfile);
    setSettingsOpen(false);
    setSyncStatus("Profile settings saved");
  };

  const switchProfile = (person: ResearchProfile) => {
    setCurrentProfile(person);
    window.localStorage.setItem("symposium-profile-handle", person.handle);
    window.localStorage.setItem("symposium-auth-handle", person.handle);
    persistLocalSnapshot(items, profiles, person);
    setSyncStatus(`Posting as ${person.name}`);
  };

  const createAccount = async (input: CreateProfileInput, password: string) => {
    const person = await saveProfile(input);
    if (!person) return false;
    const identifier = person.email ?? person.handle;
    const records = authRecords().filter((record) => record.handle !== person.handle);
    persistAuthRecords([...records, { handle: person.handle, identifier: identifier.toLowerCase(), password }]);
    completeSignIn(person);
    setAuthError("");
    return true;
  };

  const signIn = (identifier: string, password: string) => {
    const lowered = identifier.trim().toLowerCase();
    const record = authRecords().find(
      (entry) =>
        (entry.identifier === lowered || entry.handle.toLowerCase() === lowered || entry.handle.toLowerCase() === cleanHandle(lowered)) &&
        entry.password === password
    );
    if (!record) {
      setAuthError("No matching account in this browser yet.");
      return false;
    }
    const person = profiles[record.handle] ?? readLocalSnapshot()?.profiles[record.handle];
    if (!person) {
      setAuthError("That account exists locally, but its profile is missing.");
      return false;
    }
    completeSignIn(person);
    setAuthError("");
    return true;
  };

  const signOut = () => {
    window.localStorage.removeItem("symposium-auth-handle");
    window.sessionStorage.removeItem("symposium-entry-complete");
    setSignedIn(false);
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
      item.id === itemId ? mutateItemForActor(item, action, currentProfile.handle) : item
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
        mode={entryMode}
        authError={authError}
        onCreateAccount={createAccount}
        onSignIn={signIn}
      />
    );
  }

  return (
    <main
      className={`symposium-shell ${theme}`}
      data-room={activeRoom}
      data-view={selectedProfile ? "profile" : selectedItem ? "detail" : activeRoom === "hall" ? "hall" : "room"}
      style={{ "--room-bg": `url(${roomRenders[activeRoom]})` } as CSSProperties}
    >
      <div className="ambient-layer" aria-hidden="true" />

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
            className="profile-button"
            type="button"
            title="Open your profile"
            onClick={() => openProfile(currentProfile.name)}
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
            onOpenSettings={() => setSettingsOpen(true)}
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
        ) : (
          <RoomView
            room={activeRoomData}
            items={visibleItems}
            officeMode={activeRoom === "office" ? officeMode : undefined}
            feedScope={feedScope}
            roomChip={roomChip}
            onFeedScope={setFeedScope}
            onRoomChip={setRoomChip}
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
  mode,
  authError,
  onCreateAccount,
  onSignIn
}: {
  theme: Theme;
  mode: EntryMode;
  authError: string;
  onCreateAccount: (input: CreateProfileInput, password: string) => Promise<boolean>;
  onSignIn: (identifier: string, password: string) => boolean;
}) {
  return (
    <main className={`entry-sequence ${theme}`} aria-label="Approaching Symposium">
      <Image
        src="/symposium-renders/entrance.png"
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
        <EntryAuthPanel authError={authError} onCreateAccount={onCreateAccount} onSignIn={onSignIn} />
      ) : null}
    </main>
  );
}

function EntryAuthPanel({
  authError,
  onCreateAccount,
  onSignIn
}: {
  authError: string;
  onCreateAccount: (input: CreateProfileInput, password: string) => Promise<boolean>;
  onSignIn: (identifier: string, password: string) => boolean;
}) {
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpIssued, setOtpIssued] = useState("");
  const [localError, setLocalError] = useState("");

  const issueOtp = () => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setOtpIssued(code);
    setLocalError("");
  };

  const submitSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      setLocalError("Enter your email or username and password.");
      return;
    }
    onSignIn(identifier, password);
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !username.trim() || !newPassword) {
      setLocalError("Name, email, username, and password are required.");
      return;
    }
    if (!otpIssued) {
      issueOtp();
      setLocalError("Enter the OTP shown here to finish account creation.");
      return;
    }
    if (otp.trim() !== otpIssued) {
      setLocalError("That OTP does not match.");
      return;
    }

    await onCreateAccount(
      {
        name,
        handle: cleanHandle(username),
        email,
        role: "Symposium participant",
        location: "Public rooms",
        bio: "A participant in the current inquiry thread.",
        fields: ["Inquiry"]
      },
      newPassword
    );
  };

  const continueWithGoogle = async () => {
    const googleEmail = email.trim() || "google.user@symposium.local";
    const googleName = name.trim() || googleEmail.split("@")[0].replace(/[._-]+/g, " ");
    await onCreateAccount(
      {
        name: googleName.replace(/\b\w/g, (letter) => letter.toUpperCase()),
        handle: handleFromName(googleName),
        email: googleEmail,
        role: "Symposium participant",
        location: "Public rooms",
        bio: "A participant in the current inquiry thread.",
        fields: ["Inquiry"]
      },
      "google"
    );
  };

  return (
    <section className="entry-auth" aria-label="Symposium sign in">
      <div className="auth-tabs">
        <button type="button" className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>
          Sign in
        </button>
        <button type="button" className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>
          Create account
        </button>
      </div>

      {mode === "signin" ? (
        <form className="entry-auth-form" onSubmit={submitSignIn}>
          <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Email or username" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
          <button type="submit">Enter</button>
        </form>
      ) : (
        <form className="entry-auth-form" onSubmit={submitCreate}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" />
          <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Password" type="password" />
          {otpIssued ? (
            <>
              <p className="otp-line">OTP: {otpIssued}</p>
              <input value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="Enter OTP" />
            </>
          ) : null}
          <button type="submit">{otpIssued ? "Create account" : "Send OTP"}</button>
          <button type="button" onClick={continueWithGoogle}>
            Continue with Google
          </button>
        </form>
      )}

      {localError || authError ? <p className="auth-error">{localError || authError}</p> : null}
    </section>
  );
}

function HallView({ onEnter }: { onEnter: (roomId: RoomId) => void }) {
  const doorIds: Array<Exclude<RoomId, "hall">> = [
    "office",
    "amphitheater",
    "library",
    "symposium"
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

function RoomView({
  room,
  items,
  officeMode,
  feedScope,
  roomChip,
  onFeedScope,
  onRoomChip,
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
  feedScope: FeedScope;
  roomChip: string;
  onFeedScope: (scope: FeedScope) => void;
  onRoomChip: (chip: string) => void;
  onSelect: (id: string) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
  onOpenNotes: () => void;
  onOpenSaved: () => void;
  actorHandle: string;
}) {
  return (
    <div className="room-layout">
      <RoomRender room={room} onOpenNotebook={onOpenNotes} onOpenSaved={onOpenSaved} />

      <section className="feed-toolbar" aria-label="Feed controls">
        <div className="room-mini-title">
          <p className="eyebrow">{room.eyebrow}</p>
          <h1>{officeMode === "saved" ? "Saved for later" : officeMode === "notes" ? "Notes" : room.name}</h1>
          <p>
            {officeMode === "saved"
              ? "Work you marked for return."
              : officeMode === "notes"
                ? "Your desk notes and authored fragments."
                : room.description}
          </p>
        </div>

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
  onOpenSaved
}: {
  room: Room;
  onOpenNotebook: () => void;
  onOpenSaved?: () => void;
}) {
  const isOffice = room.id === "office";

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
  const savedByActor = isSavedBy(item, actorHandle);
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
            <Icon size={16} />
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
  const saved = canShowSaved ? byRecency(items.filter((item) => !isAuthor(item) && isSavedBy(item, person.handle))) : [];
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
              <span>Settings</span>
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
