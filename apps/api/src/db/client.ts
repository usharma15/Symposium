import { Pool } from "pg";
import { databaseUrl, env } from "../config/env";

let pool: Pool | null = null;

export const hasDatabase = () => Boolean(databaseUrl);

export const getPool = () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL is required for the live backend.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: 10_000,
      ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")
        ? undefined
        : { rejectUnauthorized: false }
    });
  }

  return pool;
};

export const closeDb = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
