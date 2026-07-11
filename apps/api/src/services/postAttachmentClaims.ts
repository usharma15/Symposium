import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type { AttachmentRow } from "../repository/foundation";

type ClaimablePostAttachmentRow = AttachmentRow & {
  uploaderHandle: string | null;
  ownerType: string;
};

const attachmentClaimError = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: "One or more attachments are not confirmed, no longer available, or already belong to another post."
  });

export const canonicalPostAttachmentIds = (input: {
  attachmentIds?: string[];
  attachments?: Array<{ id: string }>;
}) => input.attachmentIds ?? input.attachments?.map((attachment) => attachment.id) ?? [];

export const assertClaimablePostAttachments = (
  rows: ClaimablePostAttachmentRow[],
  attachmentIds: string[],
  uploaderHandle: string,
  postId: string
) => {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const ordered = attachmentIds.map((attachmentId) => rowById.get(attachmentId));
  if (
    ordered.some(
      (row) =>
        !row ||
        row.ownerType !== "post" ||
        row.uploaderHandle !== uploaderHandle ||
        (row.status !== "uploaded" && row.status !== "previewed") ||
        (row.ownerId !== null && row.ownerId !== postId)
    )
  ) {
    throw attachmentClaimError();
  }
  return ordered as ClaimablePostAttachmentRow[];
};

export const claimPostAttachments = async (
  client: PoolClient,
  input: { attachmentIds: string[]; postId: string; uploaderHandle: string }
) => {
  if (!input.attachmentIds.length) return [];
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Each post attachment can only be attached once." });
  }

  const selected = await client.query<ClaimablePostAttachmentRow>(
    `SELECT
       id::text,
       owner_type AS "ownerType",
       owner_id AS "ownerId",
       uploader_handle AS "uploaderHandle",
       file_name AS "fileName",
       content_type AS "contentType",
       byte_size AS "byteSize",
       status,
       metadata,
       object_key AS "objectKey",
       created_at AS "createdAt"
     FROM attachments
     WHERE id = ANY($1::uuid[])
     FOR UPDATE`,
    [input.attachmentIds]
  );
  assertClaimablePostAttachments(selected.rows, input.attachmentIds, input.uploaderHandle, input.postId);

  const claimed = await client.query<AttachmentRow>(
    `UPDATE attachments
     SET owner_id = $1,
         updated_at = now()
     WHERE id = ANY($2::uuid[])
     RETURNING
       id::text,
       owner_id AS "ownerId",
       file_name AS "fileName",
       content_type AS "contentType",
       byte_size AS "byteSize",
       status,
       metadata,
       object_key AS "objectKey",
       created_at AS "createdAt"`,
    [input.postId, input.attachmentIds]
  );
  const claimedById = new Map(claimed.rows.map((row) => [row.id, row]));
  const ordered = input.attachmentIds.map((attachmentId) => claimedById.get(attachmentId));
  if (ordered.some((row) => !row)) throw attachmentClaimError();
  return ordered as AttachmentRow[];
};
