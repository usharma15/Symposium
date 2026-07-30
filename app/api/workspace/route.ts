import { getLocalWorkspace } from "@/lib/localWorkspaceStore";
import { workspaceRead } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return workspaceRead(request, getLocalWorkspace);
}
