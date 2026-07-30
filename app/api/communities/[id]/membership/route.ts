import { jsonError, readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { mutateLocalCommunityMembership } from "@/lib/localCommunityStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<{ action?: string; actorHandle?: string }>(request);
  const action = body?.action;
  const actorHandle = body?.actorHandle ?? "";
  if (action !== "join" && action !== "leave" && action !== "access") return jsonError("Choose a valid membership action.", 400);
  if (!actorHandle) return jsonError("Choose a profile before changing membership.", 401);
  const live = await proxyLiveApiRequest(request, {
    body: { action, actorHandle },
    actorHandle
  });
  if (live) return live;
  try {
    return Response.json(await mutateLocalCommunityMembership(id, actorHandle, action));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Membership could not be changed.", 403);
  }
}
