import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { liveBackendUnavailableResponse } from "@/lib/runtimeSafety";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

type MessageProxyOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  localFallback?: unknown;
};

export const messageRequestBody = async (request: Request) =>
  request.json().catch(() => ({})) as Promise<Record<string, unknown>>;

export const proxyMessageRequest = async (
  request: Request,
  livePath: string,
  options: MessageProxyOptions = {}
) => {
  const body = options.body;
  const bodyActorHandle = body && typeof body === "object" && "actorHandle" in body
    ? String((body as { actorHandle?: unknown }).actorHandle ?? "")
    : undefined;
  const live = await proxyLiveBackend(livePath, {
    method: options.method,
    body,
    actorHandle: workspaceActorHandle(request, bodyActorHandle),
    idempotencyKey: request.headers.get("idempotency-key") ?? undefined
  });
  if (live) return live;
  if (options.localFallback !== undefined) {
    return Response.json(options.localFallback, {
      headers: { "Cache-Control": "private, no-store", "Vary": "Authorization, Cookie" }
    });
  }
  return liveBackendUnavailableResponse();
};
