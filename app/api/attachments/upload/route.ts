import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadBody = {
  actorHandle?: string;
  fileName?: string;
  contentType?: string;
  byteSize?: number;
  ownerType?: "post" | "message" | "note" | "profile";
  ownerId?: string;
};

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);

export async function POST(request: Request) {
  const body = await readJson<UploadBody>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const contentType = String(body.contentType ?? "").toLowerCase();
  const byteSize = Number(body.byteSize ?? 0);

  if (!body.fileName || !allowedImageTypes.has(contentType)) {
    return jsonError("Choose a PNG, JPG, JPEG, WEBP, GIF, or AVIF image.", 400);
  }

  if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > 5 * 1024 * 1024) {
    return jsonError("Profile photos must be 5 MB or smaller.", 400);
  }

  const live = await proxyLiveBackend("/v1/attachments/upload", {
    method: "POST",
    body: {
      fileName: body.fileName,
      contentType,
      byteSize,
      ownerType: body.ownerType ?? "profile",
      ownerId: body.ownerId
    },
    actorHandle: body.actorHandle
  });
  if (live) return live;

  return jsonError("Live uploads are not configured in local preview.", 412);
}
