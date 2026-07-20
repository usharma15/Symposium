import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const live = await proxyLiveBackend("/v1/assistant/quota", {
    actorHandle: workspaceActorHandle(request)
  });
  if (live) return live;
  return Response.json(
    { error: "The AI Tablet quota requires the cost-controlled live backend." },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
