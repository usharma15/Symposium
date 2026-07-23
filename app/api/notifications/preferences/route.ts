import { messageRequestBody, proxyMessageRequest } from "@/lib/messageRouteSupport";
import { defaultNotificationPreferences } from "@/apps/api/src/services/notificationAggregation";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  proxyMessageRequest(request, "/v1/notifications/preferences", {
    localFallback: defaultNotificationPreferences()
  });

export async function PATCH(request: Request) {
  const body = await messageRequestBody(request);
  return proxyMessageRequest(request, "/v1/notifications/preferences", {
    method: "PATCH",
    body
  });
}
