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
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const body = await readJson<{ action?: string; actorHandle?: string; active?: boolean; trigger?: string; surface?: string }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const action = String(body.action ?? "");

  if (!actions.includes(action as PostAction)) {
    return jsonError("Unknown post action.", 400);
  }
  const typedAction = action as PostAction;

  const live = await proxyLiveBackend(`/v1/posts/${id}/actions`, {
    method: "POST",
    body,
    actorHandle: body.actorHandle ? String(body.actorHandle) : undefined,
    idempotencyKey
  });
  if (live) return live;

  const actorHandle = String(body.actorHandle ?? "@udayan");
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
