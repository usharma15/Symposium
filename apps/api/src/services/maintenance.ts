import { env } from "../config/env";
import type { PoolClient } from "pg";
import { getPool, hasDatabase } from "../db/client";
import {
  drainStorageDeletionQueue,
  queueAttachmentRowsForStorageDeletion,
  queueStagingObjectDeletion,
  triggerStorageDeletion,
  type AttachmentStorageRow
} from "./storageDeletion";

const maintenanceIntervalMs = 6 * 60 * 60 * 1000;
const maintenanceLeaseKey = "database-housekeeping-v1";
let maintenanceTimer: NodeJS.Timeout | null = null;
let lastCompletedAt: string | null = null;
let lastErrorAt: string | null = null;
let lastStartedAt: string | null = null;
let lastStorageDeletionAt: string | null = null;
let lastStorageDeletionResult: { claimed: number; deleted: number; failed: number } | null = null;
let lastSkippedAt: string | null = null;

export const getMaintenanceStatus = () => ({
  active: Boolean(maintenanceTimer),
  lastCompletedAt,
  lastErrorAt,
  lastStartedAt,
  lastStorageDeletionAt,
  lastStorageDeletionResult,
  lastSkippedAt
});

const acquireMaintenanceLease = async (client: PoolClient) => {
  const lease = await client.query<{ lastCompletedAt: Date | string | null }>(
    `INSERT INTO maintenance_leases (key, lease_expires_at, updated_at)
     VALUES ($1, now() + interval '15 minutes', now())
     ON CONFLICT (key) DO UPDATE SET
       lease_expires_at = now() + interval '15 minutes',
       updated_at = now()
     WHERE maintenance_leases.lease_expires_at <= now()
       AND (
         maintenance_leases.last_completed_at IS NULL
         OR maintenance_leases.last_completed_at <= now() - interval '6 hours'
       )
     RETURNING last_completed_at AS "lastCompletedAt"`,
    [maintenanceLeaseKey]
  );
  if (lease.rowCount) return true;
  const current = await client.query<{ lastCompletedAt: Date | string | null }>(
    `SELECT last_completed_at AS "lastCompletedAt" FROM maintenance_leases WHERE key = $1`,
    [maintenanceLeaseKey]
  );
  if (current.rows[0]?.lastCompletedAt) {
    lastCompletedAt = new Date(current.rows[0].lastCompletedAt).toISOString();
  }
  lastSkippedAt = new Date().toISOString();
  return false;
};

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
    if (!(await acquireMaintenanceLease(client))) {
      await client.query("COMMIT");
      return;
    }
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
    await client.query(
      `DELETE FROM audit_logs
       WHERE id IN (
         SELECT id FROM audit_logs
         WHERE created_at < now() - interval '90 days'
         ORDER BY created_at ASC
         LIMIT 5000
       )`
    );
    await client.query(
      `DELETE FROM notifications
       WHERE id IN (
         SELECT id FROM notifications
         WHERE (read_at IS NOT NULL AND created_at < now() - interval '90 days')
            OR created_at < now() - interval '365 days'
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
           owner_type IN ('post', 'comment', 'note', 'note_comment')
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
    await client.query(
      `UPDATE maintenance_leases
       SET last_completed_at = now(), lease_expires_at = now(), updated_at = now()
       WHERE key = $1`,
      [maintenanceLeaseKey]
    );
    await client.query("COMMIT");
    committed = true;
    lastCompletedAt = new Date().toISOString();
    lastErrorAt = null;
    lastSkippedAt = null;
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

  // Mutations attempt object deletion immediately. This batched recovery pass
  // preserves durable retries without waking a scale-to-zero database every minute.
  await runStorageDeletionMaintenance();
};

export const startDatabaseMaintenance = () => {
  if (maintenanceTimer || !hasDatabase()) return;
  const execute = () => {
    void runDatabaseMaintenance().catch((error) => {
      console.warn("SYMPOSIUM database maintenance failed.", error);
    });
  };
  execute();
  maintenanceTimer = setInterval(execute, maintenanceIntervalMs);
  maintenanceTimer.unref();
};

export const stopDatabaseMaintenance = () => {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
};
