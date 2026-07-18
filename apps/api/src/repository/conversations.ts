import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  attachmentKindForFile,
  blockProfileInputSchema,
  conversationListQuerySchema,
  conversationSearchInputSchema,
  createGroupConversationInputSchema,
  deleteMessageInputSchema,
  editMessageInputSchema,
  inviteConversationParticipantsInputSchema,
  markConversationReadInputSchema,
  messageListQuerySchema,
  resolveConversationInviteInputSchema,
  saveConversationDraftInputSchema,
  sendMessageInputSchema,
  starMessageInputSchema,
  updateConversationParticipantInputSchema,
  updateConversationPreferencesInputSchema,
  type ConversationPageContract,
  type ConversationParticipantContract,
  type ConversationSummaryContract,
  type InquiryAttachmentContract,
  type MessageContract,
  type MessagePageContract
} from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { replaceOwnerAttachments } from "../services/attachmentOwnership";
import { triggerStorageDeletion } from "../services/storageDeletion";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle, type AttachmentRow } from "./foundation";
import { createNotifications } from "./notifications";

const messageEditWindowMs = 15 * 60 * 1000;

type ConversationCursor = { pinned: boolean; updatedAt: string; id: string };
type MessageCursor = { sequence: number };

type MembershipRow = {
  conversationId: string;
  kind: "direct" | "group";
  title: string | null;
  revision: number;
  nextMessageSequence: number | string;
  updatedAt: Date | string;
  role: "owner" | "admin" | "member";
  status: "invited" | "active" | "removed";
  lastReadSequence: number | string;
  clearedThroughSequence: number | string;
  removedThroughSequence: number | string | null;
  hiddenAt: Date | string | null;
  muted: boolean;
  pinned: boolean;
  draftBody: string;
};

type MessageRow = {
  id: string;
  conversationId: string;
  sequence: number | string;
  revision: number;
  senderHandle: string | null;
  body: string;
  editedAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  starred?: boolean;
};

type ParticipantRow = {
  conversationId: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member";
  status: "invited" | "active" | "removed";
};

const encodeConversationCursor = (row: Pick<MembershipRow, "conversationId" | "pinned" | "updatedAt">) =>
  Buffer.from(JSON.stringify({
    pinned: row.pinned,
    updatedAt: new Date(row.updatedAt).toISOString(),
    id: row.conversationId
  } satisfies ConversationCursor)).toString("base64url");

const decodeConversationCursor = (cursor?: string | null): ConversationCursor | null => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<ConversationCursor>;
    if (typeof value.pinned !== "boolean" || !value.updatedAt || Number.isNaN(Date.parse(value.updatedAt)) || !value.id) return null;
    return { pinned: value.pinned, updatedAt: new Date(value.updatedAt).toISOString(), id: value.id };
  } catch {
    return null;
  }
};

const encodeMessageCursor = (sequence: number) =>
  Buffer.from(JSON.stringify({ sequence } satisfies MessageCursor)).toString("base64url");

const decodeMessageCursor = (cursor?: string | null): MessageCursor | null => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<MessageCursor>;
    if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) <= 0) return null;
    return { sequence: Number(value.sequence) };
  } catch {
    return null;
  }
};

const numberValue = (value: number | string | null | undefined) => Number(value ?? 0);

const attachmentForMessage = (row: AttachmentRow): InquiryAttachmentContract => ({
  id: row.id,
  fileName: row.fileName,
  contentType: row.contentType,
  byteSize: row.byteSize,
  status: row.status,
  kind: attachmentKindForFile(row.contentType, row.fileName),
  metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {},
  createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined
});

const messageContract = (
  row: MessageRow,
  attachments: InquiryAttachmentContract[] = []
): MessageContract => ({
  id: row.id,
  conversationId: row.conversationId,
  sequence: numberValue(row.sequence),
  revision: row.revision,
  senderHandle: row.senderHandle,
  body: row.deletedAt ? "" : row.body,
  attachments: row.deletedAt ? [] : attachments,
  starred: Boolean(row.starred),
  editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : null,
  deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
  createdAt: new Date(row.createdAt).toISOString()
});

const loadAttachments = async (messageIds: string[], client: Pick<PoolClient, "query"> = getPool()) => {
  if (!messageIds.length) return new Map<string, InquiryAttachmentContract[]>();
  const result = await client.query<AttachmentRow>(
    `SELECT id::text, owner_id AS "ownerId", file_name AS "fileName", content_type AS "contentType",
       byte_size AS "byteSize", status, metadata, object_key AS "objectKey", created_at AS "createdAt"
     FROM attachments
     WHERE owner_type = 'message'
       AND owner_id = ANY($1::text[])
       AND status IN ('uploaded', 'previewed')
     ORDER BY created_at ASC, id ASC`,
    [messageIds]
  );
  const byMessage = new Map<string, InquiryAttachmentContract[]>();
  for (const row of result.rows) {
    if (!row.ownerId) continue;
    const values = byMessage.get(row.ownerId) ?? [];
    values.push(attachmentForMessage(row));
    byMessage.set(row.ownerId, values);
  }
  return byMessage;
};

const membershipSelect = `
  SELECT c.id::text AS "conversationId", c.kind, c.title, c.revision,
    c.next_message_sequence AS "nextMessageSequence", c.updated_at AS "updatedAt",
    me.role, me.status, me.last_read_sequence AS "lastReadSequence",
    me.cleared_through_sequence AS "clearedThroughSequence",
    me.removed_through_sequence AS "removedThroughSequence", me.hidden_at AS "hiddenAt",
    me.muted, me.pinned, me.draft_body AS "draftBody"
  FROM conversations c
  JOIN conversation_participants me ON me.conversation_id = c.id`;

const getMembership = async (
  client: Pick<PoolClient, "query">,
  conversationId: string,
  handle: string,
  options: { allowHidden?: boolean; lock?: boolean } = {}
) => {
  const result = await client.query<MembershipRow>(
    `${membershipSelect}
     WHERE c.id = $1 AND me.profile_handle = $2
       ${options.allowHidden ? "" : "AND me.hidden_at IS NULL"}
     ${options.lock ? "FOR UPDATE OF c, me" : ""}`,
    [conversationId, handle]
  );
  const membership = result.rows[0];
  if (!membership) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
  return membership;
};

const participantRows = async (conversationIds: string[]) => {
  if (!conversationIds.length) return [] as ParticipantRow[];
  const result = await getPool().query<ParticipantRow>(
    `SELECT participant.conversation_id::text AS "conversationId", participant.profile_handle AS handle,
       profile.name, profile.avatar_url AS "avatarUrl", participant.role, participant.status
     FROM conversation_participants participant
     JOIN profiles profile ON profile.handle = participant.profile_handle
     WHERE participant.conversation_id = ANY($1::uuid[])
       AND NOT (participant.status = 'removed' AND participant.hidden_at IS NOT NULL)
     ORDER BY participant.created_at ASC, participant.profile_handle ASC`,
    [conversationIds]
  );
  return result.rows;
};

const summariesForMemberships = async (
  memberships: MembershipRow[],
  viewerHandle: string
): Promise<ConversationSummaryContract[]> => {
  if (!memberships.length) return [];
  const conversationIds = memberships.map((row) => row.conversationId);
  const [participants, lastMessages, unreadCounts, blocks] = await Promise.all([
    participantRows(conversationIds),
    getPool().query<MessageRow>(
      `SELECT DISTINCT ON (message.conversation_id)
         message.id::text, message.conversation_id::text AS "conversationId", message.sequence,
         message.revision, message.sender_handle AS "senderHandle", message.body,
         message.edited_at AS "editedAt", message.deleted_at AS "deletedAt", message.created_at AS "createdAt",
         EXISTS (SELECT 1 FROM message_stars star WHERE star.message_id = message.id AND star.profile_handle = $2) AS starred
       FROM messages message
       JOIN conversation_participants viewer ON viewer.conversation_id = message.conversation_id AND viewer.profile_handle = $2
       WHERE message.conversation_id = ANY($1::uuid[])
         AND viewer.status <> 'invited'
         AND message.sequence > viewer.cleared_through_sequence
         AND (viewer.removed_through_sequence IS NULL OR message.sequence <= viewer.removed_through_sequence)
         AND NOT EXISTS (SELECT 1 FROM message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.profile_handle = $2)
       ORDER BY message.conversation_id, message.sequence DESC`,
      [conversationIds, viewerHandle]
    ),
    getPool().query<{ conversationId: string; unreadCount: number }>(
      `SELECT message.conversation_id::text AS "conversationId", count(*)::int AS "unreadCount"
       FROM messages message
       JOIN conversation_participants viewer ON viewer.conversation_id = message.conversation_id AND viewer.profile_handle = $2
       WHERE message.conversation_id = ANY($1::uuid[])
         AND viewer.status <> 'invited'
         AND message.sequence > GREATEST(viewer.last_read_sequence, viewer.cleared_through_sequence)
         AND (viewer.removed_through_sequence IS NULL OR message.sequence <= viewer.removed_through_sequence)
         AND message.sender_handle IS DISTINCT FROM $2
         AND message.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.profile_handle = $2)
       GROUP BY message.conversation_id`,
      [conversationIds, viewerHandle]
    ),
    getPool().query<{ blockedHandle: string }>(
      `SELECT blocked_handle AS "blockedHandle" FROM profile_blocks WHERE blocker_handle = $1`,
      [viewerHandle]
    )
  ]);
  const participantMap = new Map<string, ConversationParticipantContract[]>();
  for (const participant of participants) {
    const values = participantMap.get(participant.conversationId) ?? [];
    values.push({
      handle: participant.handle,
      name: participant.name,
      avatarUrl: participant.avatarUrl ?? undefined,
      role: participant.role,
      status: participant.status
    });
    participantMap.set(participant.conversationId, values);
  }
  const lastByConversation = new Map(lastMessages.rows.map((row) => [row.conversationId, row]));
  const lastAttachments = await loadAttachments(lastMessages.rows.filter((row) => !row.deletedAt).map((row) => row.id));
  const unreadByConversation = new Map(unreadCounts.rows.map((row) => [row.conversationId, row.unreadCount]));
  const blocked = new Set(blocks.rows.map((row) => row.blockedHandle));
  return memberships.map((membership) => {
    const conversationParticipants = participantMap.get(membership.conversationId) ?? [];
    const last = lastByConversation.get(membership.conversationId);
    return {
      id: membership.conversationId,
      revision: membership.revision,
      kind: membership.kind,
      title: membership.title,
      role: membership.role,
      status: membership.status,
      muted: membership.muted,
      pinned: membership.pinned,
      blockedByViewer: membership.kind === "direct" && conversationParticipants.some((person) => person.handle !== viewerHandle && blocked.has(person.handle)),
      unreadCount: unreadByConversation.get(membership.conversationId) ?? 0,
      participants: conversationParticipants,
      lastMessage: last ? messageContract(last, lastAttachments.get(last.id) ?? []) : null,
      draftBody: membership.draftBody ?? "",
      updatedAt: new Date(membership.updatedAt).toISOString()
    };
  });
};

export const listConversations = async (rawQuery: unknown, actor: Actor): Promise<ConversationPageContract> => {
  const handle = actorHandle(actor);
  const query = conversationListQuerySchema.parse(rawQuery ?? {});
  const cursor = decodeConversationCursor(query.cursor);
  if (query.cursor && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid conversation cursor." });
  if (!hasDatabase()) return { conversations: [], nextCursor: null };
  await ensureLiveData();

  const values: unknown[] = [handle];
  let cursorCondition = "";
  if (cursor) {
    values.push(cursor.pinned, cursor.updatedAt, cursor.id);
    cursorCondition = `AND (
      (me.pinned = $2 AND (c.updated_at, c.id::text) < ($3::timestamptz, $4::text))
      OR ($2::boolean = true AND me.pinned = false)
    )`;
  }
  values.push(query.limit + 1);
  const result = await getPool().query<MembershipRow>(
    `${membershipSelect}
     WHERE me.profile_handle = $1
       AND me.hidden_at IS NULL
       ${cursorCondition}
     ORDER BY me.pinned DESC, c.updated_at DESC, c.id DESC
     LIMIT $${values.length}`,
    values
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  const last = rows.at(-1);
  return {
    conversations: await summariesForMemberships(rows, handle),
    nextCursor: hasMore && last ? encodeConversationCursor(last) : null
  };
};

export const getConversation = async (conversationId: string, actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
  await ensureLiveData();
  const membership = await getMembership(getPool(), conversationId, handle);
  return (await summariesForMemberships([membership], handle))[0]!;
};

export const listMessages = async (
  conversationId: string,
  rawQuery: unknown,
  actor: Actor
): Promise<MessagePageContract> => {
  const handle = actorHandle(actor);
  const query = messageListQuerySchema.parse(rawQuery ?? {});
  const cursor = decodeMessageCursor(query.cursor);
  if (query.cursor && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid message cursor." });
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
  await ensureLiveData();
  const membership = await getMembership(getPool(), conversationId, handle);
  const conversation = (await summariesForMemberships([membership], handle))[0]!;
  if (membership.status === "invited") return { conversation, messages: [], nextCursor: null };

  const values: unknown[] = [conversationId, handle, numberValue(membership.clearedThroughSequence)];
  const conditions = [
    `message.conversation_id = $1`,
    `message.sequence > $3`,
    `NOT EXISTS (SELECT 1 FROM message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.profile_handle = $2)`
  ];
  if (membership.removedThroughSequence !== null) {
    values.push(numberValue(membership.removedThroughSequence));
    conditions.push(`message.sequence <= $${values.length}`);
  }
  if (cursor) {
    values.push(cursor.sequence);
    conditions.push(`message.sequence < $${values.length}`);
  }
  values.push(query.limit + 1);
  const result = await getPool().query<MessageRow>(
    `SELECT message.id::text, message.conversation_id::text AS "conversationId", message.sequence,
       message.revision, message.sender_handle AS "senderHandle", message.body,
       message.edited_at AS "editedAt", message.deleted_at AS "deletedAt", message.created_at AS "createdAt",
       EXISTS (SELECT 1 FROM message_stars star WHERE star.message_id = message.id AND star.profile_handle = $2) AS starred
     FROM messages message
     WHERE ${conditions.join("\n       AND ")}
     ORDER BY message.sequence DESC
     LIMIT $${values.length}`,
    values
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  const attachments = await loadAttachments(rows.filter((row) => !row.deletedAt).map((row) => row.id));
  const oldest = rows.at(-1);
  return {
    conversation,
    messages: rows.reverse().map((row) => messageContract(row, attachments.get(row.id) ?? [])),
    nextCursor: hasMore && oldest ? encodeMessageCursor(numberValue(oldest.sequence)) : null
  };
};

const assertDirectMessageAllowed = async (client: Pick<PoolClient, "query">, left: string, right: string) => {
  const blocked = await client.query(
    `SELECT 1 FROM profile_blocks
     WHERE (blocker_handle = $1 AND blocked_handle = $2)
        OR (blocker_handle = $2 AND blocked_handle = $1)
     LIMIT 1`,
    [left, right]
  );
  if (blocked.rowCount) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This direct conversation is unavailable." });
  }
};

const assertMessageTargetsAllowed = async (client: Pick<PoolClient, "query">, sender: string, targets: string[]) => {
  if (!targets.length) return;
  const blocked = await client.query(
    `SELECT 1 FROM profile_blocks
     WHERE (blocker_handle = $1 AND blocked_handle = ANY($2::text[]))
        OR (blocked_handle = $1 AND blocker_handle = ANY($2::text[]))
     LIMIT 1`,
    [sender, targets]
  );
  if (blocked.rowCount) throw new TRPCError({ code: "FORBIDDEN", message: "One or more recipients are unavailable." });
};

const ensureProfileHandles = async (handles: string[]) => {
  if (!handles.length) return;
  const result = await getPool().query<{ handle: string }>(
    `SELECT handle FROM profiles WHERE handle = ANY($1::text[])`,
    [handles]
  );
  const found = new Set(result.rows.map((row) => row.handle));
  if (handles.some((handle) => !found.has(handle))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "One or more profiles could not be found." });
  }
};

const directConversation = async (client: PoolClient, sender: string, recipient: string) => {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [[sender, recipient].sort().join(":")]);
  const existing = await client.query<{ conversationId: string; nextSequence: number | string }>(
    `SELECT conversation.id::text AS "conversationId", conversation.next_message_sequence AS "nextSequence"
     FROM conversations conversation
     JOIN conversation_participants sender ON sender.conversation_id = conversation.id AND sender.profile_handle = $1
     JOIN conversation_participants recipient ON recipient.conversation_id = conversation.id AND recipient.profile_handle = $2
     WHERE conversation.kind = 'direct'
       AND NOT EXISTS (
         SELECT 1 FROM conversation_participants other
         WHERE other.conversation_id = conversation.id AND other.profile_handle NOT IN ($1, $2)
       )
     LIMIT 1
     FOR UPDATE OF conversation`,
    [sender, recipient]
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE conversation_participants
       SET hidden_at = NULL, status = 'active', removed_at = NULL, removed_through_sequence = NULL,
           cleared_through_sequence = CASE WHEN hidden_at IS NOT NULL THEN $3 ELSE cleared_through_sequence END,
           last_read_sequence = CASE WHEN hidden_at IS NOT NULL THEN $3 ELSE last_read_sequence END,
           draft_body = CASE WHEN hidden_at IS NOT NULL THEN '' ELSE draft_body END
       WHERE conversation_id = $1 AND profile_handle = $2`,
      [existing.rows[0].conversationId, sender, numberValue(existing.rows[0].nextSequence)]
    );
    return existing.rows[0].conversationId;
  }
  const created = await client.query<{ id: string }>(
    `INSERT INTO conversations (kind) VALUES ('direct') RETURNING id::text`
  );
  const conversationId = created.rows[0]!.id;
  await client.query(
    `INSERT INTO conversation_participants (conversation_id, profile_handle, role, status, accepted_at)
     VALUES ($1, $2, 'member', 'active', now()), ($1, $3, 'member', 'active', now())`,
    [conversationId, sender, recipient]
  );
  return conversationId;
};

export const sendMessage = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = sendMessageInputSchema.parse(rawInput);
  const sender = actorHandle(actor);
  if (!hasDatabase()) {
    const now = new Date().toISOString();
    return messageContract({
      id: randomUUID(), conversationId: input.conversationId ?? randomUUID(), sequence: 1, revision: 1,
      senderHandle: sender, body: input.body, editedAt: null, deletedAt: null, createdAt: now
    });
  }
  await ensureLiveData();
  const requestedRecipient = input.recipientHandle ? await ensureProfileHandle(input.recipientHandle) : undefined;
  if (requestedRecipient === sender) throw new TRPCError({ code: "BAD_REQUEST", message: "Direct messages require another recipient." });

  return runAtomic(async (client) => {
    const claim = await claimMutation<MessageContract>(client, sender, mutation);
    if (claim.replayed) return { value: claim.response };
    let conversationId = input.conversationId;
    if (!conversationId) {
      const recipient = requestedRecipient!;
      await assertDirectMessageAllowed(client, sender, recipient);
      conversationId = await directConversation(client, sender, recipient);
    }
    const membership = await getMembership(client, conversationId, sender, { allowHidden: true, lock: true });
    if (membership.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Join this conversation before sending messages." });
    if (membership.hiddenAt) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });

    const participants = await client.query<{ profileHandle: string; hiddenAt: Date | null; muted: boolean; status: string }>(
      `SELECT profile_handle AS "profileHandle", hidden_at AS "hiddenAt", muted, status
       FROM conversation_participants WHERE conversation_id = $1 FOR SHARE`,
      [conversationId]
    );
    if (membership.kind === "direct") {
      const recipient = participants.rows.find((participant) => participant.profileHandle !== sender)?.profileHandle;
      if (!recipient) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
      await assertDirectMessageAllowed(client, sender, recipient);
    }

    const sequenceResult = await client.query<{ sequence: number | string }>(
      `UPDATE conversations
       SET next_message_sequence = next_message_sequence + 1, revision = revision + 1, updated_at = now()
       WHERE id = $1
       RETURNING next_message_sequence AS sequence`,
      [conversationId]
    );
    const sequence = numberValue(sequenceResult.rows[0]?.sequence);
    const messageId = randomUUID();
    const inserted = await client.query<MessageRow>(
      `INSERT INTO messages (id, conversation_id, sequence, sender_handle, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::text, conversation_id::text AS "conversationId", sequence, revision,
         sender_handle AS "senderHandle", body, edited_at AS "editedAt", deleted_at AS "deletedAt", created_at AS "createdAt"`,
      [messageId, conversationId, sequence, sender, input.body]
    );
    const claimedAttachments = await replaceOwnerAttachments(client, {
      attachmentIds: input.attachmentIds,
      ownerId: messageId,
      ownerType: "message",
      uploaderHandle: sender
    });
    await client.query(
      `UPDATE conversation_participants
       SET draft_body = '', draft_updated_at = now(), last_read_sequence = GREATEST(last_read_sequence, $3), last_read_at = now()
       WHERE conversation_id = $1 AND profile_handle = $2`,
      [conversationId, sender, sequence]
    );
    const value = messageContract(inserted.rows[0]!, claimedAttachments.attachments.map(attachmentForMessage));
    await stageAuditLog(client, {
      actorHandle: sender,
      action: "message.send",
      subjectType: "conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, { messageId, attachmentCount: input.attachmentIds.length })
    });
    await completeMutation(client, sender, mutation, value);

    const visibleRecipients = participants.rows.filter((participant) =>
      participant.profileHandle !== sender && participant.status === "active" && !participant.hiddenAt
    );
    await createNotifications(client, visibleRecipients.filter((recipient) => !recipient.muted).map((recipient) => ({
        profileHandle: recipient.profileHandle,
        kind: "message",
        title: membership.kind === "group" ? membership.title ?? "Group message" : "New message",
        body: input.body ? input.body.slice(0, 180) : `${input.attachmentIds.length} attachment${input.attachmentIds.length === 1 ? "" : "s"}`,
        href: `/messages?conversation=${encodeURIComponent(conversationId)}`,
        dedupeKey: `message:${messageId}`,
        metadata: { conversationId, messageId, senderHandle: sender }
      })));
    const audienceHandles = [sender, ...visibleRecipients.map((recipient) => recipient.profileHandle)];
    const event = await stageEvent(client, {
      kind: "message.sent",
      actorHandle: sender,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles,
      payload: { conversationId, messageId, sequence }
    });
    return { value, events: [event] };
  });
};

export const createGroupConversation = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createGroupConversationInputSchema.parse(rawInput);
  const owner = actorHandle(actor);
  const invitees = Array.from(new Set(input.inviteeHandles.map(cleanHandle))).filter((handle) => handle !== owner);
  if (!invitees.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Invite at least one other participant." });
  if (!hasDatabase()) return { conversationId: randomUUID() };
  await ensureLiveData();
  await ensureProfileHandles(invitees);
  return runAtomic(async (client) => {
    const claim = await claimMutation<{ conversationId: string }>(client, owner, mutation);
    if (claim.replayed) return { value: claim.response };
    await assertMessageTargetsAllowed(client, owner, invitees);
    const created = await client.query<{ id: string }>(
      `INSERT INTO conversations (kind, title, owner_handle) VALUES ('group', $1, $2) RETURNING id::text`,
      [input.title, owner]
    );
    const conversationId = created.rows[0]!.id;
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, profile_handle, role, status, accepted_at)
       VALUES ($1, $2, 'owner', 'active', now())`,
      [conversationId, owner]
    );
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, profile_handle, role, status)
       SELECT $1, unnest($2::text[]), 'member', 'invited'`,
      [conversationId, invitees]
    );
    await createNotifications(client, invitees.map((invitee) => ({
        profileHandle: invitee,
        kind: "group_invite",
        title: `Invitation to ${input.title}`,
        body: `${owner} invited you to a private group conversation.`,
        href: `/messages?conversation=${encodeURIComponent(conversationId)}`,
        dedupeKey: `group-invite:${conversationId}:${invitee}`,
        metadata: { conversationId, inviterHandle: owner }
      })));
    const value = { conversationId };
    await completeMutation(client, owner, mutation, value);
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "conversation.group.create",
      subjectType: "conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, { inviteeCount: invitees.length })
    });
    const event = await stageEvent(client, {
      kind: "conversation.invited",
      actorHandle: owner,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: [owner, ...invitees],
      payload: { conversationId }
    });
    return { value, events: [event] };
  });
};

export const inviteConversationParticipants = async (conversationId: string, rawInput: unknown, actor: Actor) => {
  const input = inviteConversationParticipantsInputSchema.parse(rawInput);
  const inviter = actorHandle(actor);
  const handles = Array.from(new Set(input.handles.map(cleanHandle))).filter((handle) => handle !== inviter);
  if (!hasDatabase()) return { invited: handles };
  await ensureLiveData();
  await ensureProfileHandles(handles);
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, inviter, { lock: true });
    if (membership.kind !== "group" || membership.status !== "active" || !["owner", "admin"].includes(membership.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only group owners and administrators can invite participants." });
    }
    await assertMessageTargetsAllowed(client, inviter, handles);
    const invited = await client.query<{ handle: string }>(
      `INSERT INTO conversation_participants (conversation_id, profile_handle, role, status, hidden_at, removed_at, removed_through_sequence)
       SELECT $1, unnest($2::text[]), 'member', 'invited', NULL, NULL, NULL
       ON CONFLICT (conversation_id, profile_handle) DO UPDATE
       SET status = 'invited', hidden_at = NULL, removed_at = NULL, removed_through_sequence = NULL
       WHERE conversation_participants.status = 'removed' OR conversation_participants.hidden_at IS NOT NULL
       RETURNING profile_handle AS handle`,
      [conversationId, handles]
    );
    const invitedHandles = invited.rows.map((row) => row.handle);
    if (!invitedHandles.length) return { value: { invited: [] } };
    await createNotifications(client, invitedHandles.map((handle) => ({
        profileHandle: handle,
        kind: "group_invite",
        title: `Invitation to ${membership.title ?? "a private group"}`,
        body: `${inviter} invited you to a private group conversation.`,
        href: `/messages?conversation=${encodeURIComponent(conversationId)}`,
        dedupeKey: `group-invite:${conversationId}:${handle}:${membership.revision + 1}`,
        metadata: { conversationId, inviterHandle: inviter }
      })));
    await client.query(`UPDATE conversations SET revision = revision + 1, updated_at = now() WHERE id = $1`, [conversationId]);
    const audience = await client.query<{ handle: string }>(
      `SELECT profile_handle AS handle FROM conversation_participants WHERE conversation_id = $1 AND hidden_at IS NULL`,
      [conversationId]
    );
    const event = await stageEvent(client, {
      kind: "conversation.invited",
      actorHandle: inviter,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: Array.from(new Set([...audience.rows.map((row) => row.handle), ...invitedHandles])),
      payload: { conversationId }
    });
    return { value: { invited: invitedHandles }, events: [event] };
  });
};

export const resolveConversationInvite = async (conversationId: string, rawInput: unknown, actor: Actor) => {
  const input = resolveConversationInviteInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { conversationId, status: input.action === "accept" ? "active" : "removed" };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, handle, { lock: true });
    if (membership.status !== "invited") throw new TRPCError({ code: "CONFLICT", message: "This invitation is no longer pending." });
    const status = input.action === "accept" ? "active" : "removed";
    await client.query(
      `UPDATE conversation_participants
       SET status = $3, accepted_at = CASE WHEN $3 = 'active' THEN now() ELSE accepted_at END,
           removed_at = CASE WHEN $3 = 'removed' THEN now() ELSE NULL END,
           removed_through_sequence = CASE WHEN $3 = 'removed' THEN $4 ELSE NULL END,
           hidden_at = CASE WHEN $3 = 'removed' THEN now() ELSE NULL END
       WHERE conversation_id = $1 AND profile_handle = $2`,
      [conversationId, handle, status, numberValue(membership.nextMessageSequence)]
    );
    const audience = await client.query<{ handle: string }>(
      `SELECT profile_handle AS handle FROM conversation_participants WHERE conversation_id = $1 AND hidden_at IS NULL`,
      [conversationId]
    );
    const event = await stageEvent(client, {
      kind: `conversation.invite.${input.action}`,
      actorHandle: handle,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: Array.from(new Set([handle, ...audience.rows.map((row) => row.handle)])),
      payload: { conversationId, status }
    });
    return { value: { conversationId, status }, events: [event] };
  });
};

export const updateConversationParticipant = async (
  conversationId: string,
  targetHandle: string,
  rawInput: unknown,
  actor: Actor
) => {
  const input = updateConversationParticipantInputSchema.parse(rawInput);
  const actorProfile = actorHandle(actor);
  const target = await ensureProfileHandle(targetHandle);
  if (!hasDatabase()) return { conversationId, handle: target, role: input.role };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, actorProfile, { lock: true });
    if (membership.kind !== "group" || membership.status !== "active" || membership.role !== "owner") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the group owner can change participant roles." });
    }
    if (target === actorProfile) throw new TRPCError({ code: "BAD_REQUEST", message: "The owner role cannot be changed here." });
    const updated = await client.query(
      `UPDATE conversation_participants SET role = $3
       WHERE conversation_id = $1 AND profile_handle = $2 AND status = 'active' AND role <> 'owner'
       RETURNING profile_handle`,
      [conversationId, target, input.role]
    );
    if (!updated.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Participant not found." });
    await client.query(`UPDATE conversations SET revision = revision + 1, updated_at = now() WHERE id = $1`, [conversationId]);
    const audience = await client.query<{ handle: string }>(
      `SELECT profile_handle AS handle FROM conversation_participants WHERE conversation_id = $1 AND hidden_at IS NULL`,
      [conversationId]
    );
    await stageAuditLog(client, {
      actorHandle: actorProfile,
      action: "conversation.participant.role.update",
      subjectType: "conversation",
      subjectId: conversationId,
      metadata: { targetHandle: target, role: input.role }
    });
    const event = await stageEvent(client, {
      kind: "conversation.participant.updated",
      actorHandle: actorProfile,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: audience.rows.map((row) => row.handle),
      payload: { conversationId, targetHandle: target, role: input.role }
    });
    return { value: { conversationId, handle: target, role: input.role }, events: [event] };
  });
};

export const removeConversationParticipant = async (
  conversationId: string,
  targetHandle: string,
  actor: Actor
) => {
  const actorProfile = actorHandle(actor);
  const target = await ensureProfileHandle(targetHandle);
  if (!hasDatabase()) return { conversationId, handle: target, removed: true };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, actorProfile, { lock: true });
    if (membership.kind !== "group" || membership.status !== "active" || !["owner", "admin"].includes(membership.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only group owners and administrators can remove participants." });
    }
    if (target === actorProfile) throw new TRPCError({ code: "BAD_REQUEST", message: "Use the leave-group action to remove yourself." });
    const participant = await client.query<{ role: string; status: string }>(
      `SELECT role, status FROM conversation_participants WHERE conversation_id = $1 AND profile_handle = $2 FOR UPDATE`,
      [conversationId, target]
    );
    const existing = participant.rows[0];
    if (!existing || !["active", "invited"].includes(existing.status)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Participant not found." });
    }
    if (existing.role === "owner" || (membership.role === "admin" && existing.role === "admin")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "This participant can only be removed by the group owner." });
    }
    const through = numberValue(membership.nextMessageSequence);
    await client.query(
      `UPDATE conversation_participants
       SET status = 'removed', removed_at = now(), removed_through_sequence = $3, muted = true, pinned = false, draft_body = '',
           hidden_at = CASE WHEN $4 = 'invited' THEN now() ELSE NULL END
       WHERE conversation_id = $1 AND profile_handle = $2`,
      [conversationId, target, through, existing.status]
    );
    await client.query(`UPDATE conversations SET revision = revision + 1, updated_at = now() WHERE id = $1`, [conversationId]);
    await createNotifications(client, [{
      profileHandle: target,
      kind: "group_removed",
      title: `Removed from ${membership.title ?? "a private group"}`,
      body: existing.status === "active"
        ? "You can still read the history that was available before your removal."
        : "The pending invitation is no longer available.",
      href: `/messages?conversation=${encodeURIComponent(conversationId)}`,
      dedupeKey: `group-removed:${conversationId}:${target}:${membership.revision + 1}`,
      metadata: { conversationId, removedByHandle: actorProfile }
    }]);
    const audience = await client.query<{ handle: string }>(
      `SELECT profile_handle AS handle FROM conversation_participants WHERE conversation_id = $1 AND hidden_at IS NULL`,
      [conversationId]
    );
    await stageAuditLog(client, {
      actorHandle: actorProfile,
      action: "conversation.participant.remove",
      subjectType: "conversation",
      subjectId: conversationId,
      metadata: { targetHandle: target, through }
    });
    const event = await stageEvent(client, {
      kind: "conversation.participant.removed",
      actorHandle: actorProfile,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: Array.from(new Set([target, ...audience.rows.map((row) => row.handle)])),
      payload: { conversationId, targetHandle: target, through }
    });
    return { value: { conversationId, handle: target, removed: true }, events: [event] };
  });
};

export const updateConversationPreferences = async (conversationId: string, rawInput: unknown, actor: Actor) => {
  const input = updateConversationPreferencesInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { conversationId, ...input };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, handle, { lock: true });
    const nextMuted = input.muted ?? membership.muted;
    const nextPinned = input.pinned ?? membership.pinned;
    const value = { conversationId, muted: nextMuted, pinned: nextPinned };
    if (nextMuted === membership.muted && nextPinned === membership.pinned) return { value };
    await client.query(
      `UPDATE conversation_participants
       SET muted = COALESCE($3, muted), pinned = COALESCE($4, pinned)
       WHERE conversation_id = $1 AND profile_handle = $2`,
      [conversationId, handle, input.muted ?? null, input.pinned ?? null]
    );
    const event = await stageEvent(client, {
      kind: "conversation.preferences.updated", actorHandle: handle, subjectType: "conversation", subjectId: conversationId,
      visibility: "private", audienceHandles: [handle], payload: value
    });
    return { value, events: [event] };
  });
};

export const saveConversationDraft = async (conversationId: string, rawInput: unknown, actor: Actor) => {
  const input = saveConversationDraftInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { conversationId, body: input.body };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, handle, { lock: true });
    if (membership.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Join this conversation before saving a draft." });
    const updated = await client.query(
      `UPDATE conversation_participants SET draft_body = $3, draft_updated_at = now()
       WHERE conversation_id = $1 AND profile_handle = $2 AND draft_body IS DISTINCT FROM $3
       RETURNING profile_handle`,
      [conversationId, handle, input.body]
    );
    const value = { conversationId, body: input.body };
    if (!updated.rowCount) return { value };
    const event = await stageEvent(client, {
      kind: "conversation.draft.updated", actorHandle: handle, subjectType: "conversation", subjectId: conversationId,
      visibility: "private", audienceHandles: [handle], payload: { conversationId }
    });
    return { value, events: [event] };
  });
};

export const markConversationRead = async (conversationId: string, rawInput: unknown, actor: Actor) => {
  const input = markConversationReadInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { conversationId, sequence: input.sequence };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, handle, { lock: true });
    const bounded = Math.min(input.sequence, numberValue(membership.nextMessageSequence));
    const readUpdate = await client.query(
      `UPDATE conversation_participants
       SET last_read_sequence = GREATEST(last_read_sequence, $3), last_read_at = now()
       WHERE conversation_id = $1 AND profile_handle = $2 AND last_read_sequence < $3
       RETURNING profile_handle`,
      [conversationId, handle, bounded]
    );
    const notificationUpdate = await client.query(
      `UPDATE notifications SET read_at = now()
       WHERE profile_handle = $1 AND read_at IS NULL AND metadata->>'conversationId' = $2
       RETURNING id`,
      [handle, conversationId]
    );
    const value = { conversationId, sequence: bounded };
    if (!readUpdate.rowCount && !notificationUpdate.rowCount) return { value };
    const event = await stageEvent(client, {
      kind: "conversation.read",
      actorHandle: handle,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: [handle],
      payload: { conversationId, sequence: bounded }
    });
    return { value, events: [event] };
  });
};

export const clearConversation = async (conversationId: string, actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { conversationId, cleared: true };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, handle, { lock: true });
    const through = numberValue(membership.nextMessageSequence);
    await client.query(
      `UPDATE conversation_participants
       SET cleared_through_sequence = $3, last_read_sequence = GREATEST(last_read_sequence, $3),
           draft_body = '', draft_updated_at = now()
       WHERE conversation_id = $1 AND profile_handle = $2`,
      [conversationId, handle, through]
    );
    await client.query(
      `DELETE FROM message_stars star USING messages message
       WHERE star.message_id = message.id AND star.profile_handle = $1
         AND message.conversation_id = $2 AND message.sequence <= $3`,
      [handle, conversationId, through]
    );
    const event = await stageEvent(client, {
      kind: "conversation.cleared",
      actorHandle: handle,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: [handle],
      payload: { conversationId, through }
    });
    return { value: { conversationId, cleared: true }, events: [event] };
  });
};

export const deleteConversationForViewer = async (conversationId: string, actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { conversationId, deleted: true };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, handle, { lock: true });
    const through = numberValue(membership.nextMessageSequence);
    await client.query(
      `UPDATE conversation_participants
       SET hidden_at = now(), cleared_through_sequence = $3,
           last_read_sequence = GREATEST(last_read_sequence, $3), draft_body = '', pinned = false
       WHERE conversation_id = $1 AND profile_handle = $2`,
      [conversationId, handle, through]
    );
    await client.query(
      `DELETE FROM message_stars star USING messages message
       WHERE star.message_id = message.id AND star.profile_handle = $1 AND message.conversation_id = $2`,
      [handle, conversationId]
    );
    await client.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
       WHERE profile_handle = $1 AND metadata->>'conversationId' = $2`,
      [handle, conversationId]
    );
    const event = await stageEvent(client, {
      kind: "conversation.deleted_for_viewer",
      actorHandle: handle,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: [handle],
      payload: { conversationId }
    });
    return { value: { conversationId, deleted: true }, events: [event] };
  });
};

export const setProfileBlock = async (rawInput: unknown, actor: Actor) => {
  const input = blockProfileInputSchema.parse(rawInput);
  const blocker = actorHandle(actor);
  const target = await ensureProfileHandle(input.targetHandle);
  if (target === blocker) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot block your own profile." });
  if (!hasDatabase()) return { targetHandle: target, active: input.active };
  await ensureLiveData();
  return runAtomic(async (client) => {
    let changed = false;
    if (input.active) {
      const result = await client.query(
        `INSERT INTO profile_blocks (blocker_handle, blocked_handle) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING blocker_handle`,
        [blocker, target]
      );
      changed = Boolean(result.rowCount);
    } else {
      const result = await client.query(`DELETE FROM profile_blocks WHERE blocker_handle = $1 AND blocked_handle = $2 RETURNING blocker_handle`, [blocker, target]);
      changed = Boolean(result.rowCount);
    }
    const value = { targetHandle: target, active: input.active };
    if (!changed) return { value };
    const event = await stageEvent(client, {
      kind: input.active ? "profile.blocked" : "profile.unblocked",
      actorHandle: blocker,
      subjectType: "profile",
      subjectId: target,
      visibility: "private",
      audienceHandles: [blocker],
      payload: { targetHandle: target, active: input.active }
    });
    return { value, events: [event] };
  });
};

export const starMessage = async (conversationId: string, messageId: string, rawInput: unknown, actor: Actor) => {
  const input = starMessageInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { messageId, active: input.active };
  await ensureLiveData();
  return runAtomic(async (client) => {
    await getMembership(client, conversationId, handle, { lock: true });
    const visible = await client.query(
      `SELECT 1 FROM messages message
       JOIN conversation_participants viewer ON viewer.conversation_id = message.conversation_id AND viewer.profile_handle = $3
       WHERE message.id = $1 AND message.conversation_id = $2
         AND message.sequence > viewer.cleared_through_sequence
         AND (viewer.removed_through_sequence IS NULL OR message.sequence <= viewer.removed_through_sequence)
         AND NOT EXISTS (SELECT 1 FROM message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.profile_handle = $3)`,
      [messageId, conversationId, handle]
    );
    if (!visible.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found." });
    let changed = false;
    if (input.active) {
      const result = await client.query(`INSERT INTO message_stars (message_id, profile_handle) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id`, [messageId, handle]);
      changed = Boolean(result.rowCount);
    } else {
      const result = await client.query(`DELETE FROM message_stars WHERE message_id = $1 AND profile_handle = $2 RETURNING message_id`, [messageId, handle]);
      changed = Boolean(result.rowCount);
    }
    const value = { messageId, active: input.active };
    if (!changed) return { value };
    const event = await stageEvent(client, {
      kind: "message.star.updated", actorHandle: handle, subjectType: "conversation", subjectId: conversationId,
      visibility: "private", audienceHandles: [handle], payload: { conversationId, ...value }
    });
    return { value, events: [event] };
  });
};

const ownedMessageForUpdate = async (client: PoolClient, conversationId: string, messageId: string, handle: string) => {
  await getMembership(client, conversationId, handle, { lock: true });
  const result = await client.query<MessageRow>(
    `SELECT id::text, conversation_id::text AS "conversationId", sequence, revision,
       sender_handle AS "senderHandle", body, edited_at AS "editedAt", deleted_at AS "deletedAt", created_at AS "createdAt"
     FROM messages WHERE id = $1 AND conversation_id = $2 FOR UPDATE`,
    [messageId, conversationId]
  );
  const message = result.rows[0];
  if (!message || message.senderHandle !== handle) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found." });
  return message;
};

export const editMessage = async (conversationId: string, messageId: string, rawInput: unknown, actor: Actor) => {
  const input = editMessageInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { messageId, body: input.body, revision: input.expectedRevision + 1 };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const message = await ownedMessageForUpdate(client, conversationId, messageId, handle);
    if (message.deletedAt) throw new TRPCError({ code: "CONFLICT", message: "Deleted messages cannot be edited." });
    if (message.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "This message changed. Refresh and try again." });
    if (Date.now() - new Date(message.createdAt).getTime() > messageEditWindowMs) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The message editing window has closed." });
    }
    const updated = await client.query<MessageRow>(
      `UPDATE messages SET body = $3, edited_at = now(), revision = revision + 1, updated_at = now()
       WHERE id = $1 AND conversation_id = $2
       RETURNING id::text, conversation_id::text AS "conversationId", sequence, revision,
         sender_handle AS "senderHandle", body, edited_at AS "editedAt", deleted_at AS "deletedAt", created_at AS "createdAt"`,
      [messageId, conversationId, input.body]
    );
    const participants = await client.query<{ handle: string }>(
      `SELECT profile_handle AS handle FROM conversation_participants WHERE conversation_id = $1 AND status = 'active' AND hidden_at IS NULL`,
      [conversationId]
    );
    const event = await stageEvent(client, {
      kind: "message.edited", actorHandle: handle, subjectType: "conversation", subjectId: conversationId,
      visibility: "private", audienceHandles: participants.rows.map((row) => row.handle), payload: { conversationId, messageId }
    });
    return { value: messageContract(updated.rows[0]!), events: [event] };
  });
};

export const deleteMessage = async (conversationId: string, messageId: string, rawInput: unknown, actor: Actor) => {
  const input = deleteMessageInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { messageId, mode: input.mode, deleted: true };
  await ensureLiveData();
  let removedAttachmentIds: string[] = [];
  const value = await runAtomic<{ messageId: string; mode: "self" | "everyone"; deleted: boolean }>(async (client) => {
    if (input.mode === "self") {
      await getMembership(client, conversationId, handle, { lock: true });
      const hidden = await client.query(
        `INSERT INTO message_hidden_for (message_id, profile_handle)
         SELECT id, $3 FROM messages WHERE id = $1 AND conversation_id = $2
         ON CONFLICT DO NOTHING RETURNING message_id`,
        [messageId, conversationId, handle]
      );
      if (!hidden.rowCount) {
        const existing = await client.query(
          `SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2`,
          [messageId, conversationId]
        );
        if (!existing.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found." });
      }
      await client.query(`DELETE FROM message_stars WHERE message_id = $1 AND profile_handle = $2`, [messageId, handle]);
      return { value: { messageId, mode: "self" as const, deleted: true } };
    }
    const message = await ownedMessageForUpdate(client, conversationId, messageId, handle);
    if (message.deletedAt) return { value: { messageId, mode: "everyone" as const, deleted: true } };
    if (!input.expectedRevision || message.revision !== input.expectedRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "This message changed. Refresh and try again." });
    }
    if (Date.now() - new Date(message.createdAt).getTime() > messageEditWindowMs) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The unsend window has closed." });
    }
    const attachmentResult = await replaceOwnerAttachments(client, {
      attachmentIds: [], ownerId: messageId, ownerType: "message", uploaderHandle: handle
    });
    removedAttachmentIds = attachmentResult.removedAttachmentIds;
    await client.query(
      `UPDATE messages SET body = '', deleted_at = now(), deleted_by = $3, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND conversation_id = $2`,
      [messageId, conversationId, handle]
    );
    await client.query(`DELETE FROM message_stars WHERE message_id = $1`, [messageId]);
    await client.query(`DELETE FROM notifications WHERE metadata->>'messageId' = $1`, [messageId]);
    const participants = await client.query<{ handle: string }>(
      `SELECT profile_handle AS handle FROM conversation_participants WHERE conversation_id = $1 AND hidden_at IS NULL`,
      [conversationId]
    );
    const event = await stageEvent(client, {
      kind: "message.deleted", actorHandle: handle, subjectType: "conversation", subjectId: conversationId,
      visibility: "private", audienceHandles: participants.rows.map((row) => row.handle), payload: { conversationId, messageId }
    });
    return { value: { messageId, mode: "everyone" as const, deleted: true }, events: [event] };
  });
  if (removedAttachmentIds.length) await triggerStorageDeletion(removedAttachmentIds);
  return value;
};

export const searchConversation = async (conversationId: string, rawInput: unknown, actor: Actor) => {
  const input = conversationSearchInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { messages: [], nextCursor: null };
  await ensureLiveData();
  const membership = await getMembership(getPool(), conversationId, handle);
  if (membership.status === "invited") throw new TRPCError({ code: "FORBIDDEN", message: "Accept the invitation before searching this conversation." });
  const cursor = decodeMessageCursor(input.cursor);
  if (input.cursor && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid message cursor." });
  const values: unknown[] = [conversationId, handle, numberValue(membership.clearedThroughSequence)];
  const conditions = [
    `message.conversation_id = $1`,
    `message.sequence > $3`,
    `message.deleted_at IS NULL`,
    `NOT EXISTS (SELECT 1 FROM message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.profile_handle = $2)`
  ];
  if (membership.removedThroughSequence !== null) { values.push(numberValue(membership.removedThroughSequence)); conditions.push(`message.sequence <= $${values.length}`); }
  if (cursor) { values.push(cursor.sequence); conditions.push(`message.sequence < $${values.length}`); }
  if (input.query) { values.push(`%${input.query.replace(/[%_]/g, "\\$&")}%`); conditions.push(`message.body ILIKE $${values.length} ESCAPE '\\'`); }
  if (input.kind === "links") {
    conditions.push(`message.body ~* 'https?://[^[:space:]]+'`);
  } else if (input.kind) {
    const kindCondition: Record<string, string> = {
      image: `attachment.content_type LIKE 'image/%'`, video: `attachment.content_type LIKE 'video/%'`,
      pdf: `attachment.content_type = 'application/pdf'`, text: `attachment.content_type LIKE 'text/%'`,
      code: `attachment.file_name ~* '\\.(js|jsx|ts|tsx|py|rb|rs|go|java|c|cc|cpp|h|hpp|css|html|sql|sh|json|ya?ml)$'`,
      spreadsheet: `attachment.file_name ~* '\\.(csv|xls|xlsx|ods)$'`,
      presentation: `attachment.file_name ~* '\\.(ppt|pptx|odp)$'`,
      document: `attachment.content_type NOT LIKE 'image/%' AND attachment.content_type NOT LIKE 'video/%' AND attachment.content_type <> 'application/pdf'`
    };
    conditions.push(`EXISTS (SELECT 1 FROM attachments attachment WHERE attachment.owner_type = 'message' AND attachment.owner_id = message.id::text AND attachment.status IN ('uploaded', 'previewed') AND ${kindCondition[input.kind]})`);
  }
  values.push(input.limit + 1);
  const result = await getPool().query<MessageRow>(
    `SELECT message.id::text, message.conversation_id::text AS "conversationId", message.sequence, message.revision,
       message.sender_handle AS "senderHandle", message.body, message.edited_at AS "editedAt",
       message.deleted_at AS "deletedAt", message.created_at AS "createdAt",
       EXISTS (SELECT 1 FROM message_stars star WHERE star.message_id = message.id AND star.profile_handle = $2) AS starred
     FROM messages message WHERE ${conditions.join("\n       AND ")}
     ORDER BY message.sequence DESC LIMIT $${values.length}`,
    values
  );
  const hasMore = result.rows.length > input.limit;
  const rows = result.rows.slice(0, input.limit);
  const attachments = await loadAttachments(rows.map((row) => row.id));
  const last = rows.at(-1);
  return {
    messages: rows.map((row) => messageContract(row, attachments.get(row.id) ?? [])),
    nextCursor: hasMore && last ? encodeMessageCursor(numberValue(last.sequence)) : null
  };
};

export const listStarredMessages = async (conversationId: string, rawQuery: unknown, actor: Actor) => {
  const handle = actorHandle(actor);
  const query = messageListQuerySchema.parse(rawQuery ?? {});
  const cursor = decodeMessageCursor(query.cursor);
  if (query.cursor && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid message cursor." });
  if (!hasDatabase()) return { messages: [], nextCursor: null };
  await ensureLiveData();
  const membership = await getMembership(getPool(), conversationId, handle);
  const values: unknown[] = [conversationId, handle, numberValue(membership.clearedThroughSequence)];
  const conditions = [
    `message.conversation_id = $1`, `star.profile_handle = $2`, `message.sequence > $3`, `message.deleted_at IS NULL`,
    `NOT EXISTS (SELECT 1 FROM message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.profile_handle = $2)`
  ];
  if (membership.removedThroughSequence !== null) { values.push(numberValue(membership.removedThroughSequence)); conditions.push(`message.sequence <= $${values.length}`); }
  if (cursor) { values.push(cursor.sequence); conditions.push(`message.sequence < $${values.length}`); }
  values.push(query.limit + 1);
  const result = await getPool().query<MessageRow>(
    `SELECT message.id::text, message.conversation_id::text AS "conversationId", message.sequence, message.revision,
       message.sender_handle AS "senderHandle", message.body, message.edited_at AS "editedAt",
       message.deleted_at AS "deletedAt", message.created_at AS "createdAt", true AS starred
     FROM message_stars star JOIN messages message ON message.id = star.message_id
     WHERE ${conditions.join(" AND ")} ORDER BY message.sequence DESC LIMIT $${values.length}`,
    values
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  const attachments = await loadAttachments(rows.map((row) => row.id));
  const last = rows.at(-1);
  return { messages: rows.map((row) => messageContract(row, attachments.get(row.id) ?? [])), nextCursor: hasMore && last ? encodeMessageCursor(numberValue(last.sequence)) : null };
};

export const assertMessageAttachmentAccess = async (attachmentId: string, actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
  await ensureLiveData();
  const result = await getPool().query<{ objectKey: string }>(
    `SELECT attachment.object_key AS "objectKey"
     FROM attachments attachment
     JOIN messages message ON message.id::text = attachment.owner_id AND attachment.owner_type = 'message'
     JOIN conversation_participants viewer ON viewer.conversation_id = message.conversation_id AND viewer.profile_handle = $2
     WHERE attachment.id = $1 AND attachment.status IN ('uploaded', 'previewed')
       AND viewer.hidden_at IS NULL
       AND viewer.status IN ('active', 'removed')
       AND message.deleted_at IS NULL
       AND message.sequence > viewer.cleared_through_sequence
       AND (viewer.removed_through_sequence IS NULL OR message.sequence <= viewer.removed_through_sequence)
       AND NOT EXISTS (SELECT 1 FROM message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.profile_handle = $2)
     LIMIT 1`,
    [attachmentId, handle]
  );
  const attachment = result.rows[0];
  if (!attachment) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
  return attachment;
};
