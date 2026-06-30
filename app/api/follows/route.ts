import { proxyLiveBackend } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const live = await proxyLiveBackend("/v1/follows");
  if (live) return live;

  return Response.json({ following: [], followers: [] });
}
