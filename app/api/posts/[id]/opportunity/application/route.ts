import { ZodError } from "zod";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import {
  createLocalOpportunityApplication,
  getOwnLocalOpportunityApplication,
  LocalOpportunityApplicationError
} from "@/lib/localOpportunityApplicationStore";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";
import { createOpportunityApplicationInputSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const failure = (error: unknown) => {
  if (error instanceof LocalOpportunityApplicationError) return jsonError(error.message, error.status);
  if (error instanceof ZodError) return jsonError(error.issues[0]?.message ?? "Invalid application.", 400);
  throw error;
};

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveBackend(`/v1/posts/${encodeURIComponent(id)}/opportunity/application`, { actorHandle });
  if (live) return live;
  try { return Response.json({ application: await getOwnLocalOpportunityApplication(id, actorHandle) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<Record<string, unknown> & { actorHandle?: string }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const parsed = createOpportunityApplicationInputSchema.parse({ ...body, postId: id, actorHandle });
  const live = await proxyLiveBackend(`/v1/posts/${encodeURIComponent(id)}/opportunity/application`, {
    method: "POST", body: { statement: parsed.statement, attachmentIds: parsed.attachmentIds }, actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  try { return Response.json({ application: await createLocalOpportunityApplication({ ...parsed, actorHandle }) }); }
  catch (error) { return failure(error); }
}
