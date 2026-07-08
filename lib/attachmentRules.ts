export type AttachmentKind = "image" | "video" | "pdf" | "text" | "document";

export const maxPostAttachments = 10;
export const maxPostAttachmentBytes = 50 * 1024 * 1024;
export const maxAttachmentPreviewTextLength = 50_000;

const extensionContentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".webm": "video/webm",
  ".webp": "image/webp"
};

export const allowedPostAttachmentTypes = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
  "video/mp4",
  "video/ogg",
  "video/quicktime",
  "video/webm"
]);

export const postAttachmentAccept = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".docx"
].join(",");

const extensionForFileName = (fileName: string) => {
  const match = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
};

export const inferAttachmentContentType = (fileName: string, contentType?: string | null) => {
  const normalized = (contentType ?? "").trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return normalized;
  return extensionContentTypes[extensionForFileName(fileName)] ?? normalized;
};

export const attachmentKindForContentType = (contentType: string): AttachmentKind => {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized === "application/pdf") return "pdf";
  if (normalized.startsWith("text/") || normalized === "application/json") return "text";
  return "document";
};

export const validatePostAttachmentDetails = (fileName: string, contentType: string, byteSize: number) => {
  if (!fileName.trim()) return "Attachment file name is required.";
  if (!allowedPostAttachmentTypes.has(contentType.toLowerCase())) {
    return "Attach an image, video, PDF, text file, JSON/CSV/Markdown file, or DOCX.";
  }
  if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > maxPostAttachmentBytes) {
    return "Post attachments must be 50 MB or smaller.";
  }
  return null;
};

export const formatAttachmentBytes = (byteSize: number) => {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(byteSize < 10 * 1024 ? 1 : 0)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(byteSize < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

export const splitPreviewTextIntoPages = (text: string, pageSize = 2200) => {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [""];
  const pages: string[] = [];
  for (let index = 0; index < clean.length; index += pageSize) {
    pages.push(clean.slice(index, index + pageSize));
  }
  return pages;
};
