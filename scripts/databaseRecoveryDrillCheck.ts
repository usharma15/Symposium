import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertRecoveryDatabaseIdentity,
  auditAttachmentCoherence,
  parseRecoveryDrillEnvironment,
  recoveryDrillAck,
  safeDatabaseFingerprint,
  validateExactMigrationLedger,
  type AttachmentAuditRow
} from "@/scripts/recoveryDrillCore";
import { migrationChecksum, type Migration } from "@/apps/api/src/db/migrationRunner";
import { reportCheck } from "@/scripts/checkReport";

const drillId = "local_20260730";
const database = `symposium_drill_${drillId}`;
const role = `symposium_drill_${drillId}`;
const applicationName = `symposium-recovery-drill-${drillId}`;
const databaseUrl = `postgresql://${role}:secret@127.0.0.1:55432/${database}`;
const baseEnvironment = {
  NODE_ENV: "test",
  SYMPOSIUM_DRILL_ACK: recoveryDrillAck,
  SYMPOSIUM_DRILL_DATABASE_URL: databaseUrl,
  SYMPOSIUM_DRILL_EXPECTED_DATABASE: database,
  SYMPOSIUM_DRILL_EXPECTED_ROLE: role,
  SYMPOSIUM_DRILL_ID: drillId,
  DATABASE_APPLICATION_NAME: applicationName
} satisfies NodeJS.ProcessEnv;

const migrationPlan = [
  { id: "0001_first", sql: "SELECT 1" },
  { id: "0002_second", sql: "SELECT 2" }
] as const satisfies readonly Migration[];

const attachment = (
  overrides: Partial<AttachmentAuditRow> = {}
): AttachmentAuditRow => ({
  attachmentId: "00000000-0000-4000-8000-000000000001",
  bucket: "symposium-drill",
  byteSize: 4,
  contentType: "application/pdf",
  metadata: {},
  objectKey: "post/a.pdf",
  ownerId: "post-1",
  ownerType: "post",
  status: "uploaded",
  uploadObjectKey: "pending/00000000-0000-4000-8000-000000000001",
  ...overrides
});

const main = async () => {
  const drillSource = readFileSync("scripts/databaseRecoveryDrill.ts", "utf8");
  assert.match(
    drillSource,
    /information_schema\.columns[\s\S]*column_name IN \('checksum', 'position'\)/
  );
  assert.match(
    drillSource,
    /git", \["diff", "--binary", "HEAD", "--"\][\s\S]*update\(status\)\.update\(diff\)/
  );

  const parsed = parseRecoveryDrillEnvironment(baseEnvironment);
  assert.equal(parsed.loopback, true);
  assert.equal(parsed.expectedDatabase, database);
  assert.equal(parsed.expectedRole, role);
  assert.equal(parsed.databaseFingerprint, safeDatabaseFingerprint(databaseUrl));
  assert.doesNotMatch(parsed.databaseFingerprint, /secret/);

  for (const [key, value, pattern] of [
    ["SYMPOSIUM_DRILL_ACK", "wrong", /must equal/],
    ["SYMPOSIUM_DRILL_ID", "short", /6-48/],
    ["SYMPOSIUM_DRILL_EXPECTED_DATABASE", "unrelated", /contain the drill identifier/],
    ["SYMPOSIUM_DRILL_EXPECTED_ROLE", "unrelated", /contain the drill identifier/],
    ["DATABASE_APPLICATION_NAME", "symposium-api", /exact recovery-drill/]
  ] as const) {
    assert.throws(
      () => parseRecoveryDrillEnvironment({ ...baseEnvironment, [key]: value }),
      pattern
    );
  }
  assert.throws(
    () => parseRecoveryDrillEnvironment({
      ...baseEnvironment,
      SYMPOSIUM_DRILL_DATABASE_URL:
        `postgresql://${role}:secret@127.0.0.1:55432/wrong_database`
    }),
    /does not match/
  );
  const remoteUrl = `postgresql://${role}:secret@drill.example.test:5432/${database}`;
  assert.throws(
    () => parseRecoveryDrillEnvironment({
      ...baseEnvironment,
      SYMPOSIUM_DRILL_DATABASE_URL: remoteUrl
    }),
    /PRODUCTION_DATABASE_FINGERPRINT/
  );
  const remoteFingerprint = safeDatabaseFingerprint(remoteUrl);
  assert.throws(
    () => parseRecoveryDrillEnvironment({
      ...baseEnvironment,
      SYMPOSIUM_DRILL_DATABASE_URL: remoteUrl,
      SYMPOSIUM_PRODUCTION_DATABASE_FINGERPRINT: remoteFingerprint
    }),
    /matches the production/
  );

  assert.doesNotThrow(() => assertRecoveryDatabaseIdentity(parsed, {
    applicationName,
    databaseName: database,
    roleName: role,
    serverAddress: "127.0.0.1",
    serverVersion: "17.10"
  }));
  assert.throws(
    () => assertRecoveryDatabaseIdentity(parsed, {
      applicationName,
      databaseName: "production",
      roleName: role,
      serverAddress: null,
      serverVersion: "17.10"
    }),
    /not the expected isolated target/
  );

  assert.doesNotThrow(() => validateExactMigrationLedger(
    migrationPlan,
    migrationPlan.map((entry, index) => ({
      checksum: migrationChecksum(entry),
      id: entry.id,
      position: index + 1
    })),
    migrationChecksum
  ));
  assert.throws(
    () => validateExactMigrationLedger(
      migrationPlan,
      [{
        checksum: migrationChecksum(migrationPlan[0]),
        id: migrationPlan[0].id,
        position: 1
      }],
      migrationChecksum
    ),
    /expected 2/
  );
  assert.throws(
    () => validateExactMigrationLedger(
      migrationPlan,
      migrationPlan.map((entry, index) => ({
        checksum: index ? "tampered" : migrationChecksum(entry),
        id: entry.id,
        position: index + 1
      })),
      migrationChecksum
    ),
    /invalid ledger checksum/
  );

  const healthy = await auditAttachmentCoherence(
    [attachment({
      metadata: { stagingStorageState: "deleted" }
    })],
    [],
    async (_bucket, objectKey) => objectKey.startsWith("pending/")
      ? null
      : { byteSize: 4, contentType: "application/pdf; charset=binary" },
    drillId
  );
  assert.deepEqual(healthy.issues, []);
  assert.equal(healthy.active, 1);
  assert.equal(healthy.inspectedObjects, 2);
  assert.equal(healthy.missingAllowedByDeletionState, 1);

  const missing = await auditAttachmentCoherence(
    [attachment()],
    [],
    async () => null,
    drillId
  );
  assert.deepEqual(
    missing.issues.map((issue) => issue.code).sort(),
    [
      "active-canonical-object-missing",
      "staging-object-missing-without-deletion-state"
    ]
  );
  assert.ok(missing.issues.every((issue) => !issue.attachmentHash.includes("00000000")));

  const mismatched = await auditAttachmentCoherence(
    [
      attachment({ uploadObjectKey: "post/a.pdf" }),
      attachment({
        attachmentId: "00000000-0000-4000-8000-000000000002",
        objectKey: "post/a.pdf",
        status: "failed",
        uploadObjectKey: "post/a.pdf"
      })
    ],
    [],
    async () => ({ byteSize: 5, contentType: null }),
    drillId
  );
  assert.deepEqual(
    mismatched.issues.map((issue) => issue.code).sort(),
    [
      "active-object-content-type-mismatch",
      "active-object-size-mismatch",
      "duplicate-canonical-object-owner",
      "failed-object-without-deletion-state"
    ]
  );
  const differentlySalted = await auditAttachmentCoherence(
    [attachment({ uploadObjectKey: "post/a.pdf" })],
    [],
    async () => ({ byteSize: 4, contentType: "application/pdf" }),
    `${drillId}_other`
  );
  assert.notEqual(differentlySalted.coherenceDigest, healthy.coherenceDigest);
  await assert.rejects(
    auditAttachmentCoherence([], [], async () => null, ""),
    /drill-specific salt/
  );

  reportCheck([
    "exact drill acknowledgement and identifier validation",
    "database URL, database name, role, and application-name isolation",
    "remote production-fingerprint exclusion",
    "secret-free database fingerprinting",
    "exact migration ledger count, order, checksum, and position validation",
    "active attachment object size and content-type coherence",
    "staging deletion-state reconciliation",
    "missing, duplicate-owner, and failed-object detection",
    "privacy-safe hashed attachment evidence",
    "true legacy-ledger setup and content-sensitive candidate identity"
  ]);
};

void main();
