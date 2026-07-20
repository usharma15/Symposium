import { getPool, hasDatabase } from "../db/client";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { publishLocalLiveEvent } from "./liveBus";

export type LiveEvent = {
  kind: string;
  actorHandle?: string;
  audienceHandles?: string[];
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
  audienceHandles: unknown;
  subjectType: string;
  subjectId: string;
  visibility: "public" | "private" | "community";
  payload: unknown;
  createdAt: Date | string;
};

const eventCursor = (createdAt: Date | string, id: string) => `${new Date(createdAt).toISOString()}::${id}`;

export const parseEventCursor = (cursor?: string | null) => {
  if (!cursor || cursor.length > 200) return null;
  const [createdAt, id] = cursor.split("::");
  if (
    !createdAt ||
    !id ||
    Number.isNaN(Date.parse(createdAt)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    return null;
  }
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
  audienceHandles: Array.isArray(row.audienceHandles)
    ? row.audienceHandles.filter((handle): handle is string => typeof handle === "string")
    : [],
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  visibility: row.visibility,
  payload: typeof row.payload === "object" && row.payload !== null ? (row.payload as Record<string, unknown>) : {},
  createdAt: new Date(row.createdAt).toISOString(),
  cursor: eventCursor(row.createdAt, row.id)
});

const insertStoredEvent = async (queryable: Pick<PoolClient, "query">, event: LiveEvent) => {
  const result = await queryable.query<EventRow>(
    `INSERT INTO events (kind, actor_handle, audience_handles, subject_type, subject_id, visibility, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id::text,
       kind,
       actor_handle AS "actorHandle",
       audience_handles AS "audienceHandles",
       subject_type AS "subjectType",
       subject_id AS "subjectId",
       visibility,
       payload,
       created_at AS "createdAt"`,
    [
      event.kind,
      event.actorHandle ?? null,
      JSON.stringify(
        event.audienceHandles ??
          ((event.visibility ?? "public") === "private" && event.actorHandle ? [event.actorHandle] : [])
      ),
      event.subjectType,
      event.subjectId,
      event.visibility ?? "public",
      JSON.stringify(event.payload ?? {})
    ]
  );
  const stored = rowToEvent(result.rows[0]);
  return stored;
};

export const stageEvent = (client: PoolClient, event: LiveEvent) => insertStoredEvent(client, event);

export const publishStoredEvent = async (stored: StoredLiveEvent) => {
  try {
    publishLocalLiveEvent(stored);
  } catch (error) {
    console.warn("SYMPOSIUM local event publish failed; cursor-based replay will recover it on reconnect.", error);
  }

  return stored;
};

export const listEventsSince = async (
  cursor?: string | null,
  limit = 50,
  actorHandle?: string | null
): Promise<StoredLiveEvent[]> => {
  if (!hasDatabase()) return [];

  const parsed = parseEventCursor(cursor);
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

  if (!parsed) {
    const latest = await getPool().query<EventRow>(
      `SELECT
         id::text,
         kind,
         actor_handle AS "actorHandle",
         audience_handles AS "audienceHandles",
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         visibility,
         payload,
         created_at AS "createdAt"
       FROM events
       WHERE visibility = 'public'
          OR (visibility IN ('private', 'community') AND audience_handles ? $1)
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [actorHandle ?? null, boundedLimit]
    );

    return latest.rows.reverse().map(rowToEvent);
  }

  const result = await getPool().query<EventRow>(
    `SELECT
       id::text,
       kind,
       actor_handle AS "actorHandle",
       audience_handles AS "audienceHandles",
       subject_type AS "subjectType",
       subject_id AS "subjectId",
       visibility,
       payload,
       created_at AS "createdAt"
     FROM events
     WHERE (visibility = 'public' OR (visibility IN ('private', 'community') AND audience_handles ? $1))
       AND (created_at, id::text) > ($2::timestamptz, $3::text)
     ORDER BY created_at ASC, id ASC
     LIMIT $4`,
    [actorHandle ?? null, parsed.createdAt, parsed.id, boundedLimit]
  );

  return result.rows.map(rowToEvent);
};

export const emitEvent = async (event: LiveEvent) => {
  let stored: StoredLiveEvent;

  if (hasDatabase()) {
    stored = await insertStoredEvent(getPool(), event);
  } else {
    const createdAt = new Date().toISOString();
    const id = randomUUID();
    stored = {
      ...event,
      id,
      audienceHandles:
        event.audienceHandles ??
        ((event.visibility ?? "public") === "private" && event.actorHandle ? [event.actorHandle] : []),
      visibility: event.visibility ?? "public",
      payload: event.payload ?? {},
      createdAt,
      cursor: eventCursor(createdAt, id)
    };
  }

  return publishStoredEvent(stored);
};
