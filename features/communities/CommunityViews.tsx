"use client";

import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import {
  researchCommunities,
  type InquiryItem,
  type ResearchCommunity,
  type ResearchProfile
} from "@/lib/mockData";
import { itemTimestampScore, normalizeSearchPhrase } from "@/lib/symposiumCore";
import type { PostActionHandler } from "@/features/actions/actionTypes";
import type { AttachmentPreviewHandler } from "@/features/attachments/AttachmentViews";
import {
  communitySearchText,
  getCommunityItems,
  getCommunityStats
} from "@/features/discovery/discoveryPolicy";
import { FeedPost } from "@/features/posts/PostViews";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";

const fallbackCommunityCount = 8;
const communityMembershipIds = (communities: ResearchCommunity[], person: ResearchProfile) => {
  const explicit = communities.filter((community) => community.memberHandles.includes(person.handle));
  if (explicit.length > 0) return new Set(explicit.map((community) => community.id));
  const maxOffset = Math.max(1, communities.length - fallbackCommunityCount + 1);
  const offset =
    Array.from(person.handle).reduce((total, character) => total + character.charCodeAt(0), 0) % maxOffset;
  return new Set(communities.slice(offset, offset + fallbackCommunityCount).map((community) => community.id));
};

export function CommunitiesDirectoryView({
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
    <CanonicalLink
      className={`community-card community-card-${community.visibility}`}
      route={{ kind: "community", communityId: community.id }}
      onNavigate={() => onOpenCommunity(community.id)}
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
    </CanonicalLink>
  );
}

export function SelectedCommunityView({
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
  onOpenAttachmentPreview,
  onDummyCall
}: {
  community: ResearchCommunity;
  items: InquiryItem[];
  currentProfile: ResearchProfile;
  profiles: Record<string, ResearchProfile>;
  onBack: () => void;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  onDummyCall: (mode: "Voice" | "Video") => void;
}) {
  const memberships = communityMembershipIds(researchCommunities, currentProfile);
  const isMember = memberships.has(community.id);
  const relatedItems = sortCommunityItems(getCommunityItems(items, community));

  return (
    <section className="selected-community-layout" aria-label={community.name}>
      <div className="selected-community-panel">
        <CanonicalLink className="community-back" route={{ kind: "communities" }} onNavigate={onBack}>
          <ArrowLeft size={17} />
          Communities
        </CanonicalLink>
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
              onOpenAttachmentPreview={onOpenAttachmentPreview}
              actorHandle={currentProfile.handle}
              profiles={profiles}
              surface="community"
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
