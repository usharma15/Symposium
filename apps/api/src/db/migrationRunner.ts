import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

export type Migration = {
  id: string;
  sql: string;
};

export type AppliedMigrationRow = {
  checksum: string | null;
  id: string;
  position: number | null;
};

type MigrationClient = Pick<PoolClient, "query">;

const migrationLockName = "symposium:database-migrations:v1";
const migrationIdPattern = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const migrationChecksum = (migration: Migration) =>
  createHash("sha256").update(migration.sql, "utf8").digest("hex");

export const validateMigrationPlan = (migrations: readonly Migration[]) => {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (!migrationIdPattern.test(migration.id)) {
      throw new Error(`Invalid migration id "${migration.id}".`);
    }
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id "${migration.id}".`);
    }
    if (!migration.sql.trim()) {
      throw new Error(`Migration "${migration.id}" has no SQL.`);
    }
    seen.add(migration.id);
  }
};

export const inspectMigrationHistory = (
  migrations: readonly Migration[],
  rows: readonly AppliedMigrationRow[]
) => {
  validateMigrationPlan(migrations);
  const planById = new Map(
    migrations.map((migration, index) => [
      migration.id,
      {
        checksum: migrationChecksum(migration),
        position: index + 1
      }
    ])
  );
  const applied = new Set<string>();
  const metadataBackfill: Array<{ checksum: string; id: string; position: number }> = [];

  for (const row of rows) {
    const expected = planById.get(row.id);
    if (!expected) continue;
    if (applied.has(row.id)) {
      throw new Error(`Duplicate applied migration id "${row.id}".`);
    }
    applied.add(row.id);
    if (row.checksum !== null && row.checksum !== expected.checksum) {
      throw new Error(
        `Migration checksum drift detected for "${row.id}". Historical migration SQL is immutable.`
      );
    }
    if (row.position !== null && Number(row.position) !== expected.position) {
      throw new Error(
        `Migration order drift detected for "${row.id}": expected position ${expected.position}, found ${row.position}.`
      );
    }
    if (row.checksum === null || row.position === null) {
      metadataBackfill.push({ id: row.id, ...expected });
    }
  }

  return { applied, metadataBackfill };
};

export const applyMigrationPlan = async (
  client: MigrationClient,
  migrations: readonly Migration[]
) => {
  validateMigrationPlan(migrations);
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [migrationLockName]
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS symposium_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT,
      position INTEGER,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    ALTER TABLE symposium_migrations
      ADD COLUMN IF NOT EXISTS checksum TEXT,
      ADD COLUMN IF NOT EXISTS position INTEGER
  `);

  const ids = migrations.map((migration) => migration.id);
  const history = ids.length
    ? await client.query<AppliedMigrationRow & QueryResultRow>(
        `SELECT id, checksum, position
         FROM symposium_migrations
         WHERE id = ANY($1::text[])`,
        [ids]
      )
    : { rows: [] as AppliedMigrationRow[] };
  const { applied, metadataBackfill } = inspectMigrationHistory(migrations, history.rows);

  for (const migration of metadataBackfill) {
    await client.query(
      `UPDATE symposium_migrations
       SET checksum = COALESCE(checksum, $2),
           position = COALESCE(position, $3)
       WHERE id = $1`,
      [migration.id, migration.checksum, migration.position]
    );
  }
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS symposium_migrations_position_idx
      ON symposium_migrations (position)
      WHERE position IS NOT NULL
  `);

  const appliedNow: string[] = [];
  for (const [index, migration] of migrations.entries()) {
    if (applied.has(migration.id)) continue;
    const checksum = migrationChecksum(migration);
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO symposium_migrations (id, checksum, position)
       VALUES ($1, $2, $3)`,
      [migration.id, checksum, index + 1]
    );
    appliedNow.push(migration.id);
  }
  return { appliedNow, metadataBackfill: metadataBackfill.map(({ id }) => id) };
};

export const runMigrationTransaction = async (
  client: MigrationClient,
  migrations: readonly Migration[]
) => {
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await applyMigrationPlan(client, migrations);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Migration failed and its transaction could not be rolled back cleanly."
        );
      }
    }
    throw error;
  }
};
