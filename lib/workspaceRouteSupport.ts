import { ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { profile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { LocalAttachmentStoreError } from "@/lib/localAttachmentStore";
import { LocalWorkspaceStoreError } from "@/lib/localWorkspaceStore";

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
