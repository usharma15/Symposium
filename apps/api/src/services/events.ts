import { getPool, hasDatabase } from "../db/client";
import { getRedis } from "./redis";

export type LiveEvent = {
  kind: string;
  actorHandle?: string;
  subjectType: string;
  subjectId: string;
  visibility?: "public" | "private" | "community";
  payload?: Record<string, unknown>;
};

export const emitEvent = async (event: LiveEvent) => {
  if (hasDatabase()) {
    await getPool().query(
      `INSERT INTO events (kind, actor_handle, subject_type, subject_id, visibility, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.kind,
        event.actorHandle ?? null,
        event.subjectType,
        event.subjectId,
        event.visibility ?? "public",
        JSON.stringify(event.payload ?? {})
      ]
    );
  }

  const redis = getRedis();
  if (redis) {
    try {
      await redis.publish("symposium:events", event);
    } catch (error) {
      console.warn("SYMPOSIUM Redis event publish failed.", error);
    }
  }
};
