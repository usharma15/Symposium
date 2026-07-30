import { getLocalScribble, updateLocalScribble } from "@/lib/localWorkspaceStore";
import { workspaceMutation, workspaceRead } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return workspaceRead(request, getLocalScribble);
}

export async function PATCH(request: Request) {
  return workspaceMutation(request, updateLocalScribble);
}
