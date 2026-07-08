import { proxyLiveBackendStream } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const heartbeatStream = (cursor: string | null, signal: AbortSignal) => {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  return new ReadableStream({
    start(controller) {
      const cleanup = () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      };
      const close = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // The stream may already be closed by the client disconnecting.
        }
      };
      const enqueue = (message: string) => {
        if (closed || signal.aborted) {
          close();
          return;
        }

        try {
          controller.enqueue(encoder.encode(message));
        } catch {
          close();
        }
      };

      signal.addEventListener("abort", close, { once: true });
      enqueue("retry: 2000\n\n");
      enqueue(`event: symposium-ready\ndata: ${JSON.stringify({ ok: true, cursor })}\n\n`);
      heartbeat = setInterval(() => {
        enqueue(
          `event: symposium-heartbeat\ndata: ${JSON.stringify({
            ok: true,
            cursor,
            time: new Date().toISOString()
          })}\n\n`
        );
      }, 15000);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    }
  });
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lastEventId = request.headers.get("last-event-id");
  if (lastEventId && !url.searchParams.has("cursor")) {
    url.searchParams.set("cursor", lastEventId);
  }
  const query = url.searchParams.toString();
  const live = await proxyLiveBackendStream(`/v1/events/stream${query ? `?${query}` : ""}`);
  if (live) return live;

  return new Response(heartbeatStream(url.searchParams.get("cursor"), request.signal), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
