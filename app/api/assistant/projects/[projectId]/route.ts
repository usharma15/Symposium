import { readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ projectId: string }>;
};

const mutateProject = async (
  request: Request,
  context: Context,
  method: "PATCH" | "DELETE"
) => {
  const { projectId } = await context.params;
  const body = await readJson<Record<string, unknown> & {
    actorHandle?: string;
  }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const payload = { ...body };
  delete payload.actorHandle;
  const live = await proxyLiveBackend(
    `/v1/assistant/projects/${encodeURIComponent(projectId)}`,
    {
      method,
      body: payload,
      actorHandle,
      idempotencyKey:
        request.headers.get("Idempotency-Key") ?? undefined
    }
  );
  if (live) return live;
  return Response.json(
    { error: "Assistant Projects require the live backend." },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    }
  );
};

export const PATCH = (request: Request, context: Context) =>
  mutateProject(request, context, "PATCH");

export const DELETE = (request: Request, context: Context) =>
  mutateProject(request, context, "DELETE");
