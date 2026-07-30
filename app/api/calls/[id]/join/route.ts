import { jsonError, readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { joinLocalCommunityCall } from "@/lib/localCommunityStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<{ actorHandle?: string }>(request);
  const actorHandle = body?.actorHandle ?? "";
  if (!actorHandle) return jsonError("Choose a profile before joining a call.", 401);
  const live = await proxyLiveApiRequest(request, {
    body: {},
    actorHandle
  });
  if (live) return live;
  try {
    return Response.json({ call: await joinLocalCommunityCall(id, actorHandle), status: "joined" });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Call could not be joined.", 403);
  }
}
