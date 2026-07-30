import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HeadObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  Pool,
  type PoolClient,
  type QueryResultRow
} from "pg";
import {
  inspectMigrationHistory,
  migrationChecksum,
  runMigrationTransaction,
  type AppliedMigrationRow,
  type Migration
} from "@/apps/api/src/db/migrationRunner";
import { migrations } from "@/apps/api/src/db/migrate";
import {
  assertRecoveryDatabaseIdentity,
  auditAttachmentCoherence,
  parseRecoveryDrillEnvironment,
  sha256,
  validateExactMigrationLedger,
  type AttachmentAuditRow,
  type DatabaseIdentity,
  type MigrationLedgerRow,
  type ObjectMetadata,
  type RecoveryDrillEnvironment,
  type StorageDeletionAuditRow
} from "@/scripts/recoveryDrillCore";

type DrillMode =
  | "all"
  | "preflight"
  | "fresh"
  | "backfill"
  | "concurrency"
  | "rollback"
  | "restore-audit";

type DrillCase = {
  detail?: Record<string, boolean | number | string | null>;
  durationMs: number;
  id: string;
  status: "failed" | "not-run" | "passed";
};

type DrillReport = {
  cases: DrillCase[];
  finishedAt: string;
  mode: DrillMode;
  schemaVersion: 1;
  source: {
    dirty: boolean;
    dirtyDigest: string;
    headSha: string;
  };
  startedAt: string;
  status: "failed" | "passed";
  target: {
    databaseFingerprint: string;
    databaseName: string | null;
    roleName: string | null;
    serverVersion: string | null;
  };
};

type ManifestRow = QueryResultRow & {
  definition: string;
  identity: string;
  kind: string;
};

const allowedModes = new Set<DrillMode>([
  "all",
  "preflight",
  "fresh",
  "backfill",
  "concurrency",
  "rollback",
  "restore-audit"
]);

const canonicalLedger = async (client: PoolClient) => {
  const ids = migrations.map((migration) => migration.id);
  const result = await client.query<MigrationLedgerRow & QueryResultRow>(
    `SELECT id, checksum, position
     FROM symposium_migrations
     WHERE id = ANY($1::text[])
     ORDER BY position ASC NULLS LAST, id ASC`,
    [ids]
  );
  return result.rows;
};

const databaseIdentity = async (client: PoolClient): Promise<DatabaseIdentity> => {
  const result = await client.query<QueryResultRow & {
    applicationName: string;
    databaseName: string;
    roleName: string;
    serverAddress: string | null;
    serverVersion: string;
  }>(
    `SELECT
       current_database() AS "databaseName",
       current_user AS "roleName",
       current_setting('application_name') AS "applicationName",
       inet_server_addr()::text AS "serverAddress",
       current_setting('server_version') AS "serverVersion"`
  );
  const identity = result.rows[0];
  if (!identity) throw new Error("Unable to read the recovery database identity.");
  return identity;
};

const ensureDrillMarker = async (
  client: PoolClient,
  environment: RecoveryDrillEnvironment
) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS symposium_recovery_drill_marker (
      drill_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `INSERT INTO symposium_recovery_drill_marker (drill_id)
     VALUES ($1)
     ON CONFLICT (drill_id) DO NOTHING`,
    [environment.drillId]
  );
  const marker = await client.query<QueryResultRow & { drillId: string }>(
    `SELECT drill_id AS "drillId"
     FROM symposium_recovery_drill_marker
     WHERE drill_id = $1`,
    [environment.drillId]
  );
  assert.equal(marker.rows[0]?.drillId, environment.drillId);
};

const manifestRows = async (client: PoolClient) => {
  const result = await client.query<ManifestRow>(`
    WITH relations AS (
      SELECT
        'relation'::text AS kind,
        format('%I.%I', namespace.nspname, class.relname) AS identity,
        class.relkind::text AS definition
      FROM pg_class class
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      WHERE namespace.nspname = 'public'
        AND class.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND class.relname NOT IN ('symposium_migrations', 'symposium_recovery_drill_marker')
    ),
    columns AS (
      SELECT
        'column'::text AS kind,
        format('%I.%I.%I', table_schema, table_name, column_name) AS identity,
        concat_ws('|', data_type, udt_name, is_nullable, column_default) AS definition
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name NOT IN ('symposium_migrations', 'symposium_recovery_drill_marker')
    ),
    constraints AS (
      SELECT
        'constraint'::text AS kind,
        format('%I.%I', namespace.nspname, constraint_row.conname) AS identity,
        pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_constraint constraint_row
      JOIN pg_namespace namespace ON namespace.oid = constraint_row.connamespace
      WHERE namespace.nspname = 'public'
        AND constraint_row.conrelid NOT IN (
          'public.symposium_migrations'::regclass,
          'public.symposium_recovery_drill_marker'::regclass
        )
    ),
    indexes AS (
      SELECT
        'index'::text AS kind,
        format('%I.%I', schemaname, indexname) AS identity,
        indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename NOT IN ('symposium_migrations', 'symposium_recovery_drill_marker')
    ),
    triggers AS (
      SELECT
        'trigger'::text AS kind,
        format('%I.%I', event_object_table, trigger_name) AS identity,
        concat_ws('|', action_timing, event_manipulation, action_statement) AS definition
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
        AND event_object_table NOT IN ('symposium_migrations', 'symposium_recovery_drill_marker')
    ),
    routines AS (
      SELECT
        'routine'::text AS kind,
        format('%I.%I', namespace.nspname, procedure.proname) AS identity,
        pg_get_functiondef(procedure.oid) AS definition
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
    )
    SELECT * FROM relations
    UNION ALL SELECT * FROM columns
    UNION ALL SELECT * FROM constraints
    UNION ALL SELECT * FROM indexes
    UNION ALL SELECT * FROM triggers
    UNION ALL SELECT * FROM routines
    ORDER BY kind, identity, definition
  `);
  return result.rows;
};

const schemaManifest = async (client: PoolClient) => {
  const rows = await manifestRows(client);
  return {
    entries: rows.length,
    hash: sha256(JSON.stringify(rows))
  };
};

const productRowCounts = async (client: PoolClient) => {
  const tables = await client.query<QueryResultRow & { tableName: string }>(
    `SELECT tablename AS "tableName"
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('symposium_migrations', 'symposium_recovery_drill_marker')
     ORDER BY tablename`
  );
  const counts: Array<[string, string]> = [];
  for (const { tableName } of tables.rows) {
    const safeName = `"${tableName.replaceAll('"', '""')}"`;
    const result = await client.query<QueryResultRow & { count: string }>(
      `SELECT count(*)::text AS count FROM ${safeName}`
    );
    counts.push([tableName, result.rows[0]?.count ?? "0"]);
  }
  return {
    digest: sha256(JSON.stringify(counts)),
    tableCount: counts.length
  };
};

const userTableCount = async (client: PoolClient) => {
  const result = await client.query<QueryResultRow & { count: string }>(
    `SELECT count(*)::text AS count
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> 'symposium_recovery_drill_marker'`
  );
  return Number(result.rows[0]?.count ?? 0);
};

const runFreshReconstruction = async (client: PoolClient) => {
  assert.equal(
    await userTableCount(client),
    0,
    "Fresh reconstruction target already contains non-marker public tables."
  );
  const first = await runMigrationTransaction(client, migrations);
  assert.equal(first.appliedNow.length, migrations.length);
  assert.equal(first.metadataBackfill.length, 0);
  const ledger = await canonicalLedger(client);
  validateExactMigrationLedger(migrations, ledger, migrationChecksum);
  const firstManifest = await schemaManifest(client);
  const firstCounts = await productRowCounts(client);

  const second = await runMigrationTransaction(client, migrations);
  assert.deepEqual(second, { appliedNow: [], metadataBackfill: [] });
  assert.deepEqual(await schemaManifest(client), firstManifest);
  assert.deepEqual(await productRowCounts(client), firstCounts);
  return {
    ledgerCount: ledger.length,
    manifestEntries: firstManifest.entries,
    manifestHash: firstManifest.hash,
    rowCountDigest: firstCounts.digest,
    tableCount: firstCounts.tableCount
  };
};

const runBackfillProof = async (client: PoolClient) => {
  const beforeManifest = await schemaManifest(client);
  const beforeCounts = await productRowCounts(client);
  const appliedBeforeResult = await client.query<QueryResultRow & { id: string }>(
    `SELECT id
     FROM symposium_migrations
     WHERE id = ANY($1::text[])`,
    [migrations.map((migration) => migration.id)]
  );
  const appliedBefore = new Set(appliedBeforeResult.rows.map(({ id }) => id));
  const pendingBefore = migrations.filter(({ id }) => !appliedBefore.has(id));
  const metadataColumnResult = await client.query<QueryResultRow & { columnName: string }>(
    `SELECT column_name AS "columnName"
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'symposium_migrations'
       AND column_name IN ('checksum', 'position')
     ORDER BY column_name`
  );
  const metadataColumnsBefore = new Set(
    metadataColumnResult.rows.map(({ columnName }) => columnName)
  );
  await client.query("DROP INDEX IF EXISTS symposium_migrations_position_idx");
  const resetAssignments = ["checksum", "position"]
    .filter((column) => metadataColumnsBefore.has(column))
    .map((column) => `${column} = NULL`);
  if (resetAssignments.length) {
    await client.query(
      `UPDATE symposium_migrations
       SET ${resetAssignments.join(", ")}
       WHERE id = ANY($1::text[])`,
      [migrations.map((migration) => migration.id)]
    );
  }
  const result = await runMigrationTransaction(client, migrations);
  assert.deepEqual(result.appliedNow, pendingBefore.map(({ id }) => id));
  assert.equal(result.metadataBackfill.length, appliedBefore.size);
  validateExactMigrationLedger(
    migrations,
    await canonicalLedger(client),
    migrationChecksum
  );
  const afterManifest = await schemaManifest(client);
  const afterCounts = await productRowCounts(client);
  if (!pendingBefore.length) assert.deepEqual(afterManifest, beforeManifest);
  assert.deepEqual(afterCounts, beforeCounts);
  const second = await runMigrationTransaction(client, migrations);
  assert.deepEqual(second, { appliedNow: [], metadataBackfill: [] });

  const first = migrations[0]!;
  await client.query(
    "UPDATE symposium_migrations SET checksum = 'tampered' WHERE id = $1",
    [first.id]
  );
  await assert.rejects(runMigrationTransaction(client, migrations), /checksum drift/);
  await client.query(
    "UPDATE symposium_migrations SET checksum = $2 WHERE id = $1",
    [first.id, migrationChecksum(first)]
  );
  await client.query(
    "UPDATE symposium_migrations SET position = 9999 WHERE id = $1",
    [first.id]
  );
  await assert.rejects(runMigrationTransaction(client, migrations), /order drift/);
  await client.query(
    "UPDATE symposium_migrations SET position = 1 WHERE id = $1",
    [first.id]
  );
  validateExactMigrationLedger(
    migrations,
    await canonicalLedger(client),
    migrationChecksum
  );
  return {
    appliedPending: result.appliedNow.length,
    backfilled: result.metadataBackfill.length,
    driftCases: 2,
    legacyColumnsAdded: metadataColumnsBefore.size === 0,
    manifestEntriesAfter: afterManifest.entries,
    manifestEntriesBefore: beforeManifest.entries,
    manifestHashAfter: afterManifest.hash,
    manifestHashBefore: beforeManifest.hash,
    metadataColumnsBefore: metadataColumnsBefore.size,
    productManifestStable: afterManifest.hash === beforeManifest.hash,
    productRowsStable: true,
    rowCountDigest: beforeCounts.digest,
    tableCount: beforeCounts.tableCount
  };
};

const concurrencyMigration: Migration = {
  id: "9001_recovery_concurrency",
  sql: `
    CREATE TABLE symposium_recovery_concurrency_proof (
      id INTEGER PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO symposium_recovery_concurrency_proof (id) VALUES (1);
  `
};

const cleanupTestMigration = async (
  client: PoolClient,
  migration: Migration,
  tableName: string
) => {
  await client.query("BEGIN");
  try {
    await client.query(`DROP TABLE IF EXISTS "${tableName.replaceAll('"', '""')}"`);
    await client.query("DELETE FROM symposium_migrations WHERE id = $1", [migration.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

const runConcurrencyProof = async (pool: Pool) => {
  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  const plan = [...migrations, concurrencyMigration];
  const startedAt = Date.now();
  try {
    const results = await Promise.all([
      runMigrationTransaction(firstClient, plan),
      runMigrationTransaction(secondClient, plan)
    ]);
    const elapsedMs = Date.now() - startedAt;
    assert.deepEqual(
      results.map((result) => result.appliedNow.length).sort((left, right) => left - right),
      [0, 1]
    );
    const proof = await firstClient.query<QueryResultRow & { count: string }>(
      "SELECT count(*)::text AS count FROM symposium_recovery_concurrency_proof"
    );
    assert.equal(proof.rows[0]?.count, "1");
    const ledger = await firstClient.query<QueryResultRow & { count: string }>(
      "SELECT count(*)::text AS count FROM symposium_migrations WHERE id = $1",
      [concurrencyMigration.id]
    );
    assert.equal(ledger.rows[0]?.count, "1");
    await cleanupTestMigration(
      firstClient,
      concurrencyMigration,
      "symposium_recovery_concurrency_proof"
    );
    validateExactMigrationLedger(
      migrations,
      await canonicalLedger(firstClient),
      migrationChecksum
    );
    return { elapsedMs, exactlyOnce: true, sessions: 2 };
  } finally {
    firstClient.release();
    secondClient.release();
  }
};

const failingMigration: Migration = {
  id: "9002_recovery_rollback",
  sql: `
    CREATE TABLE symposium_recovery_rollback_proof (
      id INTEGER PRIMARY KEY
    );
    INSERT INTO symposium_recovery_rollback_proof (id) VALUES (1);
    SELECT 1 / 0;
  `
};

const correctedMigration: Migration = {
  ...failingMigration,
  sql: `
    CREATE TABLE symposium_recovery_rollback_proof (
      id INTEGER PRIMARY KEY
    );
    INSERT INTO symposium_recovery_rollback_proof (id) VALUES (1);
  `
};

const runRollbackProof = async (client: PoolClient) => {
  await assert.rejects(
    runMigrationTransaction(client, [...migrations, failingMigration]),
    /division by zero/
  );
  const partialTable = await client.query<QueryResultRow & { present: boolean }>(
    `SELECT to_regclass('public.symposium_recovery_rollback_proof') IS NOT NULL AS present`
  );
  assert.equal(partialTable.rows[0]?.present, false);
  const partialLedger = await client.query<QueryResultRow & { count: string }>(
    "SELECT count(*)::text AS count FROM symposium_migrations WHERE id = $1",
    [failingMigration.id]
  );
  assert.equal(partialLedger.rows[0]?.count, "0");

  const retry = await runMigrationTransaction(
    client,
    [...migrations, correctedMigration]
  );
  assert.deepEqual(retry.appliedNow, [correctedMigration.id]);
  const row = await client.query<QueryResultRow & { count: string }>(
    "SELECT count(*)::text AS count FROM symposium_recovery_rollback_proof"
  );
  assert.equal(row.rows[0]?.count, "1");
  await cleanupTestMigration(
    client,
    correctedMigration,
    "symposium_recovery_rollback_proof"
  );
  validateExactMigrationLedger(
    migrations,
    await canonicalLedger(client),
    migrationChecksum
  );
  return { partialLedgerRows: 0, partialTables: 0, retryApplied: true };
};

const r2Client = () => {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Read-only R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required."
    );
  }
  return new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey }
  });
};

const runRestoreAudit = async (
  client: PoolClient,
  environment: RecoveryDrillEnvironment
) => {
  const ledger = await canonicalLedger(client);
  validateExactMigrationLedger(migrations, ledger, migrationChecksum);
  const attachmentResult = await client.query<AttachmentAuditRow & QueryResultRow>(
    `SELECT
       id::text AS "attachmentId",
       bucket,
       byte_size AS "byteSize",
       content_type AS "contentType",
       metadata,
       object_key AS "objectKey",
       owner_id AS "ownerId",
       owner_type AS "ownerType",
       status,
       upload_object_key AS "uploadObjectKey"
     FROM attachments
     ORDER BY id`
  );
  const deletionResult = await client.query<StorageDeletionAuditRow & QueryResultRow>(
    `SELECT
       attachment_id::text AS "attachmentId",
       bucket,
       object_key AS "objectKey",
       reason
     FROM storage_deletion_jobs
     ORDER BY id`
  );
  const s3 = r2Client();
  const cache = new Map<string, Promise<ObjectMetadata | null>>();
  const inspectObject = (bucket: string, objectKey: string) => {
    const key = `${bucket}\u0000${objectKey}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const request = s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }))
      .then((head) => ({
        byteSize: Number(head.ContentLength ?? 0),
        contentType: head.ContentType ?? null
      }))
      .catch((error: unknown) => {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return null;
        throw error;
      });
    cache.set(key, request);
    return request;
  };
  const coherence = await auditAttachmentCoherence(
    attachmentResult.rows,
    deletionResult.rows,
    inspectObject,
    environment.drillId
  );
  assert.deepEqual(coherence.issues, []);
  return {
    activeAttachments: coherence.active,
    attachmentCount: coherence.attachmentCount,
    coherenceDigest: coherence.coherenceDigest,
    deletionJobCount: coherence.deletionJobCount,
    inspectedObjects: coherence.inspectedObjects,
    missingAllowedByDeletionState: coherence.missingAllowedByDeletionState
  };
};

const sourceIdentity = () => {
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { encoding: "buffer" }
  );
  const diff = execFileSync("git", ["diff", "--binary", "HEAD", "--"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024
  });
  return {
    dirty: status.length > 0,
    dirtyDigest: createHash("sha256").update(status).update(diff).digest("hex"),
    headSha
  };
};

const writeReport = async (reportPath: string, report: DrillReport) => {
  const absolute = path.resolve(reportPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
};

const selectedCases = (mode: DrillMode) => {
  if (mode === "all") return ["preflight", "fresh", "backfill", "concurrency", "rollback"];
  return [mode];
};

const main = async () => {
  const mode = (process.argv[2] ?? "all") as DrillMode;
  if (!allowedModes.has(mode)) {
    throw new Error(`Unknown recovery drill mode "${mode}".`);
  }
  const environment = parseRecoveryDrillEnvironment(process.env);
  const report: DrillReport = {
    cases: [],
    finishedAt: "",
    mode,
    schemaVersion: 1,
    source: sourceIdentity(),
    startedAt: new Date().toISOString(),
    status: "failed",
    target: {
      databaseFingerprint: environment.databaseFingerprint,
      databaseName: null,
      roleName: null,
      serverVersion: null
    }
  };
  const pool = new Pool({
    application_name: environment.applicationName,
    connectionString: environment.databaseUrl,
    max: 4,
    ssl: environment.loopback ? undefined : { rejectUnauthorized: true }
  });
  const cases = selectedCases(mode);
  try {
    const client = await pool.connect();
    try {
      const identity = await databaseIdentity(client);
      assertRecoveryDatabaseIdentity(environment, identity);
      report.target.databaseName = identity.databaseName;
      report.target.roleName = identity.roleName;
      report.target.serverVersion = identity.serverVersion;
      if (mode !== "restore-audit") await ensureDrillMarker(client, environment);
      for (const id of cases) {
        const started = Date.now();
        try {
          const detail =
            id === "preflight"
              ? {
                  applicationNameExact: true,
                  databaseNameExact: true,
                  drillMarkerPresent: mode !== "restore-audit",
                  roleNameExact: true
                }
              : id === "fresh"
                ? await runFreshReconstruction(client)
                : id === "backfill"
                  ? await runBackfillProof(client)
                  : id === "concurrency"
                    ? await runConcurrencyProof(pool)
                    : id === "rollback"
                      ? await runRollbackProof(client)
                      : await runRestoreAudit(client, environment);
          report.cases.push({
            detail,
            durationMs: Date.now() - started,
            id,
            status: "passed"
          });
        } catch (error) {
          report.cases.push({
            detail: {
              errorHash: sha256(error instanceof Error ? error.message : String(error))
            },
            durationMs: Date.now() - started,
            id,
            status: "failed"
          });
          throw error;
        }
      }
    } finally {
      client.release();
    }
    report.status = "passed";
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeReport(environment.reportPath, report);
    await pool.end();
  }
  console.log(JSON.stringify({
    ok: true,
    mode,
    reportPath: environment.reportPath,
    cases: report.cases.map(({ id, status }) => ({ id, status }))
  }, null, 2));
};

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
