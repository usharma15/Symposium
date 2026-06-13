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

type Theme = "day" | "night";
type ProfileTab = "all" | "papers" | "thoughts" | "reshares" | "signals";

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

const initial = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function SymposiumV0() {
  const [theme, setTheme] = useState<Theme>("day");
  const [entryComplete, setEntryComplete] = useState<boolean | null>(null);
  const [activeRoom, setActiveRoom] = useState<RoomId>("hall");
  const [items, setItems] = useState<InquiryItem[]>(inquiryItems);
  const [feedScope, setFeedScope] = useState<FeedScope>("suggested");
  const [roomChip, setRoomChip] = useState(roomChips[0]);
  const [query, setQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [tabletOpen, setTabletOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(null);
  const [noteText, setNoteText] = useState(
    "First note: make the thing feel alive without pretending the whole world is built yet."
  );

  const activeRoomData = getRoom(activeRoom);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const selectedProfile = selectedProfileName ? getProfileForName(selectedProfileName) : null;

  const visibleItems = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    const roomFiltered = items
      .filter((item) => {
        if (activeRoom === "hall") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "office") return item.saved || item.room === "office";
        if (activeRoom === "symposium") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "library") return item.kind === "paper";
        if (activeRoom === "amphitheater") return item.kind === "thought" || item.kind === "note";
        return true;
      })
      .filter((item) => {
        if (feedScope === "following") return item.author === profile.name || item.saved;
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
  }, [activeRoom, feedScope, items, query, roomChip]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("symposium-theme") as Theme | null;
    const storedNote = window.localStorage.getItem("symposium-notebook");
    const hasEntered = window.sessionStorage.getItem("symposium-entry-complete") === "true";

    if (storedTheme === "day" || storedTheme === "night") setTheme(storedTheme);
    if (storedNote) setNoteText(storedNote);
    setEntryComplete(hasEntered);
  }, []);

  useEffect(() => {
    if (entryComplete !== false) return undefined;

    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem("symposium-entry-complete", "true");
      setEntryComplete(true);
      setActiveRoom("hall");
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [entryComplete]);

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
  };

  const openProfile = (name: string) => {
    setTabletOpen(false);
    setNotebookOpen(false);
    setSelectedProfileName(name);
  };

  const openNotebook = () => {
    setTabletOpen(false);
    setSelectedProfileName(null);
    setNotebookOpen(true);
  };

  const openTablet = () => {
    setNotebookOpen(false);
    setSelectedProfileName(null);
    setTabletOpen(true);
  };

  const createPost = ({
    title,
    body,
    kind
  }: {
    title: string;
    body: string;
    kind: InquiryItem["kind"];
  }) => {
    if (activeRoom === "hall") return;

    const newItem: InquiryItem = {
      id: `local-${Date.now()}`,
      kind,
      room: activeRoom,
      title,
      author: profile.name,
      affiliation: "Science Rebirth",
      date: "Just now",
      status: kind === "paper" ? "Draft" : "New",
      metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
      gatheringReason: "A new working post added in this session.",
      excerpt: body,
      body,
      tags: [activeRoomData.name.toLowerCase(), kind],
      signals: [
        { label: "Status", value: kind === "paper" ? "Draft" : "New" },
        { label: "Critiques", value: "0" },
        { label: "Forks", value: "0" },
        { label: "Next action", value: "Invite critique" }
      ],
      claims: [body],
      objections: [],
      evidence: [],
      tests: [],
      forks: [],
      comments: [],
      saved: activeRoom === "office"
    };

    setItems((current) => [newItem, ...current]);
    setSelectedItemId(newItem.id);
  };

  const addComment = (itemId: string, body: string, stance: string) => {
    const comment: InquiryComment = {
      author: profile.name,
      stance,
      body
    };

    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              metrics: {
                ...item.metrics,
                critiques: String(countComments(item.comments) + 1)
              },
              comments: [...item.comments, comment]
            }
          : item
      )
    );
  };

  const currentContext = selectedItem
    ? `${selectedItem.title}: ${selectedItem.gatheringReason}`
    : `${activeRoomData.name}: ${activeRoomData.description}`;

  if (entryComplete !== true) {
    return <EntrySequence theme={theme} />;
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
            title="Your profile"
            onClick={() => openProfile(profile.name)}
          >
            <UserRound size={18} />
            <span>{profile.name}</span>
          </button>
        </nav>
      </header>

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
              setSelectedItemId(id);
            }}
            onOpenProfile={openProfile}
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
            onSelect={setSelectedItemId}
            onOpenProfile={openProfile}
            onCreatePost={createPost}
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
    </main>
  );
}

function EntrySequence({ theme }: { theme: Theme }) {
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
    </main>
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
  onCreatePost
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
  onOpenProfile
}: {
  item: InquiryItem;
  onSelect: (id: string) => void;
  onOpenProfile: (name: string) => void;
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
          <span>{item.status}</span>
        </div>
        <h2>{item.title}</h2>
        <p>{item.excerpt}</p>
        <div className="tag-row">
          {item.tags.slice(0, 4).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        <SocialActions item={item} commentCount={countComments(item.comments)} />
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
  commentCount
}: {
  item: InquiryItem;
  commentCount: number;
}) {
  const actions = [
    { label: "Signal", value: item.metrics.signal, icon: Sparkles },
    { label: "Critique", value: String(commentCount), icon: MessageCircle },
    { label: "Fork", value: item.metrics.forks, icon: GitFork },
    { label: "Save", value: item.metrics.saves, icon: Bookmark },
    { label: "Reads", value: item.metrics.reads, icon: Eye }
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
            onClick={(event) => event.stopPropagation()}
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
  onAddComment
}: {
  item: InquiryItem;
  room: Room;
  onBack: () => void;
  onOpenTablet: () => void;
  onOpenNotebook: () => void;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string) => void;
}) {
  return (
    <article className="detail-layout">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back to {room.feedLabel}
      </button>

      <section className="detail-main">
        <p className="eyebrow">
          {kindLabels[item.kind]} · {item.status}
        </p>
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
        <p className="gathering-reason">{item.gatheringReason}</p>
        <p className="detail-body">{item.body}</p>
        <SocialActions item={item} commentCount={countComments(item.comments)} />

        <DetailSection title="Claims" items={item.claims} />
        <DetailSection title="Objections" items={item.objections} />
        <DetailSection title="Evidence" items={item.evidence} />
        <DetailSection title="Tests" items={item.tests} />
        <DetailSection title="Forks" items={item.forks} />

        <section className="comments-section">
          <h2>Discussion</h2>
          <CommentComposer itemId={item.id} onAddComment={onAddComment} />
          <CommentThread comments={item.comments} onOpenProfile={onOpenProfile} />
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
  onAddComment
}: {
  itemId: string;
  onAddComment: (itemId: string, body: string, stance: string) => void;
}) {
  const [stance, setStance] = useState("Comment");
  const [body, setBody] = useState("");

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanBody = body.trim();
    if (!cleanBody) return;

    onAddComment(itemId, cleanBody, stance);
    setBody("");
    setStance("Comment");
  };

  return (
    <form className="comment-composer" onSubmit={submitComment}>
      <div>
        <select value={stance} onChange={(event) => setStance(event.target.value)}>
          <option>Comment</option>
          <option>Objection</option>
          <option>Endorsement with reason</option>
          <option>Question</option>
          <option>Test proposal</option>
        </select>
        <button type="submit">Add comment</button>
      </div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Add a critique, question, test, or reasoned response"
      />
    </form>
  );
}

function DetailSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="detail-section">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function CommentThread({
  comments,
  onOpenProfile,
  depth = 0
}: {
  comments: InquiryComment[];
  onOpenProfile: (name: string) => void;
  depth?: number;
}) {
  return (
    <div className={`comment-thread depth-${depth}`}>
      {comments.map((comment) => (
        <article className="comment" key={`${comment.author}-${comment.stance}-${comment.body}`}>
          <button type="button" onClick={() => onOpenProfile(comment.author)}>
            <span className="avatar small">{initial(comment.author)}</span>
            <span>
              <strong>{comment.author}</strong>
              <small>{comment.stance}</small>
            </span>
          </button>
          <p>{comment.body}</p>
          {comment.replies?.length ? (
            <CommentThread comments={comment.replies} onOpenProfile={onOpenProfile} depth={depth + 1} />
          ) : null}
        </article>
      ))}
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
  onBack,
  onSelect,
  onOpenProfile
}: {
  person: ResearchProfile;
  items: InquiryItem[];
  onBack: () => void;
  onSelect: (id: string) => void;
  onOpenProfile: (name: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("all");
  const authored = items.filter((item) => item.author === person.name);
  const papers = authored.filter((item) => item.kind === "paper");
  const thoughts = authored.filter((item) => item.kind === "thought" || item.kind === "note");
  const reshares = items.filter((item) => item.author !== person.name && item.saved).slice(0, 4);
  const signals = items
    .filter(
      (item) =>
        item.author !== person.name &&
        person.fields.some((field) => searchableText(item).includes(field.toLowerCase()))
    )
    .slice(0, 4);

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
