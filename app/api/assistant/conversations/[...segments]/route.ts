import {
  assistantMutationRoute,
  assistantReadRoute
} from "@/lib/assistantRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unavailable = "Research threads require the cost-controlled live backend.";

export const GET = assistantReadRoute(unavailable);
export const POST = assistantMutationRoute(unavailable);
export const PATCH = assistantMutationRoute(unavailable);
export const DELETE = assistantMutationRoute(unavailable);
