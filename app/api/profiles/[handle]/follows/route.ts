import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { cleanHandle } from "@/lib/symposiumCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ handle: string }>;
};

export async function GET(request: Request, context: Context) {
  const { handle } = await context.params;
  const targetHandle = cleanHandle(decodeURIComponent(handle));
  const live = await proxyLiveApiRequest(request, {
    sourcePath: `/api/profiles/${encodeURIComponent(targetHandle)}/follows`
  });
  if (live) return live;

  return Response.json({ following: [], followers: [] });
}
