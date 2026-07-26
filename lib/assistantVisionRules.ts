export const assistantVisionContentTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

export const maxAssistantVisionAttachments = 2;
export const maxAssistantVisionInputsPerDay = 10;
export const assistantVisionMaxDimension = 1600;
export const assistantVisionMaxInputPixels = 40_000_000;

export const normalizedAssistantVisionContentType = (contentType: string) => {
  const normalized = contentType.trim().toLowerCase().split(";", 1)[0] ?? "";
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
};

export const isAssistantVisionContentType = (contentType: string) =>
  assistantVisionContentTypes.has(normalizedAssistantVisionContentType(contentType));

export const assistantVisionPatchTokens = (width: number, height: number) =>
  Math.ceil(Math.max(1, width) / 32) * Math.ceil(Math.max(1, height) / 32);

// Every model-bound image is resized inside this square before it reaches the
// provider. Reserving the full square remains safe for any smaller aspect ratio.
export const maxAssistantVisionTokensPerImage = assistantVisionPatchTokens(
  assistantVisionMaxDimension,
  assistantVisionMaxDimension
);

export const assistantVisionTokenCeiling = (imageCount: number) =>
  Math.max(0, Math.min(maxAssistantVisionAttachments, Math.floor(imageCount))) *
  maxAssistantVisionTokensPerImage;
