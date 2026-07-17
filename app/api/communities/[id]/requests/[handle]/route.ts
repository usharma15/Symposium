import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { resolveLocalCommunityRequest } from "@/lib/localCommunityStore";
import { resolveCommunityRequestInputSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; handle: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id, handle } = await context.params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const parsed = resolveCommunityRequestInputSchema.safeParse({ ...body, communityId: id, memberHandle: handle });
  if (!parsed.success) return jsonError("Choose approve or decline and include the current community revision.", 400);
  const actorHandle = typeof body.actorHandle === "string" ? body.actorHandle : "";
  const live = await proxyLiveBackend(`/v1/communities/${encodeURIComponent(id)}/requests/${encodeURIComponent(handle)}`, {
    method: "PATCH",
    body: parsed.data,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  if (!actorHandle) return jsonError("Choose a profile before reviewing requests.", 401);
  try {
    return Response.json(await resolveLocalCommunityRequest(parsed.data, actorHandle));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Join request could not be updated.";
    return jsonError(message, message.includes("changed after") ? 409 : message.includes("not found") ? 404 : 403);
  }
}
