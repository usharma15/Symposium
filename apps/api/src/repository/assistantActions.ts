import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  assistantActionProposalSchema,
  assistantActionReceiptSchema,
  confirmAssistantOfficeNoteDraftInputSchema,
  confirmAssistantOfficePostDraftInputSchema,
  type AssistantActionReceiptContract,
  type AssistantActionSourceContract,
  type AssistantActionToolContract,
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
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";
import { createWorkspaceDocumentInTransaction } from "./workspaceDocuments";

type ActionMessageRow = {
  id: string;
  metadata: Record<string, unknown>;
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
) => confirmAssistantOfficeDraftInTransaction(
  client,
  input,
  handle,
  "office.note.create_draft",
  mutation
);

export const confirmAssistantOfficePostDraftInTransaction = async (
  client: PoolClient,
  input: ConfirmAssistantOfficePostDraftInputContract,
  handle: string,
  mutation?: MutationContext
) => confirmAssistantOfficeDraftInTransaction(
  client,
  input,
  handle,
  "office.post.create_draft",
  mutation
);

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
