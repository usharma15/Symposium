import { ZodError } from "zod";
import { jsonError, readJson } from "@/lib/api";
import { profile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { LocalAttachmentStoreError } from "@/lib/localAttachmentStore";
import { LocalWorkspaceStoreError } from "@/lib/localWorkspaceStore";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";

export const workspaceActorHandle = (request: Request, bodyActorHandle?: string) => {
  const queryActor = new URL(request.url).searchParams.get("actorHandle") ?? undefined;
  return cleanHandle(bodyActorHandle ?? request.headers.get("x-symposium-handle") ?? queryActor ?? profile.handle);
};

export const workspaceRouteError = (error: unknown) => {
  if (error instanceof LocalWorkspaceStoreError || error instanceof LocalAttachmentStoreError) {
    return jsonError(error.message, error.status);
  }
  if (error instanceof ZodError) return jsonError(error.issues[0]?.message ?? "Invalid workspace request.", 400);
  throw error;
};

export const privateWorkspaceResponse = (value: unknown, init?: ResponseInit) => {
  const response = Response.json(value, init);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Authorization, Cookie");
  return response;
};

type WorkspacePayload = Record<string, unknown> & { actorHandle?: string };

export const workspaceMutation = async (
  request: Request,
  applyLocal: (payload: Record<string, unknown>, actorHandle: string) => Promise<unknown>,
  sourcePath = new URL(request.url).pathname
) => {
  const body = await readJson<WorkspacePayload>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const payload = { ...body };
  delete payload.actorHandle;
  const live = await proxyLiveApiRequest(request, { actorHandle, body: payload, sourcePath });
  if (live) return live;
  try {
    return privateWorkspaceResponse(await applyLocal(payload, actorHandle));
  } catch (error) {
    return workspaceRouteError(error);
  }
};

export const workspaceRead = async (
  request: Request,
  applyLocal: (actorHandle: string) => Promise<unknown>,
  sourcePath = new URL(request.url).pathname
) => {
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveApiRequest(request, { actorHandle, sourcePath });
  if (live) return live;
  try {
    return privateWorkspaceResponse(await applyLocal(actorHandle));
  } catch (error) {
    return workspaceRouteError(error);
  }
};
