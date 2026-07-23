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
  type MessagePageContract,
  type MessageUnreadCountContract
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
const maxGroupParticipants = 50;

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
  draftRevision: number | string;
  draftClientVersion: string | null;
  draftUpdatedAt: Date | string | null;
};

export type ConversationDraftSnapshot = {
  body: string;
  revision: number;
  clientVersion: string | null;
  updatedAt: string | null;
};

type SendMessageResult = {
  message: MessageContract;
  draft: ConversationDraftSnapshot;
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

const conversationDraftSnapshot = (row: Pick<MembershipRow, "draftBody" | "draftRevision" | "draftClientVersion" | "draftUpdatedAt">): ConversationDraftSnapshot => ({
  body: row.draftBody ?? "",
  revision: Math.max(1, numberValue(row.draftRevision)),
  clientVersion: row.draftClientVersion ?? null,
  updatedAt: row.draftUpdatedAt ? new Date(row.draftUpdatedAt).toISOString() : null
});

const isSendMessageResult = (value: SendMessageResult | MessageContract): value is SendMessageResult =>
  Boolean(value && typeof value === "object" && "message" in value && "draft" in value);

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
    me.muted, me.pinned, me.draft_body AS "draftBody", me.draft_revision AS "draftRevision",
    me.draft_client_version AS "draftClientVersion", me.draft_updated_at AS "draftUpdatedAt"
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
     JOIN conversations conversation ON conversation.id = participant.conversation_id
     JOIN profiles profile ON profile.handle = participant.profile_handle
     WHERE participant.conversation_id = ANY($1::uuid[])
       AND participant.status = 'active'
       AND (conversation.kind = 'direct' OR participant.hidden_at IS NULL)
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
      draftRevision: Math.max(1, numberValue(membership.draftRevision)),
      draftClientVersion: membership.draftClientVersion ?? null,
      draftUpdatedAt: membership.draftUpdatedAt ? new Date(membership.draftUpdatedAt).toISOString() : null,
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

export const getUnreadMessageCount = async (actor: Actor): Promise<MessageUnreadCountContract> => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { unreadCount: 0 };
  await ensureLiveData();
  const result = await getPool().query<{ unreadCount: number }>(
    `SELECT count(*)::int AS "unreadCount"
     FROM messages message
     JOIN conversation_participants viewer
       ON viewer.conversation_id = message.conversation_id
      AND viewer.profile_handle = $1
     WHERE viewer.hidden_at IS NULL
       AND viewer.status <> 'invited'
       AND viewer.muted = false
       AND message.sequence > GREATEST(viewer.last_read_sequence, viewer.cleared_through_sequence)
       AND (viewer.removed_through_sequence IS NULL OR message.sequence <= viewer.removed_through_sequence)
       AND message.sender_handle IS DISTINCT FROM $1
       AND message.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM message_hidden_for hidden
         WHERE hidden.message_id = message.id AND hidden.profile_handle = $1
       )`,
    [handle]
  );
  return { unreadCount: numberValue(result.rows[0]?.unreadCount) };
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

export const getMessageContext = async (
  conversationId: string,
  messageId: string,
  actor: Actor
): Promise<MessagePageContract> => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found." });
  await ensureLiveData();
  const membership = await getMembership(getPool(), conversationId, handle);
  if (membership.status === "invited") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Join this conversation before opening message history." });
  }
  const conversation = (await summariesForMemberships([membership], handle))[0]!;
  const baseValues: unknown[] = [conversationId, handle, numberValue(membership.clearedThroughSequence)];
  const visibleConditions = [
    `message.conversation_id = $1`,
    `message.sequence > $3`,
    `NOT EXISTS (SELECT 1 FROM message_hidden_for hidden WHERE hidden.message_id = message.id AND hidden.profile_handle = $2)`
  ];
  if (membership.removedThroughSequence !== null) {
    baseValues.push(numberValue(membership.removedThroughSequence));
    visibleConditions.push(`message.sequence <= $${baseValues.length}`);
  }
  const targetValues = [...baseValues, messageId];
  const target = await getPool().query<{ sequence: number | string }>(
    `SELECT message.sequence
     FROM messages message
     WHERE ${visibleConditions.join(" AND ")} AND message.id = $${targetValues.length}
     LIMIT 1`,
    targetValues
  );
  if (!target.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found." });
  const targetSequence = numberValue(target.rows[0].sequence);
  const selectMessage = `SELECT message.id::text, message.conversation_id::text AS "conversationId", message.sequence,
    message.revision, message.sender_handle AS "senderHandle", message.body,
    message.edited_at AS "editedAt", message.deleted_at AS "deletedAt", message.created_at AS "createdAt",
    EXISTS (SELECT 1 FROM message_stars star WHERE star.message_id = message.id AND star.profile_handle = $2) AS starred
    FROM messages message`;
  const beforeValues = [...baseValues, targetSequence, 26];
  const before = await getPool().query<MessageRow>(
    `${selectMessage}
     WHERE ${visibleConditions.join(" AND ")} AND message.sequence <= $${baseValues.length + 1}
     ORDER BY message.sequence DESC
     LIMIT $${beforeValues.length}`,
    beforeValues
  );
  const hasOlder = before.rows.length > 25;
  const earlier = before.rows.slice(0, 25).reverse();
  const afterValues = [...baseValues, targetSequence, 25];
  const after = await getPool().query<MessageRow>(
    `${selectMessage}
     WHERE ${visibleConditions.join(" AND ")} AND message.sequence > $${baseValues.length + 1}
     ORDER BY message.sequence ASC
     LIMIT $${afterValues.length}`,
    afterValues
  );
  const rows = [...earlier, ...after.rows];
  const attachments = await loadAttachments(rows.filter((row) => !row.deletedAt).map((row) => row.id));
  const oldest = rows[0];
  return {
    conversation,
    messages: rows.map((row) => messageContract(row, attachments.get(row.id) ?? [])),
    nextCursor: hasOlder && oldest ? encodeMessageCursor(numberValue(oldest.sequence)) : null
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
           draft_body = CASE WHEN hidden_at IS NOT NULL THEN '' ELSE draft_body END,
           draft_revision = CASE WHEN hidden_at IS NOT NULL THEN draft_revision + 1 ELSE draft_revision END,
           draft_client_version = CASE WHEN hidden_at IS NOT NULL THEN NULL ELSE draft_client_version END,
           draft_updated_at = CASE WHEN hidden_at IS NOT NULL THEN now() ELSE draft_updated_at END
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
    const message = messageContract({
      id: randomUUID(), conversationId: input.conversationId ?? randomUUID(), sequence: 1, revision: 1,
      senderHandle: sender, body: input.body, editedAt: null, deletedAt: null, createdAt: now
    });
    return {
      message,
      draft: { body: "", revision: (input.draftRevision ?? 1) + 1, clientVersion: null, updatedAt: now }
    } satisfies SendMessageResult;
  }
  await ensureLiveData();
  const requestedRecipient = input.recipientHandle ? await ensureProfileHandle(input.recipientHandle) : undefined;
  if (requestedRecipient === sender) throw new TRPCError({ code: "BAD_REQUEST", message: "Direct messages require another recipient." });

  return runAtomic(async (client) => {
    const claim = await claimMutation<SendMessageResult | MessageContract>(client, sender, mutation);
    if (claim.replayed) {
      if (isSendMessageResult(claim.response)) return { value: claim.response };
      const replayMembership = await getMembership(client, claim.response.conversationId, sender, { allowHidden: true, lock: true });
      return { value: { message: claim.response, draft: conversationDraftSnapshot(replayMembership) } };
    }
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
    const senderState = await client.query<{
      draftBody: string;
      draftRevision: number | string;
      draftClientVersion: string | null;
      draftUpdatedAt: Date | string | null;
    }>(
      `UPDATE conversation_participants
       SET draft_body = CASE
             WHEN $4::bigint IS NULL OR draft_revision = $4 OR ($5::text IS NOT NULL AND draft_client_version = $5) THEN ''
             ELSE draft_body
           END,
           draft_revision = CASE
             WHEN $4::bigint IS NULL OR draft_revision = $4 OR ($5::text IS NOT NULL AND draft_client_version = $5) THEN draft_revision + 1
             ELSE draft_revision
           END,
           draft_client_version = CASE
             WHEN $4::bigint IS NULL OR draft_revision = $4 OR ($5::text IS NOT NULL AND draft_client_version = $5) THEN NULL
             ELSE draft_client_version
           END,
           draft_updated_at = CASE
             WHEN $4::bigint IS NULL OR draft_revision = $4 OR ($5::text IS NOT NULL AND draft_client_version = $5) THEN now()
             ELSE draft_updated_at
           END,
           last_read_sequence = GREATEST(last_read_sequence, $3), last_read_at = now()
       WHERE conversation_id = $1 AND profile_handle = $2
       RETURNING draft_body AS "draftBody", draft_revision AS "draftRevision",
         draft_client_version AS "draftClientVersion", draft_updated_at AS "draftUpdatedAt"`,
      [conversationId, sender, sequence, input.draftRevision ?? null, input.draftClientVersion ?? null]
    );
    const message = messageContract(inserted.rows[0]!, claimedAttachments.attachments.map(attachmentForMessage));
    const senderDraft = conversationDraftSnapshot(senderState.rows[0]!);
    const value = { message, draft: senderDraft } satisfies SendMessageResult;
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
    const audienceHandles = [sender, ...visibleRecipients.map((recipient) => recipient.profileHandle)];
    const event = await stageEvent(client, {
      kind: "message.sent",
      actorHandle: sender,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles,
      payload: { conversationId, messageId, sequence, message }
    });
    return { value, events: [event] };
  });
};

export const createGroupConversation = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createGroupConversationInputSchema.parse(rawInput);
  const owner = actorHandle(actor);
  const memberHandles = Array.from(new Set(input.inviteeHandles.map(cleanHandle))).filter((handle) => handle !== owner);
  if (!memberHandles.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one other participant." });
  if (!hasDatabase()) return { conversationId: randomUUID() };
  await ensureLiveData();
  await ensureProfileHandles(memberHandles);
  return runAtomic(async (client) => {
    const claim = await claimMutation<{ conversationId: string }>(client, owner, mutation);
    if (claim.replayed) return { value: claim.response };
    await assertMessageTargetsAllowed(client, owner, memberHandles);
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
      `INSERT INTO conversation_participants (conversation_id, profile_handle, role, status, accepted_at)
       SELECT $1, unnest($2::text[]), 'member', 'active', now()`,
      [conversationId, memberHandles]
    );
    const value = { conversationId };
    await completeMutation(client, owner, mutation, value);
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "conversation.group.create",
      subjectType: "conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, { memberCount: memberHandles.length + 1 })
    });
    const event = await stageEvent(client, {
      kind: "conversation.created",
      actorHandle: owner,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: [owner, ...memberHandles],
      payload: { conversationId, memberHandles: [owner, ...memberHandles] }
    });
    return { value, events: [event] };
  });
};

export const addConversationParticipants = async (conversationId: string, rawInput: unknown, actor: Actor) => {
  const input = inviteConversationParticipantsInputSchema.parse(rawInput);
  const addedBy = actorHandle(actor);
  const handles = Array.from(new Set(input.handles.map(cleanHandle))).filter((handle) => handle !== addedBy);
  if (!handles.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one other participant." });
  if (!hasDatabase()) return { added: handles };
  await ensureLiveData();
  await ensureProfileHandles(handles);
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, addedBy, { lock: true });
    if (membership.kind !== "group" || membership.status !== "active" || !["owner", "admin"].includes(membership.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only group owners and administrators can add participants." });
    }
    const [activeCount, existingTargets] = await Promise.all([
      client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM conversation_participants
         WHERE conversation_id = $1 AND status = 'active' AND hidden_at IS NULL`,
        [conversationId]
      ),
      client.query<{ handle: string }>(
        `SELECT profile_handle AS handle
         FROM conversation_participants
         WHERE conversation_id = $1 AND profile_handle = ANY($2::text[])
           AND status = 'active' AND hidden_at IS NULL`,
        [conversationId, handles]
      )
    ]);
    const alreadyActive = new Set(existingTargets.rows.map((row) => row.handle));
    const newMemberCount = handles.filter((handle) => !alreadyActive.has(handle)).length;
    if (Number(activeCount.rows[0]?.count ?? 0) + newMemberCount > maxGroupParticipants) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Private groups can contain at most ${maxGroupParticipants} people.` });
    }
    await assertMessageTargetsAllowed(client, addedBy, handles);
    const added = await client.query<{ handle: string }>(
      `INSERT INTO conversation_participants (conversation_id, profile_handle, role, status, hidden_at, accepted_at, removed_at, removed_through_sequence)
       SELECT $1, unnest($2::text[]), 'member', 'active', NULL, now(), NULL, NULL
       ON CONFLICT (conversation_id, profile_handle) DO UPDATE
       SET status = 'active', hidden_at = NULL, accepted_at = now(), removed_at = NULL, removed_through_sequence = NULL
       WHERE conversation_participants.status = 'removed' OR conversation_participants.hidden_at IS NOT NULL
       RETURNING profile_handle AS handle`,
      [conversationId, handles]
    );
    const addedHandles = added.rows.map((row) => row.handle);
    if (!addedHandles.length) return { value: { added: [] } };
    await client.query(`UPDATE conversations SET revision = revision + 1, updated_at = now() WHERE id = $1`, [conversationId]);
    const audience = await client.query<{ handle: string }>(
      `SELECT profile_handle AS handle FROM conversation_participants WHERE conversation_id = $1 AND hidden_at IS NULL`,
      [conversationId]
    );
    const event = await stageEvent(client, {
      kind: "conversation.participants.added",
      actorHandle: addedBy,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: Array.from(new Set([...audience.rows.map((row) => row.handle), ...addedHandles])),
      payload: { conversationId, addedHandles }
    });
    return { value: { added: addedHandles }, events: [event] };
  });
};

// Compatibility alias for older web releases while the add-member route rolls out.
export const inviteConversationParticipants = addConversationParticipants;

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
  return runAtomic<{ conversationId: string; handle: string; role: "owner" | "admin" | "member" }>(async (client) => {
    const membership = await getMembership(client, conversationId, actorProfile, { lock: true });
    if (membership.kind !== "group" || membership.status !== "active" || membership.role !== "owner") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the group owner can change participant roles." });
    }
    if (target === actorProfile) throw new TRPCError({ code: "BAD_REQUEST", message: "The owner role cannot be changed here." });
    if (input.role === "owner") {
      const transferred = await client.query(
        `UPDATE conversation_participants SET role = 'owner'
         WHERE conversation_id = $1 AND profile_handle = $2 AND status = 'active' AND hidden_at IS NULL AND role <> 'owner'
         RETURNING profile_handle`,
        [conversationId, target]
      );
      if (!transferred.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Participant not found." });
      await client.query(
        `UPDATE conversation_participants SET role = 'admin'
         WHERE conversation_id = $1 AND profile_handle = $2`,
        [conversationId, actorProfile]
      );
      await client.query(
        `UPDATE conversations SET owner_handle = $2, revision = revision + 1, updated_at = now() WHERE id = $1`,
        [conversationId, target]
      );
      const audience = await client.query<{ handle: string }>(
        `SELECT profile_handle AS handle FROM conversation_participants
         WHERE conversation_id = $1 AND status = 'active' AND hidden_at IS NULL`,
        [conversationId]
      );
      await stageAuditLog(client, {
        actorHandle: actorProfile,
        action: "conversation.ownership.transfer",
        subjectType: "conversation",
        subjectId: conversationId,
        metadata: { targetHandle: target }
      });
      const event = await stageEvent(client, {
        kind: "conversation.ownership.transferred",
        actorHandle: actorProfile,
        subjectType: "conversation",
        subjectId: conversationId,
        visibility: "private",
        audienceHandles: audience.rows.map((row) => row.handle),
        payload: { conversationId, previousOwnerHandle: actorProfile, ownerHandle: target }
      });
      return { value: { conversationId, handle: target, role: input.role }, events: [event] };
    }
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
       SET status = 'removed', removed_at = now(), removed_through_sequence = $3, muted = true, pinned = false,
           draft_body = '', draft_revision = draft_revision + 1, draft_client_version = NULL, draft_updated_at = now(),
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
  if (!hasDatabase()) return {
    conflict: false,
    draft: {
      body: input.body,
      revision: input.expectedRevision + 1,
      clientVersion: input.clientVersion,
      updatedAt: new Date().toISOString()
    } satisfies ConversationDraftSnapshot
  };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, handle, { lock: true });
    if (membership.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Join this conversation before saving a draft." });
    if (numberValue(membership.draftRevision) !== input.expectedRevision) {
      return { value: { conflict: true, draft: conversationDraftSnapshot(membership) } };
    }
    if (membership.draftBody === input.body && membership.draftClientVersion === input.clientVersion) {
      return { value: { conflict: false, draft: conversationDraftSnapshot(membership) } };
    }
    const updated = await client.query<{
      draftBody: string;
      draftRevision: number | string;
      draftClientVersion: string | null;
      draftUpdatedAt: Date | string | null;
    }>(
      `UPDATE conversation_participants
       SET draft_body = $3, draft_revision = draft_revision + 1,
           draft_client_version = $4, draft_updated_at = now()
       WHERE conversation_id = $1 AND profile_handle = $2 AND draft_revision = $5
       RETURNING draft_body AS "draftBody", draft_revision AS "draftRevision",
         draft_client_version AS "draftClientVersion", draft_updated_at AS "draftUpdatedAt"`,
      [conversationId, handle, input.body, input.clientVersion, input.expectedRevision]
    );
    if (!updated.rows[0]) {
      const current = await getMembership(client, conversationId, handle, { lock: true });
      return { value: { conflict: true, draft: conversationDraftSnapshot(current) } };
    }
    const value = { conflict: false, draft: conversationDraftSnapshot(updated.rows[0]) };
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
    const value = { conversationId, sequence: bounded };
    if (!readUpdate.rowCount) return { value };
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
           draft_body = '', draft_revision = draft_revision + 1,
           draft_client_version = NULL, draft_updated_at = now()
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

const leaveGroupMembership = async (client: PoolClient, membership: MembershipRow, handle: string) => {
  if (membership.kind !== "group" || membership.status !== "active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only active group participants can leave a group." });
  }
  if (membership.role === "owner") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Transfer group ownership before leaving." });
  }
  const through = numberValue(membership.nextMessageSequence);
  await client.query(
    `UPDATE conversation_participants
     SET status = 'removed', removed_at = now(), removed_through_sequence = $3,
         hidden_at = now(), muted = true, pinned = false, draft_body = '',
         draft_revision = draft_revision + 1, draft_client_version = NULL, draft_updated_at = now()
     WHERE conversation_id = $1 AND profile_handle = $2`,
    [membership.conversationId, handle, through]
  );
  await client.query(`UPDATE conversations SET revision = revision + 1, updated_at = now() WHERE id = $1`, [membership.conversationId]);
  await client.query(
    `DELETE FROM message_stars star USING messages message
     WHERE star.message_id = message.id AND star.profile_handle = $1 AND message.conversation_id = $2`,
    [handle, membership.conversationId]
  );
  const audience = await client.query<{ handle: string }>(
    `SELECT profile_handle AS handle FROM conversation_participants
     WHERE conversation_id = $1 AND status = 'active' AND hidden_at IS NULL`,
    [membership.conversationId]
  );
  await stageAuditLog(client, {
    actorHandle: handle,
    action: "conversation.participant.leave",
    subjectType: "conversation",
    subjectId: membership.conversationId,
    metadata: { through }
  });
  const event = await stageEvent(client, {
    kind: "conversation.participant.left",
    actorHandle: handle,
    subjectType: "conversation",
    subjectId: membership.conversationId,
    visibility: "private",
    audienceHandles: Array.from(new Set([handle, ...audience.rows.map((row) => row.handle)])),
    payload: { conversationId: membership.conversationId, handle, through }
  });
  return { value: { conversationId: membership.conversationId, left: true }, events: [event] };
};

export const leaveConversation = async (conversationId: string, actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { conversationId, left: true };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const membership = await getMembership(client, conversationId, handle, { lock: true });
    return leaveGroupMembership(client, membership, handle);
  });
};

export const deleteConversationForViewer = async (conversationId: string, actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { conversationId, deleted: true };
  await ensureLiveData();
  return runAtomic<{ conversationId: string; deleted: boolean; left?: boolean }>(async (client) => {
    const membership = await getMembership(client, conversationId, handle, { lock: true });
    if (membership.kind === "group" && membership.status === "active") {
      const left = await leaveGroupMembership(client, membership, handle);
      return { ...left, value: { conversationId, deleted: true, left: true } };
    }
    const through = numberValue(membership.nextMessageSequence);
    await client.query(
      `UPDATE conversation_participants
       SET hidden_at = now(), cleared_through_sequence = $3,
           last_read_sequence = GREATEST(last_read_sequence, $3), draft_body = '',
           draft_revision = draft_revision + 1, draft_client_version = NULL, draft_updated_at = now(), pinned = false
       WHERE conversation_id = $1 AND profile_handle = $2`,
      [conversationId, handle, through]
    );
    await client.query(
      `DELETE FROM message_stars star USING messages message
       WHERE star.message_id = message.id AND star.profile_handle = $1 AND message.conversation_id = $2`,
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
      `SELECT profile_handle AS handle FROM conversation_participants WHERE conversation_id = $1 AND status IN ('active', 'removed') AND hidden_at IS NULL`,
      [conversationId]
    );
    const attachments = await loadAttachments([messageId], client);
    const value = messageContract(updated.rows[0]!, attachments.get(messageId) ?? []);
    const event = await stageEvent(client, {
      kind: "message.edited", actorHandle: handle, subjectType: "conversation", subjectId: conversationId,
      visibility: "private", audienceHandles: participants.rows.map((row) => row.handle), payload: { conversationId, messageId, message: value }
    });
    return { value, events: [event] };
  });
};

export const deleteMessage = async (conversationId: string, messageId: string, rawInput: unknown, actor: Actor) => {
  const input = deleteMessageInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { messageId, mode: input.mode, deleted: true };
  await ensureLiveData();
  let removedAttachmentIds: string[] = [];
  const value = await runAtomic<{ messageId: string; mode: "self" | "everyone"; deleted: boolean; message?: MessageContract }>(async (client) => {
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
    const deleted = await client.query<MessageRow>(
      `UPDATE messages SET body = '', deleted_at = now(), deleted_by = $3, revision = revision + 1, updated_at = now()
       WHERE id = $1 AND conversation_id = $2
       RETURNING id::text, conversation_id::text AS "conversationId", sequence, revision,
         sender_handle AS "senderHandle", body, edited_at AS "editedAt", deleted_at AS "deletedAt", created_at AS "createdAt"`,
      [messageId, conversationId, handle]
    );
    await client.query(`DELETE FROM message_stars WHERE message_id = $1`, [messageId]);
    const participants = await client.query<{ handle: string }>(
      `SELECT profile_handle AS handle FROM conversation_participants WHERE conversation_id = $1 AND hidden_at IS NULL`,
      [conversationId]
    );
    const canonicalMessage = messageContract(deleted.rows[0]!);
    const event = await stageEvent(client, {
      kind: "message.deleted", actorHandle: handle, subjectType: "conversation", subjectId: conversationId,
      visibility: "private", audienceHandles: participants.rows.map((row) => row.handle), payload: { conversationId, messageId, message: canonicalMessage }
    });
    return { value: { messageId, mode: "everyone" as const, deleted: true, message: canonicalMessage }, events: [event] };
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
      code: `attachment.file_name ~* '\\.(asm|bash|c|cc|conf|cpp|cxx|cs|css|dart|erl|ex|exs|fish|fs|fsx|go|gradle|graphql|groovy|h|hpp|hs|html|ini|ipynb|java|js|jsx|json|kt|kts|lua|m|mm|php|pl|ps1|py|r|rb|rs|s|scala|sh|sql|swift|tex|toml|ts|tsx|vb|vue|xml|ya?ml|zsh)$'`,
      spreadsheet: `attachment.file_name ~* '\\.(csv|xls|xlsx|ods)$'`,
      presentation: `attachment.file_name ~* '\\.(ppt|pptx|odp)$'`,
      document: `(attachment.content_type = 'application/pdf'
        OR attachment.file_name ~* '\\.(txt|md|doc|docx|odt|rtf|pdf)$'
        OR attachment.content_type IN (
          'application/msword',
          'application/rtf',
          'application/vnd.oasis.opendocument.text',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ))`
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
     WHERE attachment.id = $1
       AND attachment.owner_type = 'message'
       AND attachment.status IN ('uploaded', 'previewed')
       AND (
         (attachment.owner_id IS NULL AND attachment.uploader_handle = $2)
         OR EXISTS (
           SELECT 1
           FROM messages message
           JOIN conversation_participants viewer
             ON viewer.conversation_id = message.conversation_id AND viewer.profile_handle = $2
           WHERE message.id::text = attachment.owner_id
             AND viewer.hidden_at IS NULL
             AND viewer.status IN ('active', 'removed')
             AND message.deleted_at IS NULL
             AND message.sequence > viewer.cleared_through_sequence
             AND (viewer.removed_through_sequence IS NULL OR message.sequence <= viewer.removed_through_sequence)
             AND NOT EXISTS (
               SELECT 1 FROM message_hidden_for hidden
               WHERE hidden.message_id = message.id AND hidden.profile_handle = $2
             )
         )
       )
     LIMIT 1`,
    [attachmentId, handle]
  );
  const attachment = result.rows[0];
  if (!attachment) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
  return attachment;
};
