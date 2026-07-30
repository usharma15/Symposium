import { proxyLiveApiRequest } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorHandle = new URL(request.url).searchParams.get("actorHandle") ?? undefined;
  const live = await proxyLiveApiRequest(request, { actorHandle });
  if (live) return live;

  return Response.json({ following: [], followers: [] });
}
