import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { searchLocalWorkspaceCollaborators } from "@/lib/localWorkspaceStore";
import { privateWorkspaceResponse, workspaceActorHandle, workspaceRouteError } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorHandle = workspaceActorHandle(request);
  const query = new URL(request.url).searchParams;
  const live = await proxyLiveBackend(`/v1/workspace/collaborators?${query.toString()}`, { actorHandle });
  if (live) return live;
  try {
    return privateWorkspaceResponse(await searchLocalWorkspaceCollaborators(Object.fromEntries(query), actorHandle));
  } catch (error) {
    return workspaceRouteError(error);
  }
}
