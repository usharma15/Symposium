import { attachmentKindForFile, type AttachmentKindContract } from "@/packages/contracts/src";

export type AttachmentKind = AttachmentKindContract;

export const maxPostAttachments = 10;
export const maxContentAttachments = 100;
export const maxPostAttachmentBytes = 50 * 1024 * 1024;
export const maxAttachmentPreviewTextLength = 50_000;

const extensionContentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".csv": "text/csv",
  ".asm": "text/plain",
  ".bash": "text/x-shellscript",
  ".c": "text/plain",
  ".cpp": "text/plain",
  ".cxx": "text/plain",
  ".cc": "text/plain",
  ".cs": "text/plain",
  ".conf": "text/plain",
  ".css": "text/css",
  ".dart": "text/plain",
  ".erl": "text/plain",
  ".ex": "text/plain",
  ".exs": "text/plain",
  ".fish": "text/x-shellscript",
  ".fs": "text/plain",
  ".fsx": "text/plain",
  ".go": "text/plain",
  ".gradle": "text/plain",
  ".graphql": "text/plain",
  ".groovy": "text/plain",
  ".html": "text/html",
  ".h": "text/plain",
  ".hpp": "text/plain",
  ".hs": "text/plain",
  ".java": "text/plain",
  ".ini": "text/plain",
  ".ipynb": "application/json",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".kt": "text/plain",
  ".kts": "text/plain",
  ".lua": "text/plain",
  ".m": "text/plain",
  ".mm": "text/plain",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".doc": "application/msword",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".py": "text/x-python",
  ".php": "text/plain",
  ".pl": "text/plain",
  ".ps1": "text/plain",
  ".rb": "text/plain",
  ".r": "text/plain",
  ".rs": "text/plain",
  ".s": "text/plain",
  ".sql": "application/sql",
  ".scala": "text/plain",
  ".sh": "text/x-shellscript",
  ".swift": "text/plain",
  ".tex": "text/plain",
  ".toml": "application/toml",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".vb": "text/plain",
  ".vue": "text/plain",
  ".xml": "application/xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".rtf": "application/rtf",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".ogg": "video/ogg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".webm": "video/webm",
  ".webp": "image/webp"
};

export const allowedPostAttachmentTypes = new Set([
  "application/json",
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/sql",
  "application/toml",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/xml",
  "application/yaml",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/css",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/typescript",
  "text/x-shellscript",
  "text/x-python",
  "video/mp4",
  "video/mpeg",
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
  "image/bmp",
  "video/mp4",
  "video/mpeg",
  "video/webm",
  "video/quicktime",
  "video/ogg",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/css",
  "text/html",
  "text/javascript",
  "text/typescript",
  "text/x-python",
  "text/x-shellscript",
  "application/json",
  "application/msword",
  "application/rtf",
  "application/sql",
  "application/toml",
  "application/xml",
  "application/yaml",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".ipynb",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".rb",
  ".php",
  ".cs",
  ".vb",
  ".fs",
  ".fsx",
  ".kt",
  ".kts",
  ".swift",
  ".dart",
  ".ex",
  ".exs",
  ".erl",
  ".scala",
  ".lua",
  ".groovy",
  ".gradle",
  ".hs",
  ".toml",
  ".ini",
  ".conf",
  ".r",
  ".rs",
  ".go",
  ".java",
  ".asm",
  ".s",
  ".c",
  ".cpp",
  ".cxx",
  ".cc",
  ".h",
  ".hpp",
  ".html",
  ".css",
  ".xml",
  ".yaml",
  ".yml",
  ".sql",
  ".graphql",
  ".tex",
  ".vue",
  ".m",
  ".mm",
  ".pl",
  ".bmp",
  ".m4v",
  ".mpeg",
  ".mpg",
  ".doc",
  ".odt",
  ".rtf",
  ".xls",
  ".ods",
  ".ppt",
  ".pptx",
  ".odp",
  ".xlsx",
  ".docx"
].join(",");

const extensionForFileName = (fileName: string) => {
  const match = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
};

const normalizedContentType = (contentType: string) => {
  const normalized = contentType.trim().toLowerCase().split(";", 1)[0] ?? "";
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
};

export const attachmentContentTypesMatch = (left: string, right: string) =>
  normalizedContentType(left) === normalizedContentType(right);

export const validateAttachmentNameAndContentType = (fileName: string, contentType: string) => {
  const extension = extensionForFileName(fileName);
  const expected = extensionContentTypes[extension];
  if (expected && !attachmentContentTypesMatch(expected, contentType)) {
    return `The ${extension} file extension does not match the declared attachment type.`;
  }
  return null;
};

export const inferAttachmentContentType = (fileName: string, contentType?: string | null) => {
  const normalized = (contentType ?? "").trim().toLowerCase();
  return extensionContentTypes[extensionForFileName(fileName)] ?? (normalized === "application/octet-stream" ? "" : normalized);
};

export const attachmentKindForContentType = attachmentKindForFile;

export const validatePostAttachmentDetails = (fileName: string, contentType: string, byteSize: number) => {
  if (!fileName.trim()) return "Attachment file name is required.";
  if (!allowedPostAttachmentTypes.has(contentType.toLowerCase())) {
    return "Attach an image, video, PDF, document, spreadsheet, presentation, text, Markdown, or source-code file.";
  }
  const nameTypeError = validateAttachmentNameAndContentType(fileName, contentType);
  if (nameTypeError) return nameTypeError;
  if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > maxPostAttachmentBytes) {
    return "Post attachments must be 50 MB or smaller.";
  }
  return null;
};

const startsWithBytes = (bytes: Uint8Array, expected: number[]) =>
  expected.every((value, index) => bytes[index] === value);

const asciiAt = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

const containsAscii = (bytes: Uint8Array, value: string, start = 0, end = bytes.byteLength) =>
  asciiAt(bytes, start, Math.max(0, Math.min(end, bytes.byteLength) - start)).includes(value);

export const validateAttachmentContentSignature = (contentType: string, bytes: Uint8Array) => {
  const normalized = normalizedContentType(contentType);
  if (!bytes.byteLength) return "The uploaded attachment is empty.";

  const valid = (() => {
    switch (normalized) {
      case "image/png":
        return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      case "image/jpeg":
        return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
      case "image/gif":
        return asciiAt(bytes, 0, 6) === "GIF87a" || asciiAt(bytes, 0, 6) === "GIF89a";
      case "image/webp":
        return asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP";
      case "image/avif":
        return asciiAt(bytes, 4, 4) === "ftyp" && (containsAscii(bytes, "avif", 8, 40) || containsAscii(bytes, "avis", 8, 40));
      case "image/bmp":
        return asciiAt(bytes, 0, 2) === "BM";
      case "application/pdf":
        return asciiAt(bytes, 0, 5) === "%PDF-";
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      case "application/vnd.oasis.opendocument.text":
      case "application/vnd.oasis.opendocument.spreadsheet":
      case "application/vnd.oasis.opendocument.presentation":
        return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
      case "application/msword":
      case "application/vnd.ms-excel":
      case "application/vnd.ms-powerpoint":
        return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      case "video/mp4":
      case "video/quicktime":
        return asciiAt(bytes, 4, 4) === "ftyp";
      case "video/mpeg":
        return startsWithBytes(bytes, [0x00, 0x00, 0x01, 0xba]) || startsWithBytes(bytes, [0x00, 0x00, 0x01, 0xb3]);
      case "video/webm":
        return startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
      case "video/ogg":
        return asciiAt(bytes, 0, 4) === "OggS";
      case "text/plain":
      case "text/markdown":
      case "text/csv":
      case "application/json":
      case "application/sql":
      case "application/rtf":
      case "application/toml":
      case "application/xml":
      case "application/yaml":
      case "text/css":
      case "text/html":
      case "text/javascript":
      case "text/typescript":
      case "text/x-python":
      case "text/x-shellscript":
        return !bytes.includes(0);
      default:
        return false;
    }
  })();

  return valid ? null : "The uploaded file contents do not match the declared attachment type.";
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
