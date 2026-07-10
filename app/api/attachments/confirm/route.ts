import { jsonError, readJson } from "@/lib/api";
import { confirmLocalAttachment, LocalAttachmentStoreError } from "@/lib/localAttachmentStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { confirmAttachmentInputSchema } from "@/packages/contracts/src";

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

  const parsed = confirmAttachmentInputSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid attachment confirmation.", 400);

  const live = await proxyLiveBackend("/v1/attachments/confirm", {
    method: "POST",
    body: {
      attachmentId: parsed.data.attachmentId,
      byteSize: parsed.data.byteSize,
      metadata: parsed.data.metadata
    },
    actorHandle: body?.actorHandle
  });
  if (live) return live;

  try {
    const attachment = await confirmLocalAttachment({
      attachmentId: parsed.data.attachmentId,
      byteSize: parsed.data.byteSize,
      metadata: parsed.data.metadata
    });
    return Response.json({ attachmentId: attachment.attachmentId, status: attachment.status });
  } catch (error) {
    if (error instanceof LocalAttachmentStoreError) {
      return jsonError(error.message, error.status);
    }
    throw error;
  }
}
