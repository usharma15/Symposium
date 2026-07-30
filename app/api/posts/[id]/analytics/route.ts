import { proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, _context: Context) {
  return proxyMessageRequest(request);
}
