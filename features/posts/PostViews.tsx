"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent
} from "react";
import {
  ArrowLeft,
  Bookmark,
  Eye,
  MessageCircle,
  Paperclip,
  Pencil,
  Repeat2,
  ThumbsUp,
  Trash2,
  X
} from "lucide-react";
import type { PostAction } from "@/lib/dataStore";
import {
  profile,
  type InquiryAttachment,
  type InquiryComment,
  type InquiryItem,
  type ResearchProfile,
  type Room
} from "@/lib/mockData";
import {
  formatAttachmentBytes,
  maxPostAttachments,
  postAttachmentAccept
} from "@/lib/attachmentRules";
import {
  cleanHandle,
  countComments,
  deletedMetricLabel,
  deletedPostContextTitle,
  formatMetric,
  hasHandle,
  isDeletedPost,
  isSavedBy,
  localDateTimeLabel,
  metricNumber,
  relativeTimeLabel
} from "@/lib/symposiumCore";
import type {
  CommentActionHandler,
  PostActionHandler,
  ViewSurface
} from "@/features/actions/actionTypes";
import {
  PostAttachmentCarousel,
  attachmentIcon,
  type AttachmentPreviewHandler
} from "@/features/attachments/AttachmentViews";
import {
  CommentComposer,
  CommentThread,
  type CommentSegmentStacks
} from "@/features/comments/CommentThread";
import { ExpandableBodyText } from "@/features/content/ExpandableBodyText";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import { useQualifiedView } from "@/features/live-sync/useQualifiedView";

export type PostDraft = {
  title: string;
  body: string;
  kind: Extract<InquiryItem["kind"], "paper" | "thought">;
  attachments: InquiryAttachment[];
};

export const commentsSectionTargetId = "__symposium-comments-section__";
export const kindLabels: Record<InquiryItem["kind"], string> = {
  paper: "Paper",
  thought: "Thought",
  draft: "Draft",
  note: "Note",
  code: "Code"
};
const initial = profileInitials;

const postKindOptions: PostDraft["kind"][] = ["thought", "paper"];

export function PostComposerModal({
  onClose,
  onCreatePost,
  onUploadAttachment
}: {
  onClose: () => void;
  onCreatePost: (draft: PostDraft) => Promise<boolean>;
  onUploadAttachment: (file: File) => Promise<InquiryAttachment>;
}) {
  const [kind, setKind] = useState<PostDraft["kind"]>("thought");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<InquiryAttachment[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  const submitPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle || !cleanBody || uploading) return;

    const saved = await onCreatePost({ title: cleanTitle, body: cleanBody, kind, attachments });
    if (!saved) return;
    setTitle("");
    setBody("");
    setKind("thought");
    setAttachments([]);
    setAttachmentStatus("");
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const openSlots = maxPostAttachments - attachments.length;
    const selectedFiles = files.slice(0, Math.max(0, openSlots));
    if (!selectedFiles.length) {
      setAttachmentStatus(`Attachment limit reached (${maxPostAttachments})`);
      return;
    }

    setUploading(true);
    setAttachmentStatus(`Uploading ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}`);
    try {
      const uploaded: InquiryAttachment[] = [];
      for (const file of selectedFiles) {
        uploaded.push(await onUploadAttachment(file));
      }
      setAttachments((current) => [...current, ...uploaded].slice(0, maxPostAttachments));
      setAttachmentStatus(`${uploaded.length} file${uploaded.length === 1 ? "" : "s"} attached`);
    } catch (error) {
      setAttachmentStatus(error instanceof Error ? error.message : "Could not attach this file.");
    } finally {
      setUploading(false);
    }
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
          <button type="submit" disabled={uploading}>Post</button>
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
        <div className="composer-attachments">
          <label className="attachment-picker">
            <Paperclip size={16} />
            <span>{attachments.length}/{maxPostAttachments}</span>
            <input
              type="file"
              multiple
              accept={postAttachmentAccept}
              disabled={uploading || attachments.length >= maxPostAttachments}
              onChange={uploadFiles}
            />
          </label>
          {attachmentStatus ? <small>{attachmentStatus}</small> : null}
          {attachments.length ? (
            <div className="composer-attachment-list">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="composer-attachment-chip">
                  {attachmentIcon(attachment)}
                  <span>{attachment.fileName}</span>
                  <small>{formatAttachmentBytes(attachment.byteSize)}</small>
                  <button
                    type="button"
                    title="Remove attachment"
                    disabled={uploading}
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export function PostEditModal({
  item,
  onClose,
  onSave,
  onDelete
}: {
  item: InquiryItem;
  onClose: () => void;
  onSave: (itemId: string, draft: { title: string; body: string }) => void;
  onDelete: (itemId: string) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(item.id, { title, body });
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-edit-modal" onSubmit={submitEdit} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>Edit post</span>
            <strong>{kindLabels[item.kind]}</strong>
          </div>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="composer-topline">
          <button className="danger-action" type="button" onClick={() => onDelete(item.id)}>
            <Trash2 size={16} />
            Delete
          </button>
          <button type="submit">Save</button>
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

export function CommentEditModal({
  item,
  comment,
  onClose,
  onSave,
  onDelete
}: {
  item: InquiryItem;
  comment: InquiryComment;
  onClose: () => void;
  onSave: (itemId: string, commentId: string, body: string) => void;
  onDelete: (itemId: string, commentId: string) => void;
}) {
  const [body, setBody] = useState(comment.body);

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!comment.id) return;
    onSave(item.id, comment.id, body);
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-edit-modal comment-edit-modal" onSubmit={submitEdit} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>Edit comment</span>
            <strong>On {deletedPostContextTitle(item)}</strong>
          </div>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="composer-topline">
          <button className="danger-action" type="button" onClick={() => comment.id && onDelete(item.id, comment.id)}>
            <Trash2 size={16} />
            Delete
          </button>
          <button type="submit">Save</button>
        </div>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write the comment"
        />
      </form>
    </div>
  );
}

function PostTimeFooter({ item }: { item: InquiryItem }) {
  if (isDeletedPost(item)) return null;

  const created = localDateTimeLabel(item.createdAt);
  const edited = localDateTimeLabel(item.editedAt);

  if (!created && !edited) return null;

  return (
    <footer className="post-time-footer">
      {created ? <span>Posted {created}</span> : null}
      {edited ? <span>Edited {relativeTimeLabel(item.editedAt)} · {edited}</span> : null}
    </footer>
  );
}

function PostOwnerControls({
  item,
  actorHandle,
  onEditPost,
  onDeletePost
}: {
  item: InquiryItem;
  actorHandle: string;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
}) {
  if (isDeletedPost(item) || cleanHandle(item.authorHandle ?? item.author) !== actorHandle) return null;

  return (
    <div className="post-owner-actions" aria-label="Post owner actions">
      <button
        type="button"
        title="Edit post"
        onClick={(event) => {
          event.stopPropagation();
          onEditPost(item);
        }}
      >
        <Pencil size={16} />
      </button>
      <button
        type="button"
        title="Delete post"
        onClick={(event) => {
          event.stopPropagation();
          onDeletePost(item.id);
        }}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export function FeedPost({
  item,
  onSelect,
  onOpenProfile,
  onAction,
  onEditPost,
  onDeletePost,
  onOpenAttachmentPreview,
  actorHandle,
  profiles,
  surface = "feed"
}: {
  item: InquiryItem;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  surface?: ViewSurface;
}) {
  const postRef = useRef<HTMLElement | null>(null);
  const openPost = () => onSelect(item.id);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPost();
    }
  };
  useQualifiedView(postRef, {
    disabled: isDeletedPost(item),
    targetKey: item.id,
    onView: () => onAction(item.id, "read", { trigger: "visibility", surface })
  });

  return (
    <article
      ref={postRef}
      className={`feed-post post-kind-${item.kind}`}
      data-testid={`feed-card-${item.id}`}
      role="button"
      tabIndex={0}
      onClick={openPost}
      onKeyDown={onKeyDown}
    >
      <PostOwnerControls item={item} actorHandle={actorHandle} onEditPost={onEditPost} onDeletePost={onDeletePost} />
      <PostAuthor
        item={item}
        profiles={profiles}
        onOpenProfile={onOpenProfile}
        onClickStop={(event) => event.stopPropagation()}
      />
      <div className="post-body">
        <h2>{deletedPostContextTitle(item)}</h2>
        <ExpandableBodyText
          text={item.body}
          className="feed-post-text"
          onExpand={() => onAction(item.id, "read", { trigger: "expand", surface })}
        />
        <PostAttachmentCarousel item={item} onOpenPreview={onOpenAttachmentPreview} />
        <PostTimeFooter item={item} />
        <SocialActions
          item={item}
          commentCount={countComments(item.comments)}
          onAction={onAction}
          onCommentsClick={() => onSelect(item.id, commentsSectionTargetId)}
          actorHandle={actorHandle}
        />
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
  if (isDeletedPost(item)) {
    return (
      <div className="post-author deleted-post-author" aria-label="Deleted post">
        <span className="avatar deleted-avatar" aria-hidden="true" />
        <span>
          <strong aria-hidden="true">—</strong>
        </span>
      </div>
    );
  }

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
  onCommentsClick,
  actorHandle
}: {
  item: InquiryItem;
  commentCount: number;
  onAction: PostActionHandler;
  onCommentsClick?: () => void;
  actorHandle: string;
}) {
  const postDeleted = isDeletedPost(item);
  const savedByActor = isSavedBy(item, actorHandle, profile.handle);
  const signaledByActor = hasHandle(item.signaledBy, actorHandle);
  const forkedByActor = hasHandle(item.forkedBy, actorHandle);
  const actions = [
    { label: "Likes", active: !postDeleted && signaledByActor, value: postDeleted ? deletedMetricLabel : item.metrics.signal, icon: ThumbsUp, action: "signal" as PostAction },
    { label: "Comments", value: postDeleted ? deletedMetricLabel : String(commentCount), icon: MessageCircle, action: null },
    { label: "Reshares", active: !postDeleted && forkedByActor, value: postDeleted ? deletedMetricLabel : item.metrics.forks, icon: Repeat2, action: "fork" as PostAction },
    { label: "Saves", active: !postDeleted && savedByActor, value: postDeleted ? deletedMetricLabel : item.metrics.saves, icon: Bookmark, action: "save" as PostAction },
    { label: "Views", value: postDeleted ? deletedMetricLabel : item.metrics.reads, icon: Eye, action: null }
  ];

  return (
    <div className="social-actions" aria-label="Post actions">
      {actions.map((action) => {
        const Icon = action.icon;
        const fillActiveIcon = action.active && (action.label === "Likes" || action.label === "Saves");
        const disabled = postDeleted && Boolean(action.action);
        const metricValue = action.value === deletedMetricLabel ? deletedMetricLabel : formatMetric(metricNumber(action.value));
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            className={action.active ? "active" : ""}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (action.action && !postDeleted) onAction(item.id, action.action);
              else if (action.label === "Comments") onCommentsClick?.();
            }}
          >
            <Icon size={16} fill={fillActiveIcon ? "currentColor" : "none"} />
            <span className="metric-label">{action.label}</span>
            <strong>{metricValue}</strong>
          </button>
        );
      })}
    </div>
  );
}

export function DetailView({
  item,
  room,
  onBack,
  onOpenProfile,
  onAddComment,
  onAction,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  onEditPost,
  onDeletePost,
  actorHandle,
  profiles,
  selectedCommentId,
  onClearSelectedComment,
  commentSegmentStacks,
  onCommentSegmentStackChange,
  onVisibleCommentSegmentStackChange,
  onOpenAttachmentPreview
}: {
  item: InquiryItem;
  room: Room;
  onBack: () => void;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onAction: PostActionHandler;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onClearSelectedComment: () => void;
  commentSegmentStacks: CommentSegmentStacks;
  onCommentSegmentStackChange: (key: string, stack: string[]) => void;
  onVisibleCommentSegmentStackChange: (key: string, stack: string[]) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
}) {
  const isPaper = item.kind === "paper";
  const postDeleted = isDeletedPost(item);
  const detailRef = useRef<HTMLElement | null>(null);
  const doiSlug = item.id.replace(/[^a-z0-9]+/gi, ".").replace(/\.+/g, ".").replace(/\.$/, "");
  const codeSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44);
  const authorProfile = profileForHandle(profiles, item.authorHandle ?? item.author);
  const authorName = authorProfile?.name ?? item.author;
  const commentsSectionId = `comments-${item.id}`;
  const scrollToComments = () => {
    document.getElementById(commentsSectionId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const threadSelectedCommentId = selectedCommentId === commentsSectionTargetId ? null : selectedCommentId;

  useEffect(() => {
    if (selectedCommentId !== commentsSectionTargetId) return;
    window.requestAnimationFrame(scrollToComments);
  }, [selectedCommentId, item.id]);

  useEffect(() => {
    if (!threadSelectedCommentId) return;

    const scrollToSelectedComment = () => {
      document
        .getElementById(`comment-${threadSelectedCommentId}`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    };

    window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToSelectedComment));
    const shortTimer = window.setTimeout(scrollToSelectedComment, 120);
    const settledTimer = window.setTimeout(scrollToSelectedComment, 320);

    return () => {
      window.clearTimeout(shortTimer);
      window.clearTimeout(settledTimer);
    };
  }, [commentSegmentStacks, item.id, threadSelectedCommentId]);

  useQualifiedView(detailRef, {
    disabled: postDeleted,
    targetKey: item.id,
    onView: () => onAction(item.id, "read", { trigger: "visibility", surface: "detail" })
  });

  return (
    <article className={`detail-layout ${isPaper ? "paper-detail" : "simple-detail"}`}>
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back to {room.feedLabel}
      </button>

      <section className="detail-main" ref={detailRef}>
        <PostOwnerControls item={item} actorHandle={actorHandle} onEditPost={onEditPost} onDeletePost={onDeletePost} />
        <p className="eyebrow">{kindLabels[item.kind]}</p>
        <h1>{deletedPostContextTitle(item)}</h1>
        {postDeleted ? (
          <div className="detail-byline-button deleted-post-author" aria-label="Deleted post">
            <span className="avatar deleted-avatar" aria-hidden="true" />
            <span>
              <strong aria-hidden="true">—</strong>
            </span>
          </div>
        ) : (
          <button className="detail-byline-button" type="button" onClick={() => onOpenProfile(authorProfile?.handle ?? item.authorHandle ?? item.author)}>
            <span className="avatar">
              {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
            </span>
            <span>
              <strong>{authorName}</strong>
              <small>{relativeTimeLabel(item.createdAt, item.date)}</small>
            </span>
          </button>
        )}
        <p className="detail-body">{item.body}</p>
        <PostAttachmentCarousel item={item} onOpenPreview={onOpenAttachmentPreview} variant="detail" />
        <PostTimeFooter item={item} />
        <SocialActions
          item={item}
          commentCount={countComments(item.comments)}
          onAction={onAction}
          onCommentsClick={scrollToComments}
          actorHandle={actorHandle}
        />

        <section className="comments-section" id={commentsSectionId}>
          <h2>Discussion</h2>
          {postDeleted ? null : <CommentComposer itemId={item.id} onAddComment={onAddComment} />}
          <CommentThread
            comments={item.comments}
            itemId={item.id}
            profiles={profiles}
            selectedCommentId={threadSelectedCommentId}
            onOpenProfile={onOpenProfile}
            onAddComment={onAddComment}
            onCommentAction={onCommentAction}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
            actorHandle={actorHandle}
            onClearSelectedComment={onClearSelectedComment}
            commentSegmentStacks={commentSegmentStacks}
            onCommentSegmentStackChange={onCommentSegmentStackChange}
            onVisibleCommentSegmentStackChange={onVisibleCommentSegmentStackChange}
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
