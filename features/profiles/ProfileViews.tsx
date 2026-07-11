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
import type { CanonicalActionActivityContract, ToggleActionContract } from "@/packages/contracts/src";
import {
  profile,
  type InquiryComment,
  type InquiryItem,
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
  itemMatchesProfilePostAction,
  reconcileProfileActivitySlots,
  selectProfileActivitySlots,
  uniqueProfileActivityEntries
} from "@/lib/profileActivity";
import type { CommentActionHandler, PostActionHandler } from "@/features/actions/actionTypes";
import type { AttachmentPreviewHandler } from "@/features/attachments/AttachmentViews";
import { CommentActions, CommentOwnerControls } from "@/features/comments/CommentThread";
import { ExpandableBodyText } from "@/features/content/ExpandableBodyText";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import { FeedPost } from "@/features/posts/PostViews";
import { useQualifiedView } from "@/features/live-sync/useQualifiedView";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";
import type { ProfileSocialView } from "@/features/navigation/canonicalRoute";

export type ProfileTab = "all" | "papers" | "thoughts" | "comments" | "reshares" | "likes" | "saved";
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
  onActiveTabChange,
  onSocialViewChange,
  onEditPost,
  onDeletePost,
  onOpenAttachmentPreview
}: {
  person: ResearchProfile;
  items: InquiryItem[];
  isOwnProfile: boolean;
  isFollowing: boolean;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onCommentAction: CommentActionHandler;
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
  onActiveTabChange: (tab: ProfileTab) => void;
  onSocialViewChange: (view: ProfileSocialView | null) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
}) {
  const [visibleSlots, setVisibleSlots] = useState<ProfileActivitySlot[]>([]);
  const visibleSlotContextRef = useRef("");
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
  const canonicalPostActionActive = (item: InquiryItem, action: ToggleActionContract) => {
    if (!canonicalActivityLoaded) {
      return itemMatchesProfilePostAction(item, person, action, profile.handle);
    }
    return Boolean(canonicalActionState(canonicalActivities, "post", item.id, person.handle, action)?.active);
  };
  const canonicalCommentActionMatches = (
    _item: InquiryItem,
    comment: InquiryComment,
    kind: ProfileCommentActivityKind
  ) => {
    if (kind === "comments") return commentAuthoredByProfile(comment, person);
    if (!comment.id) return false;
    if (!canonicalActivityLoaded) return commentMatchesProfileActivity(comment, person, kind);
    return Boolean(canonicalActionState(canonicalActivities, "comment", comment.id, person.handle, kind)?.active);
  };
  const authored = byPublishedRecency(items.filter(isAuthor));
  const papers = authored.filter((item) => item.kind === "paper");
  const thoughts = authored.filter((item) => item.kind === "thought" || item.kind === "note");
  const commentRecency = (item: InquiryItem, comment: InquiryComment, kind: ProfileCommentActivityKind) =>
    getProfileCommentRecency(item, comment, person.handle, kind);
  const commentActivities = collectProfileComments(
    items,
    person,
    "comments",
    commentRecency,
    canonicalCommentActionMatches
  );
  const commentReshares = canShowReshares
    ? collectProfileComments(items, person, "fork", commentRecency, canonicalCommentActionMatches)
    : [];
  const commentLikes = canShowLikes
    ? collectProfileComments(items, person, "signal", commentRecency, canonicalCommentActionMatches)
    : [];
  const commentSaved = canShowSaved
    ? collectProfileComments(items, person, "save", commentRecency, canonicalCommentActionMatches)
    : [];
  const reshares = canShowReshares
    ? byProfileRecency(items.filter((item) => canonicalPostActionActive(item, "fork")), "fork")
    : [];
  const likes = canShowLikes
    ? byProfileRecency(items.filter((item) => canonicalPostActionActive(item, "signal")), "signal")
    : [];
  const saved = canShowSaved
    ? byProfileRecency(
        items.filter((item) => canonicalPostActionActive(item, "save")),
        "save"
      )
    : [];
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
  const allActivity = uniqueProfileActivityEntries(
    [...authoredEntries, ...commentEntries, ...reshareEntries, ...commentReshareEntries],
    (entry) =>
      entry.type === "post"
        ? `post:${entry.item.id}`
        : `comment:${entry.activity.item.id}:${entry.activity.comment.id}`
  );

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

  const nextVisibleSlots = tabEntries[activeTab].map(entryToSlot);
  const visibleSlotContext = `${person.handle}:${activeTab}:${activityRevision}`;
  const visibleSlotMembership = nextVisibleSlots.map((slot) => slot.id).join("|");

  useLayoutEffect(() => {
    const contextChanged = visibleSlotContextRef.current !== visibleSlotContext;
    visibleSlotContextRef.current = visibleSlotContext;
    setVisibleSlots((current) =>
      contextChanged ? nextVisibleSlots : reconcileProfileActivitySlots(current, nextVisibleSlots)
    );
  }, [visibleSlotContext, visibleSlotMembership]);

  const resolveSlot = (slot: ProfileActivitySlot): ProfileActivityEntry | null => {
    const item = items.find((candidate) => candidate.id === slot.itemId);
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
                onCommentAction={onCommentAction}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                actorHandle={actorHandle}
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
                surface="profile"
                onOpenAttachmentPreview={onOpenAttachmentPreview}
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
  profiles,
  onSelect,
  onOpenProfile,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  actorHandle
}: {
  activity: ProfileCommentActivity;
  profiles: Record<string, ResearchProfile>;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const authorProfile = profileForHandle(profiles, activity.comment.authorHandle ?? activity.comment.author);
  const authorName = authorProfile?.name ?? activity.comment.author;
  const commentDeleted = isDeletedComment(activity.comment);
  const openComment = () => {
    if (activity.comment.id && !commentDeleted) {
      onCommentAction(activity.item.id, activity.comment.id, "read", { trigger: "click", surface: "profile" });
    }
    onSelect(activity.item.id, activity.comment.id ?? null);
  };

  useQualifiedView(cardRef, {
    disabled: commentDeleted || !activity.comment.id,
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
      className="profile-comment-card"
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
          <span>
            <MessageCircle size={15} />
            {activity.label}
          </span>
          <CommentOwnerControls
            itemId={activity.item.id}
            comment={activity.comment}
            actorHandle={actorHandle}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
          />
        </div>
      </header>
      <ExpandableBodyText
        text={activity.comment.body}
        className="profile-comment-text"
        onExpand={() => {
          if (activity.comment.id) {
            onCommentAction(activity.item.id, activity.comment.id, "read", { trigger: "expand", surface: "profile" });
          }
        }}
      />
      <CommentActions
        comment={activity.comment}
        itemId={activity.item.id}
        actorHandle={actorHandle}
        onAction={onCommentAction}
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
