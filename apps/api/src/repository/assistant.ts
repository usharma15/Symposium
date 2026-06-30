import { randomUUID } from "node:crypto";
import {
  assistantMessageInputSchema,
  type AssistantResponseContract
} from "../../../../packages/contracts/src";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

const aiFallbackBody = (message: string) =>
  [
    "The SYMPOSIUM AI tablet backend is receiving messages and storing the conversation path, but the model provider is not configured yet.",
    "",
    `Your message: ${message}`,
    "",
    "Next live step: set an AI provider key and model policy, then this endpoint can return real assistant responses with explicit room/post/community/note context."
  ].join("\n");

export const askAssistant = async (rawInput: unknown, actor: Actor): Promise<AssistantResponseContract> => {
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
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
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
    await client.query("COMMIT");

    return {
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
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
