import { deleteLocalWorkspaceNotebook, updateLocalWorkspaceNotebook } from "@/lib/localWorkspaceStore";
import { workspaceMutation } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ notebookId: string }> };

const mutation = async (request: Request, context: Context, method: "PATCH" | "DELETE") => {
  const { notebookId } = await context.params;
  return workspaceMutation(request, (payload, actorHandle) =>
    method === "PATCH"
      ? updateLocalWorkspaceNotebook(notebookId, payload, actorHandle)
      : deleteLocalWorkspaceNotebook(notebookId, payload, actorHandle)
  );
};

export const PATCH = (request: Request, context: Context) => mutation(request, context, "PATCH");
export const DELETE = (request: Request, context: Context) => mutation(request, context, "DELETE");
