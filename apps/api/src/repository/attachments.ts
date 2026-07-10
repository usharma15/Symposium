import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import JSZip from "jszip";
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
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import type { Actor } from "../services/auth";
import { publishStoredEvent, stageEvent, type StoredLiveEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import {
  createObjectKey,
  createUploadObjectKey,
  createUploadUrl,
  deleteUploadedObject,
  inspectUploadedObject,
  promoteUploadedObject
} from "../services/storage";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData } from "./foundation";

const allowedProfileImageTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);
const docxContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const maxProfileImageBytes = 5 * 1024 * 1024;
const maxPendingUploadsPerActor = 20;
const maxDailyUploadsPerActor = 100;
const maxDailyUploadBytesPerActor = 250 * 1024 * 1024;

type AttachmentRow = {
  attachmentId: string;
  byteSize: number;
  contentType: string;
  fileName: string;
  objectKey: string;
  ownerId: string | null;
  ownerType: string;
  status: "pending" | "verifying" | "uploaded" | "previewed" | "failed";
  uploadObjectKey: string;
};

const publicObjectUrl = (objectKey: string) =>
  env.R2_PUBLIC_BASE_URL ? `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${objectKey}` : null;

const requireAttachmentDatabase = () => {
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Persistent attachment storage requires the live database."
    });
  }
  if (!env.R2_PUBLIC_BASE_URL) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Persistent public attachment delivery is not configured."
    });
  }
};

const assertUploadAllowance = async (client: PoolClient, handle: string, incomingByteSize: number) => {
  await client.query(
    `UPDATE attachments
     SET status = 'failed',
         metadata = metadata || jsonb_build_object('verificationError', 'Upload window expired.'),
         updated_at = now()
     WHERE uploader_handle = $1
       AND (
         (status = 'pending' AND updated_at < now() - interval '15 minutes')
         OR (status = 'verifying' AND updated_at < now() - interval '30 minutes')
       )`,
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
  const usage = result.rows[0];
  if (Number(usage?.pendingCount ?? 0) >= maxPendingUploadsPerActor) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Finish or discard an existing pending upload first." });
  }
  if (
    Number(usage?.dailyCount ?? 0) + 1 > maxDailyUploadsPerActor ||
    Number(usage?.dailyBytes ?? 0) + incomingByteSize > maxDailyUploadBytesPerActor
  ) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The 24-hour attachment upload allowance has been reached." });
  }
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

  if (input.ownerType !== "post" && input.ownerType !== "profile") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Private attachment delivery must be enabled before message or note uploads can be accepted."
    });
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
      throw new TRPCError({ code: "BAD_REQUEST", message: "A post attachment is assigned when its post is created." });
    }
    const validationError = validatePostAttachmentDetails(input.fileName, input.contentType, input.byteSize);
    if (validationError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: validationError
      });
    }
  }

  requireAttachmentDatabase();
  await ensureLiveData();
  const prepared = await runAtomic(async (client) => {
    const claim = await claimMutation<{
      attachmentId: string;
      objectKey: string;
      publicUrl: string | null;
      uploadObjectKey: string;
    }>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };

    await assertUploadAllowance(client, handle, input.byteSize);
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
      publicUrl: publicObjectUrl(objectKey)
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

  const uploadUrl = await createUploadUrl(prepared.uploadObjectKey, input.contentType);

  return {
    attachmentId: prepared.attachmentId,
    objectKey: prepared.objectKey,
    uploadUrl,
    publicUrl: prepared.publicUrl
  };
};

const markVerificationFailed = async (
  attachmentId: string,
  handle: string,
  uploadObjectKey: string,
  message: string
) => {
  await getPool().query(
    `UPDATE attachments
     SET status = 'failed',
         metadata = metadata || jsonb_build_object('verificationError', $3::text),
         updated_at = now()
     WHERE id = $1 AND uploader_handle = $2 AND status = 'verifying'`,
    [attachmentId, handle, message]
  );
  deleteUploadedObject(uploadObjectKey).catch((error) => {
    console.warn("SYMPOSIUM rejected attachment cleanup failed.", error);
  });
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

const validateDocxArchive = async (bytes: Uint8Array) => {
  try {
    const archive = await JSZip.loadAsync(bytes);
    const entries = Object.values(archive.files) as Array<{
      _data?: { uncompressedSize?: number };
      dir: boolean;
      name: string;
    }>;
    if (entries.length > 10_000) return false;
    if (entries.some((entry) => /(?:^|\/)vbaProject\.bin$/i.test(entry.name))) return false;

    let totalUncompressedBytes = 0;
    for (const entry of entries) {
      const uncompressedSize = Number(entry._data?.uncompressedSize ?? 0);
      if (!Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0 || uncompressedSize > 64 * 1024 * 1024) {
        return false;
      }
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > 128 * 1024 * 1024) return false;
    }

    const document = archive.file("word/document.xml") as
      | ({ _data?: { uncompressedSize?: number } } & NonNullable<ReturnType<typeof archive.file>>)
      | null;
    return Boolean(
      archive.file("[Content_Types].xml") &&
        document &&
        Number(document._data?.uncompressedSize ?? 0) <= 20 * 1024 * 1024
    );
  } catch {
    return false;
  }
};

const selectAttachment = async (attachmentId: string, handle: string) => {
  const result = await getPool().query<AttachmentRow>(
    `SELECT
       id::text AS "attachmentId",
       owner_type AS "ownerType",
       owner_id AS "ownerId",
       object_key AS "objectKey",
       upload_object_key AS "uploadObjectKey",
       file_name AS "fileName",
       content_type AS "contentType",
       byte_size AS "byteSize",
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
  requireAttachmentDatabase();
  await ensureLiveData();

  const existing = await selectAttachment(input.attachmentId, handle);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment upload not found." });
  if (existing.status === "uploaded" || existing.status === "previewed") {
    return {
      attachmentId: existing.attachmentId,
      publicUrl: publicObjectUrl(existing.objectKey),
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
    inspection = await inspectUploadedObject(attachment.uploadObjectKey, attachment.contentType === docxContentType);
  } catch (error) {
    await getPool().query(
      `UPDATE attachments SET status = 'pending', updated_at = now()
       WHERE id = $1 AND uploader_handle = $2 AND status = 'verifying'`,
      [attachment.attachmentId, handle]
    );
    throw error;
  }

  if (inspection.byteSize !== attachment.byteSize) {
    return markVerificationFailed(
      attachment.attachmentId,
      handle,
      attachment.uploadObjectKey,
      "Uploaded attachment size did not match the prepared upload."
    );
  }
  if (!inspection.contentType || !attachmentContentTypesMatch(inspection.contentType, attachment.contentType)) {
    return markVerificationFailed(
      attachment.attachmentId,
      handle,
      attachment.uploadObjectKey,
      "Uploaded attachment type did not match the prepared upload."
    );
  }
  const signatureError = validateAttachmentContentSignature(attachment.contentType, inspection.prefix);
  if (signatureError) {
    return markVerificationFailed(attachment.attachmentId, handle, attachment.uploadObjectKey, signatureError);
  }
  if (
    attachment.contentType === docxContentType &&
    (!inspection.body || !(await validateDocxArchive(inspection.body)))
  ) {
    return markVerificationFailed(
      attachment.attachmentId,
      handle,
      attachment.uploadObjectKey,
      "The uploaded file is not a valid DOCX document."
    );
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
    deleteUploadedObject(attachment.uploadObjectKey).catch((error) => {
      console.warn("SYMPOSIUM staged attachment cleanup failed.", error);
    });
  }

  return {
    attachmentId: attachment.attachmentId,
    publicUrl: publicObjectUrl(attachment.objectKey),
    status: "uploaded" as const
  };
};
