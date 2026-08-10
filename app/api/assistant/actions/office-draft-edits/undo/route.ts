import { assistantMutationRoute } from "@/lib/assistantRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = assistantMutationRoute("Assistant actions require the live workspace.");
