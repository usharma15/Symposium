import type { NextRequest } from "next/server";
import { getSnapshot } from "@/lib/dataStore";
import { cleanHandle } from "@/lib/symposiumCore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { publicResearchProfile } from "@/lib/publicProfile";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ handle: string }> }
) {
  const { handle } = await context.params;
  const normalizedHandle = cleanHandle(decodeURIComponent(handle));
  const live = await proxyLiveBackend(`/v1/profiles/${encodeURIComponent(normalizedHandle)}`);
  if (live) return live;

  const profile = (await getSnapshot()).profiles[normalizedHandle];
  if (!profile) return Response.json({ error: "Profile not found." }, { status: 404 });
  return Response.json({ profile: publicResearchProfile(profile) });
}
