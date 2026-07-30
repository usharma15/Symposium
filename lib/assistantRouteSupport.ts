import { readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

type AssistantRequestBody = Record<string, unknown> & {
  actorHandle?: string;
};

const unavailableResponse = (body: unknown) =>
  Response.json(typeof body === "string" ? { error: body } : body, {
    status: 503,
    headers: { "Cache-Control": "no-store" }
  });

export const assistantReadRoute = (unavailableBody: unknown) =>
  async (request: Request) => {
    const live = await proxyLiveApiRequest(request, {
      actorHandle: workspaceActorHandle(request)
    });
    return live ?? unavailableResponse(unavailableBody);
  };

export const assistantMutationRoute = (unavailableBody: unknown) =>
  async (request: Request) => {
    const body = await readJson<AssistantRequestBody>(request);
    const live = await proxyLiveApiRequest(request, {
      actorHandle: workspaceActorHandle(request, body?.actorHandle),
      body: { ...body }
    });
    return live ?? unavailableResponse(unavailableBody);
  };
