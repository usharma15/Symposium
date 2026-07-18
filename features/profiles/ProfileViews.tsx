"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from "react";
import { MessageCircle, Settings, UserRound, X } from "lucide-react";
import type { CanonicalActionActivityContract, ProfileActivityCountsContract, ToggleActionContract } from "@/packages/contracts/src";
import {
  profile,
  type InquiryComment,
  type InquiryItem,
  type ResearchCommunity,
  type ResearchProfile
} from "@/lib/mockData";
import {
  cleanHandle,
  deletedPostContextTitle,
  findCommentInTree,
  hasHandle,
  isDeletedComment,
  isDeletedPost,
  itemTimestampScore,
  localDateTimeLabel,
  relativeTimeLabel
} from "@/lib/symposiumCore";
import {
  canonicalActionState,
  emptyProfileActivityCounts,
  itemMatchesProfilePostAction,
  profileCommentsArePubliclyListable,
  profileItemIsPubliclyListable,
  reconcileProfileActivitySlots,
  selectProfileActivitySlots,
  uniqueProfileActivityEntries
} from "@/lib/profileActivity";
import { CommunityActivityBadge } from "@/features/communities/CommunityActivityBadge";
import { communityPostIsInteractive } from "@/features/communities/communityPolicy";
import type { CommentActionHandler, PostActionHandler } from "@/features/actions/actionTypes";
import {
  AttachmentCarousel,
  type AttachmentPreviewHandler
} from "@/features/attachments/AttachmentViews";
import {
  CommentActions,
  CommentOwnerControls,
  type CommentAttachmentPreviewHandler
} from "@/features/comments/CommentThread";
import { SymposiumDocumentRenderer } from "@/features/content/SymposiumDocument";
import { appendedContentAttachments } from "@/lib/documentModel";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import { FeedPost } from "@/features/posts/PostViews";
import { InfiniteFeedBoundary } from "@/features/feeds/InfiniteFeedBoundary";
import { useQualifiedView } from "@/features/live-sync/useQualifiedView";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";
import type { ProfileSocialView, ProfileTab } from "@/features/navigation/canonicalRoute";
import {
  ContentQuoteCard,
  type QuoteActionHandler
} from "@/features/quotes/QuoteViews";
import { postToneClassName, postToneForItem } from "@/lib/postTone";
import { itemHasPostType } from "@/lib/postSemantics";

export type { ProfileTab } from "@/features/navigation/canonicalRoute";
export type ProfileActivityKind = "authored" | "comments" | "fork" | "signal" | "save";
export type ProfileCommentActivityKind = Exclude<ProfileActivityKind, "authored">;
export type ProfileSocialLists = { following: string[]; followers: string[] };
export type { ProfileSocialView } from "@/features/navigation/canonicalRoute";
export type ProfileSettingsDraft = {
  avatarUrl?: string;
  name: string;
  bio: string;
  likesPublic: boolean;
  resharesPublic: boolean;
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

const findCommentById = (comments: InquiryComment[], id: string) =>
  findCommentInTree(comments, id) ?? undefined;
export const inferredLikesPublic = (person: ResearchProfile) =>
  person.likesPublic ?? person.handle.length % 5 !== 0;
export const inferredResharesPublic = (person: ResearchProfile) =>
  person.resharesPublic ?? person.handle.length % 4 !== 0;
const initial = profileInitials;

const commentAuthoredByProfile = (comment: InquiryComment, person: ResearchProfile) =>
  !isDeletedComment(comment) &&
  (comment.authorHandle ? cleanHandle(comment.authorHandle) === person.handle : comment.author === person.name);

export const commentTimestampScore = (comment: InquiryComment) => {
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
  if (isDeletedComment(comment)) return false;
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
  recencyForComment?: (item: InquiryItem, comment: InquiryComment, kind: ProfileCommentActivityKind) => number,
  matchesActivity?: (item: InquiryItem, comment: InquiryComment, kind: ProfileCommentActivityKind) => boolean
): ProfileCommentActivity[] => {
  const activities: ProfileCommentActivity[] = [];

  const visit = (item: InquiryItem, comments: InquiryComment[]) => {
    for (const comment of comments) {
      const matches = matchesActivity
        ? matchesActivity(item, comment, kind)
        : commentMatchesProfileActivity(comment, person, kind);
      if (matches && comment.id) {
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

export const updateCommentsForProfile = (
  comments: InquiryComment[],
  person: ResearchProfile
): InquiryComment[] =>
  comments.map((comment) => ({
    ...comment,
    author:
      !isDeletedComment(comment) && comment.authorHandle && cleanHandle(comment.authorHandle) === person.handle
        ? person.name
        : comment.author,
    replies: updateCommentsForProfile(comment.replies ?? [], person)
  }));

export const itemAuthoredByProfile = (item: InquiryItem, person: ResearchProfile) =>
  !isDeletedPost(item) && (item.authorHandle ? item.authorHandle === person.handle : item.author === person.name);

export function ProfileView({
  person,
  items,
  isOwnProfile,
  isFollowing,
  onSelect,
  onOpenProfile,
  onAction,
  onCommentAction,
  onQuote,
  onOpenQuote,
  onEditComment,
  onDeleteComment,
  onOpenSettings,
  onToggleFollow,
  actorHandle,
  profiles,
  socialLists,
  socialView,
  getProfileRecency,
  getProfileCommentRecency,
  activeTab,
  activityRevision,
  canonicalActivities,
  canonicalActivityLoaded,
  canonicalActivityError,
  canonicalActivityComplete,
  canonicalActivityTotals,
  authoredActivityComplete,
  activityLoadingMore,
  hiddenCommunityCounts,
  communities,
  onOpenCommunity,
  onActiveTabChange,
  onRetryActivity,
  onLoadMoreActivity,
  onSocialViewChange,
  onEditPost,
  onDeletePost,
  onOpenAttachmentPreview,
  onOpenCommentAttachmentPreview
}: {
  person: ResearchProfile;
  items: InquiryItem[];
  isOwnProfile: boolean;
  isFollowing: boolean;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onCommentAction: CommentActionHandler;
  onQuote: QuoteActionHandler;
  onOpenQuote: QuoteActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  onOpenSettings: () => void;
  onToggleFollow: (handle: string) => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  socialLists: ProfileSocialLists;
  socialView: ProfileSocialView | null;
  getProfileRecency: (item: InquiryItem, handle: string, kind: ProfileActivityKind) => number;
  getProfileCommentRecency: (
    _item: InquiryItem,
    comment: InquiryComment,
    handle: string,
    kind: ProfileCommentActivityKind
  ) => number;
  activeTab: ProfileTab;
  activityRevision: number;
  canonicalActivities: CanonicalActionActivityContract[];
  canonicalActivityLoaded: boolean;
  canonicalActivityError: boolean;
  canonicalActivityComplete: boolean;
  canonicalActivityTotals?: ProfileActivityCountsContract;
  authoredActivityComplete: boolean;
  activityLoadingMore: boolean;
  hiddenCommunityCounts: ProfileActivityCountsContract;
  communities: ResearchCommunity[];
  onOpenCommunity: (communityId: string) => void;
  onActiveTabChange: (tab: ProfileTab) => void;
  onRetryActivity: () => void;
  onLoadMoreActivity: () => void;
  onSocialViewChange: (view: ProfileSocialView | null) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  onOpenCommentAttachmentPreview: CommentAttachmentPreviewHandler;
}) {
  const [visibleSlots, setVisibleSlots] = useState<ProfileActivitySlot[]>([]);
  const visibleSlotContextRef = useRef("");
  const profileItems = isOwnProfile
    ? items
    : items.filter((item) => profileItemIsPubliclyListable(item, communities));
  const profileCommentItems = isOwnProfile
    ? profileItems
    : profileItems.filter((item) => profileCommentsArePubliclyListable(item, communities));
  const communityById = new Map(communities.map((community) => [community.id, community]));
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
  const sortEntries = (entries: ProfileActivityEntry[]) => [...entries].sort((a, b) => {
    const timestampDelta = b.recency - a.recency;
    return timestampDelta || b.id.localeCompare(a.id);
  });
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
  const canonicalPostActivity = (item: InquiryItem, action: ToggleActionContract) =>
    canonicalActionState(canonicalActivities, "post", item.id, person.handle, action);
  const canonicalPostActionActive = (item: InquiryItem, action: ToggleActionContract) => {
    if (!canonicalActivityLoaded) {
      return itemMatchesProfilePostAction(item, person, action, profile.handle);
    }
    const activity = canonicalPostActivity(item, action);
    return activity?.active ?? false;
  };
  const postActionRecency = (item: InquiryItem, action: ToggleActionContract) => {
    const occurredAt = canonicalPostActivity(item, action)?.occurredAt;
    const timestamp = occurredAt ? Date.parse(occurredAt) : Number.NaN;
    return canonicalActivityLoaded && Number.isFinite(timestamp)
      ? timestamp
      : getProfileRecency(item, person.handle, action);
  };
  const canonicalCommentActionMatches = (
    _item: InquiryItem,
    comment: InquiryComment,
    kind: ProfileCommentActivityKind
  ) => {
    if (kind === "comments") return commentAuthoredByProfile(comment, person);
    if (!comment.id) return false;
    if (!canonicalActivityLoaded) return commentMatchesProfileActivity(comment, person, kind);
    const activity = canonicalActionState(canonicalActivities, "comment", comment.id, person.handle, kind);
    return activity?.active ?? false;
  };
  const authored = byPublishedRecency(profileItems.filter(isAuthor));
  const papers = authored.filter((item) => itemHasPostType(item, "paper"));
  const thoughts = authored.filter((item) => itemHasPostType(item, "thought"));
  const proposals = authored.filter((item) => itemHasPostType(item, "proposal"));
  const opportunities = authored.filter((item) => itemHasPostType(item, "opportunity"));
  const commentRecency = (item: InquiryItem, comment: InquiryComment, kind: ProfileCommentActivityKind) =>
    (() => {
      if (kind !== "comments" && comment.id && canonicalActivityLoaded) {
        const occurredAt = canonicalActionState(
          canonicalActivities,
          "comment",
          comment.id,
          person.handle,
          kind
        )?.occurredAt;
        const timestamp = occurredAt ? Date.parse(occurredAt) : Number.NaN;
        if (Number.isFinite(timestamp)) return timestamp;
      }
      return getProfileCommentRecency(item, comment, person.handle, kind);
    })();
  const commentActivities = collectProfileComments(
    profileCommentItems,
    person,
    "comments",
    commentRecency,
    canonicalCommentActionMatches
  );
  const commentReshares = canShowReshares
    ? collectProfileComments(profileCommentItems, person, "fork", commentRecency, canonicalCommentActionMatches)
    : [];
  const commentLikes = canShowLikes
    ? collectProfileComments(profileCommentItems, person, "signal", commentRecency, canonicalCommentActionMatches)
    : [];
  const commentSaved = canShowSaved
    ? collectProfileComments(profileCommentItems, person, "save", commentRecency, canonicalCommentActionMatches)
    : [];
  const reshares = canShowReshares
    ? byProfileRecency(profileItems.filter((item) => canonicalPostActionActive(item, "fork")), "fork")
    : [];
  const likes = canShowLikes
    ? byProfileRecency(profileItems.filter((item) => canonicalPostActionActive(item, "signal")), "signal")
    : [];
  const saved = canShowSaved
    ? byProfileRecency(
        profileItems.filter((item) => canonicalPostActionActive(item, "save")),
        "save"
      )
    : [];
  const authoredEntries = authored.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const paperEntries = papers.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const thoughtEntries = thoughts.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const proposalEntries = proposals.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const opportunityEntries = opportunities.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const reshareEntries = reshares.map((item) => postEntry(item, postActionRecency(item, "fork")));
  const likeEntries = likes.map((item) => postEntry(item, postActionRecency(item, "signal")));
  const savedEntries = saved.map((item) => postEntry(item, postActionRecency(item, "save")));
  const commentEntries = commentActivities.map(commentEntry);
  const commentReshareEntries = commentReshares.map(commentEntry);
  const commentLikeEntries = commentLikes.map(commentEntry);
  const commentSavedEntries = commentSaved.map(commentEntry);
  const allActivity = uniqueProfileActivityEntries(
    [...authoredEntries, ...commentEntries, ...reshareEntries, ...commentReshareEntries],
    (entry) =>
      entry.type === "post"
        ? `post:${entry.item.id}`
        : `comment:${entry.activity.item.id}:${entry.activity.comment.id}`
  );

  const reshareTabEntries = uniqueProfileActivityEntries(
    sortEntries([...reshareEntries, ...commentReshareEntries]),
    (entry) => entry.id
  );
  const tabEntries: Record<ProfileTab, ProfileActivityEntry[]> = {
    all: allActivity,
    papers: paperEntries,
    thoughts: thoughtEntries,
    proposals: proposalEntries,
    opportunities: opportunityEntries,
    comments: commentEntries,
    reshares: reshareTabEntries,
    likes: sortEntries([...likeEntries, ...commentLikeEntries]),
    saved: sortEntries([...savedEntries, ...commentSavedEntries])
  };

  const hiddenCounts = isOwnProfile ? emptyProfileActivityCounts() : hiddenCommunityCounts;
  const tabCounts: Record<ProfileTab, number> = {
    all: allActivity.length + hiddenCounts.all,
    papers: papers.length + hiddenCounts.papers,
    thoughts: thoughts.length + hiddenCounts.thoughts,
    proposals: proposals.length + hiddenCounts.proposals,
    opportunities: opportunities.length + hiddenCounts.opportunities,
    comments: commentActivities.length + hiddenCounts.comments,
    reshares: reshareTabEntries.length + hiddenCounts.reshares,
    likes: likeEntries.length + commentLikeEntries.length + hiddenCounts.likes,
    saved: savedEntries.length + commentSavedEntries.length + hiddenCounts.saved
  };
  const activityTotals = canonicalActivityTotals ?? tabCounts;
  const hasMoreActivity = !canonicalActivityComplete || !authoredActivityComplete;

  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "all", label: "All" },
    { id: "papers", label: "Papers" },
    { id: "thoughts", label: "Thoughts" },
    { id: "proposals", label: "Proposals" },
    { id: "opportunities", label: "Opportunities" },
    { id: "comments", label: "Comments" },
    ...(canShowReshares ? [{ id: "reshares" as const, label: "Reshares" }] : []),
    ...(canShowLikes ? [{ id: "likes" as const, label: "Likes" }] : []),
    ...(canShowSaved ? [{ id: "saved" as const, label: "Saved" }] : [])
  ];

  const nextVisibleSlots = tabEntries[activeTab].map(entryToSlot);
  const visibleSlotContext = `${person.handle}:${activeTab}:${activityRevision}:${canonicalActivityLoaded ? "canonical" : "loading"}`;
  const visibleSlotMembership = nextVisibleSlots.map((slot) => slot.id).join("|");

  useLayoutEffect(() => {
    const contextChanged = visibleSlotContextRef.current !== visibleSlotContext;
    visibleSlotContextRef.current = visibleSlotContext;
    setVisibleSlots((current) =>
      contextChanged ? nextVisibleSlots : reconcileProfileActivitySlots(current, nextVisibleSlots)
    );
  }, [visibleSlotContext, visibleSlotMembership]);

  const resolveSlot = (slot: ProfileActivitySlot): ProfileActivityEntry | null => {
    const item = profileItems.find((candidate) => candidate.id === slot.itemId);
    if (!item) return null;

    if (slot.type === "post") {
      return { id: slot.id, type: "post", item, recency: slot.recency };
    }

    const comment = findCommentById(item.comments, slot.commentId);
    if (!comment || isDeletedComment(comment)) return null;

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

  const renderedVisibleSlots = selectProfileActivitySlots(
    visibleSlotContextRef.current,
    visibleSlotContext,
    visibleSlots,
    nextVisibleSlots
  );
  const visibleEntries = renderedVisibleSlots
    .map(resolveSlot)
    .filter((entry): entry is ProfileActivityEntry => Boolean(entry));

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
            <CanonicalLink
              route={{ kind: "profile", handle: person.handle, social: "following" }}
              onNavigate={() => onSocialViewChange("following")}
            >
              <strong>{socialLists.following.length}</strong>
              <span>Following</span>
            </CanonicalLink>
            <CanonicalLink
              route={{ kind: "profile", handle: person.handle, social: "followers" }}
              onNavigate={() => onSocialViewChange("followers")}
            >
              <strong>{socialLists.followers.length}</strong>
              <span>Followers</span>
            </CanonicalLink>
          </div>
          <div className="profile-metrics" aria-label={`${person.name} activity totals`}>
            {tabs.map((tab) => (
              <CanonicalLink
                key={tab.id}
                route={{ kind: "profile", handle: person.handle, tab: tab.id }}
                className={activeTab === tab.id ? "active" : ""}
                onNavigate={() => onActiveTabChange(tab.id)}
              >
                <strong>
                  {canonicalActivityLoaded
                    ? canonicalActivityTotals
                      ? activityTotals[tab.id]
                      : `${tabCounts[tab.id]}${canonicalActivityComplete ? "" : "+"}`
                    : "—"}
                </strong>
                <span>{tab.label}</span>
              </CanonicalLink>
            ))}
          </div>
        </div>
      </section>

      <section
        className="feed-stream profile-stream"
        aria-busy={!canonicalActivityLoaded}
        aria-label={`${person.name} profile feed`}
      >
        {!canonicalActivityLoaded ? (
          <div className="empty-feed">
            <strong>{canonicalActivityError ? "Profile activity could not load." : "Loading profile activity…"}</strong>
            <span>
              {canonicalActivityError
                ? "The rest of Symposium remains available. Retry when you are ready."
                : "Counts and post order will appear together when they are authoritative."}
            </span>
            {canonicalActivityError ? (
              <button type="button" onClick={onRetryActivity}>Retry activity</button>
            ) : null}
          </div>
        ) : visibleEntries.length ? (
          <>
          {visibleEntries.map((entry) =>
            entry.type === "comment" ? (
              <ProfileCommentCard
                key={entry.id}
                activity={entry.activity}
                community={entry.activity.item.communityId ? communityById.get(entry.activity.item.communityId) : undefined}
                onOpenCommunity={onOpenCommunity}
                profiles={profiles}
                onSelect={onSelect}
                onOpenProfile={onOpenProfile}
                onCommentAction={onCommentAction}
                onQuote={onQuote}
                onOpenQuote={onOpenQuote}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                onOpenAttachmentPreview={onOpenCommentAttachmentPreview}
                actorHandle={actorHandle}
              />
            ) : (
              <FeedPost
                key={entry.id}
                item={entry.item}
                onSelect={onSelect}
                onOpenProfile={onOpenProfile}
                onAction={onAction}
                onQuote={onQuote}
                onOpenQuote={onOpenQuote}
                onEditPost={onEditPost}
                onDeletePost={onDeletePost}
                actorHandle={actorHandle}
                profiles={profiles}
                community={entry.item.communityId ? communityById.get(entry.item.communityId) : undefined}
                onOpenCommunity={onOpenCommunity}
                showCommunityContext={Boolean(entry.item.communityId)}
                surface="profile"
                onOpenAttachmentPreview={onOpenAttachmentPreview}
              />
            )
          )}
          <InfiniteFeedBoundary
            hasMore={hasMoreActivity}
            loading={activityLoadingMore}
            onLoadMore={onLoadMoreActivity}
            label="activity"
          />
          </>
        ) : (
          <>
          <div className="empty-feed">
            <strong>No items here yet.</strong>
            <span>This section will fill as the profile has more activity.</span>
          </div>
          <InfiniteFeedBoundary
            hasMore={hasMoreActivity}
            loading={activityLoadingMore}
            onLoadMore={onLoadMoreActivity}
            label="activity"
          />
          </>
        )}
      </section>

      {socialView ? (
        <ProfileSocialListModal
          title={socialView === "following" ? "Following" : "Followers"}
          handles={socialLists[socialView]}
          profiles={profiles}
          onClose={() => onSocialViewChange(null)}
          onOpenProfile={(handle) => {
            onOpenProfile(handle);
          }}
        />
      ) : null}
    </article>
  );
}

function ProfileCommentCard({
  activity,
  community,
  onOpenCommunity,
  profiles,
  onSelect,
  onOpenProfile,
  onCommentAction,
  onQuote,
  onOpenQuote,
  onEditComment,
  onDeleteComment,
  onOpenAttachmentPreview,
  actorHandle
}: {
  activity: ProfileCommentActivity;
  community?: ResearchCommunity;
  onOpenCommunity: (communityId: string) => void;
  profiles: Record<string, ResearchProfile>;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onCommentAction: CommentActionHandler;
  onQuote: QuoteActionHandler;
  onOpenQuote: QuoteActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  onOpenAttachmentPreview: CommentAttachmentPreviewHandler;
  actorHandle: string;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const authorProfile = profileForHandle(profiles, activity.comment.authorHandle ?? activity.comment.author);
  const authorName = authorProfile?.name ?? activity.comment.author;
  const commentDeleted = isDeletedComment(activity.comment);
  const interactionLocked = !communityPostIsInteractive(activity.item);
  const openComment = () => {
    if (activity.comment.id && !commentDeleted && !interactionLocked) {
      onCommentAction(activity.item.id, activity.comment.id, "read", { trigger: "click", surface: "profile" });
    }
    onSelect(activity.item.id, activity.comment.id ?? null);
  };

  useQualifiedView(cardRef, {
    disabled: commentDeleted || interactionLocked || !activity.comment.id,
    targetKey: activity.comment.id,
    onView: () => {
      if (activity.comment.id) {
        onCommentAction(activity.item.id, activity.comment.id, "read", { trigger: "visibility", surface: "profile" });
      }
    }
  });

  return (
    <article
      ref={cardRef}
      className={`profile-comment-card ${postToneClassName(postToneForItem(activity.item))}`}
      role="button"
      tabIndex={0}
      onClick={openComment}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openComment();
        }
      }}
    >
      <header>
        <CanonicalLink
          route={{ kind: "profile", handle: authorProfile?.handle ?? activity.comment.authorHandle ?? activity.comment.author }}
          onNavigate={() => onOpenProfile(authorProfile?.handle ?? activity.comment.authorHandle ?? activity.comment.author)}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <span className="avatar small">
            {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
          </span>
          <span>
            <strong>{authorName}</strong>
            <small>{relativeTimeLabel(activity.comment.createdAt, "Comment")}</small>
          </span>
        </CanonicalLink>
        <div className="profile-comment-header-actions">
          {community ? (
            <CommunityActivityBadge
              community={community}
              onOpenCommunity={onOpenCommunity}
              onClick={(event) => event.stopPropagation()}
              compact
              className="profile-community-provenance"
            />
          ) : null}
          <span>
            <MessageCircle size={15} />
            {activity.label}
          </span>
          {!interactionLocked ? <CommentOwnerControls
            itemId={activity.item.id}
            comment={activity.comment}
            actorHandle={actorHandle}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
          /> : null}
        </div>
      </header>
      <SymposiumDocumentRenderer
        document={activity.comment.document}
        body={activity.comment.body}
        attachments={commentDeleted ? [] : activity.comment.attachments ?? []}
        profiles={profiles}
        mode="comment"
        onOpenAttachment={(attachmentId) => {
          if (activity.comment.id && !commentDeleted) {
            onOpenAttachmentPreview(activity.item.id, activity.comment.id, attachmentId);
          }
        }}
        onExpand={() => {
          if (activity.comment.id && !interactionLocked) {
            onCommentAction(activity.item.id, activity.comment.id, "read", { trigger: "expand", surface: "profile" });
          }
        }}
      />
      {activity.comment.id && !commentDeleted ? (
        <AttachmentCarousel
          attachments={appendedContentAttachments(activity.comment.document, activity.comment.attachments ?? [])}
          label="Comment attachments"
          variant="comment"
          onOpenPreview={(attachmentId) =>
            onOpenAttachmentPreview(activity.item.id, activity.comment.id as string, attachmentId)
          }
        />
      ) : null}
      {activity.comment.quote ? (
        <ContentQuoteCard
          quote={activity.comment.quote}
          profiles={profiles}
          onOpen={activity.comment.quote.available ? () => onOpenQuote({
            sourceType: activity.comment.quote!.sourceType,
            sourceId: activity.comment.quote!.sourceId,
            sourcePostId: activity.comment.quote!.sourcePostId
          }) : undefined}
        />
      ) : null}
      <CommentActions
        comment={activity.comment}
        itemId={activity.item.id}
        actorHandle={actorHandle}
        onAction={onCommentAction}
        onQuote={() => activity.comment.id && onQuote({
          sourceType: "comment",
          sourceId: activity.comment.id,
          sourcePostId: activity.item.id
        })}
        options={{ disabled: interactionLocked }}
      />
      <footer>
        <span>On</span>
        <CanonicalLink
          route={{
            kind: "post",
            postId: activity.item.id,
            commentId: activity.comment.id ?? undefined
          }}
          onNavigate={openComment}
          onClick={(event) => event.stopPropagation()}
        >
          <strong>{deletedPostContextTitle(activity.item)}</strong>
        </CanonicalLink>
        {activity.comment.createdAt ? <em>{localDateTimeLabel(activity.comment.createdAt)}</em> : null}
        {activity.comment.editedAt ? (
          <em>Edited {relativeTimeLabel(activity.comment.editedAt)} · {localDateTimeLabel(activity.comment.editedAt)}</em>
        ) : null}
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
                <CanonicalLink
                  key={handle}
                  route={{ kind: "profile", handle }}
                  onNavigate={() => onOpenProfile(handle)}
                >
                  <span className="avatar small">
                    {person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initial(person?.name ?? handle)}
                  </span>
                  <span>
                    <strong>{person?.name ?? handle}</strong>
                    <small>{handle}</small>
                  </span>
                </CanonicalLink>
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

export function ProfileSettingsModal({
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
