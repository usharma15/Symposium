import { ZodError } from "zod";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
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
    const live = await proxyLiveBackend(`/v1/posts/${encodeURIComponent(id)}/opportunity/applications/${encodeURIComponent(applicationId)}/comments`, {
      method: "POST", body: { body: parsed.body }, actorHandle,
      idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
    });
    if (live) return live;
    return Response.json({ application: await addLocalOpportunityApplicationComment({ postId: id, applicationId, body: parsed.body, actorHandle }) });
  } catch (error) {
    if (error instanceof LocalOpportunityApplicationError) return jsonError(error.message, error.status);
    if (error instanceof ZodError) return jsonError(error.issues[0]?.message ?? "Invalid private note.", 400);
    throw error;
  }
}
