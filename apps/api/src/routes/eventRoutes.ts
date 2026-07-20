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
const maxStreamsPerClient = 5;
const maxStreamsPerProcess = 500;

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
    const clientKey = request.ip;
    if (!acquireStream(clientKey)) {
      return reply.status(429).send({ error: "Too many live event streams.", requestId: request.id });
    }
    reply.hijack();

    const stream = reply.raw;
    let closed = false;

    const send = (eventName: string, data: unknown, id?: string) => {
      if (closed || stream.destroyed) return;
      if (stream.writableLength > 1024 * 1024) {
        stream.destroy();
        return;
      }
      try {
        if (id) stream.write(`id: ${id}\n`);
        stream.write(`event: ${eventName}\n`);
        stream.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        stream.destroy();
      }
    };

    const sendLiveEvent = (event: StoredLiveEvent) => {
      if (!eventIsAfterCursor(event, cursor)) return;
      cursor = event.cursor;
      send("symposium-event", event, event.cursor);
    };

    const flushMissedEvents = async () => {
      if (closed) return;
      const events = await listEventsSince(cursor, limitFromQuery(request.query.limit), actorHandle);
      for (const event of events) sendLiveEvent(event);
    };

    stream.writeHead(200, {
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Request-Id": request.id,
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no"
    });
    stream.write("retry: 2000\n\n");

    const unsubscribe = subscribeLocalLiveEvents((event) => {
      const visibility = event.visibility ?? "public";
      if (
        visibility !== "public" &&
        !(
          (visibility === "private" || visibility === "community") &&
          actorHandle &&
          (event.audienceHandles ?? []).some((handle) => cleanHandle(handle) === actorHandle)
        )
      ) {
        return;
      }
      sendLiveEvent(event);
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

    await flushMissedEvents().catch((error) => {
      app.log.warn(error, "Could not send initial live events.");
    });
    send("symposium-ready", { ok: true, cursor });
  });
};
