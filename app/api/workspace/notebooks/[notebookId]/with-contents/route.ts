import { deleteLocalWorkspaceNotebookWithContents } from "@/lib/localWorkspaceStore";
import { workspaceMutation } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ notebookId: string }> };

export const DELETE = async (request: Request, context: Context) => {
  const { notebookId } = await context.params;
  return workspaceMutation(request, (payload, actorHandle) =>
    deleteLocalWorkspaceNotebookWithContents(notebookId, payload, actorHandle)
  );
};
