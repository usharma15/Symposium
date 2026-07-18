import { messageRequestBody, proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await messageRequestBody(request);
  return proxyMessageRequest(request, "/v1/blocks", { method: "POST", body });
}
