import { messageRequestBody, proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ segments: string[] }> };

const livePath = async (request: Request, context: Context) => {
  const { segments } = await context.params;
  const path = segments.map(encodeURIComponent).join("/");
  return `/v1/conversations/${path}${new URL(request.url).search}`;
};

export async function GET(request: Request, context: Context) {
  return proxyMessageRequest(request, await livePath(request, context));
}

export async function POST(request: Request, context: Context) {
  const body = await messageRequestBody(request);
  return proxyMessageRequest(request, await livePath(request, context), { method: "POST", body });
}

export async function PATCH(request: Request, context: Context) {
  const body = await messageRequestBody(request);
  return proxyMessageRequest(request, await livePath(request, context), { method: "PATCH", body });
}

export async function DELETE(request: Request, context: Context) {
  const body = await messageRequestBody(request);
  return proxyMessageRequest(request, await livePath(request, context), { method: "DELETE", body });
}
