import { messageRequestBody, proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ segments: string[] }> };

export async function GET(request: Request, _context: Context) {
  return proxyMessageRequest(request);
}

export async function POST(request: Request, _context: Context) {
  const body = await messageRequestBody(request);
  return proxyMessageRequest(request, { body });
}

export async function PATCH(request: Request, _context: Context) {
  const body = await messageRequestBody(request);
  return proxyMessageRequest(request, { body });
}

export async function DELETE(request: Request, _context: Context) {
  const body = await messageRequestBody(request);
  return proxyMessageRequest(request, { body });
}
