import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { deleteLocalCommunityAnnouncement, updateLocalCommunityAnnouncement } from "@/lib/localCommunityStore";
import { deleteCommunityAnnouncementInputSchema, updateCommunityAnnouncementInputSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; announcementId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id, announcementId } = await context.params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const parsed = updateCommunityAnnouncementInputSchema.safeParse({ ...body, communityId: id, announcementId });
  if (!parsed.success) return jsonError("Add an announcement title, message, and current community revision.", 400);
  const actorHandle = typeof body.actorHandle === "string" ? body.actorHandle : "";
  const live = await proxyLiveBackend(`/v1/communities/${encodeURIComponent(id)}/announcements/${encodeURIComponent(announcementId)}`, {
    method: "PATCH",
    body: parsed.data,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  if (!actorHandle) return jsonError("Choose a profile before editing an announcement.", 401);
  try {
    return Response.json(await updateLocalCommunityAnnouncement(parsed.data, actorHandle));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Announcement could not be edited.";
    return jsonError(message, message.includes("changed after") ? 409 : message.includes("not found") ? 404 : 403);
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id, announcementId } = await context.params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const parsed = deleteCommunityAnnouncementInputSchema.safeParse({ ...body, communityId: id, announcementId });
  if (!parsed.success) return jsonError("Include the current community revision.", 400);
  const actorHandle = typeof body.actorHandle === "string" ? body.actorHandle : "";
  const live = await proxyLiveBackend(`/v1/communities/${encodeURIComponent(id)}/announcements/${encodeURIComponent(announcementId)}`, {
    method: "DELETE",
    body: parsed.data,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  if (!actorHandle) return jsonError("Choose a profile before deleting an announcement.", 401);
  try {
    return Response.json(await deleteLocalCommunityAnnouncement(parsed.data, actorHandle));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Announcement could not be deleted.";
    return jsonError(message, message.includes("changed after") ? 409 : message.includes("not found") ? 404 : 403);
  }
}
