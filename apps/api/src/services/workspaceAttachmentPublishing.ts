import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type { VersionedDocumentContract } from "../../../../packages/contracts/src";
import { env, hasR2Config } from "../config/env";
import { promoteUploadedObject } from "./storage";
import { queueAttachmentRowsForStorageDeletion, triggerStorageDeletion } from "./storageDeletion";

type PublicOwnerType = "post" | "comment";

type SourceAttachment = {
  id: string;
  bucket: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  metadata: Record<string, unknown>;
  status: "uploaded" | "previewed";
  verifiedAt: Date | null;
};

type PublicAttachment = {
  id: string;
  bucket: string;
  objectKey: string;
  uploadObjectKey: string;
  ownerType: string;
  ownerId: string | null;
  status: string;
};

const publishedAttachmentId = (
  noteId: string,
  revision: number,
  sourceAttachmentId: string,
  ownerType: PublicOwnerType
) => {
  const hex = createHash("sha256")
    .update(`symposium:workspace-publication:${noteId}:${revision}:${sourceAttachmentId}:${ownerType}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

const safeFileName = (fileName: string) =>
  fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment";

const publishedObjectKey = (
  ownerType: PublicOwnerType,
  noteId: string,
  revision: number,
  attachmentId: string,
  fileName: string
) => `${ownerType}/workspace-publications/${noteId}/${revision}/${attachmentId}-${safeFileName(fileName)}`;

export const rewritePublishedAttachmentReferences = (
  document: VersionedDocumentContract,
  attachmentIdMap: ReadonlyMap<string, string>
): VersionedDocumentContract => ({
  ...document,
  nodes: document.nodes.map((node) => node.type === "attachment"
    ? { ...node, attachmentId: attachmentIdMap.get(node.attachmentId) ?? node.attachmentId }
    : node)
});

const loadSourceAttachments = async (
  client: PoolClient,
  noteId: string,
  attachmentIds: string[]
) => {
  if (!attachmentIds.length) return [];
  const result = await client.query<SourceAttachment>(
    `SELECT
       id::text,
       bucket,
       object_key AS "objectKey",
       file_name AS "fileName",
       content_type AS "contentType",
       byte_size AS "byteSize",
       metadata,
       status,
       verified_at AS "verifiedAt"
     FROM attachments
     WHERE owner_type = 'note'
       AND owner_id = $1
       AND id = ANY($2::uuid[])
       AND status IN ('uploaded', 'previewed')`,
    [noteId, attachmentIds]
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  const ordered = attachmentIds.map((attachmentId) => byId.get(attachmentId));
  if (ordered.some((attachment) => !attachment)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "One or more attachments changed after this draft revision was saved. Review the latest revision before publishing."
    });
  }
  return ordered as SourceAttachment[];
};

const ensurePublicAttachmentCopy = async (
  client: PoolClient,
  input: {
    noteId: string;
    revision: number;
    ownerType: PublicOwnerType;
    uploaderHandle: string;
    source: SourceAttachment;
  }
) => {
  const id = publishedAttachmentId(input.noteId, input.revision, input.source.id, input.ownerType);
  const objectKey = publishedObjectKey(input.ownerType, input.noteId, input.revision, id, input.source.fileName);
  const existing = await client.query<PublicAttachment>(
    `SELECT
       id::text,
       bucket,
       object_key AS "objectKey",
       upload_object_key AS "uploadObjectKey",
       owner_type AS "ownerType",
       owner_id AS "ownerId",
       status
     FROM attachments
     WHERE id = $1`,
    [id]
  );
  const current = existing.rows[0];
  if (current && (
    current.ownerType !== input.ownerType ||
    current.bucket !== env.R2_BUCKET ||
    current.objectKey !== objectKey ||
    current.uploadObjectKey !== objectKey
  )) {
    throw new TRPCError({ code: "CONFLICT", message: "The public attachment copy has conflicting ownership metadata." });
  }
  if (current?.status === "uploaded" || current?.status === "previewed") return id;

  await client.query(
    `DELETE FROM storage_deletion_jobs WHERE bucket = $1 AND object_key = $2`,
    [env.R2_BUCKET!, objectKey]
  );
  await client.query(
    `INSERT INTO attachments (
       id, owner_type, owner_id, uploader_handle, bucket, object_key, upload_object_key,
       file_name, content_type, byte_size, status, metadata, verified_at
     ) VALUES ($1, $2, NULL, $3, $4, $5, $5, $6, $7, $8, 'pending', $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       status = 'pending',
       metadata = EXCLUDED.metadata,
       updated_at = now()`,
    [
      id,
      input.ownerType,
      input.uploaderHandle,
      env.R2_BUCKET!,
      objectKey,
      input.source.fileName,
      input.source.contentType,
      input.source.byteSize,
      JSON.stringify({
        ...input.source.metadata,
        workspacePublication: {
          noteId: input.noteId,
          revision: input.revision,
          sourceAttachmentId: input.source.id
        }
      }),
      input.source.verifiedAt
    ]
  );

  try {
    await promoteUploadedObject(input.source.objectKey, objectKey);
    await client.query(
      `UPDATE attachments
       SET status = 'uploaded', verified_at = COALESCE(verified_at, now()), updated_at = now()
       WHERE id = $1`,
      [id]
    );
  } catch (error) {
    await queueAttachmentRowsForStorageDeletion(client, [{
      attachmentId: id,
      bucket: env.R2_BUCKET!,
      objectKey,
      uploadObjectKey: objectKey
    }], "workspace_publication_copy_failed");
    await triggerStorageDeletion([id]).catch(() => undefined);
    throw error;
  }
  return id;
};

export const prepareWorkspacePublicationAttachments = async (
  client: PoolClient,
  input: {
    noteId: string;
    revision: number;
    attachmentIds: string[];
    document: VersionedDocumentContract;
    ownerType: PublicOwnerType;
    uploaderHandle: string;
  }
) => {
  if (!input.attachmentIds.length) return { attachmentIds: [], document: input.document };
  if (!hasR2Config || !env.R2_PUBLIC_BASE_URL) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Public attachment delivery must be configured before this draft can be published."
    });
  }
  const sources = await loadSourceAttachments(client, input.noteId, input.attachmentIds);
  if (sources.some((source) => source.bucket !== env.R2_BUCKET)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A draft attachment is stored outside the active publication bucket." });
  }
  const publicAttachmentIds: string[] = [];
  const attachmentIdMap = new Map<string, string>();
  for (const source of sources) {
    const publicId = await ensurePublicAttachmentCopy(client, { ...input, source });
    publicAttachmentIds.push(publicId);
    attachmentIdMap.set(source.id, publicId);
  }
  return {
    attachmentIds: publicAttachmentIds,
    document: rewritePublishedAttachmentReferences(input.document, attachmentIdMap)
  };
};
