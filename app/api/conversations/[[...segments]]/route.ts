import { conversationCompatibilityRoute } from "@/lib/messageRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => conversationCompatibilityRoute(request);
export const POST = (request: Request) => conversationCompatibilityRoute(request);
export const PATCH = (request: Request) => conversationCompatibilityRoute(request);
export const DELETE = (request: Request) => conversationCompatibilityRoute(request);
