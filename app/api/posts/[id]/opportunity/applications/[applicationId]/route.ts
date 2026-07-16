import { ZodError } from "zod";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import {
  deleteLocalOpportunityApplication,
  LocalOpportunityApplicationError,
  updateLocalOpportunityApplication
} from "@/lib/localOpportunityApplicationStore";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";
import { updateOpportunityApplicationInputSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; applicationId: string }> };
const failure = (error: unknown) => {
  if (error instanceof LocalOpportunityApplicationError) return jsonError(error.message, error.status);
  if (error instanceof ZodError) return jsonError(error.issues[0]?.message ?? "Invalid application change.", 400);
  throw error;
};

export async function PATCH(request: Request, context: Context) {
  const { id, applicationId } = await context.params;
  const body = await readJson<Record<string, unknown> & { actorHandle?: string }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const parsed = updateOpportunityApplicationInputSchema.parse({ ...body, actorHandle });
  const live = await proxyLiveBackend(`/v1/posts/${encodeURIComponent(id)}/opportunity/applications/${encodeURIComponent(applicationId)}`, {
    method: "PATCH", body: { shortlisted: parsed.shortlisted, expectedRevision: parsed.expectedRevision }, actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  try { return Response.json({ application: await updateLocalOpportunityApplication({ postId: id, applicationId, ...parsed, actorHandle }) }); }
  catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: Context) {
  const { id, applicationId } = await context.params;
  const body = await readJson<{ actorHandle?: string }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const live = await proxyLiveBackend(`/v1/posts/${encodeURIComponent(id)}/opportunity/applications/${encodeURIComponent(applicationId)}`, {
    method: "DELETE", actorHandle, idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  try { return Response.json({ deleted: await deleteLocalOpportunityApplication(id, applicationId, actorHandle) }); }
  catch (error) { return failure(error); }
}
