import { jsonError } from "@/lib/api";
import {
  LocalAttachmentStoreError,
  readLocalAttachment,
  type LocalAttachmentRecord
} from "@/lib/localAttachmentStore";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

type AttachmentAccess = (
  record: LocalAttachmentRecord,
  actorHandle: string
) => boolean | Promise<boolean>;
type AttachmentContext = { params: Promise<{ attachmentId: string }> };

export const deliverProtectedAttachment = async (
  request: Request,
  attachmentId: string,
  canAccess: AttachmentAccess
) => {
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveApiRequest(request, { actorHandle });
  if (live) {
    if (!live.ok) return live;
    const body = await live.json().catch(() => null) as { url?: string } | null;
    return body?.url
      ? Response.redirect(body.url, 307)
      : jsonError("Protected attachment delivery is unavailable.", 502);
  }

  try {
    const { record, bytes } = await readLocalAttachment(attachmentId);
    if (!(await canAccess(record, actorHandle))) return jsonError("Attachment not found.", 404);
    return new Response(new Blob([bytes], { type: record.contentType }), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${record.fileName.replace(/["\r\n]/g, "_")}"`,
        "Content-Length": String(record.byteSize),
        "Content-Type": record.contentType,
        "Vary": "Authorization, Cookie"
      }
    });
  } catch (error) {
    if (error instanceof LocalAttachmentStoreError) return jsonError(error.message, error.status);
    throw error;
  }
};

export const createProtectedAttachmentRoute = (canAccess: AttachmentAccess) =>
  async (request: Request, context: AttachmentContext) => {
    const { attachmentId } = await context.params;
    return deliverProtectedAttachment(request, attachmentId, canAccess);
  };
