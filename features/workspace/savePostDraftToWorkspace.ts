"use client";

import {
  createClientMutationId,
  shouldRetainRetryMutation,
  symposiumApi,
  SymposiumApiError
} from "@/features/api/symposiumApiClient";
import { publishCrossTabMessage } from "@/features/live-sync/useCrossTabItemTransport";
import type { ContentQuote, ContentQuoteSource, InquiryAttachment } from "@/lib/mockData";
import type { OpportunityPostInputContract, PatronageProposalInputContract, VersionedDocumentContract } from "@/packages/contracts/src";

type ComposerDraft = {
  title: string;
  body: string;
  document: VersionedDocumentContract;
  kind: "paper" | "thought" | "proposal" | "opportunity";
  patronage?: PatronageProposalInputContract;
  opportunity?: OpportunityPostInputContract;
  attachments: InquiryAttachment[];
  quoteSource?: ContentQuoteSource;
  quoteSnapshot?: ContentQuote;
};

type RetryMutation = {
  fingerprintKey: string;
  idempotencyKey: string;
};

const documentWithQuotedReference = (
  document: VersionedDocumentContract,
  quote: ContentQuote | undefined
): VersionedDocumentContract => {
  if (!quote?.available || document.nodes.length >= 2000) return document;
  const canonicalPath = quote.sourceType === "comment"
    ? `/posts/${encodeURIComponent(quote.sourcePostId)}?comment=${encodeURIComponent(quote.sourceId)}`
    : `/posts/${encodeURIComponent(quote.sourcePostId)}`;
  return {
    ...document,
    nodes: [
      ...document.nodes,
      {
        id: `workspace-quote-${crypto.randomUUID()}`,
        type: "reference",
        resource: {
          type: quote.sourceType,
          id: quote.sourceId,
          label: quote.title ?? quote.body?.slice(0, 300) ?? "Quoted Symposium post"
        },
        source: {
          kind: quote.sourceType,
          sourceId: quote.sourceId,
          sourcePostId: quote.sourcePostId,
          sourceRevision: quote.sourceRevision,
          author: quote.author,
          authorHandle: quote.authorHandle,
          title: quote.title,
          body: quote.body?.slice(0, 4000),
          createdAt: quote.createdAt,
          canonicalPath
        }
      }
    ]
  };
};

export const savePostDraftToWorkspace = async ({
  actorHandle,
  draft,
  acquireMutation,
  clearMutation,
  onStatus
}: {
  actorHandle: string;
  draft: ComposerDraft;
  acquireMutation: (fingerprint: string) => RetryMutation;
  clearMutation: (fingerprintKey: string) => void;
  onStatus: (message: string) => void;
}) => {
  const proposal = draft.kind === "proposal" ? draft.patronage ?? null : null;
  const opportunity = draft.kind === "opportunity" ? draft.opportunity ?? null : null;
  if (draft.kind === "proposal" && !proposal) {
    const error = "Add a valid funding goal before saving this proposal draft.";
    onStatus(error);
    return { ok: false as const, error };
  }
  const workspaceKind = draft.kind === "proposal" ? "paper" : draft.kind === "opportunity" ? "thought" : draft.kind;
  const payload = {
    title: draft.title.trim() || `Untitled ${draft.kind}`,
    body: draft.body,
    document: documentWithQuotedReference(draft.document, draft.quoteSnapshot),
    kind: workspaceKind,
    publicationTarget: draft.kind,
    notebookId: null,
    targetId: null,
    proposal,
    opportunity,
    attachmentIds: draft.attachments.map((attachment) => attachment.id)
  };
  const mutation = acquireMutation(JSON.stringify(payload));
  onStatus("Saving draft to Notes");
  try {
    await symposiumApi.request("/api/workspace/documents", {
      method: "POST",
      idempotencyKey: mutation.idempotencyKey,
      body: { ...payload, actorHandle }
    });
  } catch (error) {
    if (!shouldRetainRetryMutation(error)) clearMutation(mutation.fingerprintKey);
    const message =
      error instanceof SymposiumApiError && error.status === null
        ? "Draft could not reach the live service"
        : error instanceof Error
          ? error.message
          : "Draft could not be saved";
    onStatus(message);
    return { ok: false as const, error: message };
  }

  clearMutation(mutation.fingerprintKey);
  const message = {
    type: "workspace-change" as const,
    actorHandle,
    sourceId: createClientMutationId("workspace-composer"),
    changedAt: new Date().toISOString()
  };
  window.dispatchEvent(new Event("symposium-workspace-change"));
  try {
    const channel = "BroadcastChannel" in window
      ? new BroadcastChannel("symposium-workspace-sync-v1")
      : null;
    publishCrossTabMessage({
      channel,
      message,
      storage: window.localStorage,
      storageKey: "symposium-cross-tab-workspace"
    });
    channel?.close();
  } catch {
    // The saved draft remains authoritative when browser cross-tab transport is unavailable.
  }
  onStatus("Draft saved to Notes");
  return { ok: true as const };
};
