import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { listLocalCommunities, updateLocalCommunitySettings } from "@/lib/localCommunityStore";
import { updateCommunitySettingsInputSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const actorHandle = new URL(request.url).searchParams.get("actorHandle") ?? undefined;
  const live = await proxyLiveBackend(`/v1/communities/${encodeURIComponent(id)}`, { actorHandle });
  if (live) return live;
  const community = (await listLocalCommunities(actorHandle)).find((candidate) => candidate.id === id);
  return community ? Response.json({ community }) : jsonError("Community not found.", 404);
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const parsed = updateCommunitySettingsInputSchema.safeParse({ ...body, communityId: id });
  if (!parsed.success) return jsonError("Choose valid community settings and include the current revision.", 400);
  const actorHandle = typeof body.actorHandle === "string" ? body.actorHandle : "";
  const live = await proxyLiveBackend(`/v1/communities/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: parsed.data,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  if (!actorHandle) return jsonError("Choose a profile before changing community settings.", 401);
  try {
    return Response.json({ community: await updateLocalCommunitySettings(parsed.data, actorHandle) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Community settings could not be changed.";
    const status = message.includes("changed after") ? 409 : message.includes("Only community") ? 403 : message.includes("not found") ? 404 : 400;
    return jsonError(message, status);
  }
}
