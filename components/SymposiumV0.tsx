"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  Bookmark,
  BrainCircuit,
  ChevronRight,
  Eye,
  MessageCircle,
  Moon,
  NotebookPen,
  Repeat2,
  Search,
  Send,
  Sparkles,
  Sun,
  ThumbsUp,
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
  const selectedItem = inquiryItems.find((item) => item.id === selectedItemId) ?? null;
  const selectedProfile = selectedProfileName ? getProfileForName(selectedProfileName) : null;

  const visibleItems = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return inquiryItems
      .filter((item) => {
        if (activeRoom === "hall") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "office") return item.saved || item.room === "office";
        if (activeRoom === "symposium") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "library") return item.kind === "paper";
        if (activeRoom === "amphitheater") return item.kind === "thought" || item.kind === "note";
        return true;
      })
      .filter((item) => {
        if (!lowered) return true;
        return [item.title, item.author, item.status, item.excerpt, ...item.tags]
          .join(" ")
          .toLowerCase()
          .includes(lowered);
      });
  }, [activeRoom, query]);

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

      <section className="stage">
        {activeRoom === "hall" ? (
          <HallView onEnter={enterRoom} />
        ) : selectedItem ? (
          <DetailView
            item={selectedItem}
            room={activeRoomData}
            onBack={() => setSelectedItemId(null)}
            onOpenTablet={openTablet}
            onOpenNotebook={openNotebook}
            onOpenProfile={openProfile}
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

      <MovementPad room={activeRoomData} />

      {selectedProfile ? (
        <ProfilePanel profile={selectedProfile} onClose={() => setSelectedProfileName(null)} />
      ) : null}

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
        <p>SYMPOSIUM</p>
        <span>Approaching the hall</span>
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

      <aside className="hall-orientation">
        <p className="eyebrow">Main hall</p>
        <h1>Choose a room from the floor.</h1>
        <p>
          Office sits to the left, the Amphitheater is farther down that same side,
          the Library is up the short stair at the end, and the public Symposium
          room opens on the right.
        </p>
        <div className="hall-room-list">
          {doorIds.map((roomId) => {
            const room = getRoom(roomId);
            return (
              <button key={room.id} type="button" onClick={() => onEnter(room.id)}>
                <span>{room.name}</span>
                <small>{room.feedLabel}</small>
              </button>
            );
          })}
        </div>
      </aside>
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
  onOpenProfile
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

      <section className="feed-stream" aria-label={`${room.name} feed`}>
        {items.map((item) => (
          <FeedPost
            key={item.id}
            item={item}
            onSelect={onSelect}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </section>
    </div>
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
    { label: "Endorse", value: item.metrics.endorsements, icon: ThumbsUp },
    { label: "Discuss", value: commentCount, icon: MessageCircle },
    { label: "Reshare", value: item.metrics.reshares, icon: Repeat2 },
    { label: "Save", value: item.metrics.saves, icon: Bookmark },
    { label: "Views", value: item.metrics.views, icon: Eye }
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
            <span>{action.value}</span>
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
  onOpenProfile
}: {
  item: InquiryItem;
  room: Room;
  onBack: () => void;
  onOpenTablet: () => void;
  onOpenNotebook: () => void;
  onOpenProfile: (name: string) => void;
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

function ProfilePanel({
  profile: person,
  onClose
}: {
  profile: ResearchProfile;
  onClose: () => void;
}) {
  return (
    <aside className="profile-panel">
      <PanelHeader icon={<UserRound size={18} />} title="Profile" onClose={onClose} />
      <div className="profile-heading">
        <span className="avatar large">{initial(person.name)}</span>
        <span>
          <h2>{person.name}</h2>
          <small>{person.handle}</small>
        </span>
      </div>
      <p>
        {person.role} · {person.location}
      </p>
      <p>{person.bio}</p>
      <div className="profile-fields">
        {person.fields.map((field) => (
          <span key={field}>{field}</span>
        ))}
      </div>
      <div className="profile-proof">
        {person.proof.map((proof) => (
          <strong key={proof}>{proof}</strong>
        ))}
      </div>
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
