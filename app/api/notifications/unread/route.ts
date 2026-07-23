import { proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  proxyMessageRequest(request, `/v1/notifications/unread${new URL(request.url).search}`, {
    localFallback: { unreadCount: 0 }
  });
