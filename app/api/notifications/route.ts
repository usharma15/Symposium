import { proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  proxyMessageRequest(request, {
    localFallback: { notifications: [], unreadCount: 0, nextCursor: null }
  });
