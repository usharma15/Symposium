import { readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { createLocalWorkspaceGrant, getLocalWorkspaceAccess } from "@/lib/localWorkspaceStore";
import { privateWorkspaceResponse, workspaceActorHandle, workspaceRouteError } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ notebookId: string }> };

export async function GET(request: Request, context: Context) {
  const { notebookId } = await context.params;
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveBackend(`/v1/workspace/notebooks/${encodeURIComponent(notebookId)}/access`, { actorHandle });
  if (live) return live;
  try {
    return privateWorkspaceResponse(await getLocalWorkspaceAccess("notebook", notebookId, actorHandle));
  } catch (error) {
    return workspaceRouteError(error);
  }
}

export async function POST(request: Request, context: Context) {
  const { notebookId } = await context.params;
  const body = await readJson<Record<string, unknown> & { actorHandle?: string }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const payload = { ...body };
  delete payload.actorHandle;
  const live = await proxyLiveBackend(`/v1/workspace/notebooks/${encodeURIComponent(notebookId)}/access`, {
    method: "POST",
    body: payload,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  try {
    return privateWorkspaceResponse(await createLocalWorkspaceGrant("notebook", notebookId, payload, actorHandle));
  } catch (error) {
    return workspaceRouteError(error);
  }
}
