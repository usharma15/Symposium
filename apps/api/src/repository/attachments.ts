import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  confirmAttachmentInputSchema,
  createAttachmentUploadInputSchema
} from "../../../../packages/contracts/src";
import { inferAttachmentContentType, validatePostAttachmentDetails } from "@/lib/attachmentRules";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { emitEvent } from "../services/events";
import { createObjectKey, createUploadUrl } from "../services/storage";
import { actorHandle, ensureLiveData } from "./foundation";

const allowedProfileImageTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);
const maxProfileImageBytes = 5 * 1024 * 1024;

export const createAttachmentUpload = async (rawInput: unknown, actor: Actor) => {
  const parsedInput = createAttachmentUploadInputSchema.parse(rawInput);
  const input = {
    ...parsedInput,
    contentType: inferAttachmentContentType(parsedInput.fileName, parsedInput.contentType)
  };

  if (input.ownerType === "profile") {
    if (!allowedProfileImageTypes.has(input.contentType.toLowerCase())) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose a PNG, JPG, JPEG, WEBP, GIF, or AVIF image."
      });
    }

    if (input.byteSize > maxProfileImageBytes) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Profile photos must be 5 MB or smaller."
      });
    }
  } else {
    const validationError = validatePostAttachmentDetails(input.fileName, input.contentType, input.byteSize);
    if (validationError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: validationError
      });
    }
  }

  const handle = actorHandle(actor);
  const objectKey = createObjectKey(input.ownerType, input.fileName);
  const uploadUrl = await createUploadUrl(objectKey, input.contentType);
  const attachmentId = randomUUID();

  if (hasDatabase()) {
    await ensureLiveData();
    await getPool().query(
      `INSERT INTO attachments (
        id, owner_type, owner_id, uploader_handle, bucket, object_key, file_name, content_type, byte_size, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
      [
        attachmentId,
        input.ownerType,
        input.ownerId ?? null,
        handle,
        env.R2_BUCKET ?? "symposium",
        objectKey,
        input.fileName,
        input.contentType,
        input.byteSize
      ]
    );
  }

  return {
    attachmentId,
    objectKey,
    uploadUrl,
    publicUrl: env.R2_PUBLIC_BASE_URL ? `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${objectKey}` : null
  };
};

export const confirmAttachment = async (rawInput: unknown, actor: Actor) => {
  const input = confirmAttachmentInputSchema.parse(rawInput);
  const handle = actorHandle(actor);

  if (!hasDatabase()) return { attachmentId: input.attachmentId, status: "uploaded" };
  await getPool().query(
    `UPDATE attachments
     SET status = 'uploaded',
         byte_size = COALESCE($2, byte_size),
         metadata = metadata || COALESCE($4::jsonb, '{}'::jsonb),
         updated_at = now()
     WHERE id = $1 AND uploader_handle = $3`,
    [input.attachmentId, input.byteSize ?? null, handle, input.metadata ? JSON.stringify(input.metadata) : null]
  );

  await emitEvent({
    kind: "attachment.uploaded",
    actorHandle: handle,
    subjectType: "attachment",
    subjectId: input.attachmentId
  });

  return { attachmentId: input.attachmentId, status: "uploaded" };
};
