import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { liveBackendUnavailableResponse } from "@/lib/runtimeSafety";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

type MessageProxyOptions = {
  body?: unknown;
  localFallback?: unknown;
};

export const messageRequestBody = async (request: Request) =>
  request.json().catch(() => ({})) as Promise<Record<string, unknown>>;

export const proxyMessageRequest = async (
  request: Request,
  options: MessageProxyOptions = {}
) => {
  const body = options.body;
  const bodyActorHandle = body && typeof body === "object" && "actorHandle" in body
    ? String((body as { actorHandle?: unknown }).actorHandle ?? "")
    : undefined;
  const live = await proxyLiveApiRequest(request, {
    body,
    actorHandle: workspaceActorHandle(request, bodyActorHandle)
  });
  if (live) return live;
  if (options.localFallback !== undefined) {
    return Response.json(options.localFallback, {
      headers: { "Cache-Control": "private, no-store", "Vary": "Authorization, Cookie" }
    });
  }
  return liveBackendUnavailableResponse();
};
