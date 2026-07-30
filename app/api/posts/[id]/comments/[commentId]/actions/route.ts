import { applyCommentAction, getSnapshot, type CommentAction } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { localCommunityReadAllowed } from "@/lib/localCommunityAuthorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string; commentId: string }>;
};

const actions: CommentAction[] = ["signal", "save", "fork", "read"];

export async function POST(request: Request, context: Context) {
  const { id, commentId } = await context.params;
  const body = await readJson<{ action?: string; actorHandle?: string; active?: boolean; trigger?: string; surface?: string }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const action = String(body.action ?? "");
  if (!actions.includes(action as CommentAction)) {
    return jsonError("Unknown comment action.", 400);
  }
  const typedAction = action as CommentAction;

  const actorHandle = body.actorHandle ? String(body.actorHandle) : undefined;
  const live = await proxyLiveApiRequest(request, {
    body,
    actorHandle,
    sourcePath: `/api/posts/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}/actions`
  });
  if (live) return live;

  const existing = (await getSnapshot()).items.find((item) => item.id === id);
  if (!existing || !(await localCommunityReadAllowed(existing, actorHandle ?? "@udayan"))) return jsonError("Comment not found.", 404);

  const result = await applyCommentAction(
    id,
    commentId,
    typedAction,
    actorHandle ?? "@udayan",
    body.active,
    body.trigger,
    body.surface
  );
  if (!result) {
    return jsonError("Comment not found.", 404);
  }

  return Response.json(result);
}
