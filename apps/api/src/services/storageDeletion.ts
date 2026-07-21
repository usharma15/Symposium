import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { env, hasR2Config } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import { deleteUploadedObject } from "./storage";

export type AttachmentStorageRow = {
  attachmentId: string;
  bucket: string;
  objectKey: string;
  uploadObjectKey: string;
};

type StorageDeletionJob = {
  attachmentId: string | null;
  attempts: number;
  bucket: string;
  id: string;
  objectKey: string;
  reason: string;
};

export type StorageDeletionRequest = {
  attachmentId: string | null;
  bucket: string;
  objectKey: string;
  reason: string;
};

const deletionLeaseMinutes = 5;
const maxDeletionErrorLength = 500;

export const attachmentStorageObjectKeys = (row: AttachmentStorageRow) =>
  Array.from(new Set([row.objectKey, row.uploadObjectKey].filter(Boolean)));

export const storageDeletionRetryDelayMs = (attempts: number) =>
  Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 10));

const deletionRequestsForRows = (rows: AttachmentStorageRow[], reason: string): StorageDeletionRequest[] =>
  rows.flatMap((row) =>
    attachmentStorageObjectKeys(row).filter((objectKey) => !objectKey.startsWith("historical-world/")).map((objectKey) => ({
      attachmentId: row.attachmentId,
      bucket: row.bucket,
      objectKey,
      reason
    }))
  );

export const enqueueStorageDeletionJobs = async (
  client: PoolClient,
  requests: StorageDeletionRequest[]
) => {
  const unique = Array.from(
    new Map(requests.map((request) => [`${request.bucket}\u0000${request.objectKey}`, request])).values()
  );
  if (!unique.length) return 0;

  const result = await client.query(
    `INSERT INTO storage_deletion_jobs (attachment_id, bucket, object_key, reason)
     SELECT *
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[])
     ON CONFLICT (bucket, object_key) DO UPDATE SET
       attachment_id = COALESCE(storage_deletion_jobs.attachment_id, EXCLUDED.attachment_id),
       reason = EXCLUDED.reason,
       next_attempt_at = LEAST(storage_deletion_jobs.next_attempt_at, now()),
       lease_expires_at = NULL,
       updated_at = now()
     RETURNING id`,
    [
      unique.map((request) => request.attachmentId),
      unique.map((request) => request.bucket),
      unique.map((request) => request.objectKey),
      unique.map((request) => request.reason)
    ]
  );
  return result.rowCount ?? 0;
};

export const queueAttachmentRowsForStorageDeletion = async (
  client: PoolClient,
  rows: AttachmentStorageRow[],
  reason: string
) => {
  if (!rows.length) return [];
  await enqueueStorageDeletionJobs(client, deletionRequestsForRows(rows, reason));
  const attachmentIds = Array.from(new Set(rows.map((row) => row.attachmentId)));
  await client.query(
    `UPDATE attachments
     SET status = 'failed',
         metadata = metadata || jsonb_build_object(
           'storageState', 'deletion_pending',
           'storageDeletionReason', $2::text,
           'storageDeleteRequestedAt', now()
         ),
         updated_at = now()
     WHERE id = ANY($1::uuid[])`,
    [attachmentIds, reason]
  );
  return attachmentIds;
};

export const queueStagingObjectDeletion = async (
  client: PoolClient,
  rows: AttachmentStorageRow[],
  reason = "staged_upload_promoted"
) => {
  const stagedRows = rows.filter((row) => row.uploadObjectKey && row.uploadObjectKey !== row.objectKey);
  if (!stagedRows.length) return [];
  await enqueueStorageDeletionJobs(
    client,
    stagedRows.map((row) => ({
      attachmentId: row.attachmentId,
      bucket: row.bucket,
      objectKey: row.uploadObjectKey,
      reason
    }))
  );
  const attachmentIds = Array.from(new Set(stagedRows.map((row) => row.attachmentId)));
  await client.query(
    `UPDATE attachments
     SET metadata = metadata || jsonb_build_object(
           'stagingStorageState', 'deletion_pending',
           'stagingStorageDeleteRequestedAt', now()
         ),
         updated_at = now()
     WHERE id = ANY($1::uuid[])`,
    [attachmentIds]
  );
  return attachmentIds;
};

export const queueAttachmentsForOwnerStorageDeletion = async (
  client: PoolClient,
  ownerType: string,
  ownerId: string | string[],
  reason: string
) => {
  const ownerIds = Array.isArray(ownerId) ? ownerId : [ownerId];
  if (!ownerIds.length) return [];
  const result = await client.query<AttachmentStorageRow>(
    `SELECT
       id::text AS "attachmentId",
       bucket,
       object_key AS "objectKey",
       upload_object_key AS "uploadObjectKey"
     FROM attachments
     WHERE owner_type = $1
       AND owner_id = ANY($2::text[])
       AND COALESCE(metadata->>'storageState', '') <> 'deleted'
     FOR UPDATE`,
    [ownerType, ownerIds]
  );
  return queueAttachmentRowsForStorageDeletion(client, result.rows, reason);
};

export const queueUnreferencedProfileStorageDeletion = async (
  client: PoolClient,
  handle: string,
  retainedAvatarUrl?: string
) => {
  const retainedObjectKey = env.R2_PUBLIC_BASE_URL && retainedAvatarUrl?.startsWith(`${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/`)
    ? retainedAvatarUrl.slice(env.R2_PUBLIC_BASE_URL.replace(/\/$/, "").length + 1)
    : null;
  if (retainedObjectKey) {
    const retained = await client.query(
      `SELECT id
       FROM attachments
       WHERE owner_type = 'profile'
         AND owner_id = $1
         AND object_key = $2
         AND status IN ('uploaded', 'previewed')
       FOR UPDATE`,
      [handle, retainedObjectKey]
    );
    if (!retained.rowCount) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The selected profile image is not a confirmed upload owned by this profile."
      });
    }
  }
  const result = await client.query<AttachmentStorageRow>(
    `SELECT
       id::text AS "attachmentId",
       bucket,
       object_key AS "objectKey",
       upload_object_key AS "uploadObjectKey"
     FROM attachments
     WHERE owner_type = 'profile'
       AND owner_id = $1
       AND status IN ('uploaded', 'previewed')
       AND ($2::text IS NULL OR object_key <> $2)
     FOR UPDATE`,
    [handle, retainedObjectKey]
  );
  return queueAttachmentRowsForStorageDeletion(client, result.rows, "profile_attachment_replaced");
};

const claimStorageDeletionJobs = async (limit: number, attachmentIds?: string[]) => {
  const result = await getPool().query<StorageDeletionJob>(
    `WITH candidates AS (
       SELECT id
       FROM storage_deletion_jobs
       WHERE next_attempt_at <= now()
         AND (lease_expires_at IS NULL OR lease_expires_at < now())
         AND ($2::uuid[] IS NULL OR attachment_id = ANY($2::uuid[]))
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE storage_deletion_jobs jobs
     SET attempts = jobs.attempts + 1,
         lease_expires_at = now() + ($3::text || ' minutes')::interval,
         updated_at = now()
     FROM candidates
     WHERE jobs.id = candidates.id
     RETURNING
       jobs.id::text,
       jobs.attachment_id::text AS "attachmentId",
       jobs.bucket,
       jobs.object_key AS "objectKey",
       jobs.attempts,
       jobs.reason`,
    [limit, attachmentIds?.length ? attachmentIds : null, deletionLeaseMinutes]
  );
  return result.rows;
};

const storageDeletionError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, maxDeletionErrorLength);

export const processStorageDeletionJobs = async (options: { attachmentIds?: string[]; limit?: number } = {}) => {
  if (!hasDatabase() || !hasR2Config) return { claimed: 0, deleted: 0, failed: 0 };
  const jobs = await claimStorageDeletionJobs(Math.min(Math.max(options.limit ?? 50, 1), 200), options.attachmentIds);
  if (!jobs.length) return { claimed: 0, deleted: 0, failed: 0 };

  const outcomes = await Promise.all(
    jobs.map(async (job) => {
      try {
        await deleteUploadedObject(job.objectKey, job.bucket);
        return { job, ok: true as const };
      } catch (error) {
        return { error: storageDeletionError(error), job, ok: false as const };
      }
    })
  );
  const deletedJobIds = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.job.id);
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (deletedJobIds.length) {
      const deleted = await client.query<{ attachmentId: string | null; reason: string }>(
        `DELETE FROM storage_deletion_jobs
         WHERE id = ANY($1::uuid[])
         RETURNING attachment_id::text AS "attachmentId", reason`,
        [deletedJobIds]
      );
      const stagingAttachmentIds = Array.from(
        new Set(
          deleted.rows
            .filter((row) => row.reason === "staged_upload_promoted" || row.reason === "legacy_staging_cleanup")
            .map((row) => row.attachmentId)
            .filter((id): id is string => Boolean(id))
        )
      );
      if (stagingAttachmentIds.length) {
        await client.query(
          `UPDATE attachments
           SET metadata = metadata || jsonb_build_object(
                 'stagingStorageState', 'deleted',
                 'stagingStorageDeletedAt', now()
               ),
               updated_at = now()
           WHERE id = ANY($1::uuid[])
             AND status IN ('uploaded', 'previewed')`,
          [stagingAttachmentIds]
        );
      }
      const attachmentIds = Array.from(
        new Set(deleted.rows.map((row) => row.attachmentId).filter((id): id is string => Boolean(id)))
      );
      if (attachmentIds.length) {
        await client.query(
          `UPDATE attachments attachment
           SET metadata = attachment.metadata || jsonb_build_object(
                 'storageState', 'deleted',
                 'storageDeletedAt', now()
               ),
               updated_at = now()
           WHERE attachment.id = ANY($1::uuid[])
             AND attachment.status = 'failed'
             AND NOT EXISTS (
               SELECT 1 FROM storage_deletion_jobs job WHERE job.attachment_id = attachment.id
             )`,
          [attachmentIds]
        );
      }
    }
    for (const failure of failures) {
      await client.query(
        `UPDATE storage_deletion_jobs
         SET lease_expires_at = NULL,
             next_attempt_at = now() + ($2::text || ' milliseconds')::interval,
             last_error = $3,
             updated_at = now()
         WHERE id = $1`,
        [failure.job.id, storageDeletionRetryDelayMs(failure.job.attempts), failure.error]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { claimed: jobs.length, deleted: deletedJobIds.length, failed: failures.length };
};

export const drainStorageDeletionQueue = async (options: { attachmentIds?: string[]; maxBatches?: number } = {}) => {
  let claimed = 0;
  let deleted = 0;
  let failed = 0;
  const maxBatches = Math.min(Math.max(options.maxBatches ?? 10, 1), 20);
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await processStorageDeletionJobs({ attachmentIds: options.attachmentIds, limit: 50 });
    claimed += result.claimed;
    deleted += result.deleted;
    failed += result.failed;
    if (result.claimed < 50 || result.failed) break;
  }
  return { claimed, deleted, failed };
};

export const triggerStorageDeletion = async (attachmentIds?: string[]) => {
  try {
    return await drainStorageDeletionQueue({ attachmentIds, maxBatches: attachmentIds?.length ? 2 : 10 });
  } catch (error) {
    console.warn("SYMPOSIUM durable R2 deletion processing failed.", error);
    return { claimed: 0, deleted: 0, failed: 1 };
  }
};
