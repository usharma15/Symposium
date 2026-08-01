import { proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => {
  return proxyMessageRequest(request, {
    localFallback: { unreadCount: 0 }
  });
};
