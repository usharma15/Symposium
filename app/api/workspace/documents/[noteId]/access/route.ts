import { createLocalWorkspaceGrant, getLocalWorkspaceAccess } from "@/lib/localWorkspaceStore";
import { workspaceMutation, workspaceRead } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ noteId: string }> };

export async function GET(request: Request, context: Context) {
  const { noteId } = await context.params;
  return workspaceRead(
    request,
    (actorHandle) => getLocalWorkspaceAccess("document", noteId, actorHandle)
  );
}

export async function POST(request: Request, context: Context) {
  const { noteId } = await context.params;
  return workspaceMutation(
    request,
    (payload, actorHandle) => createLocalWorkspaceGrant("document", noteId, payload, actorHandle)
  );
}
