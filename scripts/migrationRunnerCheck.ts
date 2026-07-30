import assert from "node:assert/strict";
import type { PoolClient, QueryResultRow } from "pg";
import {
  inspectMigrationHistory,
  migrationChecksum,
  runMigrationTransaction,
  validateMigrationPlan,
  type AppliedMigrationRow,
  type Migration
} from "@/apps/api/src/db/migrationRunner";
import { reportCheck } from "@/scripts/checkReport";

const plan = [
  { id: "0001_first", sql: "SELECT 'migration-one'" },
  { id: "0002_second", sql: "SELECT 'migration-two'" }
] as const satisfies readonly Migration[];

type StoredMigration = {
  checksum: string | null;
  position: number | null;
};

class FakeMigrationDatabase {
  readonly executions: string[] = [];
  readonly history = new Map<string, StoredMigration>();
  readonly statements: string[] = [];
  activeLocks = 0;
  maxActiveLocks = 0;
  failSql: string | null = null;
  private lockTail: Promise<void> = Promise.resolve();

  createClient(label: string) {
    let releaseLock: (() => void) | null = null;
    let pendingHistory: Map<string, StoredMigration> | null = null;
    const query = async (
      rawSql: string,
      values: readonly unknown[] = []
    ) => {
      const sql = rawSql.replace(/\s+/g, " ").trim();
      this.statements.push(`${label}:${sql}`);
      if (sql === "BEGIN") return { rows: [] as QueryResultRow[], rowCount: null };
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
        const previous = this.lockTail;
        let unlock: () => void = () => {};
        this.lockTail = new Promise<void>((resolve) => {
          unlock = () => resolve();
        });
        await previous;
        releaseLock = unlock;
        pendingHistory = new Map(
          [...this.history].map(([id, value]) => [id, { ...value }])
        );
        this.activeLocks += 1;
        this.maxActiveLocks = Math.max(this.maxActiveLocks, this.activeLocks);
        return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
      }
      if (
        sql.startsWith("CREATE TABLE IF NOT EXISTS symposium_migrations")
        || sql.startsWith("ALTER TABLE symposium_migrations")
        || sql.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS symposium_migrations_position_idx")
      ) {
        return { rows: [] as QueryResultRow[], rowCount: null };
      }
      if (sql.startsWith("SELECT id, checksum, position FROM symposium_migrations")) {
        const requested = new Set((values[0] as string[]) ?? []);
        const rows = [...(pendingHistory ?? this.history)]
          .filter(([id]) => requested.has(id))
          .map(([id, value]) => ({ id, ...value }));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("UPDATE symposium_migrations SET checksum")) {
        assert.ok(pendingHistory, "Metadata backfill requires the migration lock.");
        const [id, checksum, position] = values as [string, string, number];
        const current = pendingHistory.get(id);
        assert.ok(current, `Missing migration history for ${id}.`);
        pendingHistory.set(id, {
          checksum: current.checksum ?? checksum,
          position: current.position ?? position
        });
        return { rows: [] as QueryResultRow[], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO symposium_migrations")) {
        assert.ok(pendingHistory, "Migration insert requires the migration lock.");
        const [id, checksum, position] = values as [string, string, number];
        if (pendingHistory.has(id)) throw new Error(`duplicate history ${id}`);
        pendingHistory.set(id, { checksum, position });
        return { rows: [] as QueryResultRow[], rowCount: 1 };
      }
      if (plan.some((migration) => migration.sql === rawSql)) {
        this.executions.push(rawSql);
        if (this.failSql === rawSql) throw new Error(`planned failure: ${rawSql}`);
        return { rows: [] as QueryResultRow[], rowCount: null };
      }
      if (sql === "COMMIT") {
        assert.ok(pendingHistory, "Commit requires a locked migration transaction.");
        this.history.clear();
        for (const [id, value] of pendingHistory) this.history.set(id, value);
        pendingHistory = null;
        this.activeLocks -= 1;
        releaseLock?.();
        releaseLock = null;
        return { rows: [] as QueryResultRow[], rowCount: null };
      }
      if (sql === "ROLLBACK") {
        pendingHistory = null;
        if (releaseLock) {
          this.activeLocks -= 1;
          releaseLock();
          releaseLock = null;
        }
        return { rows: [] as QueryResultRow[], rowCount: null };
      }
      throw new Error(`Unexpected fake migration query: ${sql}`);
    };
    return { query } as unknown as Pick<PoolClient, "query">;
  }
}

const row = (
  migration: Migration,
  position: number,
  overrides: Partial<AppliedMigrationRow> = {}
): AppliedMigrationRow => ({
  checksum: migrationChecksum(migration),
  id: migration.id,
  position,
  ...overrides
});

const main = async () => {
  assert.equal(migrationChecksum(plan[0]).length, 64);
  assert.equal(migrationChecksum(plan[0]), migrationChecksum({ ...plan[0] }));
  assert.notEqual(migrationChecksum(plan[0]), migrationChecksum({ ...plan[0], sql: `${plan[0].sql} ` }));
  assert.doesNotThrow(() => validateMigrationPlan(plan));
  assert.throws(
    () => validateMigrationPlan([plan[0], plan[0]]),
    /Duplicate migration id/
  );
  assert.throws(
    () => validateMigrationPlan([{ id: "unsafe-id", sql: "SELECT 1" }]),
    /Invalid migration id/
  );
  assert.throws(
    () => validateMigrationPlan([{ id: "0001_empty", sql: " " }]),
    /has no SQL/
  );

  const legacyInspection = inspectMigrationHistory(plan, [
    row(plan[0], 1, { checksum: null, position: null }),
    { id: "9999_future", checksum: "future", position: 9999 }
  ]);
  assert.deepEqual([...legacyInspection.applied], [plan[0].id]);
  assert.deepEqual(legacyInspection.metadataBackfill, [{
    id: plan[0].id,
    checksum: migrationChecksum(plan[0]),
    position: 1
  }]);
  assert.throws(
    () => inspectMigrationHistory(plan, [row(plan[0], 1, { checksum: "tampered" })]),
    /checksum drift/
  );
  assert.throws(
    () => inspectMigrationHistory(plan, [row(plan[0], 2)]),
    /order drift/
  );

  const legacyDatabase = new FakeMigrationDatabase();
  legacyDatabase.history.set(plan[0].id, { checksum: null, position: null });
  const legacyResult = await runMigrationTransaction(
    legacyDatabase.createClient("legacy"),
    plan
  );
  assert.deepEqual(legacyResult, {
    appliedNow: [plan[1].id],
    metadataBackfill: [plan[0].id]
  });
  assert.deepEqual(legacyDatabase.executions, [plan[1].sql]);
  assert.deepEqual(legacyDatabase.history.get(plan[0].id), {
    checksum: migrationChecksum(plan[0]),
    position: 1
  });
  assert.deepEqual(legacyDatabase.history.get(plan[1].id), {
    checksum: migrationChecksum(plan[1]),
    position: 2
  });

  const concurrentDatabase = new FakeMigrationDatabase();
  const [first, second] = await Promise.all([
    runMigrationTransaction(concurrentDatabase.createClient("startup-a"), plan),
    runMigrationTransaction(concurrentDatabase.createClient("startup-b"), plan)
  ]);
  assert.equal(concurrentDatabase.maxActiveLocks, 1);
  assert.equal(concurrentDatabase.history.size, plan.length);
  assert.deepEqual(concurrentDatabase.executions, plan.map((migration) => migration.sql));
  assert.deepEqual(
    [first.appliedNow.length, second.appliedNow.length].sort((left, right) => left - right),
    [0, plan.length]
  );

  const failingDatabase = new FakeMigrationDatabase();
  failingDatabase.failSql = plan[1].sql;
  await assert.rejects(
    runMigrationTransaction(failingDatabase.createClient("failing"), plan),
    /planned failure/
  );
  assert.equal(failingDatabase.history.size, 0);
  assert.equal(failingDatabase.activeLocks, 0);
  assert.match(failingDatabase.statements.at(-1) ?? "", /ROLLBACK$/);
  failingDatabase.failSql = null;
  await runMigrationTransaction(failingDatabase.createClient("retry"), plan);
  assert.equal(failingDatabase.history.size, plan.length);

  const driftDatabase = new FakeMigrationDatabase();
  driftDatabase.history.set(plan[0].id, { checksum: "tampered", position: 1 });
  await assert.rejects(
    runMigrationTransaction(driftDatabase.createClient("drift"), plan),
    /checksum drift/
  );
  assert.deepEqual(driftDatabase.executions, []);
  assert.equal(driftDatabase.activeLocks, 0);

  reportCheck([
    "deterministic SHA-256 migration checksums",
    "duplicate, malformed, and empty migration rejection",
    "legacy migration metadata backfill without SQL replay",
    "immutable migration checksum enforcement",
    "immutable migration order enforcement",
    "cross-process advisory-lock serialization",
    "exactly-once concurrent migration application",
    "transactional partial-failure rollback",
    "retry after rolled-back migration failure",
    "fail-closed drift detection before migration execution"
  ]);
};

void main();
