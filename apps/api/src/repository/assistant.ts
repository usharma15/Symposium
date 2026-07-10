import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  assistantMessageInputSchema,
  type AssistantResponseContract
} from "../../../../packages/contracts/src";
import { env } from "../config/env";
import { hasDatabase } from "../db/client";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import type { Actor } from "../services/auth";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

const aiFallbackBody = (message: string) =>
  [
    "The SYMPOSIUM AI tablet backend is receiving messages and storing the conversation path, but the model provider is not configured yet.",
    "",
    `Your message: ${message}`,
    "",
    "Next live step: set an AI provider key and model policy, then this endpoint can return real assistant responses with explicit room/post/community/note context."
  ].join("\n");

export const askAssistant = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantResponseContract> => {
  const input = assistantMessageInputSchema.parse(rawInput);
  const owner = await ensureProfileHandle(actorHandle(actor));
  const providerConfigured = Boolean(env.OPENAI_API_KEY);

  if (!hasDatabase()) {
    const conversationId = input.conversationId ?? randomUUID();
    return {
      conversationId,
      providerConfigured,
      status: providerConfigured ? "answered" : "provider_not_configured",
      message: {
        id: randomUUID(),
        conversationId,
        role: "assistant",
        body: providerConfigured
          ? "The AI provider key is present, but model execution is intentionally not enabled until the live provider policy is finalized."
          : aiFallbackBody(input.message),
        createdAt: new Date().toISOString()
      }
    };
  }

  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<AssistantResponseContract>(client, owner, mutation);
    if (claim.replayed) return { value: claim.response };
    let conversationId = input.conversationId;

    if (!conversationId) {
      const conversation = await client.query<{ id: string }>(
        `INSERT INTO ai_conversations (owner_handle, title, context_type, context_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          owner,
          input.message.slice(0, 80) || "AI tablet conversation",
          input.contextType,
          input.contextId ?? null
        ]
      );
      conversationId = conversation.rows[0]!.id;
    } else {
      const ownedConversation = await client.query(
        "SELECT id FROM ai_conversations WHERE id = $1 AND owner_handle = $2 FOR SHARE",
        [conversationId, owner]
      );
      if (!ownedConversation.rowCount) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "AI conversation not found."
        });
      }
    }

    await client.query(
      `INSERT INTO ai_messages (conversation_id, role, body, metadata)
       VALUES ($1, 'user', $2, $3)`,
      [conversationId, input.message, JSON.stringify({ contextType: input.contextType, contextId: input.contextId ?? null })]
    );

    const body = providerConfigured
      ? "The AI provider key is present, but model execution is intentionally not enabled until the live provider policy is finalized."
      : aiFallbackBody(input.message);
    const assistantMessage = await client.query(
      `INSERT INTO ai_messages (conversation_id, role, body, metadata)
       VALUES ($1, 'assistant', $2, $3)
       RETURNING id, conversation_id AS "conversationId", role, body, created_at AS "createdAt"`,
      [conversationId, body, JSON.stringify({ providerConfigured, model: env.SYMPOSIUM_AI_MODEL })]
    );
    await client.query("UPDATE ai_conversations SET updated_at = now() WHERE id = $1 AND owner_handle = $2", [
      conversationId,
      owner
    ]);
    const response: AssistantResponseContract = {
      conversationId,
      providerConfigured,
      status: providerConfigured ? "answered" : "provider_not_configured",
      message: {
        ...assistantMessage.rows[0],
        role: "assistant",
        createdAt: assistantMessage.rows[0]?.createdAt
          ? new Date(assistantMessage.rows[0].createdAt).toISOString()
          : undefined
      }
    };
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "assistant.message",
      subjectType: "ai_conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, {
        contextId: input.contextId,
        contextType: input.contextType,
        providerConfigured
      })
    });
    await completeMutation(client, owner, mutation, response);
    const event = await stageEvent(client, {
      kind: "assistant.message.created",
      actorHandle: owner,
      subjectType: "ai_conversation",
      subjectId: conversationId,
      visibility: "private",
      payload: { messageId: response.message.id, status: response.status }
    });
    return { value: response, events: [event] };
  });
};
