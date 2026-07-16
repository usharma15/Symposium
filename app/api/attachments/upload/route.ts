import { jsonError, readJson } from "@/lib/api";
import {
  inferAttachmentContentType,
  validateAttachmentNameAndContentType,
  validatePostAttachmentDetails
} from "@/lib/attachmentRules";
import { createLocalAttachmentUpload } from "@/lib/localAttachmentStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadBody = {
  actorHandle?: string;
  fileName?: string;
  contentType?: string;
  byteSize?: number;
  ownerType?: "post" | "comment" | "message" | "note" | "note_comment" | "opportunity_application" | "profile";
  ownerId?: string;
};

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const body = await readJson<UploadBody>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const ownerType = body.ownerType ?? "profile";
  const contentType = inferAttachmentContentType(String(body.fileName ?? ""), String(body.contentType ?? ""));
  const byteSize = Number(body.byteSize ?? 0);

  if (!["post", "comment", "note", "note_comment", "opportunity_application", "profile"].includes(ownerType)) {
    return jsonError("Private attachment delivery is not enabled for message uploads yet.", 412);
  }

  if (ownerType === "profile") {
    if (!body.fileName || !allowedImageTypes.has(contentType)) {
      return jsonError("Choose a PNG, JPG, JPEG, WEBP, GIF, or AVIF image.", 400);
    }

    if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > 5 * 1024 * 1024) {
      return jsonError("Profile photos must be 5 MB or smaller.", 400);
    }
    const nameTypeError = validateAttachmentNameAndContentType(String(body.fileName), contentType);
    if (nameTypeError) return jsonError(nameTypeError, 400);
  } else {
    const validationError = validatePostAttachmentDetails(String(body.fileName ?? ""), contentType, byteSize);
    if (validationError) return jsonError(validationError, 400);
  }

  const live = await proxyLiveBackend("/v1/attachments/upload", {
    method: "POST",
    body: {
      fileName: body.fileName,
      contentType,
      byteSize,
      ownerType,
      ownerId: body.ownerId
    },
    actorHandle: body.actorHandle,
    idempotencyKey
  });
  if (live) return live;

  if (ownerType !== "profile") {
    const localUpload = await createLocalAttachmentUpload({
      actorHandle: body.actorHandle,
      fileName: String(body.fileName ?? ""),
      contentType,
      byteSize,
      ownerType,
      ownerId: body.ownerId
    });
    return Response.json(localUpload);
  }

  return jsonError("Live uploads are not configured in local preview.", 412);
}
