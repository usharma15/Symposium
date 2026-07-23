import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveBackend(`/v1/assistant/conversations${new URL(request.url).search}`, {
    actorHandle
  });
  if (live) return live;
  return Response.json(
    { threads: [], nextCursor: null },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
