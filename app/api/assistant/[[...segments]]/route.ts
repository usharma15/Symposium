import { assistantCompatibilityRoute } from "@/lib/assistantRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: Request) => assistantCompatibilityRoute(request);
export const POST = (request: Request) => assistantCompatibilityRoute(request);
export const PATCH = (request: Request) => assistantCompatibilityRoute(request);
export const DELETE = (request: Request) => assistantCompatibilityRoute(request);
