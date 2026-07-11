import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import {
  drainStorageDeletionQueue,
  queueAttachmentRowsForStorageDeletion,
  queueStagingObjectDeletion,
  triggerStorageDeletion,
  type AttachmentStorageRow
} from "./storageDeletion";

const maintenanceIntervalMs = 6 * 60 * 60 * 1000;
const storageDeletionIntervalMs = 60 * 1000;
let maintenanceTimer: NodeJS.Timeout | null = null;
let storageDeletionTimer: NodeJS.Timeout | null = null;
let lastCompletedAt: string | null = null;
let lastErrorAt: string | null = null;
let lastStartedAt: string | null = null;
let lastStorageDeletionAt: string | null = null;
let lastStorageDeletionResult: { claimed: number; deleted: number; failed: number } | null = null;

export const getMaintenanceStatus = () => ({
  active: Boolean(maintenanceTimer && storageDeletionTimer),
  lastCompletedAt,
  lastErrorAt,
  lastStartedAt,
  lastStorageDeletionAt,
  lastStorageDeletionResult
});

export const runStorageDeletionMaintenance = async () => {
  const result = await drainStorageDeletionQueue();
  lastStorageDeletionAt = new Date().toISOString();
  lastStorageDeletionResult = result;
  return result;
};

export const runDatabaseMaintenance = async () => {
  if (!hasDatabase()) return;
  lastStartedAt = new Date().toISOString();
  const client = await getPool().connect();
  let committed = false;
  let storageAttachmentIds: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM mutation_receipts
       WHERE id IN (
         SELECT id FROM mutation_receipts
         WHERE status = 'completed' AND created_at < now() - interval '7 days'
         ORDER BY created_at ASC
         LIMIT 5000
       )`
    );
    await client.query(
      `DELETE FROM events
       WHERE id IN (
         SELECT id FROM events
         WHERE created_at < now() - interval '14 days'
         ORDER BY created_at ASC
         LIMIT 5000
       )`
    );
    await client.query(
      `DELETE FROM content_views
       WHERE id IN (
         SELECT id FROM content_views
         WHERE created_at < now() - interval '2 days'
         ORDER BY created_at ASC
         LIMIT 5000
       )`
    );
    const expiredUploads = await client.query<AttachmentStorageRow>(
      `UPDATE attachments
       SET status = 'failed',
           metadata = metadata || jsonb_build_object('verificationError', 'Upload window expired.'),
           updated_at = now()
       WHERE status IN ('pending', 'verifying')
         AND updated_at < now() - interval '1 day'
       RETURNING
         id::text AS "attachmentId",
         bucket,
         object_key AS "objectKey",
         upload_object_key AS "uploadObjectKey"`
    );
    const failedOrAbandoned = await client.query<AttachmentStorageRow>(
      `SELECT
         id::text AS "attachmentId",
         bucket,
         object_key AS "objectKey",
         upload_object_key AS "uploadObjectKey"
       FROM attachments
       WHERE (
           status = 'failed'
           AND COALESCE(metadata->>'storageState', '') NOT IN ('deletion_pending', 'deleted')
           AND updated_at < now() - interval '1 minute'
         ) OR (
           owner_type = 'post'
           AND owner_id IS NULL
           AND status IN ('uploaded', 'previewed')
           AND updated_at < now() - interval '1 day'
         )
       ORDER BY updated_at ASC
       LIMIT 500
       FOR UPDATE SKIP LOCKED`
    );
    const expiredIds = await queueAttachmentRowsForStorageDeletion(client, expiredUploads.rows, "expired_upload");
    const abandonedIds = await queueAttachmentRowsForStorageDeletion(
      client,
      failedOrAbandoned.rows,
      "failed_or_abandoned_upload"
    );
    const legacyStaging = await client.query<AttachmentStorageRow>(
      `SELECT
         attachment.id::text AS "attachmentId",
         attachment.bucket,
         attachment.object_key AS "objectKey",
         attachment.upload_object_key AS "uploadObjectKey"
       FROM attachments attachment
       WHERE attachment.status IN ('uploaded', 'previewed')
         AND attachment.upload_object_key <> attachment.object_key
         AND COALESCE(attachment.metadata->>'stagingStorageState', '') <> 'deleted'
         AND attachment.updated_at < now() - interval '1 minute'
         AND NOT EXISTS (
           SELECT 1
           FROM storage_deletion_jobs job
           WHERE job.bucket = attachment.bucket
             AND job.object_key = attachment.upload_object_key
         )
       ORDER BY attachment.updated_at ASC
       LIMIT 500
       FOR UPDATE OF attachment SKIP LOCKED`
    );
    const legacyStagingIds = await queueStagingObjectDeletion(
      client,
      legacyStaging.rows,
      "legacy_staging_cleanup"
    );
    let replacedProfileIds: string[] = [];
    if (env.R2_PUBLIC_BASE_URL) {
      const publicBaseUrl = env.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
      const replacedProfiles = await client.query<AttachmentStorageRow>(
        `SELECT
           attachment.id::text AS "attachmentId",
           attachment.bucket,
           attachment.object_key AS "objectKey",
           attachment.upload_object_key AS "uploadObjectKey"
         FROM attachments attachment
         INNER JOIN profiles profile
           ON attachment.owner_type = 'profile' AND attachment.owner_id = profile.handle
         WHERE attachment.status IN ('uploaded', 'previewed')
           AND profile.avatar_url IS DISTINCT FROM ($1::text || '/' || attachment.object_key)
           AND attachment.updated_at < now() - interval '1 day'
         ORDER BY attachment.updated_at ASC
         LIMIT 500
         FOR UPDATE OF attachment SKIP LOCKED`,
        [publicBaseUrl]
      );
      replacedProfileIds = await queueAttachmentRowsForStorageDeletion(
        client,
        replacedProfiles.rows,
        "profile_attachment_replaced"
      );
    }
    storageAttachmentIds = Array.from(
      new Set([...expiredIds, ...abandonedIds, ...legacyStagingIds, ...replacedProfileIds])
    );
    await client.query("COMMIT");
    committed = true;
    lastCompletedAt = new Date().toISOString();
    lastErrorAt = null;
  } catch (error) {
    await client.query("ROLLBACK");
    lastErrorAt = new Date().toISOString();
    throw error;
  } finally {
    client.release();
  }

  if (committed && storageAttachmentIds.length) {
    await triggerStorageDeletion(storageAttachmentIds);
  }
};

export const startDatabaseMaintenance = () => {
  if (maintenanceTimer || storageDeletionTimer || !hasDatabase()) return;
  const execute = () => {
    void runDatabaseMaintenance().catch((error) => {
      console.warn("SYMPOSIUM database maintenance failed.", error);
    });
  };
  const executeStorageDeletion = () => {
    void runStorageDeletionMaintenance().catch((error) => {
      console.warn("SYMPOSIUM durable R2 deletion maintenance failed.", error);
    });
  };
  execute();
  executeStorageDeletion();
  maintenanceTimer = setInterval(execute, maintenanceIntervalMs);
  storageDeletionTimer = setInterval(executeStorageDeletion, storageDeletionIntervalMs);
  maintenanceTimer.unref();
  storageDeletionTimer.unref();
};

export const stopDatabaseMaintenance = () => {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  if (storageDeletionTimer) clearInterval(storageDeletionTimer);
  maintenanceTimer = null;
  storageDeletionTimer = null;
};
