import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  confirmAttachmentInputSchema,
  createAttachmentUploadInputSchema
} from "../../../../packages/contracts/src";
import {
  attachmentContentTypesMatch,
  inferAttachmentContentType,
  validateAttachmentContentSignature,
  validateAttachmentNameAndContentType,
  validatePostAttachmentDetails
} from "@/lib/attachmentRules";
import { cleanHandle } from "@/lib/symposiumCore";
import { env, hasR2Config } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import type { Actor } from "../services/auth";
import { publishStoredEvent, stageEvent, type StoredLiveEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import {
  createObjectKey,
  createUploadObjectKey,
  inspectUploadedObject,
  promoteUploadedObject,
  storeUploadedObject
} from "../services/storage";
import {
  AttachmentUploadSizeError,
  createBoundedAttachmentUploadStream
} from "../services/attachmentUploadStream";
import {
  queueAttachmentRowsForStorageDeletion,
  queueStagingObjectDeletion,
  triggerStorageDeletion,
  type AttachmentStorageRow
} from "../services/storageDeletion";
import { runAtomic } from "../services/transactions";
import { officeArchiveFormatForContentType, validateOfficeArchive } from "@/lib/docxSecurity";
import { actorHandle, ensureLiveData } from "./foundation";

const allowedProfileImageTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);
const maxProfileImageBytes = 5 * 1024 * 1024;
const maxPendingUploadsPerActor = 20;
const maxDailyUploadsPerActor = 100;
const maxDailyUploadBytesPerActor = 250 * 1024 * 1024;
const maxDailyUploadsGlobal = 500;
const maxDailyUploadBytesGlobal = 1024 * 1024 * 1024;
const maxActiveUploadBytesGlobal = 8 * 1024 * 1024 * 1024;

type AttachmentRow = {
  attachmentId: string;
  bucket: string;
  byteSize: number;
  contentType: string;
  fileName: string;
  objectKey: string;
  ownerId: string | null;
  ownerType: string;
  metadata?: Record<string, unknown>;
  status: "pending" | "verifying" | "uploaded" | "previewed" | "failed";
  uploadObjectKey: string;
};

const publicObjectUrl = (objectKey: string) =>
  env.R2_PUBLIC_BASE_URL ? `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${objectKey}` : null;

const requireAttachmentDatabase = (ownerType: string) => {
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Persistent attachment storage requires the live database."
    });
  }
  if (!hasR2Config) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Persistent attachment storage is not configured."
    });
  }
  if (ownerType !== "message" && ownerType !== "note" && ownerType !== "note_comment" && ownerType !== "opportunity_application" && !env.R2_PUBLIC_BASE_URL) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Persistent public attachment delivery is not configured."
    });
  }
};

const assertUploadAllowance = async (client: PoolClient, handle: string, incomingByteSize: number) => {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('symposium:upload-capacity', 0))");
  const expired = await client.query<AttachmentStorageRow>(
    `UPDATE attachments
     SET status = 'failed',
         metadata = metadata || jsonb_build_object('verificationError', 'Upload window expired.'),
         updated_at = now()
     WHERE uploader_handle = $1
       AND (
         (status = 'pending' AND updated_at < now() - interval '15 minutes')
         OR (status = 'verifying' AND updated_at < now() - interval '30 minutes')
       )
     RETURNING
       id::text AS "attachmentId",
       bucket,
       object_key AS "objectKey",
       upload_object_key AS "uploadObjectKey"`,
    [handle]
  );
  const result = await client.query<{
    dailyBytes: string;
    dailyCount: string;
    pendingCount: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('pending', 'verifying'))::text AS "pendingCount",
       count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::text AS "dailyCount",
       COALESCE(sum(byte_size) FILTER (WHERE created_at >= now() - interval '24 hours'), 0)::text AS "dailyBytes"
     FROM attachments
     WHERE uploader_handle = $1`,
    [handle]
  );
  const globalResult = await client.query<{
    activeBytes: string;
    dailyBytes: string;
    dailyCount: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::text AS "dailyCount",
       COALESCE(sum(byte_size) FILTER (WHERE created_at >= now() - interval '24 hours'), 0)::text AS "dailyBytes",
       COALESCE(sum(byte_size) FILTER (
         WHERE status IN ('pending', 'verifying', 'uploaded', 'previewed')
            OR (status = 'failed' AND COALESCE(metadata->>'storageState', '') <> 'deleted')
       ), 0)::text AS "activeBytes"
     FROM attachments`
  );
  const usage = result.rows[0];
  const globalUsage = globalResult.rows[0];
  if (Number(usage?.pendingCount ?? 0) >= maxPendingUploadsPerActor) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Finish or discard an existing pending upload first." });
  }
  if (
    Number(usage?.dailyCount ?? 0) + 1 > maxDailyUploadsPerActor ||
    Number(usage?.dailyBytes ?? 0) + incomingByteSize > maxDailyUploadBytesPerActor
  ) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The 24-hour attachment upload allowance has been reached." });
  }
  if (
    Number(globalUsage?.dailyCount ?? 0) + 1 > maxDailyUploadsGlobal ||
    Number(globalUsage?.dailyBytes ?? 0) + incomingByteSize > maxDailyUploadBytesGlobal
  ) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "SYMPOSIUM's daily storage allowance has been reached. Please try again later."
    });
  }
  if (Number(globalUsage?.activeBytes ?? 0) + incomingByteSize > maxActiveUploadBytesGlobal) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "SYMPOSIUM's current storage capacity has been reached."
    });
  }
  return queueAttachmentRowsForStorageDeletion(client, expired.rows, "expired_upload");
};

export const createAttachmentUpload = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const parsedInput = createAttachmentUploadInputSchema.parse(rawInput);
  const input = {
    ...parsedInput,
    contentType: inferAttachmentContentType(parsedInput.fileName, parsedInput.contentType)
  };
  const handle = actorHandle(actor);

  if (!["post", "comment", "message", "note", "note_comment", "opportunity_application", "profile"].includes(input.ownerType)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported attachment owner." });
  }

  if (input.ownerType === "profile") {
    if (input.ownerId && cleanHandle(input.ownerId) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Profile uploads can only belong to the authenticated profile." });
    }
    if (!allowedProfileImageTypes.has(input.contentType.toLowerCase())) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose a PNG, JPG, JPEG, WEBP, GIF, or AVIF image."
      });
    }
    const nameTypeError = validateAttachmentNameAndContentType(input.fileName, input.contentType);
    if (nameTypeError) throw new TRPCError({ code: "BAD_REQUEST", message: nameTypeError });
    if (input.byteSize > maxProfileImageBytes) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Profile photos must be 5 MB or smaller."
      });
    }
  } else {
    if (input.ownerId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `A ${input.ownerType} attachment is assigned when its ${input.ownerType} is saved.`
      });
    }
    const validationError = validatePostAttachmentDetails(input.fileName, input.contentType, input.byteSize);
    if (validationError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: validationError
      });
    }
  }

  requireAttachmentDatabase(input.ownerType);
  await ensureLiveData();
  let expiredAttachmentIds: string[] = [];
  const prepared = await runAtomic(async (client) => {
    const claim = await claimMutation<{
      attachmentId: string;
      objectKey: string;
      publicUrl: string | null;
      uploadObjectKey: string;
    }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };

    expiredAttachmentIds = await assertUploadAllowance(client, handle, input.byteSize);
    const attachmentId = randomUUID();
    const objectKey = createObjectKey(input.ownerType, input.fileName);
    const uploadObjectKey = createUploadObjectKey(attachmentId);
    await client.query(
      `INSERT INTO attachments (
        id, owner_type, owner_id, uploader_handle, bucket, object_key, upload_object_key,
        file_name, content_type, byte_size, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
      [
        attachmentId,
        input.ownerType,
        input.ownerType === "profile" ? handle : null,
        handle,
        env.R2_BUCKET ?? "symposium",
        objectKey,
        uploadObjectKey,
        input.fileName,
        input.contentType,
        input.byteSize
      ]
    );
    const value = {
      attachmentId,
      objectKey,
      uploadObjectKey,
      publicUrl: input.ownerType === "message" || input.ownerType === "note" || input.ownerType === "note_comment" || input.ownerType === "opportunity_application" ? null : publicObjectUrl(objectKey)
    };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "attachment.prepare",
      subjectType: "attachment",
      subjectId: attachmentId,
      metadata: mutationAuditMetadata(mutation, {
        byteSize: input.byteSize,
        contentType: input.contentType,
        ownerType: input.ownerType
      })
    });
    await completeMutation(client, handle, mutation, value);
    return { value };
  });

  if (expiredAttachmentIds.length) await triggerStorageDeletion(expiredAttachmentIds);

  return {
    attachmentId: prepared.attachmentId,
    objectKey: prepared.objectKey,
    uploadUrl: `/api/attachments/${encodeURIComponent(prepared.attachmentId)}/content`,
    uploadTransport: "authenticated_api" as const,
    publicUrl: prepared.publicUrl
  };
};

const clearAttachmentUploadClaim = async (attachmentId: string, handle: string) => {
  await getPool().query(
    `UPDATE attachments
     SET metadata = metadata - 'uploadingAt', updated_at = now()
     WHERE id = $1 AND uploader_handle = $2 AND status = 'pending'`,
    [attachmentId, handle]
  );
};

export const uploadAttachmentContent = async (
  attachmentId: string,
  body: Readable,
  declaredByteSize: number | null,
  actor: Actor
) => {
  const handle = actorHandle(actor);
  requireAttachmentDatabase("message");
  await ensureLiveData();

  const claimed = await getPool().query<AttachmentRow>(
    `UPDATE attachments
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{uploadingAt}', to_jsonb(now()::text), true),
         updated_at = now()
     WHERE id = $1
       AND uploader_handle = $2
       AND status = 'pending'
       AND metadata->>'stagingUploadedAt' IS NULL
       AND (
         metadata->>'uploadingAt' IS NULL
         OR updated_at < now() - interval '10 minutes'
       )
     RETURNING
       id::text AS "attachmentId",
       bucket,
       owner_type AS "ownerType",
       owner_id AS "ownerId",
       object_key AS "objectKey",
       upload_object_key AS "uploadObjectKey",
       file_name AS "fileName",
       content_type AS "contentType",
       byte_size AS "byteSize",
       metadata,
       status`,
    [attachmentId, handle]
  );
  const attachment = claimed.rows[0];
  if (!attachment) {
    const existing = await selectAttachment(attachmentId, handle);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment upload not found." });
    if (existing.status === "pending" && existing.metadata?.stagingUploadedAt) {
      return { attachmentId, status: "staged" as const };
    }
    throw new TRPCError({
      code: "CONFLICT",
      message: existing.status === "pending"
        ? "This attachment is already being uploaded."
        : "This attachment upload is no longer pending."
    });
  }

  if (declaredByteSize !== null && declaredByteSize !== attachment.byteSize) {
    await clearAttachmentUploadClaim(attachmentId, handle);
    throw new TRPCError({ code: "BAD_REQUEST", message: "Uploaded attachment size did not match the prepared upload." });
  }

  try {
    await storeUploadedObject(
      attachment.uploadObjectKey,
      attachment.contentType,
      attachment.byteSize,
      createBoundedAttachmentUploadStream(body, attachment.byteSize)
    );
  } catch (error) {
    await clearAttachmentUploadClaim(attachmentId, handle);
    if (error instanceof AttachmentUploadSizeError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Attachment storage could not receive the upload." });
  }

  const completed = await getPool().query(
    `UPDATE attachments
     SET metadata = (metadata - 'uploadingAt') || jsonb_build_object('stagingUploadedAt', now()::text),
         updated_at = now()
     WHERE id = $1 AND uploader_handle = $2 AND status = 'pending'
     RETURNING id`,
    [attachmentId, handle]
  );
  if (!completed.rowCount) {
    throw new TRPCError({ code: "CONFLICT", message: "Attachment upload state changed unexpectedly." });
  }
  return { attachmentId, status: "staged" as const };
};

const markVerificationFailed = async (
  attachment: AttachmentRow,
  handle: string,
  message: string
) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const failed = await client.query(
      `UPDATE attachments
       SET metadata = metadata || jsonb_build_object('verificationError', $3::text),
           updated_at = now()
       WHERE id = $1 AND uploader_handle = $2 AND status = 'verifying'
       RETURNING id`,
      [attachment.attachmentId, handle, message]
    );
    if (failed.rowCount) {
      await queueAttachmentRowsForStorageDeletion(client, [attachment], "verification_failed");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await triggerStorageDeletion([attachment.attachmentId]);
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

const selectAttachment = async (attachmentId: string, handle: string) => {
  const result = await getPool().query<AttachmentRow>(
    `SELECT
       id::text AS "attachmentId",
       bucket,
       owner_type AS "ownerType",
       owner_id AS "ownerId",
       object_key AS "objectKey",
       upload_object_key AS "uploadObjectKey",
       file_name AS "fileName",
       content_type AS "contentType",
       byte_size AS "byteSize",
       metadata,
       status
     FROM attachments
     WHERE id = $1 AND uploader_handle = $2`,
    [attachmentId, handle]
  );
  return result.rows[0];
};

export const confirmAttachment = async (rawInput: unknown, actor: Actor) => {
  const input = confirmAttachmentInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  requireAttachmentDatabase("note");
  await ensureLiveData();

  const existing = await selectAttachment(input.attachmentId, handle);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment upload not found." });
  requireAttachmentDatabase(existing.ownerType);
  if (existing.status === "uploaded" || existing.status === "previewed") {
    return {
      attachmentId: existing.attachmentId,
      publicUrl: existing.ownerType === "message" || existing.ownerType === "note" || existing.ownerType === "note_comment" || existing.ownerType === "opportunity_application" ? null : publicObjectUrl(existing.objectKey),
      status: existing.status
    };
  }
  if (existing.status === "failed") {
    throw new TRPCError({ code: "CONFLICT", message: "This attachment failed verification. Prepare a new upload." });
  }
  if (input.byteSize !== undefined && input.byteSize !== existing.byteSize) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Confirmed attachment size did not match the prepared upload." });
  }

  const claimed = await getPool().query<AttachmentRow>(
    `UPDATE attachments
     SET status = 'verifying', updated_at = now()
     WHERE id = $1
       AND uploader_handle = $2
       AND (status = 'pending' OR (status = 'verifying' AND updated_at < now() - interval '10 minutes'))
     RETURNING
       id::text AS "attachmentId",
       bucket,
       owner_type AS "ownerType",
       owner_id AS "ownerId",
       object_key AS "objectKey",
       upload_object_key AS "uploadObjectKey",
       file_name AS "fileName",
       content_type AS "contentType",
       byte_size AS "byteSize",
       status`,
    [input.attachmentId, handle]
  );
  const attachment = claimed.rows[0];
  if (!attachment) {
    throw new TRPCError({ code: "CONFLICT", message: "This attachment is already being verified." });
  }

  let inspection;
  try {
    inspection = await inspectUploadedObject(attachment.uploadObjectKey, Boolean(officeArchiveFormatForContentType(attachment.contentType)));
  } catch (error) {
    await getPool().query(
      `UPDATE attachments SET status = 'pending', updated_at = now()
       WHERE id = $1 AND uploader_handle = $2 AND status = 'verifying'`,
      [attachment.attachmentId, handle]
    );
    throw error;
  }

  if (inspection.byteSize !== attachment.byteSize) {
    return markVerificationFailed(attachment, handle, "Uploaded attachment size did not match the prepared upload.");
  }
  if (!inspection.contentType || !attachmentContentTypesMatch(inspection.contentType, attachment.contentType)) {
    return markVerificationFailed(attachment, handle, "Uploaded attachment type did not match the prepared upload.");
  }
  const signatureError = validateAttachmentContentSignature(attachment.contentType, inspection.prefix);
  if (signatureError) {
    return markVerificationFailed(attachment, handle, signatureError);
  }
  const officeFormat = officeArchiveFormatForContentType(attachment.contentType);
  if (officeFormat && (!inspection.body || !(await validateOfficeArchive(inspection.body, officeFormat)))) {
    return markVerificationFailed(attachment, handle, "The uploaded file is not a valid or safe Office document.");
  }

  try {
    await promoteUploadedObject(attachment.uploadObjectKey, attachment.objectKey);
  } catch {
    await getPool().query(
      `UPDATE attachments SET status = 'pending', updated_at = now()
       WHERE id = $1 AND uploader_handle = $2 AND status = 'verifying'`,
      [attachment.attachmentId, handle]
    );
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Attachment storage could not finalize the upload." });
  }

  const client = await getPool().connect();
  let stagedEvent: StoredLiveEvent | undefined;
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE attachments
       SET status = 'uploaded',
           metadata = metadata || COALESCE($3::jsonb, '{}'::jsonb),
           verified_at = now(),
           updated_at = now()
       WHERE id = $1 AND uploader_handle = $2 AND status = 'verifying'`,
      [attachment.attachmentId, handle, input.metadata ? JSON.stringify(input.metadata) : null]
    );
    if ((updated.rowCount ?? 0) !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "Attachment verification state changed unexpectedly." });
    }
    await queueStagingObjectDeletion(client, [attachment]);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "attachment.confirm",
      subjectType: "attachment",
      subjectId: attachment.attachmentId,
      metadata: {
        byteSize: attachment.byteSize,
        contentType: attachment.contentType,
        ownerType: attachment.ownerType
      }
    });
    stagedEvent = await stageEvent(client, {
      kind: "attachment.uploaded",
      actorHandle: handle,
      subjectType: "attachment",
      subjectId: attachment.attachmentId,
      visibility: "private",
      payload: { ownerType: attachment.ownerType }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await getPool().query(
      `UPDATE attachments SET status = 'pending', updated_at = now()
       WHERE id = $1 AND uploader_handle = $2 AND status = 'verifying'`,
      [attachment.attachmentId, handle]
    );
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);
  if (attachment.uploadObjectKey !== attachment.objectKey) {
    await triggerStorageDeletion([attachment.attachmentId]);
  }

  return {
    attachmentId: attachment.attachmentId,
    publicUrl:
      attachment.ownerType === "note" ||
      attachment.ownerType === "note_comment" ||
      attachment.ownerType === "opportunity_application" ||
      attachment.ownerType === "message"
        ? null
        : publicObjectUrl(attachment.objectKey),
    status: "uploaded" as const
  };
};

export const discardAttachmentUpload = async (attachmentId: string, actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment upload not found." });
  await ensureLiveData();
  let discardedAttachmentIds: string[] = [];
  const value = await runAtomic(async (client) => {
    const result = await client.query<AttachmentStorageRow>(
      `SELECT
         id::text AS "attachmentId",
         bucket,
         object_key AS "objectKey",
         upload_object_key AS "uploadObjectKey"
       FROM attachments
       WHERE id = $1
         AND uploader_handle = $2
         AND owner_id IS NULL
         AND status IN ('pending', 'verifying', 'uploaded', 'previewed')
       FOR UPDATE`,
      [attachmentId, handle]
    );
    if (!result.rows[0]) {
      const existing = await client.query<{ ownerId: string | null; status: string }>(
        `SELECT owner_id AS "ownerId", status FROM attachments WHERE id = $1 AND uploader_handle = $2`,
        [attachmentId, handle]
      );
      if (existing.rows[0]?.status === "failed" && !existing.rows[0].ownerId) {
        return { value: { attachmentId, discarded: true } };
      }
      throw new TRPCError({ code: "NOT_FOUND", message: "Unsent attachment upload not found." });
    }
    discardedAttachmentIds = await queueAttachmentRowsForStorageDeletion(client, result.rows, "unsent_attachment_discarded");
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "attachment.discard",
      subjectType: "attachment",
      subjectId: attachmentId,
      metadata: { ownerState: "unassigned" }
    });
    return { value: { attachmentId, discarded: true } };
  });
  if (discardedAttachmentIds.length) await triggerStorageDeletion(discardedAttachmentIds);
  return value;
};
