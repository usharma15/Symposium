import { Pool, type PoolClient } from "pg";
import { databaseUrl, env } from "../config/env";
import { recordDatabaseQuery } from "../services/requestCosts";

let pool: Pool | null = null;
const instrumentedClient = Symbol("symposium.instrumented-pg-client");

const instrumentPoolClient = (client: PoolClient) => {
  const markedClient = client as PoolClient & { [instrumentedClient]?: boolean };
  if (markedClient[instrumentedClient]) return;
  markedClient[instrumentedClient] = true;
  const originalQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
  (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...rawArgs: unknown[]) => {
    const startedAt = performance.now();
    const args = [...rawArgs];
    const callback = args.at(-1);
    if (typeof callback === "function") {
      args[args.length - 1] = (error: unknown, result: unknown) => {
        recordDatabaseQuery(performance.now() - startedAt, Boolean(error));
        (callback as (nextError: unknown, nextResult: unknown) => void)(error, result);
      };
      return originalQuery(...args);
    }
    try {
      const result = originalQuery(...args);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        return Promise.resolve(result).then(
          (value) => {
            recordDatabaseQuery(performance.now() - startedAt);
            return value;
          },
          (error) => {
            recordDatabaseQuery(performance.now() - startedAt, true);
            throw error;
          }
        );
      }
      recordDatabaseQuery(performance.now() - startedAt);
      return result;
    } catch (error) {
      recordDatabaseQuery(performance.now() - startedAt, true);
      throw error;
    }
  };
};

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
    pool.on("connect", instrumentPoolClient);
  }

  return pool;
};

export const closeDb = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
