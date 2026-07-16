import { jsonError } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { listLocalOpportunityApplications, LocalOpportunityApplicationError } from "@/lib/localOpportunityApplicationStore";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveBackend(`/v1/posts/${encodeURIComponent(id)}/opportunity/applications`, { actorHandle });
  if (live) return live;
  try { return Response.json({ applications: await listLocalOpportunityApplications(id, actorHandle) }); }
  catch (error) {
    if (error instanceof LocalOpportunityApplicationError) return jsonError(error.message, error.status);
    throw error;
  }
}
