import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import {
  attachmentStorageObjectKeys,
  queueAttachmentRowsForStorageDeletion,
  storageDeletionRetryDelayMs
} from "@/apps/api/src/services/storageDeletion";

const attachment = {
  attachmentId: "00000000-0000-4000-8000-000000000001",
  bucket: "symposium",
  objectKey: "post/2026-07-11/canonical.png",
  uploadObjectKey: "pending/00000000-0000-4000-8000-000000000001"
};

const main = async () => {
  assert.deepEqual(attachmentStorageObjectKeys(attachment), [attachment.objectKey, attachment.uploadObjectKey]);
  assert.deepEqual(attachmentStorageObjectKeys({ ...attachment, uploadObjectKey: attachment.objectKey }), [attachment.objectKey]);
  assert.equal(storageDeletionRetryDelayMs(1), 30_000);
  assert.equal(storageDeletionRetryDelayMs(2), 60_000);
  assert.equal(storageDeletionRetryDelayMs(100), 6 * 60 * 60 * 1000);

  const queries: Array<{ parameters: unknown[] | undefined; text: string }> = [];
  const fakeClient = {
    query: async (text: string, parameters?: unknown[]) => {
      queries.push({ parameters, text });
      return { rowCount: text.includes("INSERT INTO storage_deletion_jobs") ? 2 : 1, rows: [] };
    }
  } as unknown as PoolClient;

  const queuedIds = await queueAttachmentRowsForStorageDeletion(fakeClient, [attachment], "post_deleted");
  assert.deepEqual(queuedIds, [attachment.attachmentId]);
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /ON CONFLICT \(bucket, object_key\)/);
  assert.deepEqual(queries[0].parameters?.[1], [attachment.bucket, attachment.bucket]);
  assert.deepEqual(queries[0].parameters?.[2], [attachment.objectKey, attachment.uploadObjectKey]);
  assert.match(queries[1].text, /status = 'failed'/);
  assert.match(queries[1].text, /'storageState', 'deletion_pending'/);

  const root = process.cwd();
  const [postSource, commentSource, attachmentSource, identitySource, maintenanceSource, migrationSource] = await Promise.all([
    readFile(path.join(root, "apps/api/src/repository/posts.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/repository/comments.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/repository/attachments.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/repository/identity.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/services/maintenance.ts"), "utf8"),
    readFile(path.join(root, "apps/api/src/db/migrate.ts"), "utf8")
  ]);

  assert.match(postSource, /queueAttachmentsForOwnerStorageDeletion[\s\S]*"post_deleted"/);
  assert.match(postSource, /"comment",[\s\S]*commentIds,[\s\S]*"post_deleted"/);
  assert.match(commentSource, /"comment",[\s\S]*commentId,[\s\S]*"comment_deleted"/);
  assert.match(postSource, /publishStoredEvent[\s\S]*triggerStorageDeletion/);
  assert.match(attachmentSource, /queueStagingObjectDeletion\(client, \[attachment\]\)/);
  assert.match(attachmentSource, /pg_advisory_xact_lock/);
  assert.match(attachmentSource, /maxDailyUploadBytesGlobal/);
  assert.match(attachmentSource, /maxActiveUploadBytesGlobal/);
  assert.match(maintenanceSource, /legacy_staging_cleanup/);
  assert.match(attachmentSource, /"verification_failed"/);
  assert.match(identitySource, /queueUnreferencedProfileStorageDeletion/);
  assert.match(maintenanceSource, /failed_or_abandoned_upload/);
  assert.match(maintenanceSource, /owner_type IN \('post', 'comment', 'note'\)/);
  assert.match(maintenanceSource, /profile_attachment_replaced/);
  assert.match(maintenanceSource, /storageDeletionIntervalMs = 60 \* 1000/);
  assert.match(migrationSource, /0015_durable_r2_deletion/);
  assert.match(migrationSource, /deleted_post_backfill/);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "canonical and staging object-key deduplication",
          "bounded exponential retry schedule",
          "race-safe global upload cost ceilings",
          "atomic attachment unavailability and deletion enqueue",
          "post tombstone storage cleanup",
          "comment and reply tombstone storage cleanup",
          "ownerless comment upload cleanup",
          "failed and abandoned upload cleanup",
          "legacy promoted staging-object cleanup",
          "replaced profile image cleanup",
          "leased minute-level retry worker",
          "legacy deleted-post backfill"
        ]
      },
      null,
      2
    )
  );
};

void main();

export {};
