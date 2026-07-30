import { deleteLocalWorkspaceDocument, updateLocalWorkspaceDocument } from "@/lib/localWorkspaceStore";
import { workspaceMutation } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ noteId: string }> };

const mutation = async (request: Request, context: Context, method: "PATCH" | "DELETE") => {
  const { noteId } = await context.params;
  return workspaceMutation(request, (payload, actorHandle) =>
    method === "PATCH"
      ? updateLocalWorkspaceDocument(noteId, payload, actorHandle)
      : deleteLocalWorkspaceDocument(noteId, payload, actorHandle)
  );
};

export const PATCH = (request: Request, context: Context) => mutation(request, context, "PATCH");
export const DELETE = (request: Request, context: Context) => mutation(request, context, "DELETE");
