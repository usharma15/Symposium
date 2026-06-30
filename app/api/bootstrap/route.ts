import { getSnapshot } from "@/lib/dataStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { profile, researchCommunities } from "@/lib/mockData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const live = await proxyLiveBackend("/v1/bootstrap");
  if (live) return live;

  const snapshot = await getSnapshot();
  return Response.json({
    ...snapshot,
    communities: researchCommunities,
    defaultProfile: profile
  });
}
