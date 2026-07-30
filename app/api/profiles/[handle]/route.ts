import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/dataStore";
import { cleanHandle } from "@/lib/symposiumCore";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { publicResearchProfile } from "@/lib/publicProfile";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ handle: string }> }
) {
  const { handle } = await context.params;
  const normalizedHandle = cleanHandle(decodeURIComponent(handle));
  const live = await proxyLiveApiRequest(request, {
    sourcePath: `/api/profiles/${encodeURIComponent(normalizedHandle)}`
  });
  if (live) return live;

  const profile = (await getSnapshot()).profiles[normalizedHandle];
  if (!profile) return Response.json({ error: "Profile not found." }, { status: 404 });
  return Response.json({ profile: publicResearchProfile(profile) });
}
