import { proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  proxyMessageRequest(request, {
    localFallback: { unreadCount: 0 }
  });
