import { applyPostAction, getSnapshot } from "@/lib/localPreviewStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { localCommunityReadAllowed } from "@/lib/localCommunityAuthorization";
import type { PostAction } from "@/lib/symposiumCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

const actions: PostAction[] = ["signal", "save", "fork", "read"];

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<{ action?: string; actorHandle?: string; active?: boolean; trigger?: string; surface?: string }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const action = String(body.action ?? "");

  if (!actions.includes(action as PostAction)) {
    return jsonError("Unknown post action.", 400);
  }
  const typedAction = action as PostAction;

  const live = await proxyLiveApiRequest(request, {
    body,
    actorHandle: body.actorHandle ? String(body.actorHandle) : undefined,
    sourcePath: `/api/posts/${encodeURIComponent(id)}/actions`
  });
  if (live) return live;

  const actorHandle = String(body.actorHandle ?? "@udayan");
  const existing = (await getSnapshot()).items.find((item) => item.id === id);
  if (!existing || !(await localCommunityReadAllowed(existing, actorHandle))) return jsonError("Post not found.", 404);
  const result = await applyPostAction(
    id,
    typedAction,
    actorHandle,
    body.active,
    body.trigger,
    body.surface
  );

  if (!result) {
    return jsonError("Post not found.", 404);
  }

  return Response.json(result);
}
