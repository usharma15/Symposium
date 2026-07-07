import { deleteComment, updateComment, type UpdateCommentInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string; commentId: string }>;
};

export async function PATCH(request: Request, context: Context) {
  const { id, commentId } = await context.params;
  const body = await readJson<Partial<UpdateCommentInput> & { actorHandle?: string }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const input: UpdateCommentInput = {
    body: String(body.body ?? "").trim()
  };

  if (!input.body) {
    return jsonError("Comment body is required.", 400);
  }

  const actorHandle = body.actorHandle ? String(body.actorHandle) : undefined;
  const live = await proxyLiveBackend(`/v1/posts/${id}/comments/${commentId}`, {
    method: "PATCH",
    body: { ...input, actorHandle },
    actorHandle
  });
  if (live) return live;

  const item = await updateComment(id, commentId, input, actorHandle ?? "");
  if (!item) {
    return jsonError("Comment not found or cannot be edited by this profile.", 404);
  }

  return Response.json({ item });
}

export async function DELETE(request: Request, context: Context) {
  const { id, commentId } = await context.params;
  const body = await readJson<{ actorHandle?: string }>(request);
  const actorHandle = body?.actorHandle ? String(body.actorHandle) : undefined;

  const live = await proxyLiveBackend(`/v1/posts/${id}/comments/${commentId}`, {
    method: "DELETE",
    body: { actorHandle },
    actorHandle
  });
  if (live) return live;

  const item = await deleteComment(id, commentId, actorHandle ?? "");
  if (!item) {
    return jsonError("Comment not found or cannot be deleted by this profile.", 404);
  }

  return Response.json({ item, deleted: { id: commentId } });
}
