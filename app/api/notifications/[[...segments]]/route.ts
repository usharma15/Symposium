import { notificationCompatibilityRoute } from "@/lib/messageRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => notificationCompatibilityRoute(request);
export const POST = (request: Request) => notificationCompatibilityRoute(request);
export const PATCH = (request: Request) => notificationCompatibilityRoute(request);
