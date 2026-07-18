import { proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => {
  const query = new URL(request.url).search;
  return proxyMessageRequest(request, `/v1/conversations${query}`, {
    localFallback: { conversations: [], nextCursor: null }
  });
};
