import { z } from "zod";
import { jsonError } from "@/lib/api";
import {
  deleteLocalPendingAttachment,
  LocalAttachmentStoreError
} from "@/lib/localAttachmentStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ attachmentId: string }> };

export async function DELETE(request: Request, context: Context) {
  const parsedId = z.string().uuid().safeParse((await context.params).attachmentId);
  if (!parsedId.success) return jsonError("Invalid attachment identifier.", 400);
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveBackend(`/v1/attachments/${encodeURIComponent(parsedId.data)}`, {
    method: "DELETE",
    actorHandle
  });
  if (live) return live;

  try {
    return Response.json(await deleteLocalPendingAttachment(parsedId.data, actorHandle));
  } catch (error) {
    if (error instanceof LocalAttachmentStoreError) return jsonError(error.message, error.status);
    throw error;
  }
}
