import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  assistantActionProposalSchema,
  assistantActionReceiptSchema,
  confirmAssistantOfficeDraftEditInputSchema,
  confirmAssistantOfficeNoteDraftInputSchema,
  confirmAssistantOfficePostDraftInputSchema,
  undoAssistantOfficeDraftEditInputSchema,
  versionedDocumentSchema,
  type AssistantActionReceiptContract,
  type AssistantActionSourceContract,
  type AssistantActionToolContract,
  type AssistantDraftEditModeContract,
  type AssistantDraftEditSessionContract,
  type ConfirmAssistantOfficeDraftEditInputContract,
  type ConfirmAssistantOfficeNoteDraftInputContract,
  type ConfirmAssistantOfficePostDraftInputContract
} from "../../../../packages/contracts/src";
import { plainTextDocument } from "@/lib/documentModel";
import { hasDatabase } from "../db/client";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import type { Actor } from "../services/auth";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { registeredAssistantAction } from "../services/assistantActionRegistry";
import {
  assistantDraftModelBlocks,
  type AssistantDraftModelContext
} from "../services/assistantDraftEdits";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";
import {
  applyAssistantWorkspaceDraftEditInTransaction,
  createWorkspaceDocumentInTransaction,
  undoAssistantWorkspaceDraftEditInTransaction
} from "./workspaceDocuments";
import { assistantNoteTargetTitleForPrompt } from "./assistantSiteSearch";

type ActionMessageRow = {
  id: string;
  metadata: Record<string, unknown>;
};

export const findAuthorizedAssistantDraftInTransaction = async (
  client: PoolClient,
  session: AssistantDraftEditSessionContract,
  conversationId: string,
  handle: string
): Promise<AssistantDraftModelContext> => {
  const result = await client.query<{
    id: string;
    title: string;
    revision: number;
    kind: string;
    document: unknown;
  }>(
    `SELECT
       note.id::text,
       note.title,
       note.revision,
       note.kind,
       note.content_document AS document
     FROM notes note
     WHERE note.id = $1
       AND note.owner_handle = $2
       AND note.lifecycle = 'draft'
       AND note.visibility = 'private'
       AND note.deleted_at IS NULL
       AND EXISTS (
         SELECT 1
         FROM ai_messages message
         JOIN ai_conversations conversation ON conversation.id = message.conversation_id
         WHERE message.conversation_id = $3
           AND conversation.owner_handle = $2
           AND conversation.kind = 'research_thread'
           AND conversation.archived_at IS NULL
           AND conversation.deleted_at IS NULL
           AND message.role = 'assistant'
           AND message.metadata -> 'actionReceipt' ->> 'documentId' = note.id::text
           AND message.metadata -> 'actionReceipt' ->> 'tool' IN (
             'office.note.create_draft',
             'office.post.create_draft'
           )
       )
     FOR SHARE OF note`,
    [session.documentId, handle, conversationId]
  );
  const draft = result.rows[0];
  if (!draft) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That private Assistant draft is not available in this chat."
    });
  }
  if (draft.revision !== session.expectedRevision) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This draft changed from revision ${session.expectedRevision} to ${draft.revision}. Review the current draft before asking the AI to edit it.`
    });
  }
  const document = versionedDocumentSchema.parse(draft.document);
  const modelBlocks = assistantDraftModelBlocks(document);
  return {
    documentId: draft.id,
    title: draft.title,
    revision: draft.revision,
    kind: draft.kind,
    ...modelBlocks
  };
};

export const findExplicitAssistantNoteTargetInTransaction = async (
  client: PoolClient,
  request: string,
  handle: string
): Promise<AssistantDraftModelContext | null> => {
  const title = assistantNoteTargetTitleForPrompt(request);
  if (!title) return null;
  const result = await client.query<{
    id: string;
    title: string;
    revision: number;
    kind: string;
    body: string;
    document: unknown;
  }>(
    `SELECT note.id::text, note.title, note.revision, note.kind, note.body,
            note.content_document AS document
     FROM notes note
     WHERE note.owner_handle = $1
       AND lower(note.title) = lower($2)
       AND note.lifecycle = 'draft'
       AND note.visibility = 'private'
       AND note.deleted_at IS NULL
     ORDER BY note.updated_at DESC, note.id DESC
     LIMIT 2
     FOR SHARE OF note`,
    [handle, title]
  );
  if (result.rows.length !== 1) return null;
  const draft = result.rows[0]!;
  const parsedDocument = versionedDocumentSchema.safeParse(draft.document);
  const document = parsedDocument.success
    ? parsedDocument.data
    : plainTextDocument(draft.body);
  return {
    documentId: draft.id,
    title: draft.title,
    revision: draft.revision,
    kind: draft.kind,
    ...assistantDraftModelBlocks(document)
  };
};

const assistantActionResourceTypes = {
  post: "post",
  community: "community",
  profile: "profile",
  workspace: "note",
  messages: "conversation",
  opportunity: "opportunity",
  attachment: "attachment"
} as const;

const assistantOfficeDraftDocument = (
  body: string,
  source?: AssistantActionSourceContract
) => {
  const document = plainTextDocument(body);
  if (!source?.entityId || !(source.surface in assistantActionResourceTypes)) {
    return document;
  }
  const surface = source.surface as keyof typeof assistantActionResourceTypes;
  return {
    ...document,
    nodes: [
      ...document.nodes,
      {
        id: `assistant-action-source-${randomUUID()}`,
        type: "reference" as const,
        resource: {
          type: assistantActionResourceTypes[surface],
          id: source.entityId,
          label: source.title
        }
      }
    ]
  };
};

type ConfirmAssistantOfficeDraftInput =
  | ConfirmAssistantOfficeNoteDraftInputContract
  | ConfirmAssistantOfficePostDraftInputContract;

const mismatchedAssistantAction = () => new TRPCError({
  code: "PRECONDITION_FAILED",
  message: "That Assistant action does not match this confirmation endpoint."
});

const receiptForExpectedTool = (
  value: unknown,
  expectedTool: AssistantActionToolContract
) => {
  const receipt = assistantActionReceiptSchema.safeParse(value);
  if (!receipt.success || receipt.data.tool !== expectedTool) {
    throw mismatchedAssistantAction();
  }
  return receipt.data;
};

const confirmAssistantOfficeDraftInTransaction = async (
  client: PoolClient,
  input: ConfirmAssistantOfficeDraftInput,
  handle: string,
  expectedTool: AssistantActionToolContract,
  mutation?: MutationContext
): Promise<{
  value: AssistantActionReceiptContract;
  events?: Awaited<ReturnType<typeof stageEvent>>[];
}> => {
    if (expectedTool === "office.document.edit_draft") {
      throw mismatchedAssistantAction();
    }
    const claim = await claimMutation<AssistantActionReceiptContract>(client, handle, mutation);
    if (claim.replayed) {
      return { value: receiptForExpectedTool(claim.response, expectedTool) };
    }

    const assistantMessage = await client.query<ActionMessageRow>(
      `SELECT message.id::text, message.metadata
       FROM ai_messages message
       JOIN ai_conversations conversation ON conversation.id = message.conversation_id
       WHERE message.id = $1
         AND message.conversation_id = $2
         AND message.role = 'assistant'
         AND conversation.owner_handle = $3
         AND conversation.kind = 'research_thread'
         AND conversation.archived_at IS NULL
         AND conversation.deleted_at IS NULL
         AND message.metadata -> 'actionProposal' IS NOT NULL
         AND message.metadata -> 'actionProposal' <> 'null'::jsonb
       FOR UPDATE OF message, conversation`,
      [input.assistantMessageId, input.conversationId, handle]
    );
    const actionMessage = assistantMessage.rows[0];
    if (!actionMessage) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "That Assistant action is no longer available to confirm."
      });
    }

    const proposal = assistantActionProposalSchema.safeParse(
      actionMessage.metadata.actionProposal
    );
    if (!proposal.success) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "That Assistant action proposal is invalid or unsupported."
      });
    }
    if (proposal.data.tool !== expectedTool) {
      throw mismatchedAssistantAction();
    }
    if (
      actionMessage.metadata.actionReceipt !== undefined &&
      actionMessage.metadata.actionReceipt !== null
    ) {
      const existingReceipt = receiptForExpectedTool(
        actionMessage.metadata.actionReceipt,
        expectedTool
      );
      if (existingReceipt.tool === "office.document.edit_draft") {
        throw mismatchedAssistantAction();
      }
      if (
        existingReceipt.tool === "office.post.create_draft" &&
        proposal.data.tool === "office.post.create_draft" &&
        existingReceipt.documentKind !== proposal.data.postKind
      ) {
        throw mismatchedAssistantAction();
      }
      await completeMutation(client, handle, mutation, existingReceipt);
      return { value: existingReceipt };
    }

    const action = registeredAssistantAction(proposal.data.tool);
    const postInput = expectedTool === "office.post.create_draft"
      ? confirmAssistantOfficePostDraftInputSchema.parse(input)
      : null;
    const confirmedInput = postInput ??
      confirmAssistantOfficeNoteDraftInputSchema.parse(input);
    action.inputSchema.parse(confirmedInput);
    const documentKind = postInput?.postKind ?? "note";
    const publicationTarget = documentKind === "note"
      ? "undecided"
      : documentKind;

    const created = await createWorkspaceDocumentInTransaction(
      client,
      {
        title: confirmedInput.title,
        body: confirmedInput.body,
        document: assistantOfficeDraftDocument(
          confirmedInput.body,
          proposal.data.source
        ),
        kind: documentKind,
        publicationTarget,
        notebookId: confirmedInput.notebookId,
        targetId: null,
        proposal: null,
        opportunity: null,
        attachmentIds: []
      },
      handle,
      mutation,
      {
        source: "assistant_action",
        assistantMessageId: confirmedInput.assistantMessageId,
        conversationId: confirmedInput.conversationId,
        assistantTool: proposal.data.tool
      }
    );
    const document = created.value.document as typeof created.value.document & {
      id: unknown;
      title: unknown;
      revision: unknown;
    };
    const receiptBase = {
      tool: proposal.data.tool,
      status: "completed",
      documentId: document.id,
      title: document.title,
      revision: document.revision,
      notebookId: document.notebookId ?? null,
      notebookName: document.notebookName ?? null,
      href: `/workspace?view=notes&note=${encodeURIComponent(String(document.id))}`,
      confirmedAt: new Date().toISOString()
    } as const;
    const receipt = assistantActionReceiptSchema.parse(
      proposal.data.tool === "office.post.create_draft"
        ? { ...receiptBase, documentKind }
        : receiptBase
    );
    if (receipt.tool === "office.document.edit_draft") {
      throw mismatchedAssistantAction();
    }
    const confirmedProposal = proposal.data.tool === "office.post.create_draft"
      ? {
          ...proposal.data,
          title: confirmedInput.title,
          body: confirmedInput.body,
          postKind: documentKind
        }
      : {
          ...proposal.data,
          title: confirmedInput.title,
          body: confirmedInput.body
        };

    await client.query(
      `UPDATE ai_messages
       SET metadata = metadata || $2::jsonb
       WHERE id = $1`,
      [
        confirmedInput.assistantMessageId,
        JSON.stringify({
          actionProposal: confirmedProposal,
          actionReceipt: receipt
        })
      ]
    );
    await client.query(
      `UPDATE ai_conversations
       SET updated_at = now(), last_message_at = GREATEST(last_message_at, now())
       WHERE id = $1 AND owner_handle = $2`,
      [confirmedInput.conversationId, handle]
    );
    await stageAuditLog(client, {
      actorHandle: handle,
      action: proposal.data.tool === "office.post.create_draft"
        ? "assistant.action.office_post.create_draft"
        : "assistant.action.office_note.create_draft",
      subjectType: "note",
      subjectId: receipt.documentId,
      metadata: mutationAuditMetadata(mutation, {
        assistantMessageId: confirmedInput.assistantMessageId,
        conversationId: confirmedInput.conversationId,
        tool: proposal.data.tool,
        documentKind,
        publicationTarget,
        permission: action.permission,
        requiresConfirmation: action.requiresConfirmation,
        notebookId: receipt.notebookId,
        sourceSurface: proposal.data.source?.surface ?? null,
        sourceId: proposal.data.source?.entityId ?? null
      })
    });
    await completeMutation(client, handle, mutation, receipt);
    const assistantEvent = await stageEvent(client, {
      kind: "assistant.action.completed",
      actorHandle: handle,
      audienceHandles: [handle],
      subjectType: "ai_conversation",
      subjectId: confirmedInput.conversationId,
      visibility: "private",
      payload: {
        messageId: confirmedInput.assistantMessageId,
        tool: proposal.data.tool,
        documentId: receipt.documentId,
        documentKind
      }
    });
    return {
      value: receipt,
      events: [created.event, assistantEvent]
    };
};

export const confirmAssistantOfficeNoteDraftInTransaction = async (
  client: PoolClient,
  input: ConfirmAssistantOfficeNoteDraftInputContract,
  handle: string,
  mutation?: MutationContext
): Promise<{
  value: Extract<
    AssistantActionReceiptContract,
    { tool: "office.note.create_draft" }
  >;
  events?: Awaited<ReturnType<typeof stageEvent>>[];
}> => confirmAssistantOfficeDraftInTransaction(
  client,
  input,
  handle,
  "office.note.create_draft",
  mutation
) as Promise<{
  value: Extract<
    AssistantActionReceiptContract,
    { tool: "office.note.create_draft" }
  >;
  events?: Awaited<ReturnType<typeof stageEvent>>[];
}>;

export const confirmAssistantOfficePostDraftInTransaction = async (
  client: PoolClient,
  input: ConfirmAssistantOfficePostDraftInputContract,
  handle: string,
  mutation?: MutationContext
): Promise<{
  value: Extract<
    AssistantActionReceiptContract,
    { tool: "office.post.create_draft" }
  >;
  events?: Awaited<ReturnType<typeof stageEvent>>[];
}> => confirmAssistantOfficeDraftInTransaction(
  client,
  input,
  handle,
  "office.post.create_draft",
  mutation
) as Promise<{
  value: Extract<
    AssistantActionReceiptContract,
    { tool: "office.post.create_draft" }
  >;
  events?: Awaited<ReturnType<typeof stageEvent>>[];
}>;

export const applyAssistantOfficeDraftEditForMessageInTransaction = async (
  client: PoolClient,
  input: ConfirmAssistantOfficeDraftEditInputContract,
  handle: string,
  mode: AssistantDraftEditModeContract
): Promise<{
  value: AssistantActionReceiptContract;
  events: Awaited<ReturnType<typeof stageEvent>>[];
}> => {
  const assistantMessage = await client.query<ActionMessageRow>(
    `SELECT message.id::text, message.metadata
     FROM ai_messages message
     JOIN ai_conversations conversation ON conversation.id = message.conversation_id
     WHERE message.id = $1
       AND message.conversation_id = $2
       AND message.role = 'assistant'
       AND conversation.owner_handle = $3
       AND conversation.kind = 'research_thread'
       AND conversation.archived_at IS NULL
       AND conversation.deleted_at IS NULL
       AND message.metadata -> 'actionProposal' IS NOT NULL
       AND message.metadata -> 'actionProposal' <> 'null'::jsonb
     FOR UPDATE OF message, conversation`,
    [input.assistantMessageId, input.conversationId, handle]
  );
  const actionMessage = assistantMessage.rows[0];
  if (!actionMessage) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That Assistant draft edit is no longer available."
    });
  }
  const proposal = assistantActionProposalSchema.safeParse(
    actionMessage.metadata.actionProposal
  );
  if (!proposal.success || proposal.data.tool !== "office.document.edit_draft") {
    throw mismatchedAssistantAction();
  }
  if (
    actionMessage.metadata.actionReceipt !== undefined &&
    actionMessage.metadata.actionReceipt !== null
  ) {
    return {
      value: receiptForExpectedTool(
        actionMessage.metadata.actionReceipt,
        "office.document.edit_draft"
      ),
      events: []
    };
  }
  if (input.expectedRevision !== proposal.data.expectedRevision) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The confirmation does not match the proposed draft revision."
    });
  }
  const action = registeredAssistantAction(proposal.data.tool);
  action.inputSchema.parse(input);
  const applied = await applyAssistantWorkspaceDraftEditInTransaction(
    client,
    {
      noteId: proposal.data.documentId,
      expectedRevision: proposal.data.expectedRevision,
      operations: proposal.data.editOperations,
      mode,
      assistantMessageId: input.assistantMessageId,
      conversationId: input.conversationId
    },
    handle
  );
  const document = applied.value.document as unknown as {
    id: string;
    title: string;
    revision: number;
  };
  const receipt = assistantActionReceiptSchema.parse({
    tool: "office.document.edit_draft",
    status: "completed",
    documentId: document.id,
    title: document.title,
    previousRevision: applied.value.previousRevision,
    revision: document.revision,
    mode,
    operationCount: applied.value.operationCount,
    href: `/workspace?view=notes&note=${encodeURIComponent(document.id)}`,
    appliedAt: new Date().toISOString()
  });
  if (receipt.tool !== "office.document.edit_draft") {
    throw mismatchedAssistantAction();
  }
  await client.query(
    `UPDATE ai_messages
     SET metadata = metadata || $2::jsonb
     WHERE id = $1`,
    [
      input.assistantMessageId,
      JSON.stringify({ actionProposal: proposal.data, actionReceipt: receipt })
    ]
  );
  await client.query(
    `UPDATE ai_conversations
     SET updated_at = now(), last_message_at = GREATEST(last_message_at, now())
     WHERE id = $1 AND owner_handle = $2`,
    [input.conversationId, handle]
  );
  await stageAuditLog(client, {
    actorHandle: handle,
    action: "assistant.action.office_document.edit_draft",
    subjectType: "note",
    subjectId: receipt.documentId,
    metadata: {
      assistantMessageId: input.assistantMessageId,
      conversationId: input.conversationId,
      tool: proposal.data.tool,
      mode,
      previousRevision: receipt.previousRevision,
      revision: receipt.revision,
      operationCount: receipt.operationCount,
      permission: action.permission,
      requiresConfirmation: action.requiresConfirmation,
      publicationChanged: false
    }
  });
  const assistantEvent = await stageEvent(client, {
    kind: "assistant.action.completed",
    actorHandle: handle,
    audienceHandles: [handle],
    subjectType: "ai_conversation",
    subjectId: input.conversationId,
    visibility: "private",
    payload: {
      messageId: input.assistantMessageId,
      tool: proposal.data.tool,
      documentId: receipt.documentId,
      previousRevision: receipt.previousRevision,
      revision: receipt.revision,
      mode
    }
  });
  return {
    value: receipt,
    events: [applied.event, assistantEvent]
  };
};

export const confirmAssistantOfficeDraftEditInTransaction = async (
  client: PoolClient,
  input: ConfirmAssistantOfficeDraftEditInputContract,
  handle: string,
  mutation?: MutationContext
) => {
  const claim = await claimMutation<AssistantActionReceiptContract>(
    client,
    handle,
    mutation
  );
  if (claim.replayed) {
    return {
      value: receiptForExpectedTool(
        claim.response,
        "office.document.edit_draft"
      )
    };
  }
  const applied = await applyAssistantOfficeDraftEditForMessageInTransaction(
    client,
    input,
    handle,
    "review"
  );
  await completeMutation(client, handle, mutation, applied.value);
  return applied;
};

export const undoAssistantOfficeDraftEditInTransaction = async (
  client: PoolClient,
  input: ConfirmAssistantOfficeDraftEditInputContract,
  handle: string,
  mutation?: MutationContext
) => {
  const claim = await claimMutation<AssistantActionReceiptContract>(
    client,
    handle,
    mutation
  );
  if (claim.replayed) {
    return {
      value: receiptForExpectedTool(
        claim.response,
        "office.document.edit_draft"
      )
    };
  }
  const assistantMessage = await client.query<ActionMessageRow>(
    `SELECT message.id::text, message.metadata
     FROM ai_messages message
     JOIN ai_conversations conversation ON conversation.id = message.conversation_id
     WHERE message.id = $1
       AND message.conversation_id = $2
       AND message.role = 'assistant'
       AND conversation.owner_handle = $3
       AND conversation.kind = 'research_thread'
       AND conversation.archived_at IS NULL
       AND conversation.deleted_at IS NULL
     FOR UPDATE OF message, conversation`,
    [input.assistantMessageId, input.conversationId, handle]
  );
  const actionMessage = assistantMessage.rows[0];
  if (!actionMessage) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That Assistant draft edit is no longer available."
    });
  }
  const proposal = assistantActionProposalSchema.safeParse(
    actionMessage.metadata.actionProposal
  );
  const receipt = assistantActionReceiptSchema.safeParse(
    actionMessage.metadata.actionReceipt
  );
  if (
    !proposal.success ||
    proposal.data.tool !== "office.document.edit_draft" ||
    !receipt.success ||
    receipt.data.tool !== "office.document.edit_draft"
  ) {
    throw mismatchedAssistantAction();
  }
  if (receipt.data.status === "undone") {
    await completeMutation(client, handle, mutation, receipt.data);
    return { value: receipt.data };
  }
  if (input.expectedRevision !== receipt.data.revision) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Undo must target the exact AI-applied revision."
    });
  }
  const restored = await undoAssistantWorkspaceDraftEditInTransaction(
    client,
    {
      noteId: receipt.data.documentId,
      expectedRevision: receipt.data.revision,
      restoreRevision: receipt.data.previousRevision,
      assistantMessageId: input.assistantMessageId,
      conversationId: input.conversationId
    },
    handle
  );
  const document = restored.value.document as unknown as {
    id: string;
    title: string;
    revision: number;
  };
  const undoneReceipt = assistantActionReceiptSchema.parse({
    ...receipt.data,
    status: "undone",
    title: document.title,
    undoRevision: document.revision,
    undoneAt: new Date().toISOString()
  });
  await client.query(
    `UPDATE ai_messages
     SET metadata = metadata || $2::jsonb
     WHERE id = $1`,
    [input.assistantMessageId, JSON.stringify({ actionReceipt: undoneReceipt })]
  );
  await stageAuditLog(client, {
    actorHandle: handle,
    action: "assistant.action.office_document.edit_draft_undo",
    subjectType: "note",
    subjectId: receipt.data.documentId,
    metadata: mutationAuditMetadata(mutation, {
      assistantMessageId: input.assistantMessageId,
      conversationId: input.conversationId,
      appliedRevision: receipt.data.revision,
      restoredFromRevision: receipt.data.previousRevision,
      undoRevision: document.revision
    })
  });
  await completeMutation(client, handle, mutation, undoneReceipt);
  const assistantEvent = await stageEvent(client, {
    kind: "assistant.action.undone",
    actorHandle: handle,
    audienceHandles: [handle],
    subjectType: "ai_conversation",
    subjectId: input.conversationId,
    visibility: "private",
    payload: {
      messageId: input.assistantMessageId,
      tool: proposal.data.tool,
      documentId: receipt.data.documentId,
      revision: document.revision
    }
  });
  return {
    value: undoneReceipt,
    events: [restored.event, assistantEvent]
  };
};

export const confirmAssistantOfficeNoteDraft = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantActionReceiptContract> => {
  const input = confirmAssistantOfficeNoteDraftInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI Assistant actions require the live workspace."
    });
  }
  await ensureLiveData();
  return runAtomic((client) =>
    confirmAssistantOfficeNoteDraftInTransaction(client, input, handle, mutation)
  );
};

export const confirmAssistantOfficeDraftEdit = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantActionReceiptContract> => {
  const input = confirmAssistantOfficeDraftEditInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI Assistant actions require the live workspace."
    });
  }
  await ensureLiveData();
  return runAtomic((client) =>
    confirmAssistantOfficeDraftEditInTransaction(client, input, handle, mutation)
  );
};

export const undoAssistantOfficeDraftEdit = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantActionReceiptContract> => {
  const input = undoAssistantOfficeDraftEditInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI Assistant actions require the live workspace."
    });
  }
  await ensureLiveData();
  return runAtomic((client) =>
    undoAssistantOfficeDraftEditInTransaction(client, input, handle, mutation)
  );
};

export const confirmAssistantOfficePostDraft = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantActionReceiptContract> => {
  const input = confirmAssistantOfficePostDraftInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI Assistant actions require the live workspace."
    });
  }
  await ensureLiveData();
  return runAtomic((client) =>
    confirmAssistantOfficePostDraftInTransaction(client, input, handle, mutation)
  );
};
