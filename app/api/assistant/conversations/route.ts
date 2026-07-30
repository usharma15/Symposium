import { assistantReadRoute } from "@/lib/assistantRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = assistantReadRoute({ threads: [], nextCursor: null });
