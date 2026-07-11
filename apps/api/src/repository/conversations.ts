import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { sendMessageInputSchema } from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

export const listConversations = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return [];
  await ensureLiveData();
  const result = await getPool().query(
    `SELECT c.id, c.kind, c.title, c.updated_at AS "updatedAt",
      COALESCE(json_agg(cp.profile_handle) FILTER (WHERE cp.profile_handle IS NOT NULL), '[]') AS participants
     FROM conversations c
     JOIN conversation_participants me ON me.conversation_id = c.id AND me.profile_handle = $1
     LEFT JOIN conversation_participants cp ON cp.conversation_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT 50`,
    [handle]
  );
  return result.rows;
};

export const sendMessage = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = sendMessageInputSchema.parse(rawInput);
  const sender = actorHandle(actor);
  if (!hasDatabase()) {
    return { id: randomUUID(), conversationId: input.conversationId ?? randomUUID(), senderHandle: sender, body: input.body };
  }
  await ensureLiveData();
  const requestedRecipient = input.recipientHandle
    ? await ensureProfileHandle(input.recipientHandle)
    : undefined;
  if (!input.conversationId && !requestedRecipient) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "recipientHandle or conversationId is required." });
  }
  if (requestedRecipient === sender) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Direct messages require another recipient." });
  }

  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, sender, mutation);
    if (claim.replayed) return { value: claim.response };
    let conversationId = input.conversationId;

    if (!conversationId) {
      const recipient = requestedRecipient!;
      const directKey = [sender, recipient].sort().join(":");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [directKey]);
      const existing = await client.query<{ conversationId: string }>(
        `SELECT cp1.conversation_id AS "conversationId"
         FROM conversation_participants cp1
         JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
         JOIN conversations c ON c.id = cp1.conversation_id AND c.kind = 'direct'
         WHERE cp1.profile_handle = $1
           AND cp2.profile_handle = $2
           AND NOT EXISTS (
             SELECT 1 FROM conversation_participants other
             WHERE other.conversation_id = cp1.conversation_id
               AND other.profile_handle NOT IN ($1, $2)
           )
         LIMIT 1`,
        [sender, recipient]
      );
      conversationId = existing.rows[0]?.conversationId;

      if (!conversationId) {
        const created = await client.query<{ id: string }>(
          "INSERT INTO conversations (kind) VALUES ('direct') RETURNING id"
        );
        conversationId = created.rows[0]!.id;
        await client.query(
          `INSERT INTO conversation_participants (conversation_id, profile_handle)
           VALUES ($1, $2), ($1, $3)
           ON CONFLICT DO NOTHING`,
          [conversationId, sender, recipient]
        );
      }
    } else {
      const membership = await client.query(
        `SELECT c.id
         FROM conversations c
         JOIN conversation_participants participant
           ON participant.conversation_id = c.id AND participant.profile_handle = $2
         WHERE c.id = $1
         FOR SHARE OF c`,
        [conversationId, sender]
      );
      if (!membership.rowCount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
      }
    }

    const message = await client.query(
      `INSERT INTO messages (conversation_id, sender_handle, body)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id AS "conversationId", sender_handle AS "senderHandle", body, created_at AS "createdAt"`,
      [conversationId, sender, input.body]
    );
    await client.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [conversationId]);
    const participants = await client.query<{ profileHandle: string }>(
      `SELECT profile_handle AS "profileHandle"
       FROM conversation_participants WHERE conversation_id = $1`,
      [conversationId]
    );
    const value = message.rows[0] as Record<string, unknown>;
    await stageAuditLog(client, {
      actorHandle: sender,
      action: "message.send",
      subjectType: "conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, { messageId: value.id })
    });
    await completeMutation(client, sender, mutation, value);
    const event = await stageEvent(client, {
      kind: "message.sent",
      actorHandle: sender,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: participants.rows.map((participant) => participant.profileHandle),
      payload: { messageId: value.id }
    });
    return { value, events: [event] };
  });
};
