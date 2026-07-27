import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  assistantActionProposalSchema,
  assistantActionReceiptSchema,
  confirmAssistantOfficeNoteDraftInputSchema,
  type AssistantActionReceiptContract,
  type AssistantActionSourceContract,
  type ConfirmAssistantOfficeNoteDraftInputContract
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

const assistantOfficeNoteDocument = (
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

export const confirmAssistantOfficeNoteDraftInTransaction = async (
  client: PoolClient,
  input: ConfirmAssistantOfficeNoteDraftInputContract,
  handle: string,
  mutation?: MutationContext
  ) => {
    const claim = await claimMutation<AssistantActionReceiptContract>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };

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

    const existingReceipt = assistantActionReceiptSchema.safeParse(
      actionMessage.metadata.actionReceipt
    );
    if (existingReceipt.success) {
      await completeMutation(client, handle, mutation, existingReceipt.data);
      return { value: existingReceipt.data };
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
    const action = registeredAssistantAction(proposal.data.tool);
    action.inputSchema.parse(input);

    const created = await createWorkspaceDocumentInTransaction(
      client,
      {
        title: input.title,
        body: input.body,
        document: assistantOfficeNoteDocument(input.body, proposal.data.source),
        kind: "note",
        publicationTarget: "undecided",
        notebookId: input.notebookId,
        targetId: null,
        proposal: null,
        opportunity: null,
        attachmentIds: []
      },
      handle,
      mutation,
      {
        source: "assistant_action",
        assistantMessageId: input.assistantMessageId,
        conversationId: input.conversationId,
        assistantTool: proposal.data.tool
      }
    );
    const document = created.value.document as typeof created.value.document & {
      id: unknown;
      title: unknown;
      revision: unknown;
    };
    const receipt = assistantActionReceiptSchema.parse({
      tool: proposal.data.tool,
      status: "completed",
      documentId: document.id,
      title: document.title,
      revision: document.revision,
      notebookId: document.notebookId ?? null,
      notebookName: document.notebookName ?? null,
      href: `/workspace?view=notes&note=${encodeURIComponent(String(document.id))}`,
      confirmedAt: new Date().toISOString()
    });

    await client.query(
      `UPDATE ai_messages
       SET metadata = metadata || $2::jsonb
       WHERE id = $1`,
      [
        input.assistantMessageId,
        JSON.stringify({
          actionProposal: {
            ...proposal.data,
            title: input.title,
            body: input.body
          },
          actionReceipt: receipt
        })
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
      action: "assistant.action.office_note.create_draft",
      subjectType: "note",
      subjectId: receipt.documentId,
      metadata: mutationAuditMetadata(mutation, {
        assistantMessageId: input.assistantMessageId,
        conversationId: input.conversationId,
        tool: proposal.data.tool,
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
      subjectId: input.conversationId,
      visibility: "private",
      payload: {
        messageId: input.assistantMessageId,
        tool: proposal.data.tool,
        documentId: receipt.documentId
      }
    });
    return {
      value: receipt,
      events: [created.event, assistantEvent]
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
