import { jsonError, readJson } from "@/lib/api";
import { confirmLocalAttachment, LocalAttachmentStoreError } from "@/lib/localAttachmentStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfirmBody = {
  actorHandle?: string;
  attachmentId?: string;
  byteSize?: number;
  metadata?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const body = await readJson<ConfirmBody>(request);

  if (!body?.attachmentId) {
    return jsonError("Attachment id is required.", 400);
  }

  const live = await proxyLiveBackend("/v1/attachments/confirm", {
    method: "POST",
    body: {
      attachmentId: body.attachmentId,
      byteSize: body.byteSize,
      metadata: body.metadata
    },
    actorHandle: body.actorHandle
  });
  if (live) return live;

  try {
    const attachment = await confirmLocalAttachment({
      attachmentId: body.attachmentId,
      byteSize: body.byteSize,
      metadata: body.metadata
    });
    return Response.json({ attachmentId: attachment.attachmentId, status: attachment.status });
  } catch (error) {
    if (error instanceof LocalAttachmentStoreError) {
      return jsonError(error.message, error.status);
    }
    throw error;
  }
}
