import { restoreLocalScribble } from "@/lib/localWorkspaceStore";
import { workspaceMutation } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return workspaceMutation(request, restoreLocalScribble);
}
