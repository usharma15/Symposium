import { jsonError } from "@/lib/api";
import { readLocalAttachment, LocalAttachmentStoreError } from "@/lib/localAttachmentStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ attachmentId: string }> };

export async function GET(request: Request, context: Context) {
  const { attachmentId } = await context.params;
  const actorHandle = workspaceActorHandle(request);
  const live = await proxyLiveBackend(`/v1/message-attachments/${encodeURIComponent(attachmentId)}/access`, { actorHandle });
  if (live) {
    if (!live.ok) return live;
    const body = await live.json().catch(() => null) as { url?: string } | null;
    if (!body?.url) return jsonError("Protected attachment delivery is unavailable.", 502);
    return Response.redirect(body.url, 307);
  }

  try {
    const { record, bytes } = await readLocalAttachment(attachmentId);
    // The local preview has no second authenticated participant. Keep delivery
    // fail-closed to the uploader instead of making message objects public.
    if (record.ownerType !== "message" || !record.actorHandle || record.actorHandle !== actorHandle) {
      return jsonError("Attachment not found.", 404);
    }
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
}
