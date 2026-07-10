import type { PoolClient } from "pg";
import { getPool } from "../db/client";
import { publishStoredEvent, type StoredLiveEvent } from "./events";

export type AtomicResult<T> = {
  events?: StoredLiveEvent[];
  value: T;
};

export const runAtomic = async <T>(operation: (client: PoolClient) => Promise<AtomicResult<T>>) => {
  const client = await getPool().connect();
  let result: AtomicResult<T>;
  try {
    await client.query("BEGIN");
    result = await operation(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const event of result.events ?? []) await publishStoredEvent(event);
  return result.value;
};
