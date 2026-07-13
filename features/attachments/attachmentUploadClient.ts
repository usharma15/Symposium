import {
  attachmentKindForContentType,
  inferAttachmentContentType,
  validatePostAttachmentDetails
} from "@/lib/attachmentRules";
import type { InquiryAttachment } from "@/lib/mockData";

export type AttachmentUploadResponse = {
  attachmentId?: string;
  uploadUrl?: string;
  publicUrl?: string | null;
};

export type AttachmentConfirmResponse = {
  attachmentId?: string;
  publicUrl?: string | null;
  status?: string;
};

const retryResponse = async (
  request: () => Promise<Response>,
  attempts: number,
  shouldRetry: (response: Response, attempt: number) => Promise<boolean>,
  delay: (attempt: number) => number
) => {
  let lastResponse: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await request();
      lastResponse = response;
      if (!(await shouldRetry(response, attempt))) return response;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await new Promise((resolve) => window.setTimeout(resolve, delay(attempt)));
  }
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("Could not reach attachment storage.");
};

const responseError = async (response: Response, fallback: string) => {
  const detail = (await response.json().catch(() => null)) as { error?: string } | null;
  return new Error(detail?.error ?? fallback);
};

export const prepareAttachmentUpload = (payload: Record<string, unknown>, idempotencyKey: string) =>
  retryResponse(
    () =>
      fetch("/api/attachments/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(payload)
      }),
    2,
    async (response) => !response.ok && response.status >= 500,
    () => 0
  );

export const confirmAttachmentUpload = (payload: Record<string, unknown>) =>
  retryResponse(
    () =>
      fetch("/api/attachments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }),
    6,
    async (response, attempt) => {
      if (response.status >= 500) return true;
      if (response.status !== 409 || attempt >= 5) return false;
      const detail = (await response.clone().json().catch(() => null)) as { error?: string } | null;
      return Boolean(detail?.error?.includes("already being verified"));
    },
    (attempt) => 300 * (attempt + 1)
  );

export const uploadConfirmedAttachment = async (input: {
  actorHandle: string;
  file: File;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  ownerType: "post" | "comment";
}): Promise<InquiryAttachment> => {
  const contentType = inferAttachmentContentType(input.file.name, input.file.type);
  const validationError = validatePostAttachmentDetails(input.file.name, contentType, input.file.size);
  if (validationError) throw new Error(validationError);

  const uploadResponse = await prepareAttachmentUpload(
    {
      actorHandle: input.actorHandle,
      fileName: input.file.name,
      contentType,
      byteSize: input.file.size,
      ownerType: input.ownerType
    },
    input.idempotencyKey
  );
  if (!uploadResponse.ok) throw await responseError(uploadResponse, "Could not prepare this attachment upload.");

  const upload = (await uploadResponse.json()) as AttachmentUploadResponse;
  if (!upload.uploadUrl || !upload.attachmentId || !upload.publicUrl) {
    throw new Error("Could not prepare this attachment upload.");
  }
  const putResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: input.file
  });
  if (!putResponse.ok) throw new Error("Could not upload this attachment.");

  const confirmResponse = await confirmAttachmentUpload({
    actorHandle: input.actorHandle,
    attachmentId: upload.attachmentId,
    byteSize: input.file.size,
    metadata: input.metadata
  });
  if (!confirmResponse.ok) throw await responseError(confirmResponse, "Could not confirm this attachment.");

  const confirmed = (await confirmResponse.json()) as AttachmentConfirmResponse;
  const publicUrl = confirmed.publicUrl ?? upload.publicUrl;
  if (!publicUrl) throw new Error("The confirmed attachment does not have a persistent public URL.");
  return {
    id: upload.attachmentId,
    fileName: input.file.name,
    contentType,
    byteSize: input.file.size,
    url: publicUrl,
    status: "uploaded",
    kind: attachmentKindForContentType(contentType, input.file.name),
    metadata: input.metadata,
    createdAt: new Date().toISOString()
  };
};

export const uploadConfirmedPostAttachment = (
  input: Omit<Parameters<typeof uploadConfirmedAttachment>[0], "ownerType">
) => uploadConfirmedAttachment({ ...input, ownerType: "post" });
