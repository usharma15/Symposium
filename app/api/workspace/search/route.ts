import { searchLocalWorkspace } from "@/lib/localWorkspaceStore";
import { workspaceRead } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  url.searchParams.delete("actorHandle");
  const query = url.searchParams.toString();
  return workspaceRead(
    request,
    (actorHandle) => searchLocalWorkspace(Object.fromEntries(url.searchParams), actorHandle),
    `${url.pathname}${query ? `?${query}` : ""}`
  );
}
