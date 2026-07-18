import { proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  proxyMessageRequest(request, `/v1/notifications${new URL(request.url).search}`, {
    localFallback: { notifications: [], unreadCount: 0, nextCursor: null }
  });
