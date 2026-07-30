import { createHash } from "node:crypto";
import type { Migration } from "@/apps/api/src/db/migrationRunner";

export const recoveryDrillAck = "isolated-disposable-database";
export const recoveryDrillApplicationPrefix = "symposium-recovery-drill-";

export type RecoveryDrillEnvironment = {
  ack: string;
  applicationName: string;
  databaseFingerprint: string;
  databaseUrl: string;
  drillId: string;
  expectedDatabase: string;
  expectedRole: string;
  loopback: boolean;
  productionDatabaseFingerprint: string | null;
  reportPath: string;
};

export type DatabaseIdentity = {
  applicationName: string;
  databaseName: string;
  roleName: string;
  serverAddress: string | null;
  serverVersion: string;
};

export type MigrationLedgerRow = {
  checksum: string | null;
  id: string;
  position: number | null;
};

export type AttachmentAuditRow = {
  attachmentId: string;
  bucket: string;
  byteSize: number;
  contentType: string;
  metadata: Record<string, unknown>;
  objectKey: string;
  ownerId: string | null;
  ownerType: string;
  status: string;
  uploadObjectKey: string;
};

export type StorageDeletionAuditRow = {
  attachmentId: string | null;
  bucket: string;
  objectKey: string;
  reason: string;
};

export type ObjectMetadata = {
  byteSize: number;
  contentType: string | null;
};

export type AttachmentCoherenceIssue = {
  attachmentHash: string;
  code: string;
};

const required = (environment: NodeJS.ProcessEnv, key: string) => {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required for the recovery drill.`);
  return value;
};

const normalizedDatabaseName = (url: URL) =>
  decodeURIComponent(url.pathname.replace(/^\/+/, "")).split("/")[0] ?? "";

const normalizedPort = (url: URL) => url.port || (url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "");

export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export const safeDatabaseFingerprint = (connectionString: string) => {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("SYMPOSIUM_DRILL_DATABASE_URL must be a PostgreSQL URL.");
  }
  const databaseName = normalizedDatabaseName(url);
  if (!url.hostname || !databaseName) {
    throw new Error("SYMPOSIUM_DRILL_DATABASE_URL must identify a host and database.");
  }
  return sha256(`${url.hostname.toLowerCase()}:${normalizedPort(url)}/${databaseName}`);
};

export const parseRecoveryDrillEnvironment = (
  environment: NodeJS.ProcessEnv
): RecoveryDrillEnvironment => {
  const databaseUrl = required(environment, "SYMPOSIUM_DRILL_DATABASE_URL");
  const ack = required(environment, "SYMPOSIUM_DRILL_ACK");
  if (ack !== recoveryDrillAck) {
    throw new Error(`SYMPOSIUM_DRILL_ACK must equal "${recoveryDrillAck}".`);
  }
  const drillId = required(environment, "SYMPOSIUM_DRILL_ID");
  if (!/^[a-z0-9][a-z0-9_-]{5,47}$/.test(drillId)) {
    throw new Error("SYMPOSIUM_DRILL_ID must be a 6-48 character lowercase drill identifier.");
  }
  const expectedDatabase = required(environment, "SYMPOSIUM_DRILL_EXPECTED_DATABASE");
  if (!expectedDatabase.includes(drillId)) {
    throw new Error("The expected database name must contain the drill identifier.");
  }
  const expectedRole = required(environment, "SYMPOSIUM_DRILL_EXPECTED_ROLE");
  if (!expectedRole.includes(drillId)) {
    throw new Error("The expected database role must contain the drill identifier.");
  }
  const applicationName = required(environment, "DATABASE_APPLICATION_NAME");
  if (applicationName !== `${recoveryDrillApplicationPrefix}${drillId}`) {
    throw new Error("DATABASE_APPLICATION_NAME must be the exact recovery-drill application name.");
  }

  const url = new URL(databaseUrl);
  const urlDatabase = normalizedDatabaseName(url);
  if (urlDatabase !== expectedDatabase) {
    throw new Error("The drill URL database does not match SYMPOSIUM_DRILL_EXPECTED_DATABASE.");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  const databaseFingerprint = safeDatabaseFingerprint(databaseUrl);
  const productionDatabaseFingerprint =
    environment.SYMPOSIUM_PRODUCTION_DATABASE_FINGERPRINT?.trim() || null;
  if (!loopback && !productionDatabaseFingerprint) {
    throw new Error(
      "SYMPOSIUM_PRODUCTION_DATABASE_FINGERPRINT is required for a remote recovery drill."
    );
  }
  if (productionDatabaseFingerprint === databaseFingerprint) {
    throw new Error("The recovery drill target matches the production database fingerprint.");
  }

  return {
    ack,
    applicationName,
    databaseFingerprint,
    databaseUrl,
    drillId,
    expectedDatabase,
    expectedRole,
    loopback,
    productionDatabaseFingerprint,
    reportPath:
      environment.SYMPOSIUM_DRILL_REPORT_PATH?.trim() ||
      ".artifacts/refactor/recovery/report.json"
  };
};

export const assertRecoveryDatabaseIdentity = (
  environment: RecoveryDrillEnvironment,
  identity: DatabaseIdentity
) => {
  if (identity.databaseName !== environment.expectedDatabase) {
    throw new Error(
      `Connected database "${identity.databaseName}" is not the expected isolated target.`
    );
  }
  if (identity.roleName !== environment.expectedRole) {
    throw new Error(`Connected role "${identity.roleName}" is not the expected drill role.`);
  }
  if (identity.applicationName !== environment.applicationName) {
    throw new Error("Connected PostgreSQL application_name is not the isolated drill name.");
  }
  if (!identity.databaseName.includes(environment.drillId)) {
    throw new Error("Connected database does not contain the drill identifier.");
  }
  if (!identity.roleName.includes(environment.drillId)) {
    throw new Error("Connected role does not contain the drill identifier.");
  }
};

export const validateExactMigrationLedger = (
  migrations: readonly Migration[],
  rows: readonly MigrationLedgerRow[],
  checksum: (migration: Migration) => string
) => {
  if (rows.length !== migrations.length) {
    throw new Error(
      `Migration ledger has ${rows.length} canonical rows; expected ${migrations.length}.`
    );
  }
  for (const [index, migration] of migrations.entries()) {
    const row = rows[index];
    if (!row || row.id !== migration.id) {
      throw new Error(`Migration ledger order differs at position ${index + 1}.`);
    }
    if (row.position !== index + 1) {
      throw new Error(`Migration "${migration.id}" has an invalid ledger position.`);
    }
    if (row.checksum !== checksum(migration)) {
      throw new Error(`Migration "${migration.id}" has an invalid ledger checksum.`);
    }
  }
};

const normalizedContentType = (value: string | null | undefined) =>
  value?.split(";")[0]?.trim().toLowerCase() || null;

const storageState = (metadata: Record<string, unknown>, key: string) =>
  typeof metadata[key] === "string" ? metadata[key] as string : "";

export const auditAttachmentCoherence = async (
  attachments: readonly AttachmentAuditRow[],
  deletionJobs: readonly StorageDeletionAuditRow[],
  inspectObject: (bucket: string, objectKey: string) => Promise<ObjectMetadata | null>,
  evidenceSalt: string
) => {
  if (!evidenceSalt) throw new Error("Attachment coherence evidence requires a drill-specific salt.");
  const issues: AttachmentCoherenceIssue[] = [];
  const objectOwners = new Map<string, string>();
  const jobs = new Set(deletionJobs.map((row) => `${row.bucket}\u0000${row.objectKey}`));
  let active = 0;
  let inspectedObjects = 0;
  let missingAllowedByDeletionState = 0;
  let r2Active = 0;
  let staticActive = 0;

  for (const attachment of attachments) {
    const attachmentHash = sha256(`${evidenceSalt}\u0000${attachment.attachmentId}`).slice(0, 16);
    const canonicalKey = `${attachment.bucket}\u0000${attachment.objectKey}`;
    const existingOwner = objectOwners.get(canonicalKey);
    if (existingOwner && existingOwner !== attachment.attachmentId) {
      issues.push({ attachmentHash, code: "duplicate-canonical-object-owner" });
    } else {
      objectOwners.set(canonicalKey, attachment.attachmentId);
    }

    const isActive = attachment.status === "uploaded" || attachment.status === "previewed";
    const isFailed = attachment.status === "failed";
    const canonicalDeleted =
      storageState(attachment.metadata, "storageState") === "deleted";
    const canonicalDeletionPending =
      storageState(attachment.metadata, "storageState") === "deletion_pending";
    const canonicalJob = jobs.has(canonicalKey);
    let canonicalObject: ObjectMetadata | null | undefined;
    if (isActive || isFailed) {
      canonicalObject = await inspectObject(attachment.bucket, attachment.objectKey);
      inspectedObjects += 1;
    }
    if (isActive) {
      active += 1;
      if (attachment.bucket === "static") {
        staticActive += 1;
        const staticPublicPath = storageState(attachment.metadata, "staticPublicPath");
        if (staticPublicPath.replace(/^\/+/, "") !== attachment.objectKey.replace(/^\/+/, "")) {
          issues.push({ attachmentHash, code: "static-public-path-mismatch" });
        }
      } else {
        r2Active += 1;
      }
      if (!canonicalObject) {
        issues.push({ attachmentHash, code: "active-canonical-object-missing" });
      } else {
        if (canonicalObject.byteSize !== attachment.byteSize) {
          issues.push({ attachmentHash, code: "active-object-size-mismatch" });
        }
        const storedType = normalizedContentType(canonicalObject.contentType);
        const rowType = normalizedContentType(attachment.contentType);
        if (rowType && storedType !== rowType) {
          issues.push({ attachmentHash, code: "active-object-content-type-mismatch" });
        }
      }
    }
    if (isFailed) {
      if (canonicalObject) {
        if (canonicalDeleted) {
          issues.push({ attachmentHash, code: "failed-canonical-object-present-after-deletion" });
        } else if (!canonicalJob && !canonicalDeletionPending) {
          issues.push({
            attachmentHash,
            code: "failed-canonical-object-present-without-deletion-state"
          });
        }
      } else if (canonicalDeleted || canonicalJob || canonicalDeletionPending) {
        missingAllowedByDeletionState += 1;
      } else {
        issues.push({
          attachmentHash,
          code: "failed-canonical-object-missing-without-deletion-state"
        });
      }
    }

    if (
      attachment.uploadObjectKey &&
      attachment.uploadObjectKey !== attachment.objectKey
    ) {
      const staging = await inspectObject(attachment.bucket, attachment.uploadObjectKey);
      inspectedObjects += 1;
      const stagingKey = `${attachment.bucket}\u0000${attachment.uploadObjectKey}`;
      const stagingDeleted =
        storageState(attachment.metadata, "stagingStorageState") === "deleted";
      const stagingDeletionPending =
        storageState(attachment.metadata, "stagingStorageState") === "deletion_pending";
      const stagingJob = jobs.has(stagingKey);
      if (!staging) {
        if (
          stagingJob ||
          stagingDeleted ||
          stagingDeletionPending ||
          (isFailed && (canonicalDeleted || canonicalJob || canonicalDeletionPending))
        ) {
          missingAllowedByDeletionState += 1;
        } else {
          issues.push({ attachmentHash, code: "staging-object-missing-without-deletion-state" });
        }
      } else if (
        stagingDeleted ||
        (isFailed && canonicalDeleted)
      ) {
        issues.push({ attachmentHash, code: "staging-object-present-after-deletion" });
      }
    }
  }

  const attachmentIds = new Set(attachments.map((row) => row.attachmentId));
  for (const job of deletionJobs) {
    if (job.attachmentId && !attachmentIds.has(job.attachmentId) && !job.reason) {
      issues.push({
        attachmentHash: sha256(`${evidenceSalt}\u0000${job.attachmentId}`).slice(0, 16),
        code: "deletion-job-missing-attachment-and-reason"
      });
    }
  }

  return {
    active,
    attachmentCount: attachments.length,
    coherenceDigest: sha256(JSON.stringify({
      attachments: attachments
        .map((row) => sha256(`${evidenceSalt}\u0000${row.attachmentId}\u0000${row.bucket}\u0000${row.objectKey}`))
        .sort(),
      deletionJobs: deletionJobs
        .map((row) => sha256(`${evidenceSalt}\u0000${row.attachmentId ?? ""}\u0000${row.bucket}\u0000${row.objectKey}\u0000${row.reason}`))
        .sort()
    })),
    deletionJobCount: deletionJobs.length,
    inspectedObjects,
    issues,
    missingAllowedByDeletionState,
    r2Active,
    staticActive
  };
};
