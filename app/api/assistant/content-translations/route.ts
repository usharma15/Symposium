import { readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson<Record<string, unknown> & { actorHandle?: string }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const payload = { ...body };
  delete payload.actorHandle;
  const live = await proxyLiveBackend("/v1/assistant/content-translations", {
    method: "POST",
    body: payload,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  return Response.json(
    { error: "Content translation requires the cost-controlled live backend." },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
