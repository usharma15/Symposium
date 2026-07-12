"use client";

import { useState, type FormEvent } from "react";
import { Link2, Paperclip, Quote as QuoteIcon, X } from "lucide-react";
import type {
  ContentQuote,
  ContentQuoteSource,
  InquiryAttachment,
  InquiryItem,
  ResearchProfile
} from "@/lib/mockData";
import { quotedContentExcerpt } from "@/lib/contentQuotes";
import { profileForHandle, profileInitials } from "@/features/identity/profilePresentation";
import type { AttachedQuote, QuoteLinkResolver, QuoteOwner, QuoteSelection } from "@/features/quotes/quoteTypes";
import {
  AttachmentComposerField,
  type AttachmentUploadHandler
} from "@/features/attachments/AttachmentViews";

export type { QuoteSelection } from "@/features/quotes/quoteTypes";
export type QuoteActionHandler = (selection: QuoteSelection) => void;
export type QuotePostDraft = {
  title: string;
  body: string;
  kind: Extract<InquiryItem["kind"], "paper" | "thought">;
  attachments: InquiryAttachment[];
  quoteSource: ContentQuoteSource;
};
export type QuoteCreationResult = { ok: true } | { ok: false; error: string };

const quotePostKind = (quote: ContentQuote) => quote.kind === "paper" ? "paper" : "thought";
const quoteKindLabel = (quote: ContentQuote) => {
  const postKind = quotePostKind(quote) === "paper" ? "Paper" : "Thought";
  return quote.sourceType === "comment" ? `Comment · ${postKind}` : postKind;
};

export function QuoteActionButton({
  disabled = false,
  label,
  onQuote
}: {
  disabled?: boolean;
  label: "post" | "comment";
  onQuote: () => void;
}) {
  return (
    <button
      type="button"
      className="quote-action-button"
      title={`Quote this ${label}`}
      aria-label={`Quote this ${label}`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onQuote();
      }}
    >
      <QuoteIcon size={16} aria-hidden="true" />
    </button>
  );
}

export function ContentQuoteCard({
  quote,
  profiles,
  onOpen,
  onRemove
}: {
  quote: ContentQuote;
  profiles?: Record<string, ResearchProfile>;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  const content = quote.body ? quotedContentExcerpt(quote.body) : "";
  const authorProfile = quote.author
    ? profileForHandle(profiles ?? {}, quote.authorHandle ?? quote.author)
    : undefined;
  const authorName = authorProfile?.name ?? quote.author;
  const postKind = quotePostKind(quote);
  const cardClassName = `quote-card quote-card-${postKind}`;
  const cardBody = (
    <>
      <div className="quote-card-head">
        {quote.available && authorName ? (
          <span className="quote-card-author">
            <span className="avatar small">
              {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : profileInitials(authorName)}
            </span>
            <strong>{authorName}</strong>
          </span>
        ) : <span />}
        <span className={`quote-card-kind quote-kind-${postKind}`}><QuoteIcon size={14} />{quoteKindLabel(quote)}</span>
      </div>
      {quote.available ? (
        <>
          {quote.sourceType === "post" && quote.title ? <h3>{quote.title}</h3> : null}
          <p>{content}</p>
          {quote.attachmentCount ? (
            <span className="quote-card-attachments">
              <Paperclip size={13} />
              {quote.attachmentCount} attachment{quote.attachmentCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </>
      ) : (
        <p className="quote-card-unavailable">Quoted content is unavailable.</p>
      )}
    </>
  );

  return (
    <div className={`quote-card-shell${onRemove ? " removable" : ""}`} data-testid={`quote-card-${quote.sourceType}-${quote.sourceId}`}>
      {quote.available && onOpen ? (
        <button type="button" className={cardClassName} onClick={(event) => { event.stopPropagation(); onOpen(); }}>
          {cardBody}
        </button>
      ) : (
        <div className={cardClassName}>{cardBody}</div>
      )}
      {onRemove ? (
        <button type="button" className="quote-card-remove" title="Remove quote" onClick={onRemove}>
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function QuoteLinkField({
  attached,
  disabled = false,
  owner,
  profiles,
  onChange,
  onResolve
}: {
  attached: AttachedQuote | null;
  disabled?: boolean;
  owner?: QuoteOwner;
  profiles: Record<string, ResearchProfile>;
  onChange: (attached: AttachedQuote | null) => void;
  onResolve: QuoteLinkResolver;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [status, setStatus] = useState("");

  const attach = () => {
    try {
      const resolved = onResolve(link, owner);
      onChange(resolved);
      setLink("");
      setStatus("");
      setOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "That quote could not be attached.");
    }
  };

  if (attached) {
    return (
      <div className="composer-quote-field">
        <ContentQuoteCard
          quote={attached.quote}
          profiles={profiles}
          onRemove={() => {
            onChange(null);
            setStatus("");
          }}
        />
      </div>
    );
  }

  return (
    <div className="composer-quote-field">
      <button
        type="button"
        className="quote-link-toggle"
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setStatus("");
        }}
      >
        <QuoteIcon size={16} />
        Insert quote
      </button>
      {open ? (
        <div className="quote-link-input-row">
          <Link2 size={16} aria-hidden="true" />
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              attach();
            }}
            placeholder="Paste a Symposium post or comment link"
            aria-label="Post or comment link to quote"
          />
          <button type="button" disabled={!link.trim() || disabled} onClick={attach}>Attach</button>
        </div>
      ) : null}
      {status ? <small className="composer-submit-status">{status}</small> : null}
    </div>
  );
}

export function QuoteComposerModal({
  quote,
  selection,
  profiles,
  onClose,
  onCreatePost,
  onAddComment,
  onUploadPostAttachment,
  onUploadCommentAttachment
}: {
  quote: ContentQuote;
  selection: QuoteSelection;
  profiles: Record<string, ResearchProfile>;
  onClose: () => void;
  onCreatePost: (draft: QuotePostDraft) => Promise<QuoteCreationResult>;
  onAddComment: (
    itemId: string,
    body: string,
    stance: string,
    parentId: string | null,
    attachments: InquiryAttachment[],
    quoteSource: ContentQuoteSource
  ) => Promise<boolean>;
  onUploadPostAttachment: AttachmentUploadHandler;
  onUploadCommentAttachment: AttachmentUploadHandler;
}) {
  const [destination, setDestination] = useState<"post" | "comment">("post");
  const [kind, setKind] = useState<QuotePostDraft["kind"]>("thought");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [postAttachments, setPostAttachments] = useState<InquiryAttachment[]>([]);
  const [commentAttachments, setCommentAttachments] = useState<InquiryAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const quoteSource: ContentQuoteSource = { sourceType: selection.sourceType, sourceId: selection.sourceId };
  const attachments = destination === "post" ? postAttachments : commentAttachments;
  const setAttachments = destination === "post" ? setPostAttachments : setCommentAttachments;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanBody = body.trim();
    const cleanTitle = title.trim();
    if (busy || !cleanBody || (destination === "post" && !cleanTitle)) return;
    setBusy(true);
    setStatus(destination === "post" ? "Publishing quoted post" : "Publishing quoted comment");
    try {
      if (destination === "post") {
        const result = await onCreatePost({
          title: cleanTitle,
          body: cleanBody,
          kind,
          attachments: postAttachments,
          quoteSource
        });
        if (!result.ok) {
          setStatus(result.error);
          return;
        }
      } else {
        const saved = await onAddComment(
          selection.sourcePostId,
          cleanBody,
          "Comment",
          selection.sourceType === "comment" ? selection.sourceId : null,
          commentAttachments,
          quoteSource
        );
        if (!saved) {
          setStatus("Quoted comment could not be saved");
          return;
        }
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-composer-modal quote-composer-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div><span>Quote</span><strong>{destination === "post" ? "New post" : "Add comment"}</strong></div>
          <button type="button" title="Close" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="quote-destination-switch" aria-label="Quote destination">
          <button type="button" className={destination === "post" ? "active" : ""} onClick={() => setDestination("post")}>New post</button>
          <button type="button" className={destination === "comment" ? "active" : ""} onClick={() => setDestination("comment")}>Add comment</button>
        </div>
        {destination === "post" ? (
          <div className="composer-topline">
            <select value={kind} onChange={(event) => setKind(event.target.value as QuotePostDraft["kind"])}>
              <option value="thought">Thought</option>
              <option value="paper">Paper</option>
            </select>
            <button type="submit" disabled={busy}>{busy ? "Posting…" : "Post quote"}</button>
          </div>
        ) : (
          <div className="composer-topline quote-comment-submit">
            <span />
            <button type="submit" disabled={busy}>{busy ? "Posting…" : "Post comment"}</button>
          </div>
        )}
        {destination === "post" ? <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" /> : null}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={destination === "comment" ? "Write your comment here" : `Write your ${kind} here`}
        />
        <ContentQuoteCard quote={quote} profiles={profiles} />
        <AttachmentComposerField
          attachments={attachments}
          disabled={busy}
          onAttachmentsChange={setAttachments}
          onBusyChange={setBusy}
          onUploadAttachment={destination === "post" ? onUploadPostAttachment : onUploadCommentAttachment}
        />
        {status ? <small className="composer-submit-status">{status}</small> : null}
      </form>
    </div>
  );
}
