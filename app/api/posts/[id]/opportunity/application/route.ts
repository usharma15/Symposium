import { ZodError } from "zod";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
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
  const live = await proxyLiveApiRequest(request, {
    actorHandle,
    sourcePath: new URL(request.url).pathname
  });
  if (live) return live;
  try { return Response.json({ application: await getOwnLocalOpportunityApplication(id, actorHandle) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<Record<string, unknown> & { actorHandle?: string }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  try {
    const parsed = createOpportunityApplicationInputSchema.parse({ ...body, postId: id, actorHandle });
    const live = await proxyLiveApiRequest(request, {
      body: { statement: parsed.statement, attachmentIds: parsed.attachmentIds },
      actorHandle
    });
    if (live) return live;
    return Response.json({ application: await createLocalOpportunityApplication({ ...parsed, actorHandle }) });
  }
  catch (error) { return failure(error); }
}
