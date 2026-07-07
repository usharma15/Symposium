import { applyPostAction, type PostAction } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";

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

  const live = await proxyLiveBackend(`/v1/posts/${id}/actions`, {
    method: "POST",
    body,
    actorHandle: body.actorHandle ? String(body.actorHandle) : undefined
  });
  if (live) return live;

  const item = await applyPostAction(
    id,
    action as PostAction,
    String(body.actorHandle ?? "@udayan"),
    body.active,
    body.trigger,
    body.surface
  );

  if (!item) {
    return jsonError("Post not found.", 404);
  }

  return Response.json({ item });
}
