import { assistantMutationRoute } from "@/lib/assistantRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unavailable = "Assistant Projects require the live backend.";

export const PATCH = assistantMutationRoute(unavailable);
export const DELETE = assistantMutationRoute(unavailable);
