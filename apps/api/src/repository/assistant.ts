import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  assistantContextSchema,
  assistantContextUpdateInputSchema,
  assistantConversationListQuerySchema,
  assistantMessageSchema,
  assistantMessageInputSchema,
  assistantSourceUpdateInputSchema,
  assistantThreadDeleteInputSchema,
  assistantThreadSourceSchema,
  assistantThreadUpdateInputSchema,
  isSafeInternalRoute,
  inquiryAttachmentSchema,
  type AssistantContextContract,
  type AssistantContextUpdateResultContract,
  type AssistantMessageContract,
  type AssistantQuotaStatusContract,
  type AssistantResponseContract,
  type AssistantSourceUpdateResultContract,
  type AssistantThreadDeleteResultContract,
  type AssistantThreadDetailContract,
  type AssistantThreadPageContract,
  type AssistantThreadSourceContract,
  type AssistantThreadStateContract,
  type AssistantThreadUpdateResultContract,
  type InquiryAttachmentContract
} from "../../../../packages/contracts/src";
import { attachmentKindForFile } from "../../../../packages/contracts/src";
import { maxAssistantAttachmentBytes } from "@/lib/attachmentRules";
import {
  assistantVisionTokenCeiling,
  isAssistantVisionContentType,
  maxAssistantVisionAttachments
} from "@/lib/assistantVisionRules";
import {
  assistantContextKey,
  assistantContextTypeForSurface
} from "@/lib/assistantContext";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import { actualCostMicros } from "../services/aiBudget";
import {
  assistantQuota,
  assistantQuotaAfterReservation,
  completeAssistantUsage,
  reserveAssistantUsage
} from "../services/assistantUsage";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import type { Actor } from "../services/auth";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import {
  assistantProviderFailure,
  assistantMaxOutputTokens,
  assistantRenderedInput,
  callAssistantModel,
  type AssistantProviderFailure,
  type AssistantModelResult
} from "../services/openaiResponses";
import { runAtomic } from "../services/transactions";
import {
  replaceOwnerAttachments,
  type OwnedAttachmentRow
} from "../services/attachmentOwnership";
import {
  queueAttachmentsForOwnerStorageDeletion,
  triggerStorageDeletion
} from "../services/storageDeletion";
import {
  prepareAssistantVisionInputs,
  type AssistantVisionAttachment
} from "../services/assistantVision";
import {
  buildAssistantEvidence,
  resolveAssistantEvidenceClaims,
  type AssistantEvidenceBlock,
  type AssistantEvidencePacket,
  type AssistantSourceValidation
} from "../services/assistantEvidence";
import { assistantActionProposalFromDraft } from "../services/assistantActionRegistry";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

type ParsedInput = ReturnType<typeof assistantMessageInputSchema.parse>;
type HistoryMessage = { role: "user" | "assistant"; body: string };
type ConversationRow = {
  id: string;
  kind: "research_thread";
  title: string;
  projectId: string | null;
  pinnedAt: Date | string | null;
  archivedAt: Date | string | null;
  deletedAt: Date | string | null;
  metadataRevision: number;
  contextType: string;
  contextId: string | null;
  contextSources: unknown;
  activeContextKey: string | null;
  activeSourceId: string | null;
  originSourceId: string | null;
  contextRevision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastMessageAt: Date | string;
};

type PreparedAssistant = {
  owner: string;
  conversationId: string;
  usageId: string;
  reservedCostMicros: number;
  history: HistoryMessage[];
  context: AssistantContextContract | null;
  attachedContexts: AssistantContextContract[];
  visionAttachments: AssistantVisionAttachment[];
  evidence: AssistantMessageContract["evidence"];
  evidenceBlocks: AssistantEvidenceBlock[];
  evidencePackets: AssistantEvidencePacket[];
  userMessage: AssistantMessageContract;
  thread: AssistantThreadStateContract;
  input: ParsedInput;
  dailyLimit: number;
  remainingToday: number;
};

export const assistantThreadSources = (value: unknown): AssistantThreadSourceContract[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((entry) => {
    const normalized = (() => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const source = entry as Record<string, unknown>;
      if (typeof source.attachedAt !== "string" || Number.isNaN(Date.parse(source.attachedAt))) return source;
      return { ...source, attachedAt: new Date(source.attachedAt).toISOString() };
    })();
    const parsed = assistantThreadSourceSchema.safeParse(normalized);
    return parsed.success ? [parsed.data] : [];
  });
};

const isoString = (value: Date | string) => new Date(value).toISOString();

const assistantThreadState = (row: ConversationRow): AssistantThreadStateContract => {
  const sources = assistantThreadSources(row.contextSources);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    projectId: row.projectId,
    pinned: row.pinnedAt !== null,
    archivedAt: row.archivedAt === null ? null : isoString(row.archivedAt),
    metadataRevision: row.metadataRevision,
    contextType: row.contextType,
    contextId: row.contextId,
    activeContextKey: row.activeContextKey,
    activeSourceId: row.activeSourceId,
    originSourceId: row.originSourceId,
    contextRevision: row.contextRevision,
    sourceCount: sources.filter((source) => source.included).length,
    sourceRevisionCount: sources.length,
    sources,
    createdAt: isoString(row.createdAt),
    updatedAt: isoString(row.updatedAt),
    lastMessageAt: isoString(row.lastMessageAt)
  };
};

const sourceForContext = (
  context: AssistantContextContract,
  existing: AssistantThreadSourceContract[] = [],
  attachedAt = new Date().toISOString()
): AssistantThreadSourceContract => ({
  id: randomUUID(),
  key: assistantContextKey(context),
  revision: Math.max(0, ...existing.filter((source) => source.key === assistantContextKey(context)).map((source) => source.revision)) + 1,
  included: true,
  context,
  attachedAt,
  supersedesSourceId: existing.filter((source) => source.key === assistantContextKey(context)).at(-1)?.id ?? null,
  provenance: "captured"
});

const assistantAttachmentFromRow = (
  row: Pick<OwnedAttachmentRow, "id" | "fileName" | "contentType" | "byteSize" | "status" | "metadata" | "createdAt">
): InquiryAttachmentContract => ({
  id: row.id,
  fileName: row.fileName,
  contentType: row.contentType,
  byteSize: row.byteSize,
  status: row.status,
  kind: attachmentKindForFile(row.contentType, row.fileName),
  metadata: row.metadata && typeof row.metadata === "object"
    ? row.metadata as Record<string, unknown>
    : {},
  createdAt: row.createdAt ? isoString(row.createdAt) : undefined
});

const assistantAttachmentsFromMetadata = (value: unknown): InquiryAttachmentContract[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((entry) => {
    const parsed = inquiryAttachmentSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
};

const assistantAttachmentContext = (
  row: OwnedAttachmentRow,
  owner: string
): AssistantContextContract => {
  const attachment = assistantAttachmentFromRow(row);
  const metadata = attachment.metadata ?? {};
  const previewText = typeof metadata.previewText === "string"
    ? metadata.previewText.trim()
    : "";
  const structuredPreview = metadata.structuredPreview && typeof metadata.structuredPreview === "object"
    ? JSON.stringify(metadata.structuredPreview)
    : "";
  const extracted = (previewText || structuredPreview).slice(0, 12_000);
  const visionReady = isAssistantVisionContentType(attachment.contentType);
  const kindLabel = attachment.kind === "pdf"
    ? "PDF"
    : attachment.kind.charAt(0).toUpperCase() + attachment.kind.slice(1);
  const sizeLabel = `${Math.max(0.01, attachment.byteSize / (1024 * 1024)).toFixed(2)} MB`;
  return assistantContextSchema.parse({
    surface: "attachment",
    route: `/api/assistant-attachments/${encodeURIComponent(attachment.id)}?actorHandle=${encodeURIComponent(owner)}`,
    title: attachment.fileName,
    summary: visionReady
      ? `${kindLabel} file · ${sizeLabel} · ready for bounded AI image inspection.`
      : extracted
        ? `${kindLabel} file · ${sizeLabel} · bounded text preview extracted for this limited beta.`
        : `${kindLabel} file · ${sizeLabel} · stored only; no model-readable content was extracted.`,
    content: extracted
      ? `Extracted file preview:\n${extracted}`
      : visionReady
        ? "This image is available to the model as a bounded visual source while it remains included."
        : "No model-readable content is available for this file in the limited beta.",
    entityType: "assistant_attachment",
    entityId: attachment.id,
    metadata: {
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      kind: attachment.kind,
      processing: visionReady
        ? "image_ready_for_ai"
        : extracted
          ? "bounded_text_extracted"
          : "stored_only",
      extractedCharacters: extracted.length
    }
  });
};

const unavailableEvidenceSource = (source: AssistantThreadSourceContract) => {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `“${source.context.title || "A saved source"}” is no longer available with your current access. Remove it from this answer or recapture the view.`
  });
};

export const validateAssistantEvidenceSources = async (
  client: PoolClient,
  sources: AssistantThreadSourceContract[],
  owner: string,
  conversationId: string,
  pendingAttachmentIds: string[]
): Promise<AssistantSourceValidation[]> => Promise.all(sources.map(async (source) => {
  const { context } = source;
  const entityType = context.entityType;
  const entityId = context.entityId?.trim();
  const allowUnresolvedRecovery = source.provenance === "recovered";
  const validated = (currentEntityRevision: number | null): AssistantSourceValidation => ({
    source,
    accessStatus: "verified",
    currentEntityRevision
  });
  const unresolved = (): AssistantSourceValidation => ({
    source,
    accessStatus: "not_applicable",
    currentEntityRevision: null
  });

  if (!entityId || !entityType) return unresolved();
  if (entityType === "post" || entityType === "opportunity") {
    const result = await client.query<{ revision: number }>(
      `SELECT post.revision
       FROM posts post
       LEFT JOIN communities community ON community.id = post.community_id
       WHERE post.id = $1
         AND post.deleted_at IS NULL
         AND ((post.room <> 'office' AND post.kind <> 'draft') OR post.author_handle = $2)
         AND (
           post.community_id IS NULL
           OR post.post_type = 'paper'
           OR community.visibility = 'public'
           OR post.author_handle = $2
           OR EXISTS (
             SELECT 1
             FROM community_memberships viewer
             WHERE viewer.community_id = post.community_id
               AND viewer.profile_handle = $2
               AND viewer.status = 'active'
           )
         )
       LIMIT 1`,
      [entityId, owner]
    );
    if (!result.rows[0]) return allowUnresolvedRecovery ? unresolved() : unavailableEvidenceSource(source);
    return validated(result.rows[0].revision);
  }
  if (entityType === "comment") {
    const result = await client.query<{ revision: number }>(
      `SELECT comment.revision
       FROM comments comment
       JOIN posts post ON post.id = comment.post_id
       LEFT JOIN communities community ON community.id = post.community_id
       WHERE comment.id = $1
         AND comment.deleted_at IS NULL
         AND post.deleted_at IS NULL
         AND ((post.room <> 'office' AND post.kind <> 'draft') OR post.author_handle = $2)
         AND (
           post.community_id IS NULL
           OR post.post_type = 'paper'
           OR community.visibility = 'public'
           OR post.author_handle = $2
           OR EXISTS (
             SELECT 1
             FROM community_memberships viewer
             WHERE viewer.community_id = post.community_id
               AND viewer.profile_handle = $2
               AND viewer.status = 'active'
           )
         )
       LIMIT 1`,
      [entityId, owner]
    );
    if (!result.rows[0]) return allowUnresolvedRecovery ? unresolved() : unavailableEvidenceSource(source);
    return validated(result.rows[0].revision);
  }
  if (entityType === "note") {
    const result = await client.query<{ revision: number }>(
      `SELECT note.revision
       FROM notes note
       LEFT JOIN workspace_note_grants direct
         ON direct.note_id = note.id AND direct.grantee_handle = $2
       LEFT JOIN workspace_notebook_grants inherited
         ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $2
       WHERE note.id::text = $1
         AND note.deleted_at IS NULL
         AND (note.owner_handle = $2 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)
       LIMIT 1`,
      [entityId, owner]
    );
    if (!result.rows[0]) return allowUnresolvedRecovery ? unresolved() : unavailableEvidenceSource(source);
    return validated(result.rows[0].revision);
  }
  if (entityType === "conversation") {
    const result = await client.query<{ revision: number }>(
      `SELECT conversation.revision
       FROM conversations conversation
       JOIN conversation_participants participant
         ON participant.conversation_id = conversation.id
       WHERE conversation.id::text = $1
         AND participant.profile_handle = $2
         AND participant.status = 'active'
         AND participant.hidden_at IS NULL
       LIMIT 1`,
      [entityId, owner]
    );
    if (!result.rows[0]) return allowUnresolvedRecovery ? unresolved() : unavailableEvidenceSource(source);
    return validated(result.rows[0].revision);
  }
  if (entityType === "assistant_attachment") {
    const result = await client.query(
      `SELECT 1
       FROM attachments attachment
       WHERE attachment.id::text = $1
         AND attachment.owner_type = 'assistant_message'
         AND attachment.uploader_handle = $2
         AND attachment.status IN ('uploaded', 'previewed')
         AND (
           (
             attachment.owner_id IS NULL
             AND attachment.id::text = ANY($4::text[])
           )
           OR EXISTS (
             SELECT 1
             FROM ai_messages message
             WHERE message.id::text = attachment.owner_id
               AND message.conversation_id = $3
           )
         )
       LIMIT 1`,
      [entityId, owner, conversationId, pendingAttachmentIds]
    );
    if (!result.rowCount) return allowUnresolvedRecovery ? unresolved() : unavailableEvidenceSource(source);
    return validated(null);
  }
  if (entityType === "attachment") {
    const result = await client.query<{ revision: number }>(
      `SELECT post.revision
       FROM attachments attachment
       LEFT JOIN comments comment
         ON attachment.owner_type = 'comment' AND comment.id = attachment.owner_id
       JOIN posts post
         ON post.id = CASE
           WHEN attachment.owner_type = 'post' THEN attachment.owner_id
           WHEN attachment.owner_type = 'comment' THEN comment.post_id
           ELSE NULL
         END
       LEFT JOIN communities community ON community.id = post.community_id
       WHERE attachment.id::text = $1
         AND attachment.status IN ('uploaded', 'previewed')
         AND post.deleted_at IS NULL
         AND (comment.id IS NULL OR comment.deleted_at IS NULL)
         AND ((post.room <> 'office' AND post.kind <> 'draft') OR post.author_handle = $2)
         AND (
           post.community_id IS NULL
           OR post.post_type = 'paper'
           OR community.visibility = 'public'
           OR post.author_handle = $2
           OR EXISTS (
             SELECT 1
             FROM community_memberships viewer
             WHERE viewer.community_id = post.community_id
               AND viewer.profile_handle = $2
               AND viewer.status = 'active'
           )
         )
       LIMIT 1`,
      [entityId, owner]
    );
    if (!result.rows[0]) return allowUnresolvedRecovery ? unresolved() : unavailableEvidenceSource(source);
    return validated(result.rows[0].revision);
  }

  return unresolved();
}));

const messageFromRow = (row: {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  body: string;
  metadata?: unknown;
  createdAt: Date | string;
}): AssistantMessageContract => {
  const metadata = row.metadata && typeof row.metadata === "object"
    ? row.metadata as Record<string, unknown>
    : {};
  return assistantMessageSchema.parse({
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    body: row.body,
    createdAt: isoString(row.createdAt),
    evidence: metadata.evidence ?? [],
    claims: metadata.claims ?? [],
    attachments: assistantAttachmentsFromMetadata(metadata.attachments),
    ...(metadata.translation ? { translation: metadata.translation } : {}),
    ...(metadata.quickNote ? { quickNote: metadata.quickNote } : {}),
    ...(metadata.quickNoteResult ? { quickNoteResult: metadata.quickNoteResult } : {}),
    ...(metadata.actionProposal ? { actionProposal: metadata.actionProposal } : {}),
    ...(metadata.actionReceipt ? { actionReceipt: metadata.actionReceipt } : {})
  });
};

const conversationSelect = `
  id,
  kind,
  title,
  project_id AS "projectId",
  pinned_at AS "pinnedAt",
  archived_at AS "archivedAt",
  deleted_at AS "deletedAt",
  metadata_revision AS "metadataRevision",
  context_type AS "contextType",
  context_id AS "contextId",
  context_sources AS "contextSources",
  active_context_key AS "activeContextKey",
  active_source_id AS "activeSourceId",
  origin_source_id AS "originSourceId",
  context_revision AS "contextRevision",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  last_message_at AS "lastMessageAt"
`;

type AssistantCursor = { pinned: boolean; lastMessageAt: string; id: string };

const encodeAssistantCursor = (row: { pinnedAt?: Date | string | null; lastMessageAt: Date | string; id: string }) =>
  Buffer.from(JSON.stringify({
    pinned: Boolean(row.pinnedAt),
    lastMessageAt: isoString(row.lastMessageAt),
    id: row.id
  } satisfies AssistantCursor)).toString("base64url");

const parseAssistantCursor = (cursor: string): AssistantCursor => {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<AssistantCursor>;
    if (
      typeof value.pinned !== "boolean" ||
      typeof value.lastMessageAt !== "string" ||
      Number.isNaN(Date.parse(value.lastMessageAt)) ||
      typeof value.id !== "string"
    ) {
      throw new Error("Invalid cursor.");
    }
    return value as AssistantCursor;
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The research-thread cursor is invalid." });
  }
};

const unavailableResponse = (
  input: ParsedInput,
  status: "provider_not_configured" | "disabled",
  body: string
): AssistantResponseContract => {
  const conversationId = input.conversationId ?? randomUUID();
  return {
    conversationId,
    providerConfigured: Boolean(env.OPENAI_API_KEY),
    status,
    model: env.SYMPOSIUM_AI_MODEL,
    quota: assistantQuota(env.SYMPOSIUM_AI_USER_DAILY_LIMIT, env.SYMPOSIUM_AI_USER_DAILY_LIMIT),
    message: {
      id: randomUUID(),
      conversationId,
      role: "assistant",
      body,
      createdAt: new Date().toISOString(),
      evidence: [],
      claims: [],
      attachments: []
    }
  };
};

export const getAssistantQuota = async (actor: Actor): Promise<AssistantQuotaStatusContract> => {
  if (!hasDatabase()) {
    return {
      enabled: false,
      providerConfigured: Boolean(env.OPENAI_API_KEY),
      model: env.SYMPOSIUM_AI_MODEL,
      quota: assistantQuota(env.SYMPOSIUM_AI_USER_DAILY_LIMIT, 0)
    };
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const usage = await getPool().query<{ usedToday: number; usageDay: string }>(
    `WITH quota_reset AS (
       SELECT COALESCE(max(reset_at), date_trunc('day', now())) AS reset_at
       FROM ai_daily_quota_resets
       WHERE owner_handle = $1 AND usage_day = current_date
     )
     SELECT count(*)::int AS "usedToday", current_date::text AS "usageDay"
     FROM ai_usage CROSS JOIN quota_reset
     WHERE owner_handle = $1
       AND status IN ('reserved', 'completed')
       AND created_at >= quota_reset.reset_at`,
    [owner]
  );
  const dailyLimit = env.SYMPOSIUM_AI_USER_DAILY_LIMIT;
  return {
    enabled: env.SYMPOSIUM_AI_ENABLED,
    providerConfigured: Boolean(env.OPENAI_API_KEY),
    model: env.SYMPOSIUM_AI_MODEL,
    quota: assistantQuota(dailyLimit, dailyLimit - (usage.rows[0]?.usedToday ?? 0))
  };
};

export const listAssistantConversations = async (
  rawQuery: unknown,
  actor: Actor
): Promise<AssistantThreadPageContract> => {
  const query = assistantConversationListQuerySchema.parse(rawQuery);
  if (!hasDatabase()) return { threads: [], nextCursor: null };
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const cursor = query.cursor ? parseAssistantCursor(query.cursor) : null;
  const values: unknown[] = [owner];
  const clauses = [
    "conversation.owner_handle = $1",
    "conversation.kind = 'research_thread'",
    "conversation.deleted_at IS NULL",
    query.status === "archived"
      ? "conversation.archived_at IS NOT NULL"
      : "conversation.archived_at IS NULL"
  ];
  if (cursor) {
    if (cursor.pinned) {
      values.push(cursor.lastMessageAt, cursor.id);
      clauses.push(`(
        (
          conversation.pinned_at IS NOT NULL
          AND (conversation.last_message_at, conversation.id)
            < ($${values.length - 1}::timestamptz, $${values.length}::uuid)
        )
        OR conversation.pinned_at IS NULL
      )`);
    } else {
      values.push(cursor.lastMessageAt, cursor.id);
      clauses.push(`conversation.pinned_at IS NULL
        AND (conversation.last_message_at, conversation.id)
          < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
  }
  if (query.contextKey) {
    values.push(JSON.stringify([{ key: query.contextKey }]));
    clauses.push(`conversation.context_sources @> $${values.length}::jsonb`);
  }
  if (query.projectId) {
    values.push(query.projectId);
    clauses.push(`conversation.project_id = $${values.length}
      AND EXISTS (
        SELECT 1
        FROM ai_projects project
        WHERE project.id = conversation.project_id
          AND project.owner_handle = $1
          AND project.deleted_at IS NULL
      )`);
  }
  if (query.search) {
    const escaped = query.search.replace(/[\\%_]/g, "\\$&");
    values.push(`%${escaped}%`);
    clauses.push(`(
      conversation.title ILIKE $${values.length} ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM ai_messages message
        WHERE message.conversation_id = conversation.id
          AND message.role IN ('user', 'assistant')
          AND message.body ILIKE $${values.length} ESCAPE '\\'
      )
    )`);
  }
  values.push(query.limit + 1);
  const result = await getPool().query<ConversationRow>(
    `SELECT ${conversationSelect}
     FROM ai_conversations conversation
     WHERE ${clauses.join(" AND ")}
     ORDER BY
       (conversation.pinned_at IS NOT NULL) DESC,
       conversation.last_message_at DESC,
       conversation.id DESC
     LIMIT $${values.length}`,
    values
  );
  const hasMore = result.rows.length > query.limit;
  const rows = result.rows.slice(0, query.limit);
  const last = rows.at(-1);
  return {
    threads: rows.map((row) => {
      const state = assistantThreadState(row);
      const { sources: _sources, ...summary } = state;
      return summary;
    }),
    nextCursor: hasMore && last ? encodeAssistantCursor(last) : null
  };
};

export const getAssistantConversation = async (
  conversationId: string,
  actor: Actor
): Promise<AssistantThreadDetailContract> => {
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Research thread not found." });
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const conversation = await getPool().query<ConversationRow>(
     `SELECT ${conversationSelect}
     FROM ai_conversations
     WHERE id = $1
       AND owner_handle = $2
       AND kind = 'research_thread'
       AND deleted_at IS NULL`,
    [conversationId, owner]
  );
  const row = conversation.rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Research thread not found." });
  const messages = await getPool().query<{
    id: string;
    conversationId: string;
    role: "user" | "assistant" | "system";
    body: string;
    metadata: unknown;
    createdAt: Date | string;
  }>(
    `SELECT id, conversation_id AS "conversationId", role, body, metadata, created_at AS "createdAt"
     FROM (
       SELECT id, conversation_id, role, body, metadata, created_at
       FROM ai_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [conversationId]
  );
  return {
    ...assistantThreadState(row),
    messages: messages.rows.map(messageFromRow)
  };
};

export const updateAssistantConversation = async (
  conversationId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantThreadUpdateResultContract> => {
  const input = assistantThreadUpdateInputSchema.parse(rawInput);
  if (!hasDatabase()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Research threads require the live database." });
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<AssistantThreadUpdateResultContract>(client, owner, mutation);
    if (claim.replayed) return { value: claim.response };
    const conversation = await client.query<ConversationRow>(
      `SELECT ${conversationSelect}
       FROM ai_conversations
       WHERE id = $1
         AND owner_handle = $2
         AND kind = 'research_thread'
         AND deleted_at IS NULL
       FOR UPDATE`,
      [conversationId, owner]
    );
    const row = conversation.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Research thread not found." });
    if (row.metadataRevision !== input.expectedRevision) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This chat changed elsewhere. Reload it before changing its details."
      });
    }
    if (input.pinned === true && row.archivedAt !== null && input.archived !== false) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Restore this chat before pinning it."
      });
    }
    if (input.projectId) {
      const project = await client.query(
        `SELECT 1
         FROM ai_projects
         WHERE id = $1
           AND owner_handle = $2
           AND deleted_at IS NULL
         FOR SHARE`,
        [input.projectId, owner]
      );
      if (!project.rowCount) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That Project is not available."
        });
      }
    }

    const updated = await client.query<ConversationRow>(
      `UPDATE ai_conversations
       SET title = CASE WHEN $3::text IS NULL THEN title ELSE $3::text END,
           pinned_at = CASE
             WHEN $5::boolean = true THEN NULL
             WHEN $4::boolean IS NULL THEN pinned_at
             WHEN $4::boolean = true AND pinned_at IS NULL THEN now()
             WHEN $4::boolean = true THEN pinned_at
             ELSE NULL
           END,
           archived_at = CASE
             WHEN $5::boolean IS NULL THEN archived_at
             WHEN $5::boolean = true AND archived_at IS NULL THEN now()
             WHEN $5::boolean = true THEN archived_at
             ELSE NULL
           END,
           project_id = CASE
             WHEN $6::boolean THEN $7::uuid
             ELSE project_id
           END,
           metadata_revision = metadata_revision + 1,
           updated_at = now()
       WHERE id = $1 AND owner_handle = $2
       RETURNING ${conversationSelect}`,
      [
        conversationId,
        owner,
        input.title ?? null,
        input.pinned ?? null,
        input.archived ?? null,
        input.projectId !== undefined,
        input.projectId ?? null
      ]
    );
    const response: AssistantThreadUpdateResultContract = {
      thread: assistantThreadState(updated.rows[0]!)
    };
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "assistant.thread.update",
      subjectType: "ai_conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, {
        renamed: input.title !== undefined,
        pinned: input.pinned ?? null,
        archived: input.archived ?? null,
        projectChanged: input.projectId !== undefined,
        projectId: response.thread.projectId,
        metadataRevision: response.thread.metadataRevision
      })
    });
    await completeMutation(client, owner, mutation, response);
    const event = await stageEvent(client, {
      kind: "assistant.thread.updated",
      actorHandle: owner,
      subjectType: "ai_conversation",
      subjectId: conversationId,
      visibility: "private",
      payload: {
        renamed: input.title !== undefined,
        pinned: response.thread.pinned,
        archived: response.thread.archivedAt !== null,
        projectId: response.thread.projectId,
        metadataRevision: response.thread.metadataRevision
      }
    });
    if (input.projectId !== undefined) {
      const projectIds = Array.from(new Set(
        [row.projectId, response.thread.projectId].filter(
          (projectId): projectId is string => Boolean(projectId)
        )
      ));
      if (projectIds.length) {
        await client.query(
          `UPDATE ai_projects
           SET updated_at = now()
           WHERE id = ANY($1::uuid[])
             AND owner_handle = $2
             AND deleted_at IS NULL`,
          [projectIds, owner]
        );
      }
    }
    return { value: response, events: [event] };
  });
};

export const deleteAssistantConversation = async (
  conversationId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantThreadDeleteResultContract> => {
  const input = assistantThreadDeleteInputSchema.parse(rawInput);
  if (!hasDatabase()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Research threads require the live database." });
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  let deletedAttachmentIds: string[] = [];
  const response = await runAtomic(async (client) => {
    const claim = await claimMutation<AssistantThreadDeleteResultContract>(client, owner, mutation);
    if (claim.replayed) return { value: claim.response };
    const conversation = await client.query<ConversationRow>(
      `SELECT ${conversationSelect}
       FROM ai_conversations
       WHERE id = $1
         AND owner_handle = $2
         AND kind = 'research_thread'
         AND deleted_at IS NULL
       FOR UPDATE`,
      [conversationId, owner]
    );
    const row = conversation.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Research thread not found." });
    if (row.metadataRevision !== input.expectedRevision) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This chat changed elsewhere. Reload it before deleting it."
      });
    }

    const messageIds = await client.query<{ id: string }>(
      "SELECT id::text FROM ai_messages WHERE conversation_id = $1 FOR UPDATE",
      [conversationId]
    );
    deletedAttachmentIds = await queueAttachmentsForOwnerStorageDeletion(
      client,
      "assistant_message",
      messageIds.rows.map((message) => message.id),
      "assistant_chat_deleted"
    );
    await client.query("DELETE FROM ai_messages WHERE conversation_id = $1", [conversationId]);
    await client.query(
      `DELETE FROM mutation_receipts
       WHERE actor_handle = $1
         AND (
           response ->> 'conversationId' = $2
           OR response -> 'thread' ->> 'id' = $2
         )`,
      [owner, conversationId]
    );
    await client.query(
      `UPDATE ai_conversations
       SET title = 'Deleted chat',
           context_type = 'general',
           context_id = NULL,
           context_sources = '[]'::jsonb,
           active_context_key = NULL,
           active_source_id = NULL,
           origin_source_id = NULL,
           project_id = NULL,
           pinned_at = NULL,
           archived_at = NULL,
           deleted_at = now(),
           metadata_revision = metadata_revision + 1,
           updated_at = now()
       WHERE id = $1 AND owner_handle = $2`,
      [conversationId, owner]
    );
    const response: AssistantThreadDeleteResultContract = {
      conversationId,
      deleted: true
    };
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "assistant.thread.delete",
      subjectType: "ai_conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, {
        preservedUsageLedger: true
      })
    });
    await completeMutation(client, owner, mutation, response);
    const event = await stageEvent(client, {
      kind: "assistant.thread.deleted",
      actorHandle: owner,
      subjectType: "ai_conversation",
      subjectId: conversationId,
      visibility: "private",
      payload: { deleted: true }
    });
    return { value: response, events: [event] };
  });
  if (deletedAttachmentIds.length) {
    await triggerStorageDeletion(deletedAttachmentIds);
  }
  return response;
};

export const updateAssistantConversationContext = async (
  conversationId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantContextUpdateResultContract> => {
  const input = assistantContextUpdateInputSchema.parse(rawInput);
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Research threads require the live database." });
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<AssistantContextUpdateResultContract>(client, owner, mutation);
    if (claim.replayed) return { value: claim.response };
    const conversation = await client.query<ConversationRow>(
       `SELECT ${conversationSelect}
       FROM ai_conversations
       WHERE id = $1
         AND owner_handle = $2
         AND kind = 'research_thread'
         AND archived_at IS NULL
         AND deleted_at IS NULL
       FOR UPDATE`,
      [conversationId, owner]
    );
    const row = conversation.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Research thread not found." });
    if (row.contextRevision !== input.expectedRevision) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This research thread changed elsewhere. Reload it before changing its sources."
      });
    }

    if (input.mode === "clear") {
      const sources = assistantThreadSources(row.contextSources).map((source) => ({
        ...source,
        included: false
      }));
      const updated = await client.query<ConversationRow>(
        `UPDATE ai_conversations
         SET context_sources = $3::jsonb,
             context_type = 'general',
             active_context_key = NULL,
             active_source_id = NULL,
             context_id = NULL,
             context_revision = context_revision + 1,
             updated_at = now()
         WHERE id = $1 AND owner_handle = $2
         RETURNING ${conversationSelect}`,
        [conversationId, owner, JSON.stringify(sources)]
      );
      const messageResult = await client.query<{
        id: string;
        conversationId: string;
        role: "system";
        body: string;
        createdAt: Date | string;
      }>(
        `INSERT INTO ai_messages (conversation_id, role, body, metadata)
         VALUES ($1, 'system', $2, $3)
         RETURNING id, conversation_id AS "conversationId", role, body, created_at AS "createdAt"`,
        [
          conversationId,
          "Context cleared. This chat is now using no explicit Symposium source.",
          JSON.stringify({ event: "context_update", mode: "clear", contextKey: null })
        ]
      );
      const response: AssistantContextUpdateResultContract = {
        thread: assistantThreadState(updated.rows[0]!),
        message: messageFromRow(messageResult.rows[0]!)
      };
      await stageAuditLog(client, {
        actorHandle: owner,
        action: "assistant.context.update",
        subjectType: "ai_conversation",
        subjectId: conversationId,
        metadata: mutationAuditMetadata(mutation, {
          mode: "clear",
          contextKey: null,
          contextRevision: response.thread.contextRevision
        })
      });
      await completeMutation(client, owner, mutation, response);
      const event = await stageEvent(client, {
        kind: "assistant.context.updated",
        actorHandle: owner,
        subjectType: "ai_conversation",
        subjectId: conversationId,
        visibility: "private",
        payload: { mode: "clear", contextKey: null, contextRevision: response.thread.contextRevision }
      });
      return { value: response, events: [event] };
    }

    const contextKey = assistantContextKey(input.context);
    let sources = assistantThreadSources(row.contextSources);
    const latestForKey = sources.filter((entry) => entry.key === contextKey).at(-1);
    const contextChanged = !latestForKey || JSON.stringify(latestForKey.context) !== JSON.stringify(input.context);
    const createRevision = input.mode === "refresh" || contextChanged;
    let source = latestForKey;
    if (createRevision) {
      source = sourceForContext(input.context, sources);
      sources = sources.map((entry) => entry.key === source!.key ? { ...entry, included: false } : entry);
      sources.push(source);
    } else if (source && !source.included) {
      sources = sources.map((entry) => entry.id === source!.id ? { ...entry, included: true } : entry);
      source = { ...source, included: true };
    }
    if (!source) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The source revision could not be prepared." });

    const activeSourceId = input.mode === "use"
      || !row.activeSourceId
      || (input.mode === "refresh" && row.activeContextKey === source.key)
      ? source.id
      : row.activeSourceId;
    const activeContextKey = sources.find((entry) => entry.id === activeSourceId)?.key ?? source.key;
    sources = sources.map((entry) => entry.id === activeSourceId ? { ...entry, included: true } : entry);
    const activeContext = sources.find((entry) => entry.id === activeSourceId)?.context ?? source.context;
    if (sources.filter((entry) => entry.included).length > 5) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This thread already has five included sources. Exclude one in the Context Dock before adding another."
      });
    }
    const protectedIds = new Set([row.originSourceId, activeSourceId, source.id].filter(Boolean));
    while (sources.length > 24) {
      const removable = sources.findIndex((entry) => !entry.included && !protectedIds.has(entry.id));
      if (removable < 0) break;
      sources.splice(removable, 1);
    }
    const updated = await client.query<ConversationRow>(
      `UPDATE ai_conversations
       SET context_sources = $3::jsonb,
           active_context_key = $4,
           active_source_id = $5,
           context_revision = context_revision + 1,
           context_type = $6,
           context_id = $7,
           updated_at = now()
       WHERE id = $1 AND owner_handle = $2
       RETURNING ${conversationSelect}`,
      [
        conversationId,
        owner,
        JSON.stringify(sources),
        activeContextKey,
        activeSourceId,
        assistantContextTypeForSurface(activeContext.surface),
        activeContext.entityId ?? null
      ]
    );
    const systemBody = input.mode === "use"
      ? `Active view changed to ${input.context.title || "the current view"}.`
      : input.mode === "refresh"
        ? `Captured revision ${source.revision} of ${input.context.title || "the current view"}.`
        : createRevision
          ? `Added ${input.context.title || "the current view"} as a source.`
          : `Included ${input.context.title || "the current view"} in the source set.`;
    const messageResult = await client.query<{
      id: string;
      conversationId: string;
      role: "system";
      body: string;
      createdAt: Date | string;
    }>(
      `INSERT INTO ai_messages (conversation_id, role, body, metadata)
       VALUES ($1, 'system', $2, $3)
       RETURNING id, conversation_id AS "conversationId", role, body, created_at AS "createdAt"`,
      [conversationId, systemBody, JSON.stringify({ event: "context_update", mode: input.mode, contextKey: source.key })]
    );
    const message = messageResult.rows[0]!;
    const response: AssistantContextUpdateResultContract = {
      thread: assistantThreadState(updated.rows[0]!),
      message: messageFromRow(message)
    };
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "assistant.context.update",
      subjectType: "ai_conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, {
        mode: input.mode,
        contextKey: source.key,
        contextRevision: response.thread.contextRevision
      })
    });
    await completeMutation(client, owner, mutation, response);
    const event = await stageEvent(client, {
      kind: "assistant.context.updated",
      actorHandle: owner,
      subjectType: "ai_conversation",
      subjectId: conversationId,
      visibility: "private",
      payload: { mode: input.mode, contextKey: source.key, contextRevision: response.thread.contextRevision }
    });
    return { value: response, events: [event] };
  });
};

export const updateAssistantConversationSource = async (
  conversationId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantSourceUpdateResultContract> => {
  const input = assistantSourceUpdateInputSchema.parse(rawInput);
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Research threads require the live database." });
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<AssistantSourceUpdateResultContract>(client, owner, mutation);
    if (claim.replayed) return { value: claim.response };
    const conversation = await client.query<ConversationRow>(
      `SELECT ${conversationSelect}
       FROM ai_conversations
       WHERE id = $1
         AND owner_handle = $2
         AND kind = 'research_thread'
         AND archived_at IS NULL
         AND deleted_at IS NULL
       FOR UPDATE`,
      [conversationId, owner]
    );
    const row = conversation.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Research thread not found." });
    if (row.contextRevision !== input.expectedRevision) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This research thread changed elsewhere. Reload it before changing its sources."
      });
    }
    let sources = assistantThreadSources(row.contextSources);
    const source = sources.find((entry) => entry.id === input.sourceId);
    if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "That source revision is no longer in this thread." });
    if (input.action === "exclude" && source.id === row.activeSourceId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Choose another active source before excluding this one." });
    }
    if (input.action === "include" && !source.included && sources.filter((entry) => entry.included).length >= 5) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Only five sources can be included per answer. Exclude one before including another."
      });
    }
    sources = sources.map((entry) => entry.id === source.id
      ? { ...entry, included: input.action !== "exclude" }
      : entry);
    const activeSourceId = input.action === "use" ? source.id : row.activeSourceId;
    const activeContextKey = input.action === "use" ? source.key : row.activeContextKey;
    const updated = await client.query<ConversationRow>(
      `UPDATE ai_conversations
       SET context_sources = $3::jsonb,
           active_source_id = $4,
           active_context_key = $5,
           context_id = CASE WHEN $6 = 'use' THEN $7 ELSE context_id END,
           context_type = CASE WHEN $6 = 'use' THEN $8 ELSE context_type END,
           context_revision = context_revision + 1,
           updated_at = now()
       WHERE id = $1 AND owner_handle = $2
       RETURNING ${conversationSelect}`,
      [
        conversationId,
        owner,
        JSON.stringify(sources),
        activeSourceId,
        activeContextKey,
        input.action,
        source.context.entityId ?? null,
        assistantContextTypeForSurface(source.context.surface)
      ]
    );
    const systemBody = input.action === "use"
      ? `Active source changed to ${source.context.title || "a saved view"} revision ${source.revision}.`
      : input.action === "include"
        ? `Included ${source.context.title || "a saved view"} revision ${source.revision} in future answers.`
        : `Excluded ${source.context.title || "a saved view"} revision ${source.revision} from future answers.`;
    const messageResult = await client.query<{
      id: string;
      conversationId: string;
      role: "system";
      body: string;
      createdAt: Date | string;
    }>(
      `INSERT INTO ai_messages (conversation_id, role, body, metadata)
       VALUES ($1, 'system', $2, $3)
       RETURNING id, conversation_id AS "conversationId", role, body, created_at AS "createdAt"`,
      [conversationId, systemBody, JSON.stringify({
        event: "source_update",
        action: input.action,
        sourceId: source.id,
        sourceRevision: source.revision
      })]
    );
    const response: AssistantSourceUpdateResultContract = {
      thread: assistantThreadState(updated.rows[0]!),
      message: messageFromRow(messageResult.rows[0]!)
    };
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "assistant.source.update",
      subjectType: "ai_conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, {
        sourceId: source.id,
        sourceKey: source.key,
        sourceRevision: source.revision,
        sourceAction: input.action,
        contextRevision: response.thread.contextRevision
      })
    });
    await completeMutation(client, owner, mutation, response);
    const event = await stageEvent(client, {
      kind: "assistant.source.updated",
      actorHandle: owner,
      subjectType: "ai_conversation",
      subjectId: conversationId,
      visibility: "private",
      payload: {
        sourceId: source.id,
        sourceAction: input.action,
        contextRevision: response.thread.contextRevision
      }
    });
    return { value: response, events: [event] };
  });
};

const prepareAssistant = async (
  input: ParsedInput,
  owner: string,
  mutation?: MutationContext
): Promise<PreparedAssistant | { replayed: AssistantResponseContract }> => runAtomic<PreparedAssistant | { replayed: AssistantResponseContract }>(async (client) => {
  const claim = await claimMutation<AssistantResponseContract>(client, owner, mutation);
  if (claim.replayed) return { value: { replayed: claim.response } };

  let conversationId = input.conversationId;
  let history: HistoryMessage[] = [];
  let conversationRow: ConversationRow;
  if (!conversationId) {
    const source = input.context ? sourceForContext(input.context) : null;
    if (input.projectId) {
      const project = await client.query(
        `SELECT 1
         FROM ai_projects
         WHERE id = $1
           AND owner_handle = $2
           AND deleted_at IS NULL
         FOR SHARE`,
        [input.projectId, owner]
      );
      if (!project.rowCount) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That Project is not available."
        });
      }
    }
    const conversation = await client.query<ConversationRow>(
      `INSERT INTO ai_conversations (
         owner_handle,
         project_id,
         kind,
         title,
         context_type,
         context_id,
         context_sources,
         active_context_key,
         active_source_id,
         origin_source_id
       )
       VALUES ($1, $2, 'research_thread', $3, $4, $5, $6::jsonb, $7, $8, $8)
       RETURNING ${conversationSelect}`,
      [
        owner,
        input.projectId ?? null,
        input.message.slice(0, 80),
        input.context ? input.contextType : "general",
        input.context ? input.contextId ?? input.context.entityId ?? null : null,
        JSON.stringify(source ? [source] : []),
        source?.key ?? null,
        source?.id ?? null
      ]
    );
    conversationRow = conversation.rows[0]!;
    conversationId = conversationRow.id;
    if (conversationRow.projectId) {
      await client.query(
        `UPDATE ai_projects
         SET updated_at = now()
         WHERE id = $1
           AND owner_handle = $2
           AND deleted_at IS NULL`,
        [conversationRow.projectId, owner]
      );
    }
  } else {
    const ownedConversation = await client.query<ConversationRow>(
      `SELECT ${conversationSelect}
       FROM ai_conversations
       WHERE id = $1
         AND owner_handle = $2
         AND kind = 'research_thread'
         AND archived_at IS NULL
         AND deleted_at IS NULL
       FOR UPDATE`,
      [conversationId, owner]
    );
    if (!ownedConversation.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "AI conversation not found." });
    conversationRow = ownedConversation.rows[0]!;
    const historyResult = await client.query<HistoryMessage>(
      `SELECT role, body FROM (
         SELECT role, body, created_at
         FROM ai_messages
         WHERE conversation_id = $1 AND role IN ('user', 'assistant')
         ORDER BY created_at DESC
         LIMIT 6
       ) recent ORDER BY created_at ASC`,
      [conversationId]
    );
    history = historyResult.rows;
  }

  const attachmentIds = input.attachmentIds;
  const attachmentRows = attachmentIds.length
    ? await client.query<OwnedAttachmentRow>(
        `SELECT
           id::text,
           id::text AS "attachmentId",
           owner_type AS "ownerType",
           owner_id AS "ownerId",
           uploader_handle AS "uploaderHandle",
           bucket,
           file_name AS "fileName",
           content_type AS "contentType",
           byte_size AS "byteSize",
           status,
           metadata,
           object_key AS "objectKey",
           upload_object_key AS "uploadObjectKey",
           created_at AS "createdAt"
         FROM attachments
         WHERE id = ANY($1::uuid[])
         FOR UPDATE`,
        [attachmentIds]
      )
    : { rows: [] as OwnedAttachmentRow[], rowCount: 0 };
  const attachmentRowsById = new Map(attachmentRows.rows.map((row) => [row.id, row]));
  const orderedAttachmentRows = attachmentIds.map((id) => attachmentRowsById.get(id));
  if (
    orderedAttachmentRows.some((row) =>
      !row ||
      row.ownerType !== "assistant_message" ||
      row.ownerId !== null ||
      row.uploaderHandle !== owner ||
      (row.status !== "uploaded" && row.status !== "previewed") ||
      row.byteSize > maxAssistantAttachmentBytes
    )
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "One or more AI chat files are unavailable, over 5 MB, or already attached elsewhere."
    });
  }
  if (input.intent === "translate" && attachmentIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Whole-file translation is paused in this limited beta. Open a Symposium document page to use page translation."
    });
  }

  let sources = assistantThreadSources(conversationRow.contextSources);
  const attachmentSources = (orderedAttachmentRows as OwnedAttachmentRow[]).map((row) =>
    sourceForContext(assistantAttachmentContext(row, owner), sources)
  );
  if (sources.filter((source) => source.included).length + attachmentSources.length > 5) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Only five sources can be included per answer. Exclude a saved source or remove a pending file before sending."
    });
  }
  for (const source of attachmentSources) {
    sources.push(source);
  }
  if (attachmentSources.length) {
    const activeSourceId = conversationRow.activeSourceId ?? attachmentSources[0]!.id;
    const activeSource = sources.find((source) => source.id === activeSourceId)!;
    const protectedIds = new Set([
      conversationRow.originSourceId,
      activeSourceId,
      ...attachmentSources.map((source) => source.id)
    ].filter(Boolean));
    while (sources.length > 24) {
      const removable = sources.findIndex((source) =>
        !source.included && !protectedIds.has(source.id)
      );
      if (removable < 0) break;
      sources.splice(removable, 1);
    }
    const updated = await client.query<ConversationRow>(
      `UPDATE ai_conversations
       SET context_sources = $3::jsonb,
           active_context_key = $4,
           active_source_id = $5,
           context_type = $6,
           context_id = $7,
           context_revision = context_revision + 1,
           updated_at = now()
       WHERE id = $1 AND owner_handle = $2
       RETURNING ${conversationSelect}`,
      [
        conversationId,
        owner,
        JSON.stringify(sources),
        activeSource.key,
        activeSource.id,
        assistantContextTypeForSurface(activeSource.context.surface),
        activeSource.context.entityId ?? null
      ]
    );
    conversationRow = updated.rows[0]!;
  }

  const activeSource = sources.find((source) => source.id === conversationRow.activeSourceId)
    ?? sources.filter((source) => source.key === conversationRow.activeContextKey).at(-1);
  const context = activeSource ? assistantContextSchema.parse(activeSource.context) : null;
  if (input.intent === "translate" && !context) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Attach a Symposium source before starting a source translation."
    });
  }
  const evidenceSources = activeSource ? [
    activeSource,
    ...sources
      .filter((source) => source.included && source.id !== activeSource.id)
      .slice(-4)
  ] : [];
  const attachedContexts = evidenceSources
    .filter((source) => source.id !== activeSource?.id)
    .slice(-4)
    .map((source) => source.context);
  const validatedSources = await validateAssistantEvidenceSources(
    client,
    evidenceSources,
    owner,
    conversationId,
    attachmentIds
  );
  const {
    evidence,
    blocks: evidenceBlocks,
    packets: evidencePackets
  } = buildAssistantEvidence(validatedSources, activeSource?.id ?? null);
  const visionAttachmentIds = Array.from(new Set(
    evidenceSources.flatMap((source) => {
      const sourceContext = source.context;
      if (
        sourceContext.surface !== "attachment" ||
        !sourceContext.entityId ||
        !isAssistantVisionContentType(
          typeof sourceContext.metadata?.contentType === "string"
            ? sourceContext.metadata.contentType
            : ""
        )
      ) {
        return [];
      }
      return [sourceContext.entityId];
    })
  ));
  if (visionAttachmentIds.length > maxAssistantVisionAttachments) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Only ${maxAssistantVisionAttachments} images can be visually inspected in one answer. Exclude another image in the Context Dock and try again.`
    });
  }
  if (input.intent === "translate" && visionAttachmentIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Whole-image translation is paused in this limited beta. Ask for an explanation or description instead."
    });
  }
  const visionRows = visionAttachmentIds.length
    ? await client.query<OwnedAttachmentRow>(
        `SELECT
           attachment.id::text,
           attachment.id::text AS "attachmentId",
           attachment.owner_type AS "ownerType",
           attachment.owner_id AS "ownerId",
           attachment.uploader_handle AS "uploaderHandle",
           attachment.bucket,
           attachment.file_name AS "fileName",
           attachment.content_type AS "contentType",
           attachment.byte_size AS "byteSize",
           attachment.status,
           attachment.metadata,
           attachment.object_key AS "objectKey",
           attachment.upload_object_key AS "uploadObjectKey",
           attachment.created_at AS "createdAt"
         FROM attachments attachment
         WHERE attachment.id::text = ANY($1::text[])
           AND attachment.owner_type = 'assistant_message'
           AND attachment.uploader_handle = $2
           AND attachment.status IN ('uploaded', 'previewed')
           AND (
             (
               attachment.owner_id IS NULL
               AND attachment.id::text = ANY($4::text[])
             )
             OR EXISTS (
               SELECT 1
               FROM ai_messages message
               WHERE message.id::text = attachment.owner_id
                 AND message.conversation_id = $3
             )
           )
         FOR UPDATE OF attachment`,
        [visionAttachmentIds, owner, conversationId, attachmentIds]
      )
    : { rows: [] as OwnedAttachmentRow[], rowCount: 0 };
  const visionRowsById = new Map(visionRows.rows.map((row) => [row.id, row]));
  const orderedVisionRows = visionAttachmentIds.map((id) => visionRowsById.get(id));
  if (orderedVisionRows.some((row) => !row)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "One or more included images are no longer available for private AI inspection."
    });
  }
  const visionAttachments = (orderedVisionRows as OwnedAttachmentRow[]).map((row) => ({
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    objectKey: row.objectKey
  }));
  const renderedInput = assistantRenderedInput({
    history,
    context,
    attachedContexts,
    evidencePackets,
    message: input.message,
    intent: input.intent,
    targetLanguage: input.targetLanguage
  });
  const reservation = await reserveAssistantUsage(client, {
    owner,
    conversationId,
    renderedInput,
    maxOutputTokens: assistantMaxOutputTokens(input.intent),
    additionalInputTokens: assistantVisionTokenCeiling(visionAttachments.length),
    visionInputCount: visionAttachments.length
  });
  const attachments = (orderedAttachmentRows as OwnedAttachmentRow[]).map(assistantAttachmentFromRow);
  const userMessage = await client.query<{
    id: string;
    conversationId: string;
    role: "user";
    body: string;
    metadata: unknown;
    createdAt: Date | string;
  }>(
    `INSERT INTO ai_messages (conversation_id, role, body, metadata)
     VALUES ($1, 'user', $2, $3)
     RETURNING id, conversation_id AS "conversationId", role, body, metadata, created_at AS "createdAt"`,
    [conversationId, input.message, JSON.stringify({
      context: context ?? null,
      contextKey: activeSource?.key ?? null,
      evidence,
      activeSourceId: activeSource?.id ?? null,
      attachedSourceIds: evidenceSources.filter((source) => source.id !== activeSource?.id).map((source) => source.id),
      visionAttachmentIds,
      grounding: context ? "sources" : "none",
      contextType: conversationRow.contextType,
      contextId: conversationRow.contextId,
      attachments
    })]
  );
  if (attachmentIds.length) {
    await replaceOwnerAttachments(client, {
      attachmentIds,
      ownerId: userMessage.rows[0]!.id,
      ownerType: "assistant_message",
      uploaderHandle: owner
    });
  }
  await client.query(
    `UPDATE ai_conversations
     SET last_message_at = GREATEST(last_message_at, $3::timestamptz)
     WHERE id = $1 AND owner_handle = $2`,
    [conversationId, owner, userMessage.rows[0]?.createdAt ?? new Date()]
  );
  return {
    value: {
      owner,
      conversationId,
      usageId: reservation.usageId,
      reservedCostMicros: reservation.reservedCostMicros,
      history,
      context,
      attachedContexts,
      visionAttachments,
      evidence,
      evidenceBlocks,
      evidencePackets,
      userMessage: messageFromRow(userMessage.rows[0]!),
      thread: assistantThreadState({ ...conversationRow, contextSources: sources }),
      input,
      dailyLimit: reservation.dailyLimit,
      remainingToday: reservation.remainingToday
    }
  };
});

const finalizeAssistant = async (
  prepared: PreparedAssistant,
  result: AssistantModelResult | null,
  failure: AssistantProviderFailure | null,
  mutation?: MutationContext
): Promise<AssistantResponseContract> => runAtomic(async (client) => {
  const providerError = !result;
  const body = result?.body ?? failure?.body ?? "The AI service could not complete this answer. No daily answer was used; you can retry.";
  const claims = result
    ? resolveAssistantEvidenceClaims(result.claims, prepared.evidenceBlocks)
    : [];
  const translation = result?.translation && prepared.input.targetLanguage && prepared.context
    ? {
        ...result.translation,
        targetLanguage: prepared.input.targetLanguage,
        source: {
          surface: prepared.context.surface,
          route: isSafeInternalRoute(prepared.context.route) ? prepared.context.route : "/",
          title: prepared.context.title.trim() || "Current view",
          ...(prepared.context.entityType ? { entityType: prepared.context.entityType } : {}),
          ...(prepared.context.entityId ? { entityId: prepared.context.entityId } : {})
        }
      }
    : undefined;
  const quickNote = result?.quickNote && prepared.context
      ? {
        ...result.quickNote,
        source: {
          surface: prepared.context.surface,
          route: isSafeInternalRoute(prepared.context.route) ? prepared.context.route : "/",
          title: prepared.context.title.trim() || "Current view",
          ...(prepared.context.entityType ? { entityType: prepared.context.entityType } : {}),
          ...(prepared.context.entityId ? { entityId: prepared.context.entityId } : {})
        }
      }
    : undefined;
  const actionSource = prepared.context
    ? {
        surface: prepared.context.surface,
        route: isSafeInternalRoute(prepared.context.route) ? prepared.context.route : "/",
        title: prepared.context.title.trim() || "Current view",
        ...(prepared.context.entityType ? { entityType: prepared.context.entityType } : {}),
        ...(prepared.context.entityId ? { entityId: prepared.context.entityId } : {})
      }
    : undefined;
  const actionProposal = result?.action
    ? assistantActionProposalFromDraft(result.action, actionSource)
    : undefined;
  const actualMicros = result
    ? actualCostMicros(env.SYMPOSIUM_AI_MODEL, result.inputTokens, result.outputTokens)
    : failure?.mayHaveBeenBilled
      ? failure.inputTokens + failure.outputTokens > 0
        ? actualCostMicros(env.SYMPOSIUM_AI_MODEL, failure.inputTokens, failure.outputTokens)
        : prepared.reservedCostMicros
      : 0;
  const conversation = await client.query<{ deletedAt: Date | string | null }>(
    `SELECT deleted_at AS "deletedAt"
     FROM ai_conversations
     WHERE id = $1 AND owner_handle = $2
     FOR UPDATE`,
    [prepared.conversationId, prepared.owner]
  );
  if (!conversation.rowCount || conversation.rows[0]!.deletedAt) {
    await completeAssistantUsage(client, {
      usageId: prepared.usageId,
      owner: prepared.owner,
      providerError,
      actualCostMicros: actualMicros,
      inputTokens: result?.inputTokens ?? failure?.inputTokens ?? 0,
      cachedInputTokens: result?.cachedInputTokens ?? failure?.cachedInputTokens ?? 0,
      cacheWriteTokens: result?.cacheWriteTokens ?? failure?.cacheWriteTokens ?? 0,
      outputTokens: result?.outputTokens ?? failure?.outputTokens ?? 0,
      providerResponseId: result?.providerResponseId ?? failure?.providerResponseId,
      errorCode: failure?.code
    });
    const discardedResponse: AssistantResponseContract = {
      conversationId: prepared.conversationId,
      providerConfigured: true,
      status: "discarded",
      model: result?.model ?? env.SYMPOSIUM_AI_MODEL,
      quota: assistantQuotaAfterReservation(
        prepared.dailyLimit,
        prepared.remainingToday,
        !providerError
      ),
      message: {
        id: randomUUID(),
        conversationId: prepared.conversationId,
        role: "assistant",
        body: "This chat was deleted while the answer was being prepared, so the answer was discarded.",
        createdAt: new Date().toISOString(),
        evidence: [],
        claims: [],
        attachments: []
      }
    };
    await stageAuditLog(client, {
      actorHandle: prepared.owner,
      action: "assistant.message.discard",
      subjectType: "ai_conversation",
      subjectId: prepared.conversationId,
      metadata: mutationAuditMetadata(mutation, {
        reason: "conversation_deleted",
        providerCompleted: Boolean(result),
        actualCostMicros: actualMicros
      })
    });
    await completeMutation(client, prepared.owner, mutation, discardedResponse);
    return { value: discardedResponse };
  }
  const assistantMessage = await client.query<{
    id: string;
    conversationId: string;
    role: "assistant";
    body: string;
    createdAt: Date | string;
  }>(
    `INSERT INTO ai_messages (conversation_id, role, body, metadata)
     VALUES ($1, 'assistant', $2, $3)
     RETURNING id, conversation_id AS "conversationId", role, body, created_at AS "createdAt"`,
    [prepared.conversationId, body, JSON.stringify({
      model: result?.model ?? env.SYMPOSIUM_AI_MODEL,
      providerResponseId: result?.providerResponseId ?? null,
      providerError,
      providerErrorCode: failure?.code ?? null,
      evidence: prepared.evidence,
      claims,
      translation: translation ?? null,
      quickNote: quickNote ?? null,
      actionProposal: actionProposal ?? null
    })]
  );
  await completeAssistantUsage(client, {
    usageId: prepared.usageId,
    owner: prepared.owner,
    providerError,
    actualCostMicros: actualMicros,
    inputTokens: result?.inputTokens ?? failure?.inputTokens ?? 0,
    cachedInputTokens: result?.cachedInputTokens ?? failure?.cachedInputTokens ?? 0,
    cacheWriteTokens: result?.cacheWriteTokens ?? failure?.cacheWriteTokens ?? 0,
    outputTokens: result?.outputTokens ?? failure?.outputTokens ?? 0,
    providerResponseId: result?.providerResponseId ?? failure?.providerResponseId,
    errorCode: failure?.code
  });
  const updatedConversation = await client.query<ConversationRow>(
    `UPDATE ai_conversations
     SET updated_at = now(),
         last_message_at = GREATEST(
           last_message_at,
           (SELECT created_at FROM ai_messages WHERE id = $3)
         )
     WHERE id = $1 AND owner_handle = $2
     RETURNING ${conversationSelect}`,
    [prepared.conversationId, prepared.owner, assistantMessage.rows[0]!.id]
  );
  const row = assistantMessage.rows[0]!;
  const response: AssistantResponseContract = {
    conversationId: prepared.conversationId,
    providerConfigured: true,
    status: providerError ? "provider_error" : "answered",
    model: result?.model ?? env.SYMPOSIUM_AI_MODEL,
    quota: assistantQuotaAfterReservation(prepared.dailyLimit, prepared.remainingToday, !providerError),
    thread: assistantThreadState(updatedConversation.rows[0] ?? {
      ...prepared.thread,
      contextSources: prepared.thread.sources,
      createdAt: prepared.thread.createdAt,
      updatedAt: new Date().toISOString()
    }),
    message: assistantMessageSchema.parse({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      evidence: prepared.evidence,
      claims,
      ...(translation ? { translation } : {}),
      ...(quickNote ? { quickNote } : {}),
      ...(actionProposal ? { actionProposal } : {})
    }),
    userMessage: prepared.userMessage,
    ...(translation ? { translation } : {}),
    ...(quickNote ? { quickNote } : {}),
    ...(actionProposal ? { actionProposal } : {})
  };
  await stageAuditLog(client, {
    actorHandle: prepared.owner,
    action: "assistant.message",
    subjectType: "ai_conversation",
    subjectId: prepared.conversationId,
    metadata: mutationAuditMetadata(mutation, {
      contextId: prepared.input.contextId,
      contextType: prepared.input.contextType,
      surface: prepared.context?.surface ?? null,
      intent: prepared.input.intent,
      targetLanguage: prepared.input.targetLanguage,
      proposedAction: actionProposal?.tool ?? null,
      model: response.model,
      status: response.status,
      visionInputCount: prepared.visionAttachments.length,
      actualCostMicros: actualMicros
    })
  });
  await completeMutation(client, prepared.owner, mutation, response);
  const event = await stageEvent(client, {
    kind: "assistant.message.created",
    actorHandle: prepared.owner,
    subjectType: "ai_conversation",
    subjectId: prepared.conversationId,
    visibility: "private",
    payload: { messageId: response.message.id, status: response.status }
  });
  return { value: response, events: [event] };
});

export const askAssistant = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantResponseContract> => {
  const input = assistantMessageInputSchema.parse(rawInput);
  if (!env.SYMPOSIUM_AI_ENABLED) {
    return unavailableResponse(input, "disabled", "The AI Tablet is currently switched off. It only runs when the shared cost-controlled beta is explicitly enabled.");
  }
  if (!env.OPENAI_API_KEY) {
    return unavailableResponse(input, "provider_not_configured", "The AI Tablet is ready, but the model provider key has not been configured yet.");
  }
  if (!hasDatabase()) {
    return unavailableResponse(input, "disabled", "The AI Tablet will not spend money without its durable usage ledger. Connect the live database first.");
  }

  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const prepared = await prepareAssistant(input, owner, mutation);
  if ("replayed" in prepared) return prepared.replayed;

  let result: AssistantModelResult | null = null;
  let failure: AssistantProviderFailure | null = null;
  try {
    const visionInputs = await prepareAssistantVisionInputs(prepared.visionAttachments);
    result = await callAssistantModel({
      ownerHandle: owner,
      history: prepared.history,
      context: prepared.context,
      attachedContexts: prepared.attachedContexts,
      evidencePackets: prepared.evidencePackets,
      evidenceBlocks: prepared.evidenceBlocks,
      message: input.message,
      intent: input.intent,
      targetLanguage: input.targetLanguage,
      visionInputs
    });
  } catch (error) {
    failure = error instanceof TRPCError
      ? {
          code: "invalid_image_input",
          body: `${error.message} No daily answer was used.`,
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          mayHaveBeenBilled: false
        }
      : assistantProviderFailure(error);
    console.error("SYMPOSIUM AI provider request failed.", error);
  }
  return finalizeAssistant(prepared, result, failure, mutation);
};

export const assertAssistantAttachmentAccess = async (
  attachmentId: string,
  actor: Actor
) => {
  const owner = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
  }
  await ensureLiveData();
  const result = await getPool().query<{ objectKey: string }>(
    `SELECT attachment.object_key AS "objectKey"
     FROM attachments attachment
     WHERE attachment.id = $1
       AND attachment.owner_type = 'assistant_message'
       AND attachment.status IN ('uploaded', 'previewed')
       AND (
         (attachment.owner_id IS NULL AND attachment.uploader_handle = $2)
         OR EXISTS (
           SELECT 1
           FROM ai_messages message
           JOIN ai_conversations conversation
             ON conversation.id = message.conversation_id
           WHERE message.id::text = attachment.owner_id
             AND conversation.owner_handle = $2
             AND conversation.kind = 'research_thread'
             AND conversation.deleted_at IS NULL
         )
       )
     LIMIT 1`,
    [attachmentId, owner]
  );
  const attachment = result.rows[0];
  if (!attachment) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
  }
  return attachment;
};
