import { applyLocalWorkspaceCommentAction } from "@/lib/localWorkspaceCommentStore";
import { workspaceMutation } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ noteId: string; commentId: string }> };

export async function POST(request: Request, context: Context) {
  const { noteId, commentId } = await context.params;
  return workspaceMutation(request, (payload, actorHandle) =>
    applyLocalWorkspaceCommentAction(noteId, commentId, payload, actorHandle)
  );
}
