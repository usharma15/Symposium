import { jsonError, readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { createLocalCommunity, listLocalCommunities } from "@/lib/localCommunityStore";
import { createCommunityInputSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorHandle = new URL(request.url).searchParams.get("actorHandle") ?? undefined;
  const live = await proxyLiveApiRequest(request, {
    actorHandle
  });
  if (live) return live;
  return Response.json({ communities: await listLocalCommunities(actorHandle) });
}
export async function POST(request: Request) {
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return jsonError("Invalid JSON body.", 400);
  const parsed = createCommunityInputSchema.safeParse(body);
  if (!parsed.success) return jsonError("Add a name, field, short description, and visibility.", 400);
  const actorHandle = typeof body.actorHandle === "string" ? body.actorHandle : "";
  const live = await proxyLiveApiRequest(request, {
    body: parsed.data,
    actorHandle
  });
  if (live) return live;
  if (!actorHandle) return jsonError("Choose a profile before creating a community.", 401);
  return Response.json({ community: await createLocalCommunity(parsed.data, actorHandle) });
}
