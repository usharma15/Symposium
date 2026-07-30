import {
  deleteLocalWorkspaceComment,
  updateLocalWorkspaceComment
} from "@/lib/localWorkspaceCommentStore";
import { workspaceMutation } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ noteId: string; commentId: string }> };

const mutation = async (request: Request, context: Context, method: "PATCH" | "DELETE") => {
  const { noteId, commentId } = await context.params;
  return workspaceMutation(request, (payload, actorHandle) =>
    method === "PATCH"
      ? updateLocalWorkspaceComment(noteId, commentId, payload, actorHandle)
      : deleteLocalWorkspaceComment(noteId, commentId, payload, actorHandle)
  );
};

export const PATCH = (request: Request, context: Context) => mutation(request, context, "PATCH");
export const DELETE = (request: Request, context: Context) => mutation(request, context, "DELETE");
