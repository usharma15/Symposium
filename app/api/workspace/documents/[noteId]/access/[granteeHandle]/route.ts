import { deleteLocalWorkspaceGrant, updateLocalWorkspaceGrant } from "@/lib/localWorkspaceStore";
import { workspaceMutation } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ noteId: string; granteeHandle: string }> };

const mutation = async (request: Request, context: Context, method: "PATCH" | "DELETE") => {
  const { noteId, granteeHandle } = await context.params;
  return workspaceMutation(
    request,
    (payload, actorHandle) => method === "PATCH"
      ? updateLocalWorkspaceGrant("document", noteId, granteeHandle, payload, actorHandle)
      : deleteLocalWorkspaceGrant("document", noteId, granteeHandle, payload, actorHandle)
  );
};

export const PATCH = (request: Request, context: Context) => mutation(request, context, "PATCH");
export const DELETE = (request: Request, context: Context) => mutation(request, context, "DELETE");
