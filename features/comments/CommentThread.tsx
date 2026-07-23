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
  BarChart3,
  Eye,
  MessageCircle,
  Link2,
  Pencil,
  Repeat2,
  ThumbsUp,
  Trash2
} from "lucide-react";
import type { CommentAction } from "@/lib/dataStore";
import type { ContentQuoteSource, InquiryAttachment, InquiryComment, ResearchProfile } from "@/lib/mockData";
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
import { SymposiumDocumentEditor, SymposiumDocumentRenderer } from "@/features/content/SymposiumDocument";
import { appendedContentAttachments, emptySymposiumDocument } from "@/lib/documentModel";
import type { VersionedDocumentContract } from "@/packages/contracts/src";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import { useQualifiedView } from "@/features/live-sync/useQualifiedView";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";
import {
  AttachmentCarousel,
  type AttachmentUploadHandler
} from "@/features/attachments/AttachmentViews";
import {
  ContentQuoteCard,
  QuoteActionButton,
  QuoteLinkField,
  type QuoteActionHandler
} from "@/features/quotes/QuoteViews";
import type { AttachedQuote, QuoteLinkResolver } from "@/features/quotes/quoteLinks";
import { canonicalRouteHref } from "@/features/navigation/canonicalRoute";
import { postToneClassName, type PostTone } from "@/lib/postTone";
import {
  attachmentScribbleSource,
  commentScribbleSource,
  ScribbleCitable,
  useScribble
} from "@/features/scribble/ScribbleContext";
import { useCommunityGovernance } from "@/features/communities/CommunityGovernanceContext";
import { ContentAnalyticsDialog } from "@/features/analytics/ContentAnalyticsDialog";
import {
  clearPendingContentAnalytics,
  consumePendingContentAnalytics,
  isPendingContentAnalytics,
  openContentAnalyticsEvent
} from "@/features/analytics/contentAnalyticsNavigation";
import type { ContentAnalyticsViewContract } from "@/packages/contracts/src";

export type CommentSegmentStacks = Record<string, string[]>;
export type CommentThreadOptions = {
  allowQuotes?: boolean;
  allowReplies?: boolean;
  allowReshares?: boolean;
  commentHref?: (itemId: string, commentId: string) => string | null;
  disabled?: boolean;
};
export type AddCommentHandler = (
  itemId: string,
  body: string,
  document: VersionedDocumentContract,
  stance: string,
  parentId: string | null,
  attachments: InquiryAttachment[],
  quoteSource?: ContentQuoteSource
) => Promise<boolean>;
export type CommentAttachmentPreviewHandler = (
  itemId: string,
  commentId: string,
  attachmentId: string
) => void;

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
  const governance = useCommunityGovernance();
  const isAuthor = cleanHandle(comment.authorHandle ?? comment.author) === actorHandle;
  const mayDelete = isAuthor || governance.canModerateComment(itemId);
  const [analyticsView, setAnalyticsView] = useState<ContentAnalyticsViewContract | null>(() => {
    if (typeof window === "undefined" || !isAuthor || !comment.id) return null;
    const pending = consumePendingContentAnalytics({
      subjectType: "comment",
      postId: itemId,
      commentId: comment.id
    });
    if (pending) return pending;
    const parameters = new URLSearchParams(window.location.search);
    const value = parameters.get("analytics");
    return window.location.pathname === `/posts/${encodeURIComponent(itemId)}`
      && parameters.get("comment") === comment.id
      && (value === "likes" || value === "reshares" || value === "quotes" || value === "overview")
      ? value
      : null;
  });
  useEffect(() => {
    if (!isAuthor || !comment.id) return;
    const onOpenAnalytics = (event: Event) => {
      const detail = (event as CustomEvent<{
        postId?: string;
        commentId?: string;
        subjectType?: string;
        view?: string;
      }>).detail;
      if (!isPendingContentAnalytics(detail)) return;
      if (detail?.postId !== itemId || detail.commentId !== comment.id || detail.subjectType !== "comment") return;
      clearPendingContentAnalytics();
      setAnalyticsView(detail.view);
    };
    window.addEventListener(openContentAnalyticsEvent, onOpenAnalytics);
    return () => window.removeEventListener(openContentAnalyticsEvent, onOpenAnalytics);
  }, [comment.id, isAuthor, itemId]);
  if (
    !comment.id ||
    isDeletedComment(comment) ||
    (!isAuthor && !mayDelete)
  ) {
    return null;
  }

  return (
    <>
    <div className="comment-owner-actions" aria-label="Comment owner actions">
      {isAuthor ? <button
        type="button"
        title="View comment analytics"
        aria-label="View comment analytics"
        onClick={(event) => {
          event.stopPropagation();
          setAnalyticsView("overview");
        }}
      >
        <BarChart3 size={14} />
      </button> : null}
      {isAuthor ? <button
        type="button"
        title="Edit comment"
        onClick={(event) => {
          event.stopPropagation();
          onEditComment(itemId, comment.id as string);
        }}
      >
        <Pencil size={14} />
      </button> : null}
      {mayDelete ? <button
        type="button"
        title={isAuthor ? "Delete comment" : "Remove comment from community"}
        onClick={(event) => {
          event.stopPropagation();
          onDeleteComment(itemId, comment.id as string);
        }}
      >
        <Trash2 size={14} />
      </button> : null}
    </div>
    {isAuthor && analyticsView && comment.id ? (
      <ContentAnalyticsDialog
        actorHandle={actorHandle}
        postId={itemId}
        subjectType="comment"
        commentId={comment.id}
        initialView={analyticsView}
        onClose={() => setAnalyticsView(null)}
      />
    ) : null}
    </>
  );
}

export function CommentComposer({
  itemId,
  onAddComment,
  onUploadAttachment,
  onResolveQuoteLink,
  profiles,
  parentId,
  compact = false,
  allowQuotes = true
}: {
  itemId: string;
  onAddComment: AddCommentHandler;
  onUploadAttachment: AttachmentUploadHandler;
  onResolveQuoteLink?: QuoteLinkResolver;
  profiles: Record<string, ResearchProfile>;
  parentId?: string | null;
  compact?: boolean;
  allowQuotes?: boolean;
}) {
  const [body, setBody] = useState("");
  const [documentValue, setDocumentValue] = useState<VersionedDocumentContract>(() => emptySymposiumDocument());
  const [attachments, setAttachments] = useState<InquiryAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attachedQuote, setAttachedQuote] = useState<AttachedQuote | null>(null);

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanBody = body.trim();
    if (!cleanBody || busy || submitting) return;

    setSubmitting(true);
    const saved = await onAddComment(
      itemId,
      cleanBody,
      documentValue,
      "Comment",
      parentId ?? null,
      attachments,
      allowQuotes && attachedQuote
        ? { sourceType: attachedQuote.selection.sourceType, sourceId: attachedQuote.selection.sourceId }
        : undefined
    );
    setSubmitting(false);
    if (saved) {
      setBody("");
      setDocumentValue(emptySymposiumDocument());
      setAttachments([]);
      setAttachedQuote(null);
    }
  };

  return (
    <form className={`comment-composer ${compact ? "compact" : ""}`} onSubmit={submitComment}>
      <div className="comment-composer-actions">
        <button type="submit" disabled={busy || submitting}>{submitting ? "Saving…" : parentId ? "Add reply" : "Add comment"}</button>
      </div>
      <SymposiumDocumentEditor
        value={documentValue}
        capability="reduced"
        attachments={attachments}
        profiles={profiles}
        disabled={submitting}
        placeholder="Write your comment here"
        onChange={(document, plainText) => { setDocumentValue(document); setBody(plainText); }}
        onAttachmentsChange={setAttachments}
        onBusyChange={setBusy}
        onUploadAttachment={onUploadAttachment}
      />
      {allowQuotes && onResolveQuoteLink ? (
        <QuoteLinkField
          attached={attachedQuote}
          profiles={profiles}
          disabled={submitting}
          onChange={setAttachedQuote}
          onResolve={onResolveQuoteLink}
        />
      ) : null}
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
  onUploadAttachment,
  onResolveQuoteLink,
  onOpenAttachmentPreview,
  onCommentAction,
  onQuote,
  onOpenQuote,
  onEditComment,
  onDeleteComment,
  actorHandle,
  onClearSelectedComment,
  onSelectComment,
  commentSegmentStacks,
  onCommentSegmentStackChange,
  onVisibleCommentSegmentStackChange,
  options = {},
  tone = null,
  depth = 0
}: {
  comments: InquiryComment[];
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: AddCommentHandler;
  onUploadAttachment: AttachmentUploadHandler;
  onResolveQuoteLink?: QuoteLinkResolver;
  onOpenAttachmentPreview: CommentAttachmentPreviewHandler;
  onCommentAction: CommentActionHandler;
  onQuote?: QuoteActionHandler;
  onOpenQuote?: QuoteActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
  onClearSelectedComment: () => void;
  onSelectComment: (commentId: string) => void;
  commentSegmentStacks: CommentSegmentStacks;
  onCommentSegmentStackChange: (key: string, stack: string[]) => void;
  onVisibleCommentSegmentStackChange: (key: string, stack: string[]) => void;
  options?: CommentThreadOptions;
  tone?: PostTone | null;
  depth?: number;
}) {
  return (
    <div className={`comment-thread depth-${depth} ${postToneClassName(tone)}`}>
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
            onUploadAttachment={onUploadAttachment}
            onResolveQuoteLink={onResolveQuoteLink}
            onOpenAttachmentPreview={onOpenAttachmentPreview}
            onCommentAction={onCommentAction}
            onQuote={onQuote}
            onOpenQuote={onOpenQuote}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
            actorHandle={actorHandle}
            onClearSelectedComment={onClearSelectedComment}
            onSelectComment={onSelectComment}
            segmentStack={commentSegmentStacks[rootStackKey] ?? null}
            onSegmentStackChange={(stack) => onCommentSegmentStackChange(rootStackKey, stack)}
            onVisibleSegmentStackChange={(stack) => onVisibleCommentSegmentStackChange(rootStackKey, stack)}
            options={options}
            tone={tone}
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
  onUploadAttachment,
  onResolveQuoteLink,
  onOpenAttachmentPreview,
  onCommentAction,
  onQuote,
  onOpenQuote,
  onEditComment,
  onDeleteComment,
  actorHandle,
  onClearSelectedComment,
  onSelectComment,
  segmentStack,
  onSegmentStackChange,
  onVisibleSegmentStackChange,
  options,
  tone,
  depth
}: {
  rootStackKey: string;
  comment: InquiryComment;
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: AddCommentHandler;
  onUploadAttachment: AttachmentUploadHandler;
  onResolveQuoteLink?: QuoteLinkResolver;
  onOpenAttachmentPreview: CommentAttachmentPreviewHandler;
  onCommentAction: CommentActionHandler;
  onQuote?: QuoteActionHandler;
  onOpenQuote?: QuoteActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
  onClearSelectedComment: () => void;
  onSelectComment: (commentId: string) => void;
  segmentStack: string[] | null;
  onSegmentStackChange: (stack: string[]) => void;
  onVisibleSegmentStackChange: (stack: string[]) => void;
  options: CommentThreadOptions;
  tone: PostTone | null;
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
        onUploadAttachment={onUploadAttachment}
        onResolveQuoteLink={onResolveQuoteLink}
        onOpenAttachmentPreview={onOpenAttachmentPreview}
        onCommentAction={onCommentAction}
        onQuote={onQuote}
        onOpenQuote={onOpenQuote}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        actorHandle={actorHandle}
        depth={depth}
        segmentDepth={1}
        onOpenReplySegment={openReplySegment}
        onClearSelectedComment={onClearSelectedComment}
        onSelectComment={onSelectComment}
        options={options}
        tone={tone}
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
  onUploadAttachment,
  onResolveQuoteLink,
  onOpenAttachmentPreview,
  onCommentAction,
  onQuote,
  onOpenQuote,
  onEditComment,
  onDeleteComment,
  actorHandle,
  depth,
  segmentDepth,
  onOpenReplySegment,
  onClearSelectedComment,
  onSelectComment,
  options,
  tone,
  leadingAction
}: {
  comment: InquiryComment;
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: AddCommentHandler;
  onUploadAttachment: AttachmentUploadHandler;
  onResolveQuoteLink?: QuoteLinkResolver;
  onOpenAttachmentPreview: CommentAttachmentPreviewHandler;
  onCommentAction: CommentActionHandler;
  onQuote?: QuoteActionHandler;
  onOpenQuote?: QuoteActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
  depth: number;
  segmentDepth: number;
  onOpenReplySegment: (commentId: string) => void;
  onClearSelectedComment: () => void;
  onSelectComment: (commentId: string) => void;
  options: CommentThreadOptions;
  tone: PostTone | null;
  leadingAction?: ReactNode;
}) {
  const governance = useCommunityGovernance();
  const [replyOpen, setReplyOpen] = useState(false);
  const scribble = useScribble();
  const scribbleSource = commentScribbleSource(comment, itemId, tone);
  const replies = comment.replies ?? [];
  const nodeRef = useRef<HTMLElement | null>(null);
  const commentDeleted = isDeletedComment(comment);
  const authorProfile = profileForHandle(profiles, comment.authorHandle ?? comment.author);
  const authorName = authorProfile?.name ?? comment.author;
  const communityRole = governance.containsPost(itemId)
    ? governance.roleForHandle(comment.authorHandle ?? comment.author)
    : null;
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
              <strong>{authorName}{authorProfile?.actorKind === "historical_simulation" ? <em className="historical-inline-badge" title="Historical simulation">simulation</em> : null}{communityRole ? <em className="community-role-badge">{communityRole}</em> : null}</strong>
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
        <ScribbleCitable source={scribbleSource}><SymposiumDocumentRenderer
          document={comment.document}
          body={comment.body}
          attachments={comment.attachments}
          profiles={profiles}
          mode="comment"
          onOpenAttachment={(attachmentId) => comment.id && onOpenAttachmentPreview(itemId, comment.id, attachmentId)}
          onCiteAttachment={(attachment) => scribble.addReference(attachmentScribbleSource(attachment, scribbleSource))}
          onExpand={() => {
            if (comment.id && !commentDeleted) {
              onCommentAction(itemId, comment.id, "read", { trigger: "expand", surface: "thread" });
            }
          }}
        /></ScribbleCitable>
        {comment.id && !commentDeleted && appendedContentAttachments(comment.document, comment.attachments ?? []).length ? (
          <AttachmentCarousel
            attachments={appendedContentAttachments(comment.document, comment.attachments ?? [])}
            label="Comment attachments"
            variant="comment"
            onOpenPreview={(attachmentId) =>
              onOpenAttachmentPreview(itemId, comment.id as string, attachmentId)
            }
            onAddToScribble={(attachment) => scribble.addReference(attachmentScribbleSource(attachment, scribbleSource))}
          />
        ) : null}
        {options.allowQuotes !== false && comment.quote && onOpenQuote ? (
          <ContentQuoteCard
            quote={comment.quote}
            profiles={profiles}
            onOpen={comment.quote.available ? () => onOpenQuote({
              sourceType: comment.quote!.sourceType,
              sourceId: comment.quote!.sourceId,
              sourcePostId: comment.quote!.sourcePostId
            }) : undefined}
          />
        ) : null}
        <CommentTimeFooter comment={comment} />
        <CommentActions
          comment={comment}
          itemId={itemId}
          actorHandle={actorHandle}
          onAction={onCommentAction}
          onQuote={onQuote ? () => comment.id && onQuote({ sourceType: "comment", sourceId: comment.id, sourcePostId: itemId }) : undefined}
          options={options}
        />
        {commentDeleted || options.allowReplies === false ? null : (
          <>
            <button className="reply-button" type="button" onClick={() => setReplyOpen((open) => !open)}>
              Reply
            </button>
            {replyOpen ? (
              <CommentComposer
                itemId={itemId}
                parentId={comment.id ?? null}
                compact
                profiles={profiles}
                onUploadAttachment={onUploadAttachment}
                onResolveQuoteLink={onResolveQuoteLink}
                allowQuotes={options.allowQuotes !== false}
                onAddComment={async (id, body, document, stance, parentId, attachments, quoteSource) => {
                  const saved = await onAddComment(id, body, document, stance, parentId, attachments, quoteSource);
                  if (saved) setReplyOpen(false);
                  return saved;
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
                onUploadAttachment={onUploadAttachment}
                onResolveQuoteLink={onResolveQuoteLink}
                onOpenAttachmentPreview={onOpenAttachmentPreview}
                onCommentAction={onCommentAction}
                onQuote={onQuote}
                onOpenQuote={onOpenQuote}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                actorHandle={actorHandle}
                depth={depth + 1}
                segmentDepth={segmentDepth + 1}
                onOpenReplySegment={onOpenReplySegment}
                onClearSelectedComment={onClearSelectedComment}
                onSelectComment={onSelectComment}
                options={options}
                tone={tone}
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
  onAction,
  onQuote,
  options = {}
}: {
  comment: InquiryComment;
  itemId: string;
  actorHandle: string;
  onAction: (itemId: string, commentId: string, action: CommentAction) => void;
  onQuote?: () => void;
  options?: CommentThreadOptions;
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
  ].filter((action) => options.allowReshares !== false || action.label !== "Reshares");
  const commentHref = options.commentHref
    ? options.commentHref(itemId, comment.id)
    : canonicalRouteHref({ kind: "post", postId: itemId, commentId: comment.id });

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
            disabled={deleted || options.disabled || !action.action}
            onClick={(event) => {
              event.stopPropagation();
              if (!deleted && !options.disabled && action.action) onAction(itemId, comment.id as string, action.action);
            }}
          >
            <Icon size={15} fill={fillActiveIcon ? "currentColor" : "none"} />
            <span>{action.label}</span>
            <strong>{deleted ? deletedMetricLabel : formatMetric(metricNumber(action.value))}</strong>
          </button>
        );
      })}
      {options.allowQuotes !== false && onQuote ? <QuoteActionButton disabled={deleted || options.disabled} label="comment" onQuote={onQuote} /> : null}
      {commentHref ? (
        <a
          className="content-link-action"
          href={commentHref}
          title="Open comment link"
          aria-label="Open comment link"
          onClick={(event) => event.stopPropagation()}
        >
          <Link2 size={15} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}
