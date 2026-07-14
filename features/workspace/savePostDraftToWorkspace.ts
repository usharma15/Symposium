"use client";

import {
  createClientMutationId,
  shouldRetainRetryMutation,
  symposiumApi,
  SymposiumApiError
} from "@/features/api/symposiumApiClient";
import { publishCrossTabMessage } from "@/features/live-sync/useCrossTabItemTransport";
import type { ContentQuoteSource, InquiryAttachment } from "@/lib/mockData";
import type { VersionedDocumentContract } from "@/packages/contracts/src";

type ComposerDraft = {
  title: string;
  body: string;
  document: VersionedDocumentContract;
  kind: "paper" | "thought";
  attachments: InquiryAttachment[];
  quoteSource?: ContentQuoteSource;
};

type RetryMutation = {
  fingerprintKey: string;
  idempotencyKey: string;
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
  if (draft.attachments.length || draft.quoteSource) {
    const error = "Remove attached files and quotes before moving this draft into the private Notes workspace.";
    onStatus(error);
    return { ok: false as const, error };
  }

  const payload = {
    title: draft.title.trim() || `Untitled ${draft.kind}`,
    body: draft.body,
    document: draft.document,
    kind: draft.kind,
    publicationTarget: draft.kind,
    notebookId: null,
    targetId: null,
    attachmentIds: []
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
