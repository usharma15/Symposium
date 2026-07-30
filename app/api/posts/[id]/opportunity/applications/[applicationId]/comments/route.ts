import { ZodError } from "zod";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { addLocalOpportunityApplicationComment, LocalOpportunityApplicationError } from "@/lib/localOpportunityApplicationStore";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";
import { createOpportunityApplicationCommentInputSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; applicationId: string }> };

export async function POST(request: Request, context: Context) {
  const { id, applicationId } = await context.params;
  const body = await readJson<Record<string, unknown> & { actorHandle?: string }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  try {
    const parsed = createOpportunityApplicationCommentInputSchema.parse({ ...body, actorHandle });
    const live = await proxyLiveApiRequest(request, {
      body: { body: parsed.body },
      actorHandle
    });
    if (live) return live;
    return Response.json({ application: await addLocalOpportunityApplicationComment({ postId: id, applicationId, body: parsed.body, actorHandle }) });
  } catch (error) {
    if (error instanceof LocalOpportunityApplicationError) return jsonError(error.message, error.status);
    if (error instanceof ZodError) return jsonError(error.issues[0]?.message ?? "Invalid private note.", 400);
    throw error;
  }
}
