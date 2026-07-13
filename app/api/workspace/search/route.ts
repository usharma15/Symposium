import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { searchLocalWorkspace } from "@/lib/localWorkspaceStore";
import { privateWorkspaceResponse, workspaceActorHandle, workspaceRouteError } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const actorHandle = workspaceActorHandle(request);
  url.searchParams.delete("actorHandle");
  const query = url.searchParams.toString();
  const live = await proxyLiveBackend(`/v1/workspace/search?${query}`, { actorHandle });
  if (live) return live;
  try {
    return privateWorkspaceResponse(await searchLocalWorkspace(Object.fromEntries(url.searchParams), actorHandle));
  } catch (error) {
    return workspaceRouteError(error);
  }
}
