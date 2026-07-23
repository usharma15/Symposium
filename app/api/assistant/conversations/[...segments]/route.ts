import { readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ segments: string[] }> };

const livePath = async (request: Request, context: Context) => {
  const { segments } = await context.params;
  return `/v1/assistant/conversations/${segments.map(encodeURIComponent).join("/")}${new URL(request.url).search}`;
};

export async function GET(request: Request, context: Context) {
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveBackend(await livePath(request, context), { actorHandle });
  if (live) return live;
  return Response.json(
    { error: "Research threads require the cost-controlled live backend." },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request, context: Context) {
  const body = await readJson<Record<string, unknown> & { actorHandle?: string }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const payload = { ...body };
  delete payload.actorHandle;
  const live = await proxyLiveBackend(await livePath(request, context), {
    method: "POST",
    body: payload,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  return Response.json(
    { error: "Research threads require the cost-controlled live backend." },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
