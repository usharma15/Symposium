"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CalendarDays,
  ChevronDown,
  CircleDot,
  Contact,
  LockKeyhole,
  Megaphone,
  Plus,
  Radio,
  Search,
  Send,
  SlidersHorizontal,
  UserRoundPlus,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  CommunityCallContract,
  CreateCommunityInputContract,
  CreateCommunityCallInputContract
} from "@/packages/contracts/src";
import type { InquiryItem, ResearchCommunity, ResearchProfile } from "@/lib/mockData";
import { normalizeSearchPhrase } from "@/lib/symposiumCore";
import type { PostActionHandler } from "@/features/actions/actionTypes";
import type { QuoteActionHandler } from "@/features/quotes/QuoteViews";
import type { AttachmentPreviewHandler } from "@/features/attachments/AttachmentViews";
import {
  communitySearchText,
  getCommunityItems,
  getCommunityStats
} from "@/features/discovery/discoveryPolicy";
import {
  canParticipateInCommunity,
  canViewCommunity,
  communityFeedFilterLabel,
  communityMembershipLabel,
  communityMembershipStatus,
  communityRecencyScore,
  defaultCommunityFeedFilter,
  filterCommunityFeedItems,
  isActiveCommunityMember
} from "@/features/communities/communityPolicy";
import { CommunityFeedFilterModal } from "@/features/communities/CommunityFeedFilterModal";
import { CommunityPeopleModal } from "@/features/communities/CommunityPeopleModal";
import { FeedPost } from "@/features/posts/PostViews";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";

export function CommunitiesStage({
  state,
  directory,
  actions
}: {
  state: {
    selectedCommunity: ResearchCommunity | null;
    communities: ResearchCommunity[];
    items: InquiryItem[];
    calls: CommunityCallContract[];
    currentProfile: ResearchProfile;
    profiles: Record<string, ResearchProfile>;
    membershipBusy: boolean;
  };
  directory: {
    query: string;
    onQuery: (query: string) => void;
    expanded: boolean;
    onExpanded: (expanded: boolean) => void;
  };
  actions: {
    onBack: () => void;
    onMembership: () => void;
    onCreatePost: () => void;
    onCreateCall: (input: Omit<CreateCommunityCallInputContract, "communityId">) => Promise<{ ok: boolean; error?: string }>;
    onJoinCall: (callId: string) => Promise<void>;
    onInvite: () => void;
    onMessageModerator: (handle: string) => void;
    onOpenCommunity: (communityId: string) => void;
    onCreateCommunity: (input: CreateCommunityInputContract) => Promise<{ ok: boolean; error?: string }>;
    onSelect: (id: string, commentId?: string | null) => void;
    onOpenProfile: (name: string) => void;
    onAction: PostActionHandler;
    onQuote: QuoteActionHandler;
    onOpenQuote: QuoteActionHandler;
    onEditPost: (item: InquiryItem) => void;
    onDeletePost: (itemId: string) => void;
    onOpenAttachmentPreview: AttachmentPreviewHandler;
  };
}) {
  if (!state.selectedCommunity) {
    return <CommunitiesDirectoryView
      communities={state.communities}
      items={state.items}
      currentProfile={state.currentProfile}
      query={directory.query}
      onQuery={directory.onQuery}
      expanded={directory.expanded}
      onExpanded={directory.onExpanded}
      onOpenCommunity={actions.onOpenCommunity}
      onCreateCommunity={actions.onCreateCommunity}
    />;
  }
  return <SelectedCommunityView
    community={state.selectedCommunity}
    items={state.items}
    calls={state.calls}
    currentProfile={state.currentProfile}
    profiles={state.profiles}
    membershipBusy={state.membershipBusy}
    onBack={actions.onBack}
    onMembership={actions.onMembership}
    onCreatePost={actions.onCreatePost}
    onCreateCall={actions.onCreateCall}
    onJoinCall={actions.onJoinCall}
    onInvite={actions.onInvite}
    onMessageModerator={actions.onMessageModerator}
    onSelect={actions.onSelect}
    onOpenProfile={actions.onOpenProfile}
    onAction={actions.onAction}
    onQuote={actions.onQuote}
    onOpenQuote={actions.onOpenQuote}
    onEditPost={actions.onEditPost}
    onDeletePost={actions.onDeletePost}
    onOpenAttachmentPreview={actions.onOpenAttachmentPreview}
  />;
}

export function CommunitiesDirectoryView({
  communities,
  items,
  currentProfile,
  query,
  onQuery,
  expanded,
  onExpanded,
  onOpenCommunity,
  onCreateCommunity
}: {
  communities: ResearchCommunity[];
  items: InquiryItem[];
  currentProfile: ResearchProfile;
  query: string;
  onQuery: (query: string) => void;
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
  onOpenCommunity: (communityId: string) => void;
  onCreateCommunity: (input: CreateCommunityInputContract) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [discoverLimit, setDiscoverLimit] = useState(6);
  const discoverSentinel = useRef<HTMLDivElement | null>(null);
  const term = normalizeSearchPhrase(query);
  const matches = (community: ResearchCommunity) => !term || communitySearchText(community).includes(term);
  const myCommunities = communities
    .filter((community) => isActiveCommunityMember(community, currentProfile) && matches(community))
    .sort((a, b) => communityRecencyScore(b) - communityRecencyScore(a) || b.online - a.online);
  const discoverCommunities = communities
    .filter((community) => !isActiveCommunityMember(community, currentProfile) && matches(community))
    .sort((a, b) => b.online - a.online || (b.monthlyActive ?? 0) - (a.monthlyActive ?? 0));
  const visibleMyCommunities = expanded ? myCommunities : myCommunities.slice(0, 3);
  const visibleDiscover = discoverCommunities.slice(0, discoverLimit);
  const liveCommunities = communities
    .filter((community) => community.visibility === "public" && community.callStatus !== "quiet")
    .sort((a, b) => b.online - a.online)
    .slice(0, 4);

  useEffect(() => {
    setDiscoverLimit(6);
  }, [query]);

  useEffect(() => {
    const target = discoverSentinel.current;
    if (!target || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setDiscoverLimit((current) => Math.min(discoverCommunities.length, current + 6));
    }, { rootMargin: "240px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [discoverCommunities.length]);

  return (
    <section className="communities-directory-layout" aria-label="Communities directory">
      <aside className="communities-directory-rail">
        <header>
          <p className="eyebrow">Directory</p>
          <h1>Communities</h1>
        </header>

        <button className="community-primary-action" type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={17} />
          Create community
        </button>
        <button className="community-search-launch" type="button" onClick={() => setSearchOpen(true)}>
          <Search size={17} />
          <span>{query || "Search all communities"}</span>
        </button>

        <section className="directory-live-panel" aria-label="Live public community calls">
          <div className="community-section-heading">
            <span><Radio size={15} /> Live now</span>
            <small>{liveCommunities.length}</small>
          </div>
          {liveCommunities.length ? liveCommunities.map((community) => (
            <button key={community.id} type="button" onClick={() => onOpenCommunity(community.id)}>
              <span className="live-pulse" aria-hidden="true" />
              <span>
                <strong>{community.name}</strong>
                <small>{community.callStatus} · {community.online} online</small>
              </span>
              <ArrowRight size={14} />
            </button>
          )) : <p>Public calls and events will appear here.</p>}
        </section>
      </aside>

      <main className="communities-directory-feed">
        <CommunityLayer
          title="Your communities"
          communities={visibleMyCommunities}
          items={items}
          expanded={expanded}
          total={myCommunities.length}
          onToggle={myCommunities.length > 3 ? () => onExpanded(!expanded) : undefined}
          onOpenCommunity={onOpenCommunity}
          emptyText="Join a community and it will stay close at hand here."
        />

        <CommunityLayer
          title="Discover"
          communities={visibleDiscover}
          items={items}
          total={discoverCommunities.length}
          onOpenCommunity={onOpenCommunity}
          emptyText="No community matches this search yet."
        />
        <div ref={discoverSentinel} className="community-discover-sentinel" aria-hidden="true" />
        {visibleDiscover.length < discoverCommunities.length ? (
          <button className="community-load-more" type="button" onClick={() => setDiscoverLimit((current) => current + 6)}>
            Show more communities
          </button>
        ) : null}
      </main>

      {searchOpen ? (
        <CommunitySearchModal
          communities={communities}
          items={items}
          query={query}
          onQuery={onQuery}
          onOpenCommunity={(communityId) => {
            setSearchOpen(false);
            onOpenCommunity(communityId);
          }}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
      {createOpen ? (
        <CreateCommunityModal
          onCreate={onCreateCommunity}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}
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
          {onToggle ? <ChevronDown size={16} className={expanded ? "expanded" : ""} /> : null}
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
      ) : <p className="community-empty">{emptyText}</p>}
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
  const privateHidden = community.visibility === "private" && community.membershipStatus !== "active";
  return (
    <CanonicalLink
      className={`community-card community-card-${community.visibility}`}
      route={{ kind: "community", communityId: community.id }}
      onNavigate={() => onOpenCommunity(community.id)}
    >
      <span className="community-card-topline">
        <strong>{community.name}</strong>
        <small>{community.visibility === "private" ? <LockKeyhole size={11} /> : null}{community.visibility}</small>
      </span>
      <span className="community-field">{community.field}</span>
      <span className="community-summary">{community.summary}</span>
      <span className="community-stats">
        {privateHidden ? <small>Membership required</small> : <><small>{community.online} online</small><small>{community.monthlyActive ?? community.online} monthly active</small></>}
        <small>{stats.papers} {privateHidden ? "public papers" : "papers"}</small>
      </span>
    </CanonicalLink>
  );
}

function CommunitySearchModal({
  communities,
  items,
  query,
  onQuery,
  onOpenCommunity,
  onClose
}: {
  communities: ResearchCommunity[];
  items: InquiryItem[];
  query: string;
  onQuery: (query: string) => void;
  onOpenCommunity: (communityId: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const term = normalizeSearchPhrase(query);
  const matches = communities.filter((community) => !term || communitySearchText(community).includes(term));
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="community-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="community-search-modal" role="dialog" aria-modal="true" aria-label="Search communities" onClick={(event) => event.stopPropagation()}>
        <header>
          <label>
            <Search size={19} />
            <input ref={inputRef} value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search communities, fields, calls…" />
          </label>
          <button type="button" title="Close search" onClick={onClose}><X size={18} /></button>
        </header>
        <p>{matches.length} {matches.length === 1 ? "community" : "communities"}</p>
        <div className="community-search-results">
          {matches.map((community) => (
            <CommunityCard key={community.id} community={community} stats={getCommunityStats(items, community)} onOpenCommunity={onOpenCommunity} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CreateCommunityModal({
  onCreate,
  onClose
}: {
  onCreate: (input: CreateCommunityInputContract) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [field, setField] = useState("");
  const [summary, setSummary] = useState("");
  const [visibility, setVisibility] = useState<CreateCommunityInputContract["visibility"]>("public");
  const [guidelines, setGuidelines] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !field.trim() || !summary.trim() || busy) return;
    setBusy(true);
    setStatus("Creating community…");
    const result = await onCreate({
      name: name.trim(),
      field: field.trim(),
      summary: summary.trim(),
      visibility,
      guidelines: guidelines.trim() || undefined,
      moderatorHandles: [],
      keywords: []
    });
    setBusy(false);
    if (result.ok) onClose();
    else setStatus(result.error ?? "Community could not be created.");
  };
  return (
    <div className="community-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="community-create-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>New community</span><strong>Give the work a home</strong></div>
          <button type="button" title="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus /></label>
        <label>Field or purpose<input value={field} onChange={(event) => setField(event.target.value)} maxLength={180} /></label>
        <label>Short description<textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={360} rows={3} /></label>
        <label>Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="public">Public — anyone can look in</option><option value="private">Private — membership required</option></select></label>
        <label>Opening guidelines <small>optional</small><textarea value={guidelines} onChange={(event) => setGuidelines(event.target.value)} rows={4} /></label>
        <p className="community-form-status" aria-live="polite">{status}</p>
        <button className="community-primary-action" type="submit" disabled={busy || !name.trim() || !field.trim() || !summary.trim()}>
          <Plus size={17} /> {busy ? "Creating…" : "Create community"}
        </button>
      </form>
    </div>
  );
}

export function SelectedCommunityView({
  community,
  items,
  calls,
  currentProfile,
  profiles,
  membershipBusy,
  onBack,
  onMembership,
  onCreatePost,
  onCreateCall,
  onJoinCall,
  onInvite,
  onMessageModerator,
  onSelect,
  onOpenProfile,
  onAction,
  onQuote,
  onOpenQuote,
  onEditPost,
  onDeletePost,
  onOpenAttachmentPreview
}: {
  community: ResearchCommunity;
  items: InquiryItem[];
  calls: CommunityCallContract[];
  currentProfile: ResearchProfile;
  profiles: Record<string, ResearchProfile>;
  membershipBusy: boolean;
  onBack: () => void;
  onMembership: () => void;
  onCreatePost: () => void;
  onCreateCall: (input: Omit<CreateCommunityCallInputContract, "communityId">) => Promise<{ ok: boolean; error?: string }>;
  onJoinCall: (callId: string) => Promise<void>;
  onInvite: () => void;
  onMessageModerator: (handle: string) => void;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onQuote: QuoteActionHandler;
  onOpenQuote: QuoteActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
}) {
  const [filter, setFilter] = useState(defaultCommunityFeedFilter);
  const [feedQuery, setFeedQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [callComposerOpen, setCallComposerOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState<"members" | "moderators" | null>(null);
  const [announcementsExpanded, setAnnouncementsExpanded] = useState(false);
  const [callsExpanded, setCallsExpanded] = useState(false);
  const isMember = isActiveCommunityMember(community, currentProfile);
  const mayView = canViewCommunity(community, currentProfile);
  const mayParticipate = canParticipateInCommunity(community, currentProfile);
  const relatedItems = useMemo(() => {
    const term = normalizeSearchPhrase(feedQuery);
    const matching = getCommunityItems(items, community).filter((item) => {
      const queryMatches = !term || normalizeSearchPhrase([item.title, item.body, item.author, ...item.tags].join(" ")).includes(term);
      return queryMatches;
    });
    return filterCommunityFeedItems(matching, filter);
  }, [community, feedQuery, filter, items]);
  const liveCalls = calls.filter((call) => call.status === "live");
  const upcomingCalls = calls.filter((call) => call.status === "scheduled");
  const announcements = [...(community.announcements ?? [])].sort((first, second) =>
    (second.createdAt ?? "").localeCompare(first.createdAt ?? "")
  );
  const activeCalls = [...liveCalls, ...upcomingCalls];

  return (
    <section className="selected-community-layout" aria-label={community.name}>
      <aside className="selected-community-left">
        <CanonicalLink className="community-back" route={{ kind: "communities" }} onNavigate={onBack}>
          <ArrowLeft size={16} /> Communities
        </CanonicalLink>
        <header className="selected-community-header">
          <p className="eyebrow">{community.visibility} community</p>
          <h1>{community.name}</h1>
          <p>{community.summary}</p>
        </header>

        <button className="community-membership-action" type="button" disabled={membershipBusy || communityMembershipStatus(community, currentProfile) === "requested"} onClick={onMembership}>
          {communityMembershipStatus(community, currentProfile) === "active" ? <UsersRound size={16} /> : <UserRoundPlus size={16} />}
          {membershipBusy ? "Updating…" : communityMembershipLabel(community, currentProfile)}
        </button>
        <button type="button" disabled={!mayParticipate} onClick={onCreatePost}><Plus size={16} /> Create post here</button>

        {mayView ? <section className="community-feed-controls" aria-label="Community feed controls">
          <label><Search size={15} /><input value={feedQuery} onChange={(event) => setFeedQuery(event.target.value)} placeholder="Search this community" /></label>
          <button type="button" onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={15} /><span><strong>Filter feed</strong><small>{communityFeedFilterLabel(filter)}</small></span></button>
        </section> : null}

        {mayView ? <div className="community-secondary-actions">
          <button type="button" onClick={() => setRulesOpen(true)}><BookOpenText size={16} /> Guidelines & rules</button>
          <button type="button" onClick={() => setPeopleOpen("moderators")}><Contact size={16} /> Contact moderators</button>
          <button type="button" onClick={onInvite}><Send size={16} /> Invite</button>
        </div> : null}
      </aside>

      <main className="selected-community-work" aria-label={`${community.name} feed`}>
        {!mayView ? (
          <section className="community-private-gate">
            <LockKeyhole size={28} />
            <h2>This community is private.</h2>
            <p>Membership is required to see its feed, calls, announcements, and member activity.</p>
          </section>
        ) : relatedItems.length ? (
          relatedItems.map((item) => (
            <FeedPost
              key={item.id}
              item={item}
              onSelect={onSelect}
              onOpenProfile={onOpenProfile}
              onAction={onAction}
              onQuote={onQuote}
              onOpenQuote={onOpenQuote}
              onEditPost={onEditPost}
              onDeletePost={onDeletePost}
              onOpenAttachmentPreview={onOpenAttachmentPreview}
              actorHandle={currentProfile.handle}
              profiles={profiles}
              surface="community"
            />
          ))
        ) : (
          <div className="empty-feed">
            <strong>{feedQuery || filter.content !== "all" || filter.sort !== "recent" ? "No posts match these filters." : "No shared work yet."}</strong>
            <span>{isMember ? "Create the first post here. Papers will also appear publicly in the Library." : "Join to begin contributing."}</span>
          </div>
        )}
      </main>

      {mayView ? <aside className="selected-community-right">
        <section className="community-activity-panel">
          <div className="community-section-heading"><span><CircleDot size={15} /> Activity</span></div>
          <div className="community-activity-counts">
            <span><strong>{community.monthlyActive ?? community.online}</strong><small>monthly active</small></span>
            <span><strong>{community.online}</strong><small>online now</small></span>
            <button type="button" onClick={() => setPeopleOpen("members")} title="Browse and search community members"><strong>{community.memberCount ?? community.memberHandles.length}</strong><small>members</small></button>
          </div>
        </section>

        <section className={`community-announcements-panel community-expandable-panel ${announcementsExpanded ? "expanded" : ""}`}>
          <button className="community-section-heading community-section-toggle" type="button" aria-expanded={announcementsExpanded} onClick={() => setAnnouncementsExpanded((current) => !current)}>
            <span><Megaphone size={15} /> Announcements</span><span className="community-heading-actions"><small>{announcements.length}</small><ChevronDown size={14} /></span>
          </button>
          <div className="community-section-list" onClick={() => setAnnouncementsExpanded((current) => !current)}>
            {mayView && announcements.length ? announcements.slice(0, announcementsExpanded ? undefined : 3).map((announcement) => (
              <article key={announcement.id}><strong>{announcement.title}</strong><p>{announcement.body}</p></article>
            )) : <p>{mayView ? "No announcements right now." : "Available to members."}</p>}
          </div>
        </section>

        <section className={`community-calls-panel community-expandable-panel ${callsExpanded ? "expanded" : ""}`}>
          <div className="community-section-heading">
            <button className="community-section-toggle" type="button" aria-expanded={callsExpanded} onClick={() => setCallsExpanded((current) => !current)}><span><CalendarDays size={15} /> Events & calls</span><span className="community-heading-actions"><small>{activeCalls.length}</small><ChevronDown size={14} /></span></button>
            {mayView ? <button className="community-section-new" type="button" disabled={!mayParticipate} onClick={() => setCallComposerOpen(true)}><Plus size={13} /> New</button> : null}
          </div>
          <div className="community-section-list" onClick={() => setCallsExpanded((current) => !current)}>
            {mayView ? activeCalls.slice(0, callsExpanded ? undefined : 3).map((call) => (
              <article key={call.id}>
                <span className={call.status === "live" ? "live-pulse" : "scheduled-dot"} aria-hidden="true" />
                <div><strong>{call.title}</strong><small>{call.status === "live" ? `${call.kind} live now` : formatCallTime(call.startsAt)}</small><small>{call.participantHandles.length} joined</small></div>
                <button type="button" onClick={(event) => { event.stopPropagation(); void onJoinCall(call.id); }}>{call.status === "live" ? "Join" : "RSVP"}</button>
              </article>
            )) : null}
            {mayView && !activeCalls.length ? <p>No calls or events scheduled.</p> : null}
          </div>
        </section>
      </aside> : null}

      {rulesOpen ? (
        <div className="community-modal-backdrop" role="presentation" onClick={() => setRulesOpen(false)}>
          <section className="community-rules-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header><div><span>Guidelines</span><strong>{community.name}</strong></div><button type="button" title="Close guidelines" onClick={() => setRulesOpen(false)}><X size={18} /></button></header>
            <p>{community.guidelines || "Keep criticism attached to the work. Preserve sources and leave a legible trail when a claim changes."}</p>
          </section>
        </div>
      ) : null}
      {filtersOpen ? <CommunityFeedFilterModal value={filter} onChange={setFilter} onClose={() => setFiltersOpen(false)} /> : null}
      {peopleOpen ? <CommunityPeopleModal
        community={community}
        currentProfileHandle={currentProfile.handle}
        profiles={profiles}
        mode={peopleOpen}
        onClose={() => setPeopleOpen(null)}
        onOpenProfile={onOpenProfile}
        onMessage={peopleOpen === "moderators" ? onMessageModerator : undefined}
      /> : null}
      {callComposerOpen ? <CreateCallModal onCreate={onCreateCall} onClose={() => setCallComposerOpen(false)} /> : null}
    </section>
  );
}

function CreateCallModal({
  onCreate,
  onClose
}: {
  onCreate: (input: Omit<CreateCommunityCallInputContract, "communityId">) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"voice" | "video">("voice");
  const [startsAt, setStartsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const parsedStart = startsAt ? new Date(startsAt).toISOString() : undefined;
    const result = await onCreate({ title: title.trim(), kind, startsAt: parsedStart });
    setBusy(false);
    if (result.ok) onClose();
    else setStatus(result.error ?? "Call could not be created.");
  };
  return (
    <div className="community-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="community-call-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <header><div><span>Event or call</span><strong>Open a gathering point</strong></div><button type="button" title="Close call form" onClick={onClose}><X size={18} /></button></header>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} autoFocus /></label>
        <label>Format<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="voice">Voice</option><option value="video">Video</option></select></label>
        <label>Start time <small>leave empty to go live now</small><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
        <p className="community-form-status" aria-live="polite">{status}</p>
        <button className="community-primary-action" type="submit" disabled={busy || !title.trim()}><Radio size={16} /> {busy ? "Creating…" : startsAt ? "Schedule" : "Go live"}</button>
      </form>
    </div>
  );
}

const formatCallTime = (value?: string) => {
  if (!value) return "Scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date);
};
