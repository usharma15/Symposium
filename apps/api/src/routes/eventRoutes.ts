import type { FastifyInstance } from "fastify";
import type { OutgoingHttpHeaders } from "node:http";
import { sendError } from "../http/errors";
import {
  eventIsAfterCursor,
  listEventsSince,
  parseEventCursor,
  type StoredLiveEvent
} from "../services/events";
import { subscribeLocalLiveEvents } from "../services/liveBus";
import { getActorFromRequest } from "../services/auth";
import { cleanHandle } from "@/lib/symposiumCore";

type EventQuery = {
  cursor?: string;
  limit?: string;
};

const limitFromQuery = (value?: string) => {
  const parsed = Number(value ?? 50);
  return Number.isFinite(parsed) ? parsed : 50;
};

const activeStreamsByClient = new Map<string, number>();
let activeStreamCount = 0;
const maxStreamsPerClient = 12;
const maxStreamsPerProcess = 500;
const replayPageSize = 100;
const maxReplayEventsPerConnection = 1000;

const acquireStream = (clientKey: string) => {
  const clientCount = activeStreamsByClient.get(clientKey) ?? 0;
  if (clientCount >= maxStreamsPerClient || activeStreamCount >= maxStreamsPerProcess) return false;
  activeStreamsByClient.set(clientKey, clientCount + 1);
  activeStreamCount += 1;
  return true;
};

const releaseStream = (clientKey: string) => {
  const clientCount = activeStreamsByClient.get(clientKey) ?? 0;
  if (clientCount <= 1) activeStreamsByClient.delete(clientKey);
  else activeStreamsByClient.set(clientKey, clientCount - 1);
  activeStreamCount = Math.max(0, activeStreamCount - 1);
};

export const registerEventRoutes = (app: FastifyInstance) => {
  app.addHook("onClose", () => {
    activeStreamsByClient.clear();
    activeStreamCount = 0;
  });

  app.get<{ Querystring: EventQuery }>("/v1/events", async (request, reply) => {
    try {
      if (request.query.cursor && !parseEventCursor(request.query.cursor)) {
        return reply.status(400).send({ error: "Invalid event cursor.", requestId: request.id });
      }
      const actor = await getActorFromRequest(request);
      const events = await listEventsSince(request.query.cursor, limitFromQuery(request.query.limit), actor.handle);
      const cursor = events.at(-1)?.cursor ?? request.query.cursor ?? null;
      return reply.send({ events, cursor });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Querystring: EventQuery }>("/v1/events/stream", async (request, reply) => {
    const lastEventId = request.headers["last-event-id"];
    let cursor = request.query.cursor ?? (Array.isArray(lastEventId) ? lastEventId[0] : lastEventId) ?? null;
    if (cursor && !parseEventCursor(cursor)) {
      return reply.status(400).send({ error: "Invalid event cursor.", requestId: request.id });
    }
    const actor = await getActorFromRequest(request);
    const actorHandle = actor.handle ? cleanHandle(actor.handle) : null;
    const clientKey = actorHandle ? `actor:${actorHandle}` : `ip:${request.ip}`;
    if (!acquireStream(clientKey)) {
      return reply.status(429).send({ error: "Too many live event streams.", requestId: request.id });
    }
    reply.hijack();

    const stream = reply.raw;
    let closed = false;
    let replaying = true;
    const pendingLiveEvents: StoredLiveEvent[] = [];

    const send = (eventName: string, data: unknown, id?: string) => {
      if (closed || stream.destroyed || stream.writableEnded) return false;
      try {
        const frame = `${id ? `id: ${id}\n` : ""}event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
        if (!stream.write(frame)) {
          stream.destroy();
          return false;
        }
        return true;
      } catch {
        stream.destroy();
        return false;
      }
    };

    const sendLiveEvent = (event: StoredLiveEvent) => {
      if (!eventIsAfterCursor(event, cursor)) return true;
      if (!send("symposium-event", event, event.cursor)) return false;
      cursor = event.cursor;
      return true;
    };

    const flushMissedEvents = async () => {
      let replayed = 0;
      const requestedPageSize = request.query.limit
        ? Math.max(25, limitFromQuery(request.query.limit))
        : replayPageSize;
      while (!closed && replayed < maxReplayEventsPerConnection) {
        const pageLimit = Math.min(
          replayPageSize,
          maxReplayEventsPerConnection - replayed,
          requestedPageSize
        );
        const events = await listEventsSince(cursor, pageLimit, actorHandle);
        for (const event of events) {
          if (!sendLiveEvent(event)) return false;
          replayed += 1;
        }
        if (events.length < pageLimit) return true;
      }
      if (!closed) stream.end();
      return false;
    };

    stream.socket?.setNoDelay(true);
    stream.writeHead(200, {
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Request-Id": request.id,
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no"
    });
    stream.flushHeaders();
    stream.write(`: ${" ".repeat(2048)}\nretry: 750\n\n`);

    const visibleToActor = (event: StoredLiveEvent) => {
      const visibility = event.visibility ?? "public";
      return visibility === "public" || Boolean(
        (visibility === "private" || visibility === "community") &&
        actorHandle &&
        (event.audienceHandles ?? []).some((handle) => cleanHandle(handle) === actorHandle)
      );
    };

    const unsubscribe = subscribeLocalLiveEvents((event) => {
      if (!visibleToActor(event)) return;
      if (replaying) {
        pendingLiveEvents.push(event);
        if (pendingLiveEvents.length > maxReplayEventsPerConnection) stream.destroy();
      } else {
        sendLiveEvent(event);
      }
    });
    const heartbeat = setInterval(() => {
      send("symposium-heartbeat", { ok: true, cursor, time: new Date().toISOString() });
    }, 15000);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      releaseStream(clientKey);
    };

    request.raw.on("close", cleanup);
    stream.on("error", cleanup);

    const replayComplete = await flushMissedEvents().catch((error) => {
      app.log.warn(error, "Could not send initial live events.");
      stream.destroy();
      return false;
    });
    if (!replayComplete || closed || stream.destroyed || stream.writableEnded) return;
    replaying = false;
    pendingLiveEvents.sort((left, right) => left.cursor.localeCompare(right.cursor));
    for (const event of pendingLiveEvents) {
      if (!sendLiveEvent(event)) return;
    }
    pendingLiveEvents.length = 0;
    send("symposium-ready", { ok: true, cursor });
  });
};
