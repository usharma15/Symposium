import { Pool, type PoolClient } from "pg";
import { databaseApplicationName, databaseUrl, env } from "../config/env";
import { currentRequestCost, recordDatabaseQuery } from "../services/requestCosts";

let pool: Pool | null = null;
const instrumentedClient = Symbol("symposium.instrumented-pg-client");
let lastConnectionOpenedAt: string | null = null;
let lastQueryAt: string | null = null;

const instrumentPoolClient = (client: PoolClient) => {
  const markedClient = client as PoolClient & { [instrumentedClient]?: boolean };
  if (markedClient[instrumentedClient]) return;
  markedClient[instrumentedClient] = true;
  lastConnectionOpenedAt = new Date().toISOString();
  const originalQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
  (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...rawArgs: unknown[]) => {
    lastQueryAt = new Date().toISOString();
    const startedAt = performance.now();
    const requestCost = currentRequestCost();
    const args = [...rawArgs];
    const callback = args.at(-1);
    if (typeof callback === "function") {
      args[args.length - 1] = (error: unknown, result: unknown) => {
        recordDatabaseQuery(performance.now() - startedAt, Boolean(error), requestCost);
        (callback as (nextError: unknown, nextResult: unknown) => void)(error, result);
      };
      return originalQuery(...args);
    }
    try {
      const result = originalQuery(...args);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        return Promise.resolve(result).then(
          (value) => {
            recordDatabaseQuery(performance.now() - startedAt, false, requestCost);
            return value;
          },
          (error) => {
            recordDatabaseQuery(performance.now() - startedAt, true, requestCost);
            throw error;
          }
        );
      }
      recordDatabaseQuery(performance.now() - startedAt, false, requestCost);
      return result;
    } catch (error) {
      recordDatabaseQuery(performance.now() - startedAt, true, requestCost);
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
      application_name: databaseApplicationName,
      ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")
        ? undefined
        : { rejectUnauthorized: false }
    });
    pool.on("connect", instrumentPoolClient);
  }

  return pool;
};

export const getDatabaseActivityStatus = () => ({
  applicationName: databaseApplicationName,
  poolCreated: Boolean(pool),
  connectionCount: pool?.totalCount ?? 0,
  idleConnectionCount: pool?.idleCount ?? 0,
  waitingRequestCount: pool?.waitingCount ?? 0,
  lastConnectionOpenedAt,
  lastQueryAt
});

export const closeDb = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
