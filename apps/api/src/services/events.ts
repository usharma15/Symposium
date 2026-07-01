import { getPool, hasDatabase } from "../db/client";
import { randomUUID } from "node:crypto";
import { publishLocalLiveEvent } from "./liveBus";
import { getRedis } from "./redis";

export type LiveEvent = {
  kind: string;
  actorHandle?: string;
  subjectType: string;
  subjectId: string;
  visibility?: "public" | "private" | "community";
  payload?: Record<string, unknown>;
};

export type StoredLiveEvent = LiveEvent & {
  id: string;
  createdAt: string;
  cursor: string;
};

type EventRow = {
  id: string;
  kind: string;
  actorHandle: string | null;
  subjectType: string;
  subjectId: string;
  visibility: "public" | "private" | "community";
  payload: unknown;
  createdAt: Date | string;
};

const eventCursor = (createdAt: Date | string, id: string) => `${new Date(createdAt).toISOString()}::${id}`;

export const parseEventCursor = (cursor?: string | null) => {
  if (!cursor) return null;
  const [createdAt, id] = cursor.split("::");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
};

export const eventIsAfterCursor = (event: StoredLiveEvent, cursor?: string | null) => {
  const parsed = parseEventCursor(cursor);
  if (!parsed) return true;
  if (event.createdAt > parsed.createdAt) return true;
  return event.createdAt === parsed.createdAt && event.id > parsed.id;
};

const rowToEvent = (row: EventRow): StoredLiveEvent => ({
  id: row.id,
  kind: row.kind,
  actorHandle: row.actorHandle ?? undefined,
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  visibility: row.visibility,
  payload: typeof row.payload === "object" && row.payload !== null ? (row.payload as Record<string, unknown>) : {},
  createdAt: new Date(row.createdAt).toISOString(),
  cursor: eventCursor(row.createdAt, row.id)
});

export const listEventsSince = async (cursor?: string | null, limit = 50): Promise<StoredLiveEvent[]> => {
  if (!hasDatabase()) return [];

  const parsed = parseEventCursor(cursor);
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

  if (!parsed) {
    const latest = await getPool().query<EventRow>(
      `SELECT
         id::text,
         kind,
         actor_handle AS "actorHandle",
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         visibility,
         payload,
         created_at AS "createdAt"
       FROM events
       WHERE visibility = 'public'
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      [boundedLimit]
    );

    return latest.rows.reverse().map(rowToEvent);
  }

  const result = await getPool().query<EventRow>(
    `SELECT
       id::text,
       kind,
       actor_handle AS "actorHandle",
       subject_type AS "subjectType",
       subject_id AS "subjectId",
       visibility,
       payload,
       created_at AS "createdAt"
     FROM events
     WHERE visibility = 'public'
       AND (created_at, id::text) > ($1::timestamptz, $2::text)
     ORDER BY created_at ASC, id ASC
     LIMIT $3`,
    [parsed.createdAt, parsed.id, boundedLimit]
  );

  return result.rows.map(rowToEvent);
};

export const emitEvent = async (event: LiveEvent) => {
  let stored: StoredLiveEvent;

  if (hasDatabase()) {
    const result = await getPool().query<EventRow>(
      `INSERT INTO events (kind, actor_handle, subject_type, subject_id, visibility, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         id::text,
         kind,
         actor_handle AS "actorHandle",
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         visibility,
         payload,
         created_at AS "createdAt"`,
      [
        event.kind,
        event.actorHandle ?? null,
        event.subjectType,
        event.subjectId,
        event.visibility ?? "public",
        JSON.stringify(event.payload ?? {})
      ]
    );
    stored = rowToEvent(result.rows[0]);
  } else {
    const createdAt = new Date().toISOString();
    const id = randomUUID();
    stored = {
      ...event,
      id,
      visibility: event.visibility ?? "public",
      payload: event.payload ?? {},
      createdAt,
      cursor: eventCursor(createdAt, id)
    };
  }

  publishLocalLiveEvent(stored);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.publish("symposium:events", stored);
    } catch (error) {
      console.warn("SYMPOSIUM Redis event publish failed.", error);
    }
  }

  return stored;
};
