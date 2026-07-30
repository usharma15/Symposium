import { createLocalWorkspaceGrant, getLocalWorkspaceAccess } from "@/lib/localWorkspaceStore";
import { workspaceMutation, workspaceRead } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ notebookId: string }> };

export async function GET(request: Request, context: Context) {
  const { notebookId } = await context.params;
  return workspaceRead(
    request,
    (actorHandle) => getLocalWorkspaceAccess("notebook", notebookId, actorHandle)
  );
}

export async function POST(request: Request, context: Context) {
  const { notebookId } = await context.params;
  return workspaceMutation(
    request,
    (payload, actorHandle) => createLocalWorkspaceGrant("notebook", notebookId, payload, actorHandle)
  );
}
