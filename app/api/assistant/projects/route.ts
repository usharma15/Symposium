import {
  assistantMutationRoute,
  assistantReadRoute
} from "@/lib/assistantRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = assistantReadRoute({ projects: [] });
export const POST = assistantMutationRoute("Assistant Projects require the live backend.");
