import { jsonError } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { listLocalCommunityMembers } from "@/lib/localCommunityStore";
import { communityMemberQuerySchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const parsed = communityMemberQuerySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    role: url.searchParams.get("role") ?? "all"
  });
  if (!parsed.success) return jsonError("Choose a valid member search.", 400);
  const actorHandle = url.searchParams.get("actorHandle") ?? undefined;
  const search = new URLSearchParams({ q: parsed.data.q, limit: String(parsed.data.limit), role: parsed.data.role });
  if (parsed.data.cursor) search.set("cursor", parsed.data.cursor);
  const live = await proxyLiveBackend(`/v1/communities/${encodeURIComponent(id)}/members?${search}`, { actorHandle });
  if (live) return live;
  try {
    return Response.json(await listLocalCommunityMembers(id, actorHandle, parsed.data));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Community members are unavailable.", 403);
  }
}
