import type { InquiryAttachmentContract } from "@/packages/contracts/src";
import { isAssistantVisionContentType } from "@/lib/assistantVisionRules";

export const assistantAttachmentProcessingLabel = (
  attachment: InquiryAttachmentContract
) => {
  if (isAssistantVisionContentType(attachment.contentType)) {
    return "Image ready for AI";
  }
  if (
    typeof attachment.metadata?.previewText === "string" &&
    attachment.metadata.previewText.trim()
  ) {
    return "Text extracted";
  }
  if (
    attachment.metadata?.structuredPreview &&
    typeof attachment.metadata.structuredPreview === "object"
  ) {
    return "Text extracted";
  }
  return "Stored only";
};

export const assistantClaimKindLabel = {
  direct: "Direct evidence",
  inference: "Inference",
  insufficient: "Insufficient context"
} as const;

export const assistantAttachmentUrl = (
  attachment: InquiryAttachmentContract,
  actorHandle: string
) =>
  attachment.url ??
  `/api/assistant-attachments/${encodeURIComponent(
    attachment.id
  )}?actorHandle=${encodeURIComponent(actorHandle)}`;
