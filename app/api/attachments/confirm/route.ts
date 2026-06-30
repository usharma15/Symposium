import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfirmBody = {
  actorHandle?: string;
  attachmentId?: string;
  byteSize?: number;
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
      byteSize: body.byteSize
    },
    actorHandle: body.actorHandle
  });
  if (live) return live;

  return jsonError("Live uploads are not configured in local preview.", 412);
}
