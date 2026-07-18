import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type { AttachmentRow } from "../repository/foundation";
import { queueAttachmentRowsForStorageDeletion, type AttachmentStorageRow } from "./storageDeletion";

export type AttachmentOwnerType = "post" | "comment" | "message" | "note" | "note_comment" | "opportunity_application";

export type OwnedAttachmentRow = AttachmentRow &
  AttachmentStorageRow & {
    uploaderHandle: string | null;
    ownerType: string;
  };

const attachmentOwnershipError = (ownerType: AttachmentOwnerType) =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: `One or more attachments are not confirmed, no longer available, or already belong to another ${ownerType}.`
  });

const isPublicDraftStagingTransition = (source: string, destination: AttachmentOwnerType) =>
  (source === "post" && destination === "note") || (source === "note" && destination === "post");

export const canonicalAttachmentIds = (input: {
  attachmentIds?: string[];
  attachments?: Array<{ id: string }>;
}) => input.attachmentIds ?? input.attachments?.map((attachment) => attachment.id) ?? [];

export const assertUniqueAttachmentIds = (attachmentIds: string[], ownerType: AttachmentOwnerType) => {
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Each ${ownerType} attachment can only be attached once.`
    });
  }
};

export const assertClaimableOwnerAttachments = (
  rows: OwnedAttachmentRow[],
  attachmentIds: string[],
  input: { ownerId: string; ownerType: AttachmentOwnerType; uploaderHandle: string }
) => {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const desiredRows = attachmentIds.map((attachmentId) => rowById.get(attachmentId));
  if (
    desiredRows.some(
      (row) =>
        !row ||
        (row.ownerType !== input.ownerType && !(
          row.ownerId === null &&
          row.uploaderHandle === input.uploaderHandle &&
          isPublicDraftStagingTransition(row.ownerType, input.ownerType)
        )) ||
        (row.ownerId === null && row.uploaderHandle !== input.uploaderHandle) ||
        (row.status !== "uploaded" && row.status !== "previewed") ||
        (row.ownerId !== null && row.ownerId !== input.ownerId)
    )
  ) {
    throw attachmentOwnershipError(input.ownerType);
  }
  return desiredRows as OwnedAttachmentRow[];
};

export const replaceOwnerAttachments = async (
  client: PoolClient,
  input: {
    attachmentIds?: string[];
    ownerId: string;
    ownerType: AttachmentOwnerType;
    uploaderHandle: string;
  }
) => {
  if (input.attachmentIds) assertUniqueAttachmentIds(input.attachmentIds, input.ownerType);

  const selected = await client.query<OwnedAttachmentRow>(
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
     WHERE (owner_type = $1 AND owner_id = $2)
        OR id = ANY($3::uuid[])
     FOR UPDATE`,
    [input.ownerType, input.ownerId, input.attachmentIds ?? []]
  );

  const attachmentIds = input.attachmentIds ?? selected.rows
    .filter(
      (row) =>
        row.ownerType === input.ownerType &&
        row.ownerId === input.ownerId &&
        (row.status === "uploaded" || row.status === "previewed")
    )
    .sort((left, right) => new Date(left.createdAt ?? 0).getTime() - new Date(right.createdAt ?? 0).getTime())
    .map((row) => row.id);
  const desiredRows = assertClaimableOwnerAttachments(selected.rows, attachmentIds, input);

  const desiredIds = new Set(attachmentIds);
  const removedRows = selected.rows.filter(
    (row) =>
      row.ownerType === input.ownerType &&
      row.ownerId === input.ownerId &&
      (row.status === "uploaded" || row.status === "previewed") &&
      !desiredIds.has(row.id)
  );
  const removedAttachmentIds = await queueAttachmentRowsForStorageDeletion(
    client,
    removedRows,
    `${input.ownerType}_attachment_removed`
  );

  if (attachmentIds.length) {
    await client.query(
      `UPDATE attachments
       SET owner_id = $1, owner_type = $3, updated_at = now()
       WHERE id = ANY($2::uuid[])`,
      [input.ownerId, attachmentIds, input.ownerType]
    );
  }

  const attachments = (desiredRows as OwnedAttachmentRow[]).map(
    ({ attachmentId: _attachmentId, bucket: _bucket, ownerType: _ownerType, uploaderHandle: _uploaderHandle, uploadObjectKey: _uploadObjectKey, ...row }) => row
  );
  return { attachments, removedAttachmentIds };
};
