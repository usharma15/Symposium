import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { getLocalWorkspace } from "@/lib/localWorkspaceStore";
import { privateWorkspaceResponse, workspaceActorHandle, workspaceRouteError } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveBackend("/v1/workspace", { actorHandle });
  if (live) return live;
  try {
    return privateWorkspaceResponse(await getLocalWorkspace(actorHandle));
  } catch (error) {
    return workspaceRouteError(error);
  }
}
