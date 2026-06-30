import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { cleanHandle } from "@/lib/symposiumCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ handle: string }>;
};

export async function GET(_request: Request, context: Context) {
  const { handle } = await context.params;
  const targetHandle = cleanHandle(decodeURIComponent(handle));
  const live = await proxyLiveBackend(`/v1/profiles/${encodeURIComponent(targetHandle)}/follows`);
  if (live) return live;

  return Response.json({ following: [], followers: [] });
}
