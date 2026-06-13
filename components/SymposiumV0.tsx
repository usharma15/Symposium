"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Bookmark,
  BrainCircuit,
  ChevronRight,
  Eye,
  GitFork,
  MessageCircle,
  Moon,
  NotebookPen,
  Search,
  Send,
  Sparkles,
  Sun,
  UserRound,
  X
} from "lucide-react";
import {
  feedScopes,
  getProfileForName,
  inquiryItems,
  libraryFolders,
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
type ProfileTab = "all" | "papers" | "thoughts" | "reshares" | "signals";
type EntryMode = "loading" | "approach" | "auth" | "complete";

type AuthRecord = {
  handle: string;
  identifier: string;
  password: string;
};

type LocalSnapshot = {
  profiles: Record<string, ResearchProfile>;
  items: InquiryItem[];
};

const kindLabels: Record<InquiryItem["kind"], string> = {
  paper: "Paper",
  thought: "Thought",
  draft: "Draft",
  note: "Note",
  code: "Code"
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
    ...item.forks
  ]
    .join(" ")
    .toLowerCase();

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
  const [query, setQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [tabletOpen, setTabletOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(null);
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

  const visibleItems = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    const roomFiltered = items
      .filter((item) => {
        if (activeRoom === "hall") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "office") return isSavedBy(item, currentProfile.handle) || item.room === "office";
        if (activeRoom === "symposium") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "library") return item.kind === "paper";
        if (activeRoom === "amphitheater") return item.kind === "thought" || item.kind === "note";
        return true;
      })
      .filter((item) => {
        if (feedScope === "following") return item.authorHandle === currentProfile.handle || item.author === currentProfile.name || isSavedBy(item, currentProfile.handle);
        if (feedScope === "rooms") return matchesTopic(item, roomChip);
        return true;
      })
      .filter((item) => {
        if (!lowered) return true;
        return searchableText(item).includes(lowered);
      });

    if (feedScope === "suggested") {
      return [...roomFiltered].sort((a, b) => metricScore(b.metrics.signal) - metricScore(a.metrics.signal));
    }

    return roomFiltered;
  }, [activeRoom, currentProfile.handle, currentProfile.name, feedScope, items, query, roomChip]);

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

  const enterRoom = (roomId: RoomId) => {
    setActiveRoom(roomId);
    setSelectedItemId(null);
    setQuery("");
    setSelectedProfileName(null);
    setAccountOpen(false);
  };

  const openProfile = (name: string) => {
    setTabletOpen(false);
    setNotebookOpen(false);
    setAccountOpen(false);
    setSelectedProfileName(name);
  };

  const openNotebook = () => {
    setTabletOpen(false);
    setAccountOpen(false);
    setSelectedProfileName(null);
    setNotebookOpen(true);
  };

  const openTablet = () => {
    setNotebookOpen(false);
    setAccountOpen(false);
    setSelectedProfileName(null);
    setTabletOpen(true);
  };

  const openAccount = () => {
    setTabletOpen(false);
    setNotebookOpen(false);
    setSelectedProfileName(null);
    setAccountOpen(true);
  };

  const createPost = async ({
    title,
    body,
    kind
  }: {
    title: string;
    body: string;
    kind: InquiryItem["kind"];
  }) => {
    if (activeRoom === "hall") return;
    setSyncStatus("Posting");
    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, kind, room: activeRoom, authorHandle: currentProfile.handle })
    });
    const fallbackItem: InquiryItem = {
      id: clientId("post"),
      kind,
      room: activeRoom,
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
      saved: activeRoom === "office",
      savedBy: activeRoom === "office" ? [currentProfile.handle] : [],
      signaledBy: [],
      forkedBy: []
    };
    const data = response.ok ? ((await response.json()) as { item: InquiryItem }) : { item: fallbackItem };
    const nextItems = [data.item, ...items.filter((item) => item.id !== data.item.id)];
    setItems(nextItems);
    persistLocalSnapshot(nextItems, profiles);
    setSelectedItemId(data.item.id);
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
      setItems(nextItems);
      persistLocalSnapshot(nextItems, profiles);
      setSelectedItemId(itemId);
      setSyncStatus(parentId ? "Reply saved locally" : "Comment saved locally");
      return;
    }

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
    setAccountOpen(false);
    setEntryMode("complete");
    setActiveRoom("hall");
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
    setAccountOpen(false);
    setAuthError("");
    setEntryMode("auth");
  };

  const applyAction = async (itemId: string, action: PostAction) => {
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
    setSelectedItemId(id);
    void applyAction(id, "read");
  };

  const currentContext = selectedItem
    ? `${selectedItem.title}: ${selectedItem.gatheringReason}`
    : `${activeRoomData.name}: ${activeRoomData.description}`;

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
    <main className={`symposium-shell ${theme}`} data-room={activeRoom}>
      <div className="ambient-layer" aria-hidden="true" />

      <header className="topbar">
        <button className="brand" type="button" onClick={() => enterRoom("hall")}>
          <span className="brand-glyph">S</span>
          <span>
            <strong>SYMPOSIUM</strong>
            <small>{activeRoomData.location}</small>
          </span>
        </button>

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
            title="Open notebook"
            onClick={openNotebook}
          >
            <NotebookPen size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Open AI tablet"
            onClick={openTablet}
          >
            <BrainCircuit size={18} />
          </button>
          <button
            className="profile-button"
            type="button"
            title="Account"
            onClick={openAccount}
          >
            <UserRound size={18} />
            <span>{currentProfile.name}</span>
          </button>
        </nav>
      </header>

      <div className="sync-status" aria-live="polite">
        {syncStatus}
      </div>

      {activeRoom !== "hall" && !selectedProfile ? (
        <aside className="world-rail" aria-label="Rooms">
          {rooms.map((room) => {
            const Icon = room.icon;
            return (
              <button
                key={room.id}
                className={`rail-button ${activeRoom === room.id ? "active" : ""}`}
                type="button"
                onClick={() => enterRoom(room.id)}
                title={room.name}
              >
                <Icon size={18} />
                <span>{room.shortName}</span>
              </button>
            );
          })}
        </aside>
      ) : null}

      <section className="stage">
        {selectedProfile ? (
          <ProfileView
            person={selectedProfile}
            items={items}
            onBack={() => setSelectedProfileName(null)}
            onSelect={(id) => {
              setSelectedProfileName(null);
              openPost(id);
            }}
            onOpenProfile={openProfile}
            onAction={applyAction}
            actorHandle={currentProfile.handle}
          />
        ) : activeRoom === "hall" ? (
          <HallView onEnter={enterRoom} />
        ) : selectedItem ? (
          <DetailView
            item={selectedItem}
            room={activeRoomData}
            onBack={() => setSelectedItemId(null)}
            onOpenTablet={openTablet}
            onOpenNotebook={openNotebook}
            onOpenProfile={openProfile}
            onAddComment={addComment}
            onAction={applyAction}
            actorHandle={currentProfile.handle}
          />
        ) : (
          <RoomView
            room={activeRoomData}
            items={visibleItems}
            feedScope={feedScope}
            roomChip={roomChip}
            query={query}
            onFeedScope={setFeedScope}
            onRoomChip={setRoomChip}
            onQuery={setQuery}
            onSelect={openPost}
            onOpenProfile={openProfile}
            onCreatePost={createPost}
            onAction={applyAction}
            actorHandle={currentProfile.handle}
          />
        )}
      </section>

      <button
        className="pocket pocket-left"
        type="button"
        title="Notebook"
        onClick={openNotebook}
      >
        <NotebookPen size={18} />
        <span>Notebook</span>
      </button>

      <button
        className="pocket pocket-right"
        type="button"
        title="AI tablet"
        onClick={openTablet}
      >
        <BrainCircuit size={18} />
        <span>AI Tablet</span>
      </button>

      {activeRoom !== "hall" && !selectedProfile ? <MovementPad room={activeRoomData} /> : null}

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

      {accountOpen ? (
        <AccountPanel
          currentProfile={currentProfile}
          onClose={() => setAccountOpen(false)}
          onSave={saveProfile}
          onViewProfile={(name) => openProfile(name)}
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
        src="/symposium-arrival.jpg"
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
        <div className="hall-vault" aria-hidden="true" />
        <div className="hall-floor" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="library-stair" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        {doorIds.map((roomId) => {
          const room = getRoom(roomId);
          const Icon = room.icon;
          return (
            <button
              key={room.id}
              className={`hall-door hall-door-${room.id}`}
              type="button"
              onClick={() => onEnter(room.id)}
            >
              <span className="door-icon">
                <Icon size={20} />
              </span>
              <span>
                <small>{room.location}</small>
                <strong>{room.name}</strong>
                <em>{room.feedLabel}</em>
              </span>
              <ChevronRight size={17} />
            </button>
          );
        })}
      </section>
    </div>
  );
}

function RoomView({
  room,
  items,
  feedScope,
  roomChip,
  query,
  onFeedScope,
  onRoomChip,
  onQuery,
  onSelect,
  onOpenProfile,
  onCreatePost,
  onAction,
  actorHandle
}: {
  room: Room;
  items: InquiryItem[];
  feedScope: FeedScope;
  roomChip: string;
  query: string;
  onFeedScope: (scope: FeedScope) => void;
  onRoomChip: (chip: string) => void;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onOpenProfile: (name: string) => void;
  onCreatePost: (draft: { title: string; body: string; kind: InquiryItem["kind"] }) => void;
  onAction: (itemId: string, action: PostAction) => void;
  actorHandle: string;
}) {
  const RoomIcon = room.icon;

  return (
    <div className="room-layout">
      <section className="room-header">
        <div>
          <p className="eyebrow">{room.eyebrow}</p>
          <h1>{room.title}</h1>
          <p>{room.description}</p>
        </div>
        <div className="room-seal">
          <RoomIcon size={28} />
          <span>{room.feedLabel}</span>
        </div>
      </section>

      <section className="feed-toolbar" aria-label="Feed controls">
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

        <label className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search claims, papers, rooms"
          />
        </label>
      </section>

      {feedScope === "rooms" ? (
        <section className="chip-row" aria-label="Rooms">
          {roomChips.map((chip) => (
            <button
              key={chip}
              type="button"
              className={roomChip === chip ? "active" : ""}
              onClick={() => onRoomChip(chip)}
            >
              {chip}
            </button>
          ))}
        </section>
      ) : null}

      {room.id === "office" ? <OfficeFolders /> : null}

      <PostComposer room={room} onCreatePost={onCreatePost} />

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

function PostComposer({
  room,
  onCreatePost
}: {
  room: Room;
  onCreatePost: (draft: { title: string; body: string; kind: InquiryItem["kind"] }) => void;
}) {
  const defaultKind: InquiryItem["kind"] =
    room.id === "library" ? "paper" : room.id === "office" ? "draft" : "thought";
  const allowedKinds = room.includes.length ? room.includes : [defaultKind];
  const [kind, setKind] = useState<InquiryItem["kind"]>(defaultKind);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    setKind(defaultKind);
  }, [defaultKind]);

  const submitPost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle || !cleanBody) return;

    onCreatePost({ title: cleanTitle, body: cleanBody, kind });
    setTitle("");
    setBody("");
    setKind(defaultKind);
  };

  return (
    <form className="post-composer" onSubmit={submitPost}>
      <div className="composer-topline">
        <select value={kind} onChange={(event) => setKind(event.target.value as InquiryItem["kind"])}>
          {allowedKinds.map((option) => (
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
        placeholder="Claim, note, question, or paper sketch"
      />
    </form>
  );
}

function OfficeFolders() {
  return (
    <section className="folder-row" aria-label="Saved folders">
      {libraryFolders.map((folder) => {
        const Icon = folder.icon;
        return (
          <button className="folder-tile" key={folder.label} type="button">
            <Icon size={19} />
            <strong>{folder.label}</strong>
            <span>{folder.count} artifacts</span>
          </button>
        );
      })}
    </section>
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
      className="feed-post"
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
        <div className="card-topline">
          <span>{kindLabels[item.kind]}</span>
        </div>
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
    { label: signaledByActor ? "Signaled" : "Signal", value: item.metrics.signal, icon: Sparkles, action: "signal" as PostAction },
    { label: "Critique", value: String(commentCount), icon: MessageCircle, action: null },
    { label: forkedByActor ? "Forked" : "Fork", value: item.metrics.forks, icon: GitFork, action: "fork" as PostAction },
    { label: savedByActor ? "Saved" : "Save", value: item.metrics.saves, icon: Bookmark, action: "save" as PostAction },
    { label: "Reads", value: item.metrics.reads, icon: Eye, action: null }
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
  onOpenTablet,
  onOpenNotebook,
  onOpenProfile,
  onAddComment,
  onAction,
  actorHandle
}: {
  item: InquiryItem;
  room: Room;
  onBack: () => void;
  onOpenTablet: () => void;
  onOpenNotebook: () => void;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onAction: (itemId: string, action: PostAction) => void;
  actorHandle: string;
}) {
  return (
    <article className="detail-layout">
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

      <aside className="detail-side">
        <section className="signal-panel">
          <h2>Signal Panel</h2>
          {item.signals.map((signal) => (
            <div key={signal.label}>
              <span>{signal.label}</span>
              <strong>{signal.value}</strong>
            </div>
          ))}
        </section>

        <section className="side-actions">
          <button type="button" onClick={onOpenNotebook}>
            <NotebookPen size={17} />
            Add to notebook
          </button>
          <button type="button" onClick={onOpenTablet}>
            <BrainCircuit size={17} />
            Ask tablet
          </button>
        </section>
      </aside>
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
  onBack,
  onSelect,
  onOpenProfile,
  onAction,
  actorHandle
}: {
  person: ResearchProfile;
  items: InquiryItem[];
  onBack: () => void;
  onSelect: (id: string) => void;
  onOpenProfile: (name: string) => void;
  onAction: (itemId: string, action: PostAction) => void;
  actorHandle: string;
}) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("all");
  const authored = items.filter((item) => item.author === person.name);
  const papers = authored.filter((item) => item.kind === "paper");
  const thoughts = authored.filter((item) => item.kind === "thought" || item.kind === "note");
  const reshares = items.filter((item) => item.author !== person.name && isSavedBy(item, person.handle));
  const signals = items.filter((item) => item.author !== person.name && hasHandle(item.signaledBy, person.handle));

  const tabItems: Record<ProfileTab, InquiryItem[]> = {
    all: authored,
    papers,
    thoughts,
    reshares,
    signals
  };

  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "all", label: "All" },
    { id: "papers", label: "Papers" },
    { id: "thoughts", label: "Thoughts" },
    { id: "reshares", label: "Reshares" },
    { id: "signals", label: "Signals" }
  ];

  return (
    <article className="profile-page">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back
      </button>

      <section className="profile-hero">
        <span className="avatar large">{initial(person.name)}</span>
        <div>
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
        </div>
      </section>

      <section className="profile-tabs" aria-label="Profile sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span>{tabItems[tab.id].length}</span>
          </button>
        ))}
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

function AccountPanel({
  currentProfile,
  onClose,
  onSave,
  onViewProfile,
  onSignOut
}: {
  currentProfile: ResearchProfile;
  onClose: () => void;
  onSave: (input: CreateProfileInput) => void;
  onViewProfile: (name: string) => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(currentProfile.name);
  const [handle, setHandle] = useState(currentProfile.handle);
  const [email, setEmail] = useState(currentProfile.email ?? "");
  const [role, setRole] = useState(currentProfile.role);
  const [location, setLocation] = useState(currentProfile.location);
  const [bio, setBio] = useState(currentProfile.bio);
  const [fields, setFields] = useState(currentProfile.fields.join(", "));

  useEffect(() => {
    setName(currentProfile.name);
    setHandle(currentProfile.handle);
    setEmail(currentProfile.email ?? "");
    setRole(currentProfile.role);
    setLocation(currentProfile.location);
    setBio(currentProfile.bio);
    setFields(currentProfile.fields.join(", "));
  }, [currentProfile]);

  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanHandle =
      handle.trim() ||
      `@${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
    if (!cleanName || !cleanHandle) return;

    onSave({
      name: cleanName,
      handle: cleanHandle,
      email,
      role,
      location,
      bio,
      fields: fields.split(",")
    });
  };

  return (
    <aside className="side-panel account-panel">
      <PanelHeader icon={<UserRound size={18} />} title="Account" onClose={onClose} />

      <section className="account-current">
        <span className="avatar">{initial(currentProfile.name)}</span>
        <div>
          <strong>{currentProfile.name}</strong>
          <small>{currentProfile.handle}</small>
        </div>
      </section>

      <form className="account-form" onSubmit={submitProfile}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Handle
          <input value={handle} onChange={(event) => setHandle(event.target.value)} />
        </label>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Role
          <input value={role} onChange={(event) => setRole(event.target.value)} />
        </label>
        <label>
          Location
          <input value={location} onChange={(event) => setLocation(event.target.value)} />
        </label>
        <label>
          Bio
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} />
        </label>
        <label>
          Fields
          <input value={fields} onChange={(event) => setFields(event.target.value)} />
        </label>
        <div className="account-actions">
          <button type="submit">Save profile</button>
          <button type="button" onClick={() => onViewProfile(currentProfile.name)}>
            View profile
          </button>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </form>
    </aside>
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

function MovementPad({ room }: { room: Room }) {
  return (
    <aside className="movement-pad" aria-label="Movement concept">
      <span className="movement-ring">
        <span />
      </span>
      <strong>{room.name}</strong>
      <small>{room.ambient}</small>
    </aside>
  );
}
