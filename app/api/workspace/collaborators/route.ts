import { searchLocalWorkspaceCollaborators } from "@/lib/localWorkspaceStore";
import { workspaceRead } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return workspaceRead(
    request,
    (actorHandle) => searchLocalWorkspaceCollaborators(Object.fromEntries(url.searchParams), actorHandle),
    `${url.pathname}${url.search}`
  );
}
