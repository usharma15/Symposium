import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { removeLocalCommunityMember, updateLocalCommunityMember } from "@/lib/localCommunityStore";
import { removeCommunityMemberInputSchema, updateCommunityMemberInputSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; handle: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id, handle } = await context.params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const parsed = updateCommunityMemberInputSchema.safeParse({ ...body, communityId: id, memberHandle: handle });
  if (!parsed.success) return jsonError("Choose member or moderator and include the current community revision.", 400);
  const actorHandle = typeof body.actorHandle === "string" ? body.actorHandle : "";
  const live = await proxyLiveBackend(`/v1/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(handle)}`, {
    method: "PATCH",
    body: parsed.data,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  if (!actorHandle) return jsonError("Choose a profile before managing members.", 401);
  try {
    return Response.json(await updateLocalCommunityMember(parsed.data, actorHandle));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Member role could not be changed.";
    return jsonError(message, message.includes("changed after") ? 409 : message.includes("not found") ? 404 : 403);
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id, handle } = await context.params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const parsed = removeCommunityMemberInputSchema.safeParse({ ...body, communityId: id, memberHandle: handle });
  if (!parsed.success) return jsonError("Include the current community revision.", 400);
  const actorHandle = typeof body.actorHandle === "string" ? body.actorHandle : "";
  const live = await proxyLiveBackend(`/v1/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(handle)}`, {
    method: "DELETE",
    body: parsed.data,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  if (!actorHandle) return jsonError("Choose a profile before managing members.", 401);
  try {
    return Response.json(await removeLocalCommunityMember(parsed.data, actorHandle));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Member could not be removed.";
    return jsonError(message, message.includes("changed after") ? 409 : message.includes("not found") ? 404 : 403);
  }
}
