import { assistantMutationRoute } from "@/lib/assistantRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = assistantMutationRoute("AI Assistant actions require the live workspace.");
