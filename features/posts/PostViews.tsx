"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  Eye,
  Link2,
  MessageCircle,
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
  type ResearchCommunity,
  type ContentQuoteSource,
  type ResearchProfile,
  type Room
} from "@/lib/mockData";
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
  type AttachmentPreviewHandler,
  type AttachmentUploadHandler
} from "@/features/attachments/AttachmentViews";
import type { PdfAttachmentViewContext } from "@/features/attachments/pdfAttachmentClient";
import {
  ContentQuoteCard,
  QuoteActionButton,
  QuoteLinkField,
  type QuoteActionHandler,
  type QuoteSelection
} from "@/features/quotes/QuoteViews";
import {
  attachedQuoteFromSnapshot,
  type AttachedQuote,
  type QuoteLinkResolver
} from "@/features/quotes/quoteLinks";
import {
  CommentComposer,
  CommentThread,
  type AddCommentHandler,
  type CommentAttachmentPreviewHandler,
  type CommentSegmentStacks
} from "@/features/comments/CommentThread";
import { ExpandableBodyText } from "@/features/content/ExpandableBodyText";
import { SymposiumDocumentEditor, SymposiumDocumentRenderer } from "@/features/content/SymposiumDocument";
import { appendedContentAttachments, documentForContent, emptySymposiumDocument, editorCapabilityForKind } from "@/lib/documentModel";
import type { VersionedDocumentContract } from "@/packages/contracts/src";
import type { OpportunityPostInputContract, PatronageProposalInputContract } from "@/packages/contracts/src";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import { CommunityActivityBadge } from "@/features/communities/CommunityActivityBadge";
import { useCommunityGovernance } from "@/features/communities/CommunityGovernanceContext";
import { useQualifiedView } from "@/features/live-sync/useQualifiedView";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";
import { canonicalRouteHref } from "@/features/navigation/canonicalRoute";
import { postToneClassName, postToneForItem } from "@/lib/postTone";
import { itemHasPostType } from "@/lib/postSemantics";
import { communityPostIsInteractive } from "@/features/communities/communityPolicy";
import { ContentAnalyticsDialog } from "@/features/analytics/ContentAnalyticsDialog";
import {
  clearPendingContentAnalytics,
  consumePendingContentAnalytics,
  isPendingContentAnalytics,
  openContentAnalyticsEvent
} from "@/features/analytics/contentAnalyticsNavigation";
import type { ContentAnalyticsViewContract } from "@/packages/contracts/src";
import {
  attachmentScribbleSource,
  postScribbleSource,
  ScribbleCitable,
  useScribble
} from "@/features/scribble/ScribbleContext";
import {
  ContentTranslationControl,
  TranslatedContent,
  useContentTranslation
} from "@/features/translation/ContentTranslationControl";
import {
  PatronageFeedSummary,
  PatronageProposalFields,
  PatronageProposalRail
} from "@/features/patronage/PatronageViews";
import {
  emptyPatronageDraftFields,
  patronageDraftFieldsForProposal,
  patronageInputForDraft
} from "@/features/patronage/patronageModel";
import {
  emptyOpportunityDraftFields,
  OpportunityFeedSummary,
  OpportunityFields,
  OpportunityRail,
  opportunityDraftFieldsForPost,
  opportunityInputForDraft
} from "@/features/opportunities/OpportunityViews";

export type PostDraftKind = "paper" | "thought" | "proposal" | "opportunity";

export type PostDraft = {
  title: string;
  body: string;
  document: VersionedDocumentContract;
  kind: PostDraftKind;
  patronage?: PatronageProposalInputContract;
  opportunity?: OpportunityPostInputContract;
  attachments: InquiryAttachment[];
  quoteSource?: ContentQuoteSource;
  quoteSnapshot?: InquiryItem["quote"];
};

export type PostCreationResult = { ok: true } | { ok: false; error: string };

export const commentsSectionTargetId = "__symposium-comments-section__";
export const kindLabels: Record<InquiryItem["kind"], string> = {
  paper: "Paper",
  thought: "Thought",
  draft: "Draft",
  note: "Note",
  code: "Code"
};
const initial = profileInitials;

const postKindOptions: PostDraftKind[] = ["thought", "paper", "proposal", "opportunity"];
const composerKindLabels: Record<PostDraftKind, string> = {
  thought: "Thought",
  paper: "Paper",
  proposal: "Patronage Proposal",
  opportunity: "Opportunity"
};

export function PostComposerModal({
  onClose,
  onCreatePost,
  onSaveDraft,
  onUploadAttachment,
  onResolveQuoteLink,
  profiles,
  initialKind = "thought",
  destination
}: {
  onClose: () => void;
  onCreatePost: (draft: PostDraft) => Promise<PostCreationResult>;
  onSaveDraft: (draft: PostDraft) => Promise<PostCreationResult>;
  onUploadAttachment: AttachmentUploadHandler;
  onResolveQuoteLink: QuoteLinkResolver;
  profiles: Record<string, ResearchProfile>;
  initialKind?: PostDraftKind;
  destination?: {
    communityId: string | null;
    selectedCommunity?: { id: string; name: string; canPost: boolean };
    onChange: (communityId: string | null) => void;
  };
}) {
  const [kind, setKind] = useState<PostDraft["kind"]>(initialKind);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [documentValue, setDocumentValue] = useState<VersionedDocumentContract>(() => emptySymposiumDocument());
  const [attachments, setAttachments] = useState<InquiryAttachment[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [attachedQuote, setAttachedQuote] = useState<AttachedQuote | null>(null);
  const [patronageFields, setPatronageFields] = useState(emptyPatronageDraftFields);
  const [opportunityFields, setOpportunityFields] = useState(emptyOpportunityDraftFields);

  const submitPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    const patronage = kind === "proposal" ? patronageInputForDraft(patronageFields) : undefined;
    const opportunity = kind === "opportunity" ? opportunityInputForDraft(opportunityFields) : undefined;
    if (!cleanTitle || !cleanBody || uploading || submitting || savingDraft || (kind === "proposal" && !patronage)) return;

    setSubmitting(true);
    setAttachmentStatus(attachments.length ? "Publishing post with attachments" : "Publishing post");
    const result = await onCreatePost({
      title: cleanTitle,
      body: cleanBody,
      document: documentValue,
      kind,
      patronage: patronage ?? undefined,
      opportunity,
      attachments,
      quoteSource: attachedQuote
        ? { sourceType: attachedQuote.selection.sourceType, sourceId: attachedQuote.selection.sourceId }
        : undefined,
      quoteSnapshot: attachedQuote?.quote
    });
    setSubmitting(false);
    if (!result.ok) {
      setAttachmentStatus(result.error);
      return;
    }
    setTitle("");
    setBody("");
    setDocumentValue(emptySymposiumDocument());
    setKind(initialKind);
    setPatronageFields(emptyPatronageDraftFields());
    setOpportunityFields(emptyOpportunityDraftFields());
    setAttachments([]);
    setAttachedQuote(null);
    setAttachmentStatus("");
  };

  const saveDraft = async () => {
    if (uploading || submitting || savingDraft) return;
    const patronage = kind === "proposal" ? patronageInputForDraft(patronageFields) : undefined;
    const opportunity = kind === "opportunity" ? opportunityInputForDraft(opportunityFields) : undefined;
    if (kind === "proposal" && !patronage) {
      setAttachmentStatus("Add a valid funding goal before saving this proposal draft");
      return;
    }
    setSavingDraft(true);
    setAttachmentStatus("Saving draft to Notes");
    const result = await onSaveDraft({
      title: title.trim() || `Untitled ${kind}`,
      body,
      document: documentValue,
      kind,
      patronage: patronage ?? undefined,
      opportunity,
      attachments,
      quoteSource: attachedQuote
        ? { sourceType: attachedQuote.selection.sourceType, sourceId: attachedQuote.selection.sourceId }
        : undefined,
      quoteSnapshot: attachedQuote?.quote
    });
    setSavingDraft(false);
    if (!result.ok) {
      setAttachmentStatus(result.error);
      return;
    }
    onClose();
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-composer-modal" onSubmit={submitPost} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>{destination?.communityId && destination.selectedCommunity ? `Posting in ${destination.selectedCommunity.name}` : "Global post"}</span>
            <strong>{composerKindLabels[kind]}</strong>
          </div>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="composer-topline">
          <select value={kind} onChange={(event) => setKind(event.target.value as PostDraft["kind"])}>
            {postKindOptions.map((option) => (
              <option key={option} value={option}>
                {composerKindLabels[option]}
              </option>
            ))}
          </select>
          <div className="composer-primary-actions">
            <button
              type="button"
              className="composer-save-draft"
              disabled={uploading || submitting || savingDraft}
              onClick={() => void saveDraft()}
            >
              {savingDraft ? "Saving…" : "Save draft"}
            </button>
            <button
              type="submit"
              disabled={uploading || submitting || savingDraft || !title.trim() || !body.trim() || (kind === "proposal" && !patronageInputForDraft(patronageFields))}
            >
              {submitting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
        {destination?.selectedCommunity ? (
          <label className="composer-destination-control">
            <span>Post destination</span>
            <select value={destination.communityId ?? "global"} onChange={(event) => destination.onChange(event.target.value === "global" ? null : event.target.value)}>
              <option value="global">Global · common feeds</option>
              <option value={destination.selectedCommunity.id} disabled={!destination.selectedCommunity.canPost}>
                {destination.selectedCommunity.name}{destination.selectedCommunity.canPost ? "" : " · join to post"}
              </option>
            </select>
            <small>{kind === "paper" ? "Papers are always public and published in the Library, wherever they begin." : destination.communityId ? "This post stays inside the selected community." : "This post enters the common global feeds."}</small>
          </label>
        ) : null}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        {kind === "proposal" ? (
          <PatronageProposalFields
            value={patronageFields}
            onChange={setPatronageFields}
            disabled={submitting || savingDraft}
          />
        ) : null}
        {kind === "opportunity" ? <OpportunityFields value={opportunityFields} onChange={setOpportunityFields} disabled={submitting || savingDraft} /> : null}
        <SymposiumDocumentEditor
          value={documentValue}
          capability={editorCapabilityForKind(kind === "proposal" ? "paper" : kind === "opportunity" ? "thought" : kind)}
          attachments={attachments}
          profiles={profiles}
          disabled={submitting || savingDraft}
          placeholder={kind === "proposal" ? "Develop the work, budget, milestones, risks, and evidence here" : kind === "opportunity" ? "Describe the work, who should apply, and what a strong application should show" : `Write your ${kind} here`}
          onChange={(document, plainText) => { setDocumentValue(document); setBody(plainText); }}
          onAttachmentsChange={setAttachments}
          onBusyChange={setUploading}
          onUploadAttachment={onUploadAttachment}
        />
        <QuoteLinkField
          attached={attachedQuote}
          profiles={profiles}
          disabled={submitting || savingDraft}
          onChange={setAttachedQuote}
          onResolve={onResolveQuoteLink}
        />
        {attachmentStatus ? <small className="composer-submit-status">{attachmentStatus}</small> : null}
      </form>
    </div>
  );
}

export function PostEditModal({
  item,
  onClose,
  onSave,
  onDelete,
  onUploadAttachment,
  onResolveQuoteLink,
  profiles
}: {
  item: InquiryItem;
  onClose: () => void;
  onSave: (itemId: string, draft: {
    title: string;
    body: string;
    document: VersionedDocumentContract;
    attachments: InquiryAttachment[];
    quote: InquiryItem["quote"] | null;
    patronage?: PatronageProposalInputContract;
    opportunity?: OpportunityPostInputContract;
  }) => Promise<void>;
  onDelete: (itemId: string) => void;
  onUploadAttachment: AttachmentUploadHandler;
  onResolveQuoteLink: QuoteLinkResolver;
  profiles: Record<string, ResearchProfile>;
}) {
  const isProposal = itemHasPostType(item, "proposal");
  const isOpportunity = itemHasPostType(item, "opportunity");
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [documentValue, setDocumentValue] = useState<VersionedDocumentContract>(() => documentForContent(item.document, item.body));
  const [attachments, setAttachments] = useState<InquiryAttachment[]>(item.attachments ?? []);
  const [attachedQuote, setAttachedQuote] = useState<AttachedQuote | null>(
    item.quote ? attachedQuoteFromSnapshot(item.quote) : null
  );
  const [busy, setBusy] = useState(false);
  const [patronageFields, setPatronageFields] = useState(() =>
    item.patronage ? patronageDraftFieldsForProposal(item.patronage) : emptyPatronageDraftFields()
  );
  const [opportunityFields, setOpportunityFields] = useState(() => item.opportunity ? opportunityDraftFieldsForPost(item.opportunity) : emptyOpportunityDraftFields());

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const patronage = item.patronage ? patronageInputForDraft(patronageFields) : undefined;
    const opportunity = item.opportunity ? opportunityInputForDraft(opportunityFields) : undefined;
    if (busy || !title.trim() || !body.trim() || (item.patronage && !patronage)) return;
    setBusy(true);
    try {
      await onSave(item.id, { title, body, document: documentValue, attachments, quote: attachedQuote?.quote ?? null, patronage: patronage ?? undefined, opportunity });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-edit-modal" onSubmit={submitEdit} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>Edit post</span>
            <strong>{isProposal ? "Patronage Proposal" : isOpportunity ? "Opportunity" : kindLabels[item.kind]}</strong>
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
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        {item.patronage ? (
          <PatronageProposalFields
            value={patronageFields}
            onChange={setPatronageFields}
            disabled={busy}
            allowStatus
          />
        ) : null}
        {item.opportunity ? <OpportunityFields value={opportunityFields} onChange={setOpportunityFields} disabled={busy} allowStatus /> : null}
        <SymposiumDocumentEditor
          value={documentValue}
          capability={editorCapabilityForKind(item.kind)}
          attachments={attachments}
          profiles={profiles}
          disabled={busy}
          placeholder={isProposal ? "Develop the proposal here" : isOpportunity ? "Develop the opportunity here" : `Write your ${item.kind === "paper" ? "paper" : "thought"} here`}
          onChange={(document, plainText) => { setDocumentValue(document); setBody(plainText); }}
          onAttachmentsChange={setAttachments}
          onBusyChange={setBusy}
          onUploadAttachment={onUploadAttachment}
        />
        <QuoteLinkField
          attached={attachedQuote}
          owner={{ ownerId: item.id, ownerType: "post" }}
          profiles={profiles}
          disabled={busy}
          onChange={setAttachedQuote}
          onResolve={onResolveQuoteLink}
        />
      </form>
    </div>
  );
}

export function CommentEditModal({
  item,
  context,
  comment,
  onClose,
  onSave,
  onDelete,
  onUploadAttachment,
  onResolveQuoteLink,
  profiles,
  allowQuotes = true
}: {
  item?: InquiryItem;
  context?: { id: string; title: string };
  comment: InquiryComment;
  onClose: () => void;
  onSave: (
    itemId: string,
    commentId: string,
    body: string,
    document: VersionedDocumentContract,
    attachments: InquiryAttachment[]
    , quote: InquiryComment["quote"] | null
  ) => Promise<void>;
  onDelete: (itemId: string, commentId: string) => void;
  onUploadAttachment: AttachmentUploadHandler;
  onResolveQuoteLink?: QuoteLinkResolver;
  profiles: Record<string, ResearchProfile>;
  allowQuotes?: boolean;
}) {
  const itemId = item?.id ?? context?.id ?? "";
  const contextTitle = item ? deletedPostContextTitle(item) : context?.title ?? "draft";
  const [body, setBody] = useState(comment.body);
  const [documentValue, setDocumentValue] = useState<VersionedDocumentContract>(() => documentForContent(comment.document, comment.body));
  const [attachments, setAttachments] = useState<InquiryAttachment[]>(comment.attachments ?? []);
  const [attachedQuote, setAttachedQuote] = useState<AttachedQuote | null>(
    comment.quote ? attachedQuoteFromSnapshot(comment.quote) : null
  );
  const [busy, setBusy] = useState(false);

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!comment.id || busy || !body.trim()) return;
    setBusy(true);
    try {
      await onSave(itemId, comment.id, body, documentValue, attachments, allowQuotes ? attachedQuote?.quote ?? null : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-edit-modal comment-edit-modal" onSubmit={submitEdit} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>Edit comment</span>
            <strong>On {contextTitle}</strong>
          </div>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="composer-topline">
          <button className="danger-action" type="button" onClick={() => comment.id && onDelete(itemId, comment.id)}>
            <Trash2 size={16} />
            Delete
          </button>
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
        <SymposiumDocumentEditor
          value={documentValue}
          capability="reduced"
          attachments={attachments}
          profiles={profiles}
          disabled={busy}
          placeholder="Write your comment here"
          onChange={(document, plainText) => { setDocumentValue(document); setBody(plainText); }}
          onAttachmentsChange={setAttachments}
          onBusyChange={setBusy}
          onUploadAttachment={onUploadAttachment}
        />
        {allowQuotes && onResolveQuoteLink ? (
          <QuoteLinkField
            attached={attachedQuote}
            owner={{ ownerId: comment.id ?? "", ownerType: "comment" }}
            profiles={profiles}
            disabled={busy}
            onChange={setAttachedQuote}
            onResolve={onResolveQuoteLink}
          />
        ) : null}
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
  onDeletePost,
  inline = false
}: {
  item: InquiryItem;
  actorHandle: string;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  inline?: boolean;
}) {
  const governance = useCommunityGovernance();
  const isAuthor = cleanHandle(item.authorHandle ?? item.author) === actorHandle;
  const mayDelete = isAuthor || governance.canModeratePost(item);
  const [analyticsView, setAnalyticsView] = useState<ContentAnalyticsViewContract | null>(() => {
    if (typeof window === "undefined" || !isAuthor) return null;
    const pending = consumePendingContentAnalytics({
      subjectType: "post",
      postId: item.id
    });
    if (pending) return pending;
    const pathMatches = window.location.pathname === `/posts/${encodeURIComponent(item.id)}`;
    const value = new URLSearchParams(window.location.search).get("analytics");
    return pathMatches && (value === "likes" || value === "reshares" || value === "quotes" || value === "overview")
      ? value
      : null;
  });
  useEffect(() => {
    if (!isAuthor) return;
    const onOpenAnalytics = (event: Event) => {
      const detail = (event as CustomEvent<{
        postId?: string;
        subjectType?: string;
        view?: string;
      }>).detail;
      if (!isPendingContentAnalytics(detail)) return;
      if (detail?.postId !== item.id || detail.subjectType !== "post") return;
      clearPendingContentAnalytics();
      setAnalyticsView(detail.view);
    };
    window.addEventListener(openContentAnalyticsEvent, onOpenAnalytics);
    return () => window.removeEventListener(openContentAnalyticsEvent, onOpenAnalytics);
  }, [isAuthor, item.id]);
  if (isDeletedPost(item) || (!isAuthor && !mayDelete)) return null;

  return (
    <>
    <div className={`post-owner-actions${inline ? " inline" : ""}`} aria-label="Post actions">
      {isAuthor ? <button
        type="button"
        title="View post analytics"
        aria-label="View post analytics"
        onClick={(event) => {
          event.stopPropagation();
          setAnalyticsView("overview");
        }}
      >
        <BarChart3 size={16} />
      </button> : null}
      {isAuthor ? <button
        type="button"
        title="Edit post"
        onClick={(event) => {
          event.stopPropagation();
          onEditPost(item);
        }}
      >
        <Pencil size={16} />
      </button> : null}
      {mayDelete ? <button
        type="button"
        title={isAuthor ? "Delete post" : "Remove post from community"}
        onClick={(event) => {
          event.stopPropagation();
          onDeletePost(item.id);
        }}
      >
        <Trash2 size={16} />
      </button> : null}
    </div>
    {isAuthor && analyticsView ? (
      <ContentAnalyticsDialog
        actorHandle={actorHandle}
        postId={item.id}
        subjectType="post"
        initialView={analyticsView}
        onClose={() => setAnalyticsView(null)}
      />
    ) : null}
    </>
  );
}

export function FeedPost({
  item,
  onSelect,
  onOpenProfile,
  onAction,
  onQuote,
  onOpenQuote,
  onEditPost,
  onDeletePost,
  onOpenAttachmentPreview,
  actorHandle,
  profiles,
  community,
  onOpenCommunity,
  showCommunityContext = false,
  surface = "feed",
  activityLabel
}: {
  item: InquiryItem;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onQuote: QuoteActionHandler;
  onOpenQuote: QuoteActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  community?: ResearchCommunity;
  onOpenCommunity?: (communityId: string) => void;
  showCommunityContext?: boolean;
  surface?: ViewSurface;
  activityLabel?: "Reshared";
}) {
  const postRef = useRef<HTMLElement | null>(null);
  const scribble = useScribble();
  const translation = useContentTranslation({
    sourceType: "post",
    sourceId: item.id,
    sourceRevision: item.revision ?? 1
  });
  const tone = postToneForItem(item);
  const feedKindLabel = itemHasPostType(item, "proposal")
    ? "Patronage Proposal"
    : itemHasPostType(item, "opportunity")
      ? "Opportunity"
      : kindLabels[item.kind];
  const interactionLocked = !communityPostIsInteractive(item);
  const openPost = () => onSelect(item.id);
  const openPostUnlessSelecting = () => {
    if (window.getSelection()?.toString().trim()) return;
    openPost();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPost();
    }
  };
  useQualifiedView(postRef, {
    disabled: isDeletedPost(item) || interactionLocked,
    targetKey: item.id,
    onView: () => onAction(item.id, "read", { trigger: "visibility", surface })
  });

  return (
    <article
      ref={postRef}
      className={`feed-post post-kind-${item.kind} ${postToneClassName(tone)}`}
      data-testid={`feed-card-${item.id}`}
      role="button"
      tabIndex={0}
      onClick={openPostUnlessSelecting}
      onKeyDown={onKeyDown}
    >
      {surface === "profile" ? (
        <div className="profile-post-card-header">
          <PostAuthor item={item} profiles={profiles} onOpenProfile={onOpenProfile} onClickStop={(event) => event.stopPropagation()} />
          <div className="profile-post-header-actions">
            {showCommunityContext && community && onOpenCommunity ? <CommunityActivityBadge community={community} onOpenCommunity={onOpenCommunity} onClick={(event) => event.stopPropagation()} compact className="profile-community-provenance" /> : null}
            {activityLabel ? <span className="profile-post-activity-label"><Repeat2 size={14} />{activityLabel}</span> : null}
            {!interactionLocked ? <PostOwnerControls item={item} actorHandle={actorHandle} onEditPost={onEditPost} onDeletePost={onDeletePost} inline /> : null}
          </div>
        </div>
      ) : (
        <>
          {!interactionLocked ? <PostOwnerControls item={item} actorHandle={actorHandle} onEditPost={onEditPost} onDeletePost={onDeletePost} /> : null}
          <PostAuthor item={item} profiles={profiles} onOpenProfile={onOpenProfile} onClickStop={(event) => event.stopPropagation()} />
          {showCommunityContext && community && onOpenCommunity ? <CommunityActivityBadge community={community} onOpenCommunity={onOpenCommunity} onClick={(event) => event.stopPropagation()} /> : null}
        </>
      )}
      <div className="post-body">
        <p className="post-card-kind-label">{feedKindLabel}</p>
        {!isDeletedPost(item) && !interactionLocked ? (
          <ContentTranslationControl state={translation} sourceLabel="post" />
        ) : null}
        <h2>
          <CanonicalLink
            route={{ kind: "post", postId: item.id }}
            onNavigate={openPost}
            onClick={(event) => event.stopPropagation()}
          >
            {translation.showTranslation && translation.result?.status === "translated"
              ? translation.result.translatedTitle
              : deletedPostContextTitle(item)}
          </CanonicalLink>
        </h2>
        {translation.showTranslation ? (
          <TranslatedContent state={translation} showTitle={false} />
        ) : interactionLocked ? (
          <SymposiumDocumentRenderer
            document={item.document}
            body={item.body}
            attachments={item.attachments}
            profiles={profiles}
            mode="feed"
          />
        ) : (
          <ScribbleCitable source={postScribbleSource(item)}><SymposiumDocumentRenderer
            document={item.document}
            body={item.body}
            attachments={item.attachments}
            profiles={profiles}
            mode="feed"
            onExpand={() => onAction(item.id, "read", { trigger: "expand", surface })}
            onCiteAttachment={(attachment) => scribble.addReference(attachmentScribbleSource(attachment, postScribbleSource(item)))}
          /></ScribbleCitable>
        )}
        <PostAttachmentCarousel item={item} onOpenPreview={onOpenAttachmentPreview} onAddToScribble={(attachment) => scribble.addReference(attachmentScribbleSource(attachment, postScribbleSource(item)))} />
        {item.quote ? (
          <ContentQuoteCard
            quote={item.quote}
            profiles={profiles}
            onOpen={item.quote.available ? () => onOpenQuote({
              sourceType: item.quote!.sourceType,
              sourceId: item.quote!.sourceId,
              sourcePostId: item.quote!.sourcePostId
            }) : undefined}
          />
        ) : null}
        <PatronageFeedSummary item={item} />
        <OpportunityFeedSummary item={item} />
        <PostTimeFooter item={item} />
        <SocialActions
          item={item}
          commentCount={item.commentCount ?? countComments(item.comments)}
          onAction={onAction}
          onQuote={() => onQuote({ sourceType: "post", sourceId: item.id, sourcePostId: item.id })}
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
  onClickStop?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const governance = useCommunityGovernance();
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
  const communityRole = !itemHasPostType(item, "paper") && governance.containsPost(item.id)
    ? governance.roleForHandle(item.authorHandle ?? item.author)
    : null;

  return (
    <CanonicalLink
      className="post-author"
      route={{ kind: "profile", handle: authorProfile?.handle ?? item.authorHandle ?? item.author }}
      onNavigate={() => onOpenProfile(authorProfile?.handle ?? item.authorHandle ?? item.author)}
      onClick={(event) => {
        onClickStop?.(event);
      }}
    >
      <span className="avatar">
        {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
      </span>
      <span>
        <strong>{authorName}{authorProfile?.actorKind === "historical_simulation" ? <em className="historical-inline-badge" title="Historical simulation">simulation</em> : null}{communityRole ? <em className="community-role-badge">{communityRole}</em> : null}</strong>
        <small>{relativeTimeLabel(item.createdAt, item.date)}</small>
      </span>
    </CanonicalLink>
  );
}

function SocialActions({
  item,
  commentCount,
  onAction,
  onQuote,
  onCommentsClick,
  actorHandle
}: {
  item: InquiryItem;
  commentCount: number;
  onAction: PostActionHandler;
  onQuote: () => void;
  onCommentsClick?: () => void;
  actorHandle: string;
}) {
  const postDeleted = isDeletedPost(item);
  const interactionLocked = !communityPostIsInteractive(item);
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
        const disabled = interactionLocked || (postDeleted && Boolean(action.action));
        const metricValue = action.value === deletedMetricLabel ? deletedMetricLabel : formatMetric(metricNumber(action.value));
        if (action.label === "Comments" && !postDeleted && !interactionLocked) {
          return (
            <CanonicalLink
              key={action.label}
              route={{ kind: "post", postId: item.id, commentId: commentsSectionTargetId }}
              onNavigate={() => onCommentsClick?.()}
              onClick={(event) => event.stopPropagation()}
              title={action.label}
            >
              <Icon size={16} />
              <span className="metric-label">{action.label}</span>
              <strong>{metricValue}</strong>
            </CanonicalLink>
          );
        }
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            className={action.active ? "active" : ""}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (action.action && !postDeleted && !interactionLocked) onAction(item.id, action.action);
              else if (action.label === "Comments") onCommentsClick?.();
            }}
          >
            <Icon size={16} fill={fillActiveIcon ? "currentColor" : "none"} />
            <span className="metric-label">{action.label}</span>
            <strong>{metricValue}</strong>
          </button>
        );
      })}
      <QuoteActionButton disabled={postDeleted || interactionLocked} label="post" onQuote={onQuote} />
      <a
        className="content-link-action"
        href={canonicalRouteHref({ kind: "post", postId: item.id })}
        title="Open post link"
        aria-label="Open post link"
        onClick={(event) => event.stopPropagation()}
      >
        <Link2 size={16} aria-hidden="true" />
      </a>
    </div>
  );
}

export function DetailView({
  item,
  room,
  onBack,
  onOpenProfile,
  onAddComment,
  onUploadCommentAttachment,
  onResolveQuoteLink,
  onOpenCommentAttachmentPreview,
  onAction,
  onQuote,
  onOpenQuote,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  onEditPost,
  onDeletePost,
  actorHandle,
  profiles,
  selectedCommentId,
  onClearSelectedComment,
  onSelectComment,
  commentSegmentStacks,
  onCommentSegmentStackChange,
  onVisibleCommentSegmentStackChange,
  onOpenAttachmentPreview,
  onAttachmentViewContextChange,
  onApplyOpportunity,
  onReviewOpportunity
}: {
  item: InquiryItem;
  room: Room;
  onBack: () => void;
  onOpenProfile: (name: string) => void;
  onAddComment: AddCommentHandler;
  onUploadCommentAttachment: AttachmentUploadHandler;
  onResolveQuoteLink: QuoteLinkResolver;
  onOpenCommentAttachmentPreview: CommentAttachmentPreviewHandler;
  onAction: PostActionHandler;
  onQuote: QuoteActionHandler;
  onOpenQuote: QuoteActionHandler;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onClearSelectedComment: () => void;
  onSelectComment: (commentId: string) => void;
  commentSegmentStacks: CommentSegmentStacks;
  onCommentSegmentStackChange: (key: string, stack: string[]) => void;
  onVisibleCommentSegmentStackChange: (key: string, stack: string[]) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  onAttachmentViewContextChange?: (context: PdfAttachmentViewContext | null) => void;
  onApplyOpportunity: (item: InquiryItem) => void;
  onReviewOpportunity: (item: InquiryItem) => void;
}) {
  const governance = useCommunityGovernance();
  const isPaper = item.kind === "paper";
  const isProposal = itemHasPostType(item, "proposal");
  const isOpportunity = itemHasPostType(item, "opportunity");
  const tone = postToneForItem(item);
  const postDeleted = isDeletedPost(item);
  const interactionLocked = !communityPostIsInteractive(item);
  const detailRef = useRef<HTMLElement | null>(null);
  const doiSlug = item.id.replace(/[^a-z0-9]+/gi, ".").replace(/\.+/g, ".").replace(/\.$/, "");
  const codeSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44);
  const authorProfile = profileForHandle(profiles, item.authorHandle ?? item.author);
  const authorName = authorProfile?.name ?? item.author;
  const communityRole = !isPaper && governance.containsPost(item.id)
    ? governance.roleForHandle(item.authorHandle ?? item.author)
    : null;
  const commentsSectionId = `comments-${item.id}`;
  const scrollToComments = () => {
    document.getElementById(commentsSectionId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const threadSelectedCommentId = selectedCommentId === commentsSectionTargetId ? null : selectedCommentId;
  const scribble = useScribble();
  const translation = useContentTranslation({
    sourceType: "post",
    sourceId: item.id,
    sourceRevision: item.revision ?? 1
  });

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
    disabled: postDeleted || interactionLocked,
    targetKey: item.id,
    onView: () => onAction(item.id, "read", { trigger: "visibility", surface: "detail" })
  });

  return (
    <article className={`detail-layout ${isPaper ? "paper-detail" : "simple-detail"}${isProposal ? " patronage-detail" : ""}${isOpportunity ? " opportunity-detail" : ""} ${postToneClassName(tone)}`}>
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back to {room.feedLabel}
      </button>

      <section className="detail-main" ref={detailRef}>
        {interactionLocked ? (
          <div className="community-citation-only-notice">
            {item.communityAccess === "activity-only"
              ? "This private-community activity remains visible because it is yours. Community context and interactions are unavailable until access returns."
              : "This source now belongs to a private community. Only the cited content and its author remain visible; community context and interactions are unavailable."}
          </div>
        ) : <PostOwnerControls item={item} actorHandle={actorHandle} onEditPost={onEditPost} onDeletePost={onDeletePost} />}
        <p className="eyebrow">{isProposal ? "Patronage Proposal" : isOpportunity ? "Opportunity" : kindLabels[item.kind]}</p>
        <h1>
          {translation.showTranslation && translation.result?.status === "translated"
            ? translation.result.translatedTitle
            : deletedPostContextTitle(item)}
        </h1>
        {postDeleted ? (
          <div className="detail-byline-button deleted-post-author" aria-label="Deleted post">
            <span className="avatar deleted-avatar" aria-hidden="true" />
            <span>
              <strong aria-hidden="true">—</strong>
            </span>
          </div>
        ) : (
          <CanonicalLink
            className="detail-byline-button"
            route={{ kind: "profile", handle: authorProfile?.handle ?? item.authorHandle ?? item.author }}
            onNavigate={() => onOpenProfile(authorProfile?.handle ?? item.authorHandle ?? item.author)}
          >
            <span className="avatar">
              {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
            </span>
            <span>
              <strong>{authorName}{authorProfile?.actorKind === "historical_simulation" ? <em className="historical-inline-badge" title="Historical simulation">simulation</em> : null}{communityRole ? <em className="community-role-badge">{communityRole}</em> : null}</strong>
              <small>{relativeTimeLabel(item.createdAt, item.date)}</small>
            </span>
          </CanonicalLink>
        )}
        {!postDeleted && !interactionLocked ? (
          <ContentTranslationControl state={translation} sourceLabel="post" />
        ) : null}
        {translation.showTranslation ? (
          <TranslatedContent state={translation} showTitle={false} titleAs="h1" />
        ) : interactionLocked ? (
          <SymposiumDocumentRenderer
            document={item.document}
            body={item.body}
            attachments={item.attachments}
            profiles={profiles}
            mode="detail"
          />
        ) : (
          <ScribbleCitable source={postScribbleSource(item)}><SymposiumDocumentRenderer
            document={item.document}
            body={item.body}
            attachments={item.attachments}
            profiles={profiles}
            mode="detail"
            onOpenAttachment={(attachmentId) => onOpenAttachmentPreview(item, attachmentId)}
            onCiteAttachment={(attachment) => scribble.addReference(attachmentScribbleSource(attachment, postScribbleSource(item)))}
          /></ScribbleCitable>
        )}
        {appendedContentAttachments(item.document, item.attachments ?? []).length ? (
          <PostAttachmentCarousel
            item={{ ...item, attachments: appendedContentAttachments(item.document, item.attachments ?? []) }}
            onOpenPreview={onOpenAttachmentPreview}
            onAddToScribble={(attachment) => scribble.addReference(attachmentScribbleSource(attachment, postScribbleSource(item)))}
            onViewContextChange={onAttachmentViewContextChange}
            variant="detail"
          />
        ) : null}
        {item.quote ? (
          <ContentQuoteCard
            quote={item.quote}
            profiles={profiles}
            onOpen={item.quote.available ? () => onOpenQuote({
              sourceType: item.quote!.sourceType,
              sourceId: item.quote!.sourceId,
              sourcePostId: item.quote!.sourcePostId
            }) : undefined}
          />
        ) : null}
        <PostTimeFooter item={item} />
        <SocialActions
          item={item}
          commentCount={countComments(item.comments)}
          onAction={onAction}
          onQuote={() => onQuote({ sourceType: "post", sourceId: item.id, sourcePostId: item.id })}
          onCommentsClick={() => {
            onSelectComment(commentsSectionTargetId);
            scrollToComments();
          }}
          actorHandle={actorHandle}
        />
        {isProposal && item.patronage ? (
          <div className="patronage-side-inline"><PatronageProposalRail item={item} /></div>
        ) : isOpportunity && item.opportunity ? (
          <div className="opportunity-side-inline"><OpportunityRail item={item} actorHandle={actorHandle} onApply={onApplyOpportunity} onReview={onReviewOpportunity} /></div>
        ) : null}
        {interactionLocked ? (
          item.comments.length ? (
            <section className="comments-section community-cited-comments" id={commentsSectionId}>
              <h2>Cited comment</h2>
              {item.comments.map((comment) => (
                <article key={comment.id ?? `${comment.author}:${comment.body.slice(0, 20)}`}>
                  <strong>{comment.author}</strong>
                  <p>{comment.body}</p>
                </article>
              ))}
            </section>
          ) : null
        ) : <section className="comments-section" id={commentsSectionId}>
          <h2>Discussion</h2>
          {postDeleted ? null : (
            <CommentComposer
              itemId={item.id}
              profiles={profiles}
              onAddComment={onAddComment}
              onUploadAttachment={onUploadCommentAttachment}
              onResolveQuoteLink={onResolveQuoteLink}
            />
          )}
          <CommentThread
            comments={item.comments}
            itemId={item.id}
            tone={tone}
            profiles={profiles}
            selectedCommentId={threadSelectedCommentId}
            onOpenProfile={onOpenProfile}
            onAddComment={onAddComment}
            onUploadAttachment={onUploadCommentAttachment}
            onResolveQuoteLink={onResolveQuoteLink}
            onOpenAttachmentPreview={onOpenCommentAttachmentPreview}
            onCommentAction={onCommentAction}
            onQuote={onQuote}
            onOpenQuote={onOpenQuote}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
            actorHandle={actorHandle}
            onClearSelectedComment={onClearSelectedComment}
            onSelectComment={onSelectComment}
            commentSegmentStacks={commentSegmentStacks}
            onCommentSegmentStackChange={onCommentSegmentStackChange}
            onVisibleCommentSegmentStackChange={onVisibleCommentSegmentStackChange}
          />
        </section>}
      </section>

      {!isProposal && !isOpportunity && isPaper ? (
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
