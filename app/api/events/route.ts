import { proxyLiveApiRequest } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const live = await proxyLiveApiRequest(request);
  if (live) return live;

  return Response.json({ events: [], cursor: url.searchParams.get("cursor") });
}
