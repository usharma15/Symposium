"use client";

import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  Bookmark,
  Eye,
  MessageCircle,
  Pencil,
  Repeat2,
  ThumbsUp,
  Trash2
} from "lucide-react";
import type { CommentAction } from "@/lib/dataStore";
import type { InquiryComment, ResearchProfile } from "@/lib/mockData";
import {
  cleanHandle,
  commentActionActive,
  commentMetricsFallback,
  countComments,
  deletedMetricLabel,
  findCommentInTree,
  formatMetric,
  isDeletedComment,
  localDateTimeLabel,
  metricNumber,
  relativeTimeLabel
} from "@/lib/symposiumCore";
import type { CommentActionHandler } from "@/features/actions/actionTypes";
import { ExpandableBodyText } from "@/features/content/ExpandableBodyText";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import { useQualifiedView } from "@/features/live-sync/useQualifiedView";

export type CommentSegmentStacks = Record<string, string[]>;

const maxVisibleCommentPathLength = 6;
const commentSegmentStackKey = (itemId: string, rootCommentId?: string | null) =>
  `${itemId}:${rootCommentId ?? "root-comment"}`;
const commentRootStackKey = (itemId: string, comment: InquiryComment, index: number) =>
  commentSegmentStackKey(
    itemId,
    comment.id ??
      `root-${index}-${comment.createdAt ?? "seeded"}-${comment.authorHandle ?? comment.author}-${comment.body
        .replace(/\s+/g, " ")
        .slice(0, 80)}`
  );
const findCommentById = (comments: InquiryComment[], id: string) =>
  findCommentInTree(comments, id) ?? undefined;
const findCommentPathById = (comments: InquiryComment[], id: string): InquiryComment[] | null => {
  for (const comment of comments) {
    if (comment.id === id) return [comment];
    const childPath = findCommentPathById(comment.replies ?? [], id);
    if (childPath) return [comment, ...childPath];
  }
  return null;
};
const initial = profileInitials;

export function CommentOwnerControls({
  itemId,
  comment,
  actorHandle,
  onEditComment,
  onDeleteComment
}: {
  itemId: string;
  comment: InquiryComment;
  actorHandle: string;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
}) {
  if (
    !comment.id ||
    isDeletedComment(comment) ||
    cleanHandle(comment.authorHandle ?? comment.author) !== actorHandle
  ) {
    return null;
  }

  return (
    <div className="comment-owner-actions" aria-label="Comment owner actions">
      <button
        type="button"
        title="Edit comment"
        onClick={(event) => {
          event.stopPropagation();
          onEditComment(itemId, comment.id as string);
        }}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        title="Delete comment"
        onClick={(event) => {
          event.stopPropagation();
          onDeleteComment(itemId, comment.id as string);
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function CommentComposer({
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

export function CommentThread({
  comments,
  itemId,
  profiles,
  selectedCommentId,
  onOpenProfile,
  onAddComment,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  actorHandle,
  onClearSelectedComment,
  commentSegmentStacks,
  onCommentSegmentStackChange,
  onVisibleCommentSegmentStackChange,
  depth = 0
}: {
  comments: InquiryComment[];
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
  onClearSelectedComment: () => void;
  commentSegmentStacks: CommentSegmentStacks;
  onCommentSegmentStackChange: (key: string, stack: string[]) => void;
  onVisibleCommentSegmentStackChange: (key: string, stack: string[]) => void;
  depth?: number;
}) {
  return (
    <div className={`comment-thread depth-${depth}`}>
      {comments.map((comment, index) => {
        const rootStackKey = commentRootStackKey(itemId, comment, index);
        return (
          <CommentRootSegment
            key={rootStackKey}
            rootStackKey={rootStackKey}
            comment={comment}
            itemId={itemId}
            profiles={profiles}
            selectedCommentId={selectedCommentId}
            onOpenProfile={onOpenProfile}
            onAddComment={onAddComment}
            onCommentAction={onCommentAction}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
            actorHandle={actorHandle}
            onClearSelectedComment={onClearSelectedComment}
            segmentStack={commentSegmentStacks[rootStackKey] ?? null}
            onSegmentStackChange={(stack) => onCommentSegmentStackChange(rootStackKey, stack)}
            onVisibleSegmentStackChange={(stack) => onVisibleCommentSegmentStackChange(rootStackKey, stack)}
            depth={depth}
          />
        );
      })}
    </div>
  );
}

function segmentStackForSelectedComment(root: InquiryComment, selectedCommentId: string | null) {
  if (!selectedCommentId) return [];
  const path = findCommentPathById([root], selectedCommentId);
  if (!path) return [];

  const stack: string[] = [];
  let segmentRootIndex = 0;
  while (path.length - segmentRootIndex > maxVisibleCommentPathLength) {
    segmentRootIndex += maxVisibleCommentPathLength - 1;
    const segmentRootId = path[segmentRootIndex]?.id;
    if (!segmentRootId) break;
    stack.push(segmentRootId);
  }

  return stack;
}

function CommentRootSegment({
  rootStackKey,
  comment,
  itemId,
  profiles,
  selectedCommentId,
  onOpenProfile,
  onAddComment,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  actorHandle,
  onClearSelectedComment,
  segmentStack,
  onSegmentStackChange,
  onVisibleSegmentStackChange,
  depth
}: {
  rootStackKey: string;
  comment: InquiryComment;
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
  onClearSelectedComment: () => void;
  segmentStack: string[] | null;
  onSegmentStackChange: (stack: string[]) => void;
  onVisibleSegmentStackChange: (stack: string[]) => void;
  depth: number;
}) {
  const segmentRef = useRef<HTMLDivElement | null>(null);
  const pendingSegmentScrollRef = useRef(false);
  const selectedCommentRouteRef = useRef<string | null>(null);
  const selectedSegmentStack = segmentStackForSelectedComment(comment, selectedCommentId);
  const visibleSegmentStack = segmentStack ?? selectedSegmentStack;
  const activeSegmentId = visibleSegmentStack.at(-1);
  const activeComment = activeSegmentId ? findCommentById([comment], activeSegmentId) ?? comment : comment;

  useEffect(() => {
    if (!selectedCommentId) {
      selectedCommentRouteRef.current = null;
      return;
    }
    const selectedRoute = `${rootStackKey}:${selectedCommentId}`;
    if (selectedCommentRouteRef.current === selectedRoute) return;
    selectedCommentRouteRef.current = selectedRoute;
    const selectedStack = segmentStackForSelectedComment(comment, selectedCommentId);
    const currentStack = segmentStack ?? [];
    if (selectedStack.join("|") === currentStack.join("|")) return;
    onSegmentStackChange(selectedStack);
  }, [comment, onSegmentStackChange, rootStackKey, selectedCommentId, segmentStack]);

  useLayoutEffect(() => {
    onVisibleSegmentStackChange(visibleSegmentStack);
  }, [onVisibleSegmentStackChange, visibleSegmentStack]);

  useLayoutEffect(() => {
    if (!pendingSegmentScrollRef.current || !segmentRef.current) return;
    pendingSegmentScrollRef.current = false;
    segmentRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [visibleSegmentStack]);

  const openReplySegment = (commentId: string) => {
    onClearSelectedComment();
    pendingSegmentScrollRef.current = true;
    if (visibleSegmentStack.at(-1) === commentId) return;
    onSegmentStackChange([...visibleSegmentStack, commentId]);
  };

  const showPreviousSegment = () => {
    onClearSelectedComment();
    pendingSegmentScrollRef.current = true;
    onSegmentStackChange(visibleSegmentStack.slice(0, -1));
  };

  return (
    <div
      className="comment-segment"
      ref={segmentRef}
      data-comment-segment-key={rootStackKey}
      data-comment-segment-stack={JSON.stringify(visibleSegmentStack)}
    >
      <CommentNode
        comment={activeComment}
        itemId={itemId}
        profiles={profiles}
        selectedCommentId={selectedCommentId}
        onOpenProfile={onOpenProfile}
        onAddComment={onAddComment}
        onCommentAction={onCommentAction}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        actorHandle={actorHandle}
        depth={depth}
        segmentDepth={1}
        onOpenReplySegment={openReplySegment}
        onClearSelectedComment={onClearSelectedComment}
        leadingAction={
          visibleSegmentStack.length ? (
            <button
              className="reply-window-button reply-window-button-previous"
              type="button"
              onClick={showPreviousSegment}
            >
              Show previous replies
            </button>
          ) : null
        }
      />
    </div>
  );
}

function CommentNode({
  comment,
  itemId,
  profiles,
  selectedCommentId,
  onOpenProfile,
  onAddComment,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  actorHandle,
  depth,
  segmentDepth,
  onOpenReplySegment,
  onClearSelectedComment,
  leadingAction
}: {
  comment: InquiryComment;
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
  depth: number;
  segmentDepth: number;
  onOpenReplySegment: (commentId: string) => void;
  onClearSelectedComment: () => void;
  leadingAction?: ReactNode;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const replies = comment.replies ?? [];
  const nodeRef = useRef<HTMLElement | null>(null);
  const commentDeleted = isDeletedComment(comment);
  const authorProfile = profileForHandle(profiles, comment.authorHandle ?? comment.author);
  const authorName = authorProfile?.name ?? comment.author;
  const highlighted = Boolean(selectedCommentId && comment.id === selectedCommentId);
  const canShowReplies = segmentDepth < maxVisibleCommentPathLength;
  const shouldHideReplies = replies.length > 0 && !canShowReplies;

  useQualifiedView(nodeRef, {
    disabled: commentDeleted || !comment.id,
    targetKey: comment.id,
    onView: () => {
      if (comment.id) onCommentAction(itemId, comment.id, "read", { trigger: "visibility", surface: "thread" });
    }
  });

  useLayoutEffect(() => {
    if (!highlighted) return;
    window.requestAnimationFrame(() => {
      nodeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [highlighted, selectedCommentId]);

  return (
    <article
      ref={nodeRef}
      id={comment.id ? `comment-${comment.id}` : undefined}
      className="comment"
      data-testid={comment.id ? `comment-${comment.id}` : undefined}
      data-item-id={itemId}
      data-comment-id={comment.id}
    >
      {leadingAction ? <div className="comment-leading-action">{leadingAction}</div> : null}
      <div className={`comment-card ${highlighted ? "highlighted" : ""}`}>
        {commentDeleted ? (
          <div className="comment-author deleted-comment-author" aria-label="Deleted comment">
            <span className="avatar small deleted-avatar" aria-hidden="true" />
            <span>
              <strong aria-hidden="true">—</strong>
            </span>
          </div>
        ) : (
          <button type="button" className="comment-author" onClick={() => onOpenProfile(authorProfile?.handle ?? comment.authorHandle ?? comment.author)}>
            <span className="avatar small">
              {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
            </span>
            <span>
              <strong>{authorName}</strong>
              {comment.createdAt ? <small>{relativeTimeLabel(comment.createdAt)}</small> : null}
            </span>
          </button>
        )}
        <CommentOwnerControls
          itemId={itemId}
          comment={comment}
          actorHandle={actorHandle}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
        />
        <ExpandableBodyText
          text={comment.body}
          className="comment-text"
          onExpand={() => {
            if (comment.id && !commentDeleted) {
              onCommentAction(itemId, comment.id, "read", { trigger: "expand", surface: "thread" });
            }
          }}
        />
        <CommentTimeFooter comment={comment} />
        <CommentActions
          comment={comment}
          itemId={itemId}
          actorHandle={actorHandle}
          onAction={onCommentAction}
        />
        {commentDeleted ? null : (
          <>
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
          </>
        )}
      </div>
      {shouldHideReplies ? (
        <div className="reply-window">
          {comment.id ? (
            <button
              className="reply-window-button"
              type="button"
              onClick={() => onOpenReplySegment(comment.id as string)}
            >
              Show more replies
            </button>
          ) : null}
        </div>
      ) : replies.length ? (
        <div className="reply-window">
          <div className={`comment-thread depth-${depth + 1}`}>
            {replies.map((reply) => (
              <CommentNode
                key={reply.id ?? `${reply.author}-${reply.stance}-${reply.body}`}
                comment={reply}
                itemId={itemId}
                profiles={profiles}
                selectedCommentId={selectedCommentId}
                onOpenProfile={onOpenProfile}
                onAddComment={onAddComment}
                onCommentAction={onCommentAction}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                actorHandle={actorHandle}
                depth={depth + 1}
                segmentDepth={segmentDepth + 1}
                onOpenReplySegment={onOpenReplySegment}
                onClearSelectedComment={onClearSelectedComment}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CommentTimeFooter({ comment }: { comment: InquiryComment }) {
  if (isDeletedComment(comment)) return null;

  const created = localDateTimeLabel(comment.createdAt);
  const edited = localDateTimeLabel(comment.editedAt);
  if (!created && !edited) return null;

  return (
    <footer className="comment-time-footer">
      {created ? <span>Posted {created}</span> : null}
      {edited ? <span>Edited {relativeTimeLabel(comment.editedAt)} · {edited}</span> : null}
    </footer>
  );
}

export function CommentActions({
  comment,
  itemId,
  actorHandle,
  onAction
}: {
  comment: InquiryComment;
  itemId: string;
  actorHandle: string;
  onAction: (itemId: string, commentId: string, action: CommentAction) => void;
}) {
  if (!comment.id) return null;

  const deleted = isDeletedComment(comment);
  const metrics = { ...commentMetricsFallback, ...(comment.metrics ?? {}) };
  const actions = [
    { label: "Likes", active: commentActionActive(comment, "signal", actorHandle), value: deleted ? deletedMetricLabel : metrics.signal, icon: ThumbsUp, action: "signal" as CommentAction },
    { label: "Comments", value: deleted ? deletedMetricLabel : String(countComments(comment.replies ?? [])), icon: MessageCircle, action: null },
    { label: "Reshares", active: commentActionActive(comment, "fork", actorHandle), value: deleted ? deletedMetricLabel : metrics.forks, icon: Repeat2, action: "fork" as CommentAction },
    { label: "Saves", active: commentActionActive(comment, "save", actorHandle), value: deleted ? deletedMetricLabel : metrics.saves, icon: Bookmark, action: "save" as CommentAction },
    { label: "Views", value: deleted ? deletedMetricLabel : metrics.reads, icon: Eye, action: null }
  ];

  return (
    <div className="comment-actions" aria-label="Comment actions">
      {actions.map((action) => {
        const Icon = action.icon;
        const fillActiveIcon = action.active && (action.label === "Likes" || action.label === "Saves");
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            className={`${action.active ? "active" : ""}${deleted ? " disabled" : ""}`}
            disabled={deleted || !action.action}
            onClick={(event) => {
              event.stopPropagation();
              if (!deleted && action.action) onAction(itemId, comment.id as string, action.action);
            }}
          >
            <Icon size={15} fill={fillActiveIcon ? "currentColor" : "none"} />
            <span>{action.label}</span>
            <strong>{deleted ? deletedMetricLabel : formatMetric(metricNumber(action.value))}</strong>
          </button>
        );
      })}
    </div>
  );
}
