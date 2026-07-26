import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import {
  assistantVisionMaxDimension,
  assistantVisionMaxInputPixels,
  assistantVisionPatchTokens,
  isAssistantVisionContentType,
  normalizedAssistantVisionContentType
} from "@/lib/assistantVisionRules";
import { validateAttachmentContentSignature } from "@/lib/attachmentRules";
import { inspectUploadedObject } from "./storage";

export type AssistantVisionAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  objectKey: string;
};

export type AssistantVisionInput = {
  attachmentId: string;
  title: string;
  imageDataUrl: string;
  width: number;
  height: number;
  tokenCeiling: number;
};

type InspectStoredObject = typeof inspectUploadedObject;

const safelyPreparedImageError = (fileName: string) => new TRPCError({
  code: "BAD_REQUEST",
  message: `${fileName} could not be safely prepared for AI image understanding. Use a valid PNG, JPEG, or WebP image under 5 MB.`
});

export const prepareAssistantVisionInput = async (
  attachment: AssistantVisionAttachment,
  inspectStoredObject: InspectStoredObject = inspectUploadedObject
): Promise<AssistantVisionInput> => {
  if (!isAssistantVisionContentType(attachment.contentType)) {
    throw safelyPreparedImageError(attachment.fileName);
  }

  try {
    const stored = await inspectStoredObject(attachment.objectKey, true);
    if (
      !stored.body ||
      stored.byteSize !== attachment.byteSize ||
      stored.byteSize > 5 * 1024 * 1024 ||
      normalizedAssistantVisionContentType(stored.contentType ?? "") !==
        normalizedAssistantVisionContentType(attachment.contentType) ||
      validateAttachmentContentSignature(attachment.contentType, stored.prefix) !== null
    ) {
      throw safelyPreparedImageError(attachment.fileName);
    }

    const normalized = await sharp(stored.body, {
      animated: false,
      failOn: "warning",
      limitInputPixels: assistantVisionMaxInputPixels,
      sequentialRead: true
    })
      .rotate()
      .resize({
        width: assistantVisionMaxDimension,
        height: assistantVisionMaxDimension,
        fit: "inside",
        withoutEnlargement: true,
        fastShrinkOnLoad: true
      })
      .flatten({ background: "#ffffff" })
      .jpeg({
        quality: 88,
        chromaSubsampling: "4:4:4",
        progressive: true
      })
      .toBuffer({ resolveWithObject: true });

    if (
      !normalized.info.width ||
      !normalized.info.height ||
      normalized.info.width > assistantVisionMaxDimension ||
      normalized.info.height > assistantVisionMaxDimension
    ) {
      throw safelyPreparedImageError(attachment.fileName);
    }

    return {
      attachmentId: attachment.id,
      title: attachment.fileName,
      imageDataUrl: `data:image/jpeg;base64,${normalized.data.toString("base64")}`,
      width: normalized.info.width,
      height: normalized.info.height,
      tokenCeiling: assistantVisionPatchTokens(
        normalized.info.width,
        normalized.info.height
      )
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw safelyPreparedImageError(attachment.fileName);
  }
};

export const prepareAssistantVisionInputs = async (
  attachments: AssistantVisionAttachment[],
  inspectStoredObject: InspectStoredObject = inspectUploadedObject
) => Promise.all(attachments.map((attachment) =>
  prepareAssistantVisionInput(attachment, inspectStoredObject)
));
