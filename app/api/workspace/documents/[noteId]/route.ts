import { readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { deleteLocalWorkspaceDocument, updateLocalWorkspaceDocument } from "@/lib/localWorkspaceStore";
import { privateWorkspaceResponse, workspaceActorHandle, workspaceRouteError } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ noteId: string }> };

const mutation = async (request: Request, context: Context, method: "PATCH" | "DELETE") => {
  const { noteId } = await context.params;
  const body = await readJson<Record<string, unknown> & { actorHandle?: string }>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const payload = { ...body };
  delete payload.actorHandle;
  const live = await proxyLiveBackend(`/v1/workspace/documents/${encodeURIComponent(noteId)}`, {
    method,
    body: payload,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;
  try {
    const result = method === "PATCH"
      ? await updateLocalWorkspaceDocument(noteId, payload, actorHandle)
      : await deleteLocalWorkspaceDocument(noteId, payload, actorHandle);
    return privateWorkspaceResponse(result);
  } catch (error) {
    return workspaceRouteError(error);
  }
};

export const PATCH = (request: Request, context: Context) => mutation(request, context, "PATCH");
export const DELETE = (request: Request, context: Context) => mutation(request, context, "DELETE");
