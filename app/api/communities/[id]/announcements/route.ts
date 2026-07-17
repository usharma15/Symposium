import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { createLocalCommunityAnnouncement } from "@/lib/localCommunityStore";
import { createCommunityAnnouncementInputSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const parsed = createCommunityAnnouncementInputSchema.safeParse({ ...body, communityId: id });
  if (!parsed.success) return jsonError("Add an announcement title, message, and current community revision.", 400);
  const actorHandle = typeof body.actorHandle === "string" ? body.actorHandle : "";
  const live = await proxyLiveBackend(`/v1/communities/${encodeURIComponent(id)}/announcements`, {
    method: "POST",
    body: parsed.data,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  if (!actorHandle) return jsonError("Choose a profile before publishing an announcement.", 401);
  try {
    return Response.json(await createLocalCommunityAnnouncement(parsed.data, actorHandle));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Announcement could not be published.";
    return jsonError(message, message.includes("changed after") ? 409 : message.includes("not found") ? 404 : 403);
  }
}
