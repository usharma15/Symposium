"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  FileSpreadsheet,
  Film,
  ImageIcon,
  Paperclip,
  Presentation,
  X
} from "lucide-react";
import type { InquiryAttachment, InquiryItem } from "@/lib/mockData";
import {
  attachmentKindForContentType,
  formatAttachmentBytes,
  maxAttachmentPreviewTextLength,
  maxPostAttachments,
  postAttachmentAccept,
  splitPreviewTextIntoPages
} from "@/lib/attachmentRules";
import { buildStructuredAttachmentMetadata } from "@/lib/structuredAttachmentPreview";
import { StructuredAttachmentPreviewPane } from "@/features/attachments/StructuredAttachmentPreviews";
import { AttachmentScribbleButton } from "@/features/attachments/AttachmentScribbleButton";
import {
  DocumentTranslationControl,
  useDocumentTranslation,
  type DocumentTranslationSource
} from "@/features/attachments/DocumentTranslationControl";
import {
  extractPdfAttachmentMetadata,
  loadPdfModule,
  readPdfPageText,
  resolvePdfDocumentUrl,
  type PdfAttachmentViewContext
} from "@/features/attachments/pdfAttachmentClient";
import { feedPreviewAttachments } from "@/lib/documentModel";
import { isDeletedPost } from "@/lib/symposiumCore";
import { isSafeExternalUrl, type DocumentCitationLocatorContract } from "@/packages/contracts/src";

export type AttachmentPreviewHandler = (item: InquiryItem, attachmentId: string) => void;
export type AttachmentUploadHandler = (file: File) => Promise<InquiryAttachment>;
export type AttachmentCitationCapture = {
  attachment: InquiryAttachment;
  excerpt: string;
  locator: DocumentCitationLocatorContract;
};
type AttachmentRenderMode = "feed" | "detail" | "modal" | "expanded";
type MediaIntrinsicSize = { width: number; height: number };
export type AttachmentViewportSize = { width: number; height: number };
type UnitPoint = { x: number; y: number };
export type ImageRegion = Extract<DocumentCitationLocatorContract, { kind: "image-region" }>;
type DocxPreviewRun = { text: string; bold: boolean; italic: boolean; underline: boolean };
type DocxPreviewBlock = {
  id: string;
  runs: DocxPreviewRun[];
  style: "heading" | "paragraph" | "list";
};

const metadataNumber = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
};

const metadataString = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
};

const metadataFiniteNumber = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const metadataBoolean = (metadata: Record<string, unknown> | undefined, key: string) =>
  metadata?.[key] === true;

const boundedDocumentTranslationSource = (
  sourcePages: Array<{ pageNumber: number; body: string }>,
  complete: boolean
): DocumentTranslationSource => {
  const pages: DocumentTranslationSource["pages"] = [];
  let remaining = maxAttachmentPreviewTextLength;
  let truncated = sourcePages.length > 40;
  for (const sourcePage of sourcePages.slice(0, 40)) {
    const clean = sourcePage.body.trim();
    if (!clean) continue;
    const body = clean.slice(0, Math.min(12_000, remaining));
    if (!body) {
      truncated = true;
      break;
    }
    pages.push({ pageNumber: sourcePage.pageNumber, body });
    remaining -= body.length;
    if (body.length < clean.length) truncated = true;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
  }
  return { pages, complete: complete && !truncated };
};

export const pdfTranslationSourceFromPreviewText = (
  previewText: string,
  complete: boolean
): DocumentTranslationSource => {
  const matches = Array.from(previewText.matchAll(/\[PDF page (\d+)\]\n([\s\S]*?)(?=\n\n\[PDF page \d+\]\n|$)/g));
  const pages = matches.length
    ? matches.map((match) => ({ pageNumber: Number(match[1]), body: match[2] ?? "" }))
    : previewText.trim()
      ? [{ pageNumber: 1, body: previewText }]
      : [];
  return boundedDocumentTranslationSource(pages, complete);
};

const clampUnit = (value: number | undefined, fallback = 0.5) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
};

const attachmentFocalStyle = (attachment: InquiryAttachment): CSSProperties => {
  const focalX = clampUnit(metadataFiniteNumber(attachment.metadata, "focalX"));
  const focalY = clampUnit(metadataFiniteNumber(attachment.metadata, "focalY"));
  return { objectPosition: `${focalX * 100}% ${focalY * 100}%` };
};

const attachmentMediaSize = (attachment: InquiryAttachment): MediaIntrinsicSize | null => {
  const width = metadataFiniteNumber(attachment.metadata, "width");
  const height = metadataFiniteNumber(attachment.metadata, "height");
  if (!width || !height || width <= 0 || height <= 0) return null;
  return { width, height };
};

const minAttachmentZoom = 0.1;
const maxAttachmentZoom = 5;
const zoomInStep = 0.2;
const zoomOutStep = 0.1;

export const clampAttachmentZoom = (value: number) =>
  Math.min(maxAttachmentZoom, Math.max(minAttachmentZoom, Math.round(value * 100) / 100));

const orderedImageRegion = (start: UnitPoint, end: UnitPoint): ImageRegion => ({
  kind: "image-region",
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.max(0.001, Math.abs(end.x - start.x)),
  height: Math.max(0.001, Math.abs(end.y - start.y))
});

export const textOffsetWithin = (element: Element, node: Node, offset: number) => {
  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return undefined;
  }
};

const fitMediaSizeToViewport = (
  intrinsicSize: MediaIntrinsicSize | null,
  viewportSize: AttachmentViewportSize | null,
  zoom: number
): MediaIntrinsicSize | null => {
  if (!intrinsicSize || !viewportSize || viewportSize.width <= 0 || viewportSize.height <= 0) return null;
  const fitScale = Math.min(
    viewportSize.width / intrinsicSize.width,
    viewportSize.height / intrinsicSize.height
  );
  return {
    width: Math.max(1, Math.round(intrinsicSize.width * fitScale * zoom)),
    height: Math.max(1, Math.round(intrinsicSize.height * fitScale * zoom))
  };
};

const attachmentPageCount = (attachment: InquiryAttachment, fallbackText = "") => {
  const metadataCount = metadataNumber(attachment.metadata, "pageCount");
  if (metadataCount) return metadataCount;
  if (fallbackText) return splitPreviewTextIntoPages(fallbackText).length;
  return 1;
};

export const attachmentRenderKind = (attachment: InquiryAttachment) =>
  attachmentKindForContentType(attachment.contentType, attachment.fileName);

const attachmentForRendering = (attachment: InquiryAttachment): InquiryAttachment => {
  const kind = attachmentRenderKind(attachment);
  const staticPublicPath = metadataString(attachment.metadata, "staticPublicPath");
  const url = attachment.url ?? (staticPublicPath?.startsWith("/historical-world/") ? staticPublicPath : undefined);
  return kind === attachment.kind && url === attachment.url ? attachment : { ...attachment, kind, url };
};

const decodeXmlText = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");

const docxContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const isDocxAttachment = (attachment: InquiryAttachment) =>
  attachment.contentType.toLowerCase() === docxContentType ||
  attachment.fileName.toLowerCase().endsWith(".docx");

const safeEmbeddedImageSource = (value: string) =>
  value.startsWith("blob:") || /^data:image\/(?:avif|gif|jpeg|jpg|png|webp);base64,/i.test(value);

export const sanitizeRenderedDocx = (target: HTMLElement) => {
  target.querySelectorAll("script, iframe, object, embed, form, base, meta[http-equiv]").forEach((element) => {
    element.remove();
  });

  target.querySelectorAll<HTMLElement>("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
    }

    if (element instanceof HTMLAnchorElement) {
      const href = element.getAttribute("href")?.trim() ?? "";
      if (href.startsWith("#")) return;
      if (!isSafeExternalUrl(href)) {
        element.removeAttribute("href");
        element.removeAttribute("target");
        element.removeAttribute("rel");
        return;
      }
      element.target = "_blank";
      element.rel = "noopener noreferrer nofollow";
      return;
    }

    for (const attributeName of ["href", "xlink:href", "src"]) {
      const value = element.getAttribute(attributeName)?.trim();
      if (value && !safeEmbeddedImageSource(value)) element.removeAttribute(attributeName);
    }
  });
};

const extractDocxParagraphText = (paragraphXml: string) =>
  Array.from(paragraphXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXmlText(match[1] ?? ""))
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();

const extractDocxPreviewTextFromXml = (documentXml: string) => {
  const paragraphs = Array.from(documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .map((match) => extractDocxParagraphText(match[0] ?? ""))
    .filter(Boolean);
  return paragraphs.join("\n\n").trim().slice(0, maxAttachmentPreviewTextLength);
};

const plainTextToDocxBlocks = (text: string): DocxPreviewBlock[] => {
  const normalized = text
    .replace(/\s+(?=(?:INTRODUCTION|BODY|CONCLUSION|Transition|Main Point|Thesis Statement|Credibility Statement)\b)/g, "\n\n")
    .trim();
  const chunks = normalized ? normalized.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean) : [];
  return chunks.map((chunk, index) => ({
    id: `plain-${index}`,
    runs: [{ text: chunk.replace(/\*\*/g, ""), bold: false, italic: false, underline: false }],
    style: /^(?:INTRODUCTION|BODY|CONCLUSION)\b/i.test(chunk) ? "heading" : "paragraph"
  }));
};

const paginateDocxBlocks = (blocks: DocxPreviewBlock[], pageSize = 2600) => {
  if (!blocks.length) return [[]] as DocxPreviewBlock[][];
  const pages: DocxPreviewBlock[][] = [];
  let current: DocxPreviewBlock[] = [];
  let currentLength = 0;

  blocks.forEach((block) => {
    const blockLength = block.runs.reduce((total, run) => total + run.text.length, 0);
    if (current.length && currentLength + blockLength > pageSize) {
      pages.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(block);
    currentLength += blockLength;
  });

  if (current.length) pages.push(current);
  return pages;
};

const extractDocxMetadata = async (file: File) => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const appXml = await zip.file("docProps/app.xml")?.async("text");
  const documentXml = await zip.file("word/document.xml")?.async("text");
  const pageMatch = appXml?.match(/<Pages>(\d+)<\/Pages>/i);
  const pageCount = pageMatch ? Number(pageMatch[1]) : undefined;
  const previewText = documentXml ? extractDocxPreviewTextFromXml(documentXml) : "";

  return {
    ...(pageCount && Number.isFinite(pageCount) ? { pageCount } : {}),
    ...(previewText ? { previewText } : {})
  };
};

const extractTextMetadata = async (file: File) => {
  const text = (await file.text()).slice(0, maxAttachmentPreviewTextLength);
  return {
    pageCount: splitPreviewTextIntoPages(text).length,
    previewText: text
  };
};

const centeredMediaMetadata = (width: number, height: number, extra: Record<string, unknown> = {}) => ({
  width,
  height,
  focalX: 0.5,
  focalY: 0.5,
  ...extra
});

const extractImageMetadata = async (file: File) =>
  new Promise<Record<string, unknown>>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = document.createElement("img");
    const finish = (metadata: Record<string, unknown>) => {
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    image.onload = () =>
      finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? centeredMediaMetadata(image.naturalWidth, image.naturalHeight) : {});
    image.onerror = () => finish({});
    image.src = url;
  });

const extractVideoMetadata = async (file: File) =>
  new Promise<Record<string, unknown>>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = (metadata: Record<string, unknown>) => {
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finish(
        video.videoWidth > 0 && video.videoHeight > 0
          ? centeredMediaMetadata(video.videoWidth, video.videoHeight, {
              ...(Number.isFinite(video.duration) ? { duration: video.duration } : {})
            })
          : {}
      );
    video.onerror = () => finish({});
    video.src = url;
  });

export const buildPostAttachmentMetadata = async (file: File, contentType: string) => {
  try {
    const kind = attachmentKindForContentType(contentType, file.name);
    if (contentType.startsWith("image/")) return extractImageMetadata(file);
    if (contentType.startsWith("video/")) return extractVideoMetadata(file);
    if (contentType === "application/pdf") return extractPdfAttachmentMetadata(file);
    if (kind === "code" || kind === "spreadsheet" || kind === "presentation") return buildStructuredAttachmentMetadata(file, kind);
    if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return extractDocxMetadata(file);
    }
    if (kind === "document") {
      const structured = await buildStructuredAttachmentMetadata(file, kind);
      if (Object.keys(structured).length) return structured;
    }
    if (contentType.startsWith("text/") || contentType === "application/json" || contentType === "application/rtf") return extractTextMetadata(file);
  } catch {
    return {};
  }
  return {};
};

export function AttachmentComposerField({
  attachments,
  maxAttachments = maxPostAttachments,
  disabled = false,
  onAttachmentsChange,
  onBusyChange,
  onUploadAttachment
}: {
  attachments: InquiryAttachment[];
  maxAttachments?: number;
  disabled?: boolean;
  onAttachmentsChange: (attachments: InquiryAttachment[]) => void;
  onBusyChange?: (busy: boolean) => void;
  onUploadAttachment: AttachmentUploadHandler;
}) {
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const openSlots = maxAttachments - attachments.length;
    const selectedFiles = files.slice(0, Math.max(0, openSlots));
    if (!selectedFiles.length) {
      setStatus(`Attachment limit reached (${maxAttachments})`);
      return;
    }

    setUploading(true);
    onBusyChange?.(true);
    setStatus(`Uploading ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}`);
    try {
      const uploaded: InquiryAttachment[] = [];
      for (const file of selectedFiles) uploaded.push(await onUploadAttachment(file));
      onAttachmentsChange([...attachments, ...uploaded].slice(0, maxAttachments));
      setStatus(`${uploaded.length} file${uploaded.length === 1 ? "" : "s"} attached`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not attach this file.");
    } finally {
      setUploading(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="composer-attachments">
      <div className="composer-attachment-toolbar">
        <label className="attachment-picker">
          <Paperclip size={16} />
          <span>{attachments.length}/{maxAttachments}</span>
          <input
            type="file"
            multiple
            accept={postAttachmentAccept}
            disabled={disabled || uploading || attachments.length >= maxAttachments}
            onChange={uploadFiles}
          />
        </label>
        {status ? <small>{status}</small> : <small>Media, documents, spreadsheets, presentations, or code</small>}
      </div>
      {attachments.length ? (
        <div className="composer-attachment-list">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="composer-attachment-chip">
              {attachmentIcon(attachment)}
              <span>{attachment.fileName}</span>
              <small>{formatAttachmentBytes(attachment.byteSize)}</small>
              <button
                type="button"
                title="Remove attachment"
                disabled={disabled || uploading}
                onClick={() => onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const startAttachmentDrag = (attachment: InquiryAttachment) => (event: React.DragEvent<HTMLElement>) => {
  const renderable = attachmentForRendering(attachment);
  if (!renderable.url) return;
  const url = new URL(renderable.url, window.location.href).toString();
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("DownloadURL", `${attachment.contentType}:${attachment.fileName}:${url}`);
};
export function postPreviewAttachments(item: InquiryItem) {
  if (isDeletedPost(item)) return [];
  return feedPreviewAttachments(item.document, item.attachments ?? [])
    .map(attachmentForRendering)
    .filter((attachment) => attachment.url);
}

export const visibleAttachments = (attachments: InquiryAttachment[]) =>
  attachments.map(attachmentForRendering).filter((attachment) => attachment.url);

export function AttachmentCarousel({ attachments: sourceAttachments, label = "Attachments", onOpenPreview, variant = "feed", onAddToScribble, onViewContextChange }: {
  attachments: InquiryAttachment[];
  label?: string;
  onOpenPreview: (attachmentId: string) => void;
  variant?: "feed" | "detail" | "comment";
  onAddToScribble?: (attachment: InquiryAttachment) => void;
  onViewContextChange?: (context: PdfAttachmentViewContext | null) => void;
}) {
  const attachments = visibleAttachments(sourceAttachments);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAttachment = attachments[Math.min(activeIndex, Math.max(attachments.length - 1, 0))];

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(attachments.length - 1, 0)));
  }, [attachments.length]);

  if (!attachments.length || !activeAttachment) return null;
  const move = (event: React.MouseEvent<HTMLButtonElement>, direction: -1 | 1) => {
    event.stopPropagation();
    setActiveIndex((current) => (current + direction + attachments.length) % attachments.length);
  };
  const openPreview = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onOpenPreview(activeAttachment.id);
  };
  const openOnSingleClick = activeAttachment.kind !== "video";
  const previewMode = variant === "detail" ? "detail" : "feed";

  return (
    <section
      className={`post-attachments post-attachments-${variant}${variant === "comment" ? " comment-attachments" : ""}`}
      aria-label={label}
    >
      <div
        className={`attachment-frame attachment-frame-${activeAttachment.kind}`}
        role="button"
        tabIndex={0}
        draggable={Boolean(activeAttachment.url)}
        onDragStart={startAttachmentDrag(activeAttachment)}
        title={openOnSingleClick ? "Open attachment" : "Double-click to open video"}
        onClick={openOnSingleClick ? openPreview : undefined}
        onDoubleClick={openOnSingleClick ? undefined : openPreview}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenPreview(activeAttachment.id);
          }
        }}
      >
        <AttachmentPreviewPane
          attachment={activeAttachment}
          mode={previewMode}
          onOpenPreview={openPreview}
          onViewContextChange={onViewContextChange}
        />
      </div>
      <div className="attachment-rail">
        <button
          type="button"
          className="attachment-meta attachment-meta-button"
          draggable={Boolean(activeAttachment.url)}
          onDragStart={startAttachmentDrag(activeAttachment)}
          onClick={openPreview}
          title="Open attachment"
        >
          {attachmentIcon(activeAttachment)}
          <span>{activeAttachment.fileName}</span>
          <small>{formatAttachmentBytes(activeAttachment.byteSize)}</small>
        </button>
        {onAddToScribble ? <AttachmentScribbleButton attachment={activeAttachment} onAdd={onAddToScribble} /> : null}
        {attachments.length > 1 ? (
          <div className="attachment-controls" aria-label="Attachment navigation">
            <button type="button" title="Previous attachment" onClick={(event) => move(event, -1)}>
              <ChevronLeft size={16} />
            </button>
            <span>{activeIndex + 1}/{attachments.length}</span>
            <button type="button" title="Next attachment" onClick={(event) => move(event, 1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function PostAttachmentCarousel({
  item,
  onOpenPreview,
  onAddToScribble,
  onViewContextChange,
  variant = "feed"
}: {
  item: InquiryItem;
  onOpenPreview: AttachmentPreviewHandler;
  onAddToScribble?: (attachment: InquiryAttachment) => void;
  onViewContextChange?: (context: PdfAttachmentViewContext | null) => void;
  variant?: "feed" | "detail";
}) {
  return (
    <AttachmentCarousel
      attachments={postPreviewAttachments(item)}
      label="Post attachments"
      variant={variant}
      onOpenPreview={(attachmentId) => onOpenPreview(item, attachmentId)}
      onAddToScribble={onAddToScribble}
      onViewContextChange={onViewContextChange}
    />
  );
}

export function attachmentIcon(attachment: InquiryAttachment) {
  const kind = attachmentRenderKind(attachment);
  if (kind === "image") return <ImageIcon size={15} />;
  if (kind === "video") return <Film size={15} />;
  if (kind === "code") return <Code2 size={15} />;
  if (kind === "spreadsheet") return <FileSpreadsheet size={15} />;
  if (kind === "presentation") return <Presentation size={15} />;
  if (kind === "pdf" || kind === "text" || kind === "document") {
    return <FileText size={15} />;
  }
  return <Paperclip size={15} />;
}

function AttachmentPreviewPane({
  attachment,
  mode,
  onOpenPreview,
  onViewContextChange
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  onOpenPreview?: (event: React.MouseEvent<HTMLElement>) => void;
  onViewContextChange?: (context: PdfAttachmentViewContext | null) => void;
}) {
  const kind = attachmentRenderKind(attachment);
  if (kind === "image" && attachment.url) {
    return (
      <div className={`attachment-media attachment-media-${mode}`}>
        <img src={attachment.url} alt="" style={attachmentFocalStyle(attachment)} />
      </div>
    );
  }

  if (kind === "video" && attachment.url) {
    return (
      <div className={`attachment-media attachment-media-${mode}`}>
        <video
          src={attachment.url}
          controls
          playsInline
          preload="metadata"
          style={attachmentFocalStyle(attachment)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenPreview?.(event);
          }}
        />
      </div>
    );
  }

  if (kind === "pdf" && attachment.url) {
    return <PdfAttachmentPreview attachment={attachment} mode={mode} onViewContextChange={onViewContextChange} />;
  }

  if (kind === "code" || kind === "spreadsheet" || kind === "presentation") {
    return <StructuredAttachmentPreviewPane attachment={attachmentForRendering(attachment)} mode={mode} />;
  }

  if (kind === "document" && isDocxAttachment(attachment)) {
    return <DocxAttachmentPreview attachment={attachment} mode={mode} />;
  }

  if (kind === "text" || kind === "document") {
    return <TextAttachmentPreview attachment={attachment} mode={mode} />;
  }

  return (
    <div className={`attachment-document attachment-document-${mode}`}>
      {attachmentIcon(attachment)}
      <strong>{attachment.fileName}</strong>
      <span>{formatAttachmentBytes(attachment.byteSize)}</span>
    </div>
  );
}

function PdfAttachmentPreview({
  attachment,
  mode,
  zoom = 1,
  onViewContextChange
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  zoom?: number;
  onViewContextChange?: (context: PdfAttachmentViewContext | null) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [document, setDocument] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [pageContext, setPageContext] = useState<{
    page: number;
    currentPageText: string;
    previousPageText?: string;
    nextPageText?: string;
  } | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const originalPageCount = document?.numPages ?? attachmentPageCount(attachment);
  const boundedPage = Math.min(Math.max(1, page), Math.max(1, originalPageCount));
  const loadTranslationSource = useCallback(async () => {
    if (document) {
      return boundedDocumentTranslationSource(
        [{ pageNumber: boundedPage, body: await readPdfPageText(document, boundedPage) }],
        true
      );
    }
    const fallback = pdfTranslationSourceFromPreviewText(
      metadataString(attachment.metadata, "previewText"),
      metadataBoolean(attachment.metadata, "pdfTextComplete")
    );
    const currentPage = fallback.pages.find((sourcePage) => sourcePage.pageNumber === boundedPage);
    return {
      pages: currentPage ? [currentPage] : [],
      complete: fallback.complete && Boolean(currentPage)
    };
  }, [attachment.metadata, boundedPage, document]);
  const translation = useDocumentTranslation({
    attachmentId: attachment.id,
    sourceTitle: attachment.fileName,
    sourceKind: "pdf",
    pageNumber: boundedPage,
    loadSource: loadTranslationSource
  });
  const translatedPages = translation.result?.status === "translated" ? translation.result.pages : [];
  const pageCount = originalPageCount;
  const translatedPage = translatedPages.find((translatedSourcePage) => translatedSourcePage.pageNumber === boundedPage);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateSize = () => {
      const next = { width: stage.clientWidth, height: stage.clientHeight };
      if (next.width <= 0 || next.height <= 0) return;
      setStageSize((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setDocument(null);
    setPage(1);
    setPageContext(null);
    setSelectedText("");
    setLoadState("loading");
    if (!attachment.url) {
      setLoadState("unavailable");
      return;
    }

    let cancelled = false;
    let loadingTask: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;
    void loadPdfModule()
      .then((pdfjs) => {
        const sourceUrl = new URL(resolvePdfDocumentUrl(attachment.url!, window.location.href));
        loadingTask = pdfjs.getDocument({
          url: sourceUrl.toString(),
          withCredentials: sourceUrl.origin === window.location.origin,
          enableXfa: false,
          stopAtErrors: false
        });
        return loadingTask.promise;
      })
      .then((loadedDocument) => {
        if (cancelled) {
          void loadingTask?.destroy().catch(() => undefined);
          return;
        }
        setDocument(loadedDocument);
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("unavailable");
      });

    return () => {
      cancelled = true;
      void loadingTask?.destroy().catch(() => undefined);
    };
  }, [attachment.id, attachment.url]);

  useEffect(() => {
    if (!document || translation.showTranslation) return;
    let cancelled = false;
    setPageContext(null);
    const pageNumbers = [boundedPage - 1, boundedPage, boundedPage + 1]
      .filter((pageNumber) => pageNumber >= 1 && pageNumber <= document.numPages);
    void Promise.all(pageNumbers.map(async (pageNumber) => ({
      pageNumber,
      text: await readPdfPageText(document, pageNumber)
    }))).then((pages) => {
      if (cancelled) return;
      const textFor = (pageNumber: number) => pages.find((entry) => entry.pageNumber === pageNumber)?.text ?? "";
      setPageContext({
        page: boundedPage,
        currentPageText: textFor(boundedPage).slice(0, 6000),
        ...(boundedPage > 1 ? { previousPageText: textFor(boundedPage - 1).slice(0, 2000) } : {}),
        ...(boundedPage < document.numPages ? { nextPageText: textFor(boundedPage + 1).slice(0, 2000) } : {})
      });
    }).catch(() => {
      if (!cancelled) {
        setPageContext({ page: boundedPage, currentPageText: "" });
      }
    });
    return () => { cancelled = true; };
  }, [boundedPage, document, translation.showTranslation]);

  useEffect(() => {
    if (!document || translation.showTranslation || !stageSize.width || !stageSize.height) return;
    const canvas = canvasRef.current;
    const textLayerContainer = textLayerRef.current;
    const pageContainer = pageRef.current;
    if (!canvas || !textLayerContainer || !pageContainer) return;

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let textLayer: { cancel: () => void; render: () => Promise<unknown> } | null = null;
    void Promise.all([loadPdfModule(), document.getPage(boundedPage)])
      .then(async ([pdfjs, pdfPage]) => {
        if (cancelled) return;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const availableWidth = Math.max(120, stageSize.width - 24);
        const availableHeight = Math.max(120, stageSize.height - 24);
        const fitScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
        const viewport = pdfPage.getViewport({ scale: Math.max(0.1, fitScale * zoom) });
        const outputScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const cssWidth = Math.max(1, Math.floor(viewport.width));
        const cssHeight = Math.max(1, Math.floor(viewport.height));

        pageContainer.style.width = `${cssWidth}px`;
        pageContainer.style.height = `${cssHeight}px`;
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        textLayerContainer.replaceChildren();

        const textContent = await pdfPage.getTextContent();
        if (cancelled) return;
        renderTask = pdfPage.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
        });
        textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerContainer,
          viewport
        });
        await Promise.all([renderTask.promise, textLayer.render()]);
      })
      .catch((error) => {
        if (!cancelled && error?.name !== "RenderingCancelledException" && error?.name !== "AbortException") {
          setLoadState("unavailable");
        }
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [boundedPage, document, stageSize.height, stageSize.width, translation.showTranslation, zoom]);

  useEffect(() => {
    if (!onViewContextChange) return;
    onViewContextChange({
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      page: boundedPage,
      pageCount: Math.max(1, pageCount),
      currentPageText: translation.showTranslation
        ? translatedPage?.body.slice(0, 6000) ?? ""
        : pageContext?.page === boundedPage ? pageContext.currentPageText : "",
      ...(!translation.showTranslation && pageContext?.page === boundedPage && pageContext.previousPageText ? { previousPageText: pageContext.previousPageText } : {}),
      ...(!translation.showTranslation && pageContext?.page === boundedPage && pageContext.nextPageText ? { nextPageText: pageContext.nextPageText } : {}),
      ...(selectedText ? { selectedText } : {}),
      status: translation.showTranslation
        ? translatedPage ? "ready" : "loading"
        : loadState === "unavailable" ? "unavailable" : pageContext?.page === boundedPage ? "ready" : "loading"
    });
  }, [attachment.fileName, attachment.id, boundedPage, loadState, onViewContextChange, pageContext, pageCount, selectedText, translatedPage, translation.showTranslation]);

  useEffect(() => () => onViewContextChange?.(null), [attachment.id, onViewContextChange]);

  useEffect(() => {
    setSelectedText("");
    const selection = window.getSelection();
    if (selection?.rangeCount && pageRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      selection.removeAllRanges();
    }
  }, [attachment.id, boundedPage]);

  const inspectSelection = () => {
    window.requestAnimationFrame(() => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const pageElement = pageRef.current;
      if (!selection || !range || selection.isCollapsed || !pageElement?.contains(range.commonAncestorContainer)) {
        setSelectedText("");
        return;
      }
      setSelectedText(selection.toString().replace(/\s+/g, " ").trim().slice(0, 4000));
    });
  };

  const movePage = (direction: -1 | 1) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setPage((current) => Math.min(Math.max(1, current + direction), Math.max(1, pageCount)));
  };

  return (
    <div
      className={`attachment-document attachment-document-${mode} attachment-pdf`}
      onClick={(event) => {
        if (mode === "expanded") {
          event.stopPropagation();
          return;
        }
        const target = event.target as HTMLElement;
        const clickedPage = target.closest(".attachment-pdf-page, .attachment-pdf-translation-page");
        const selection = window.getSelection();
        if (!clickedPage || (selection && !selection.isCollapsed && selection.toString().trim())) {
          event.stopPropagation();
        }
      }}
    >
      <div className="attachment-pagebar">
        <span>
          Page {boundedPage}/{Math.max(1, pageCount)}
          {selectedText ? ` · ${selectedText.length} characters selected` : loadState === "loading" ? " · loading" : ""}
        </span>
        <div className="attachment-page-actions">
          <DocumentTranslationControl state={translation} />
          <button type="button" title="Previous PDF page" disabled={boundedPage <= 1 || (!translation.showTranslation && loadState !== "ready")} onClick={movePage(-1)}>
            <ChevronLeft size={15} />
          </button>
          <button type="button" title="Next PDF page" disabled={boundedPage >= pageCount || (!translation.showTranslation && loadState !== "ready")} onClick={movePage(1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div
        ref={stageRef}
        className="attachment-pdf-stage"
        onMouseUp={inspectSelection}
        onKeyUp={inspectSelection}
      >
        {translation.showTranslation && translatedPage ? (
          <article
            className="attachment-pdf-translation-page"
            data-attachment-selectable="true"
            data-attachment-kind="pdf"
            data-attachment-page={translatedPage.pageNumber}
          >
            {plainTextToDocxBlocks(translatedPage.body).map((block) => (
              <p key={block.id} className={`attachment-docx-block attachment-docx-block-${block.style}`}>
                {block.runs.map((run) => run.text).join("")}
              </p>
            ))}
          </article>
        ) : loadState === "unavailable" ? (
          <div className="attachment-file-shell" role="status">
            <FileText size={24} />
            <strong>{attachment.fileName}</strong>
            <span>PDF preview unavailable. The original file is still accessible.</span>
          </div>
        ) : (
          <div
            ref={pageRef}
            className="attachment-pdf-page"
            data-attachment-selectable="true"
            data-attachment-kind="pdf"
            data-attachment-page={boundedPage}
          >
            <canvas ref={canvasRef} role="img" aria-label={`${attachment.fileName}, page ${boundedPage} of ${Math.max(1, pageCount)}`} />
            <div ref={textLayerRef} className="attachment-pdf-text-layer" />
            {loadState === "loading" ? <span className="attachment-pdf-loading" role="status">Preparing page…</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function TextAttachmentPreview({
  attachment,
  mode,
  zoom = 1
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  zoom?: number;
}) {
  const metadataPreviewText = metadataString(attachment.metadata, "previewText");
  const [loadedPreviewText, setLoadedPreviewText] = useState("");
  const [loadingPreviewText, setLoadingPreviewText] = useState(false);
  const previewText = metadataPreviewText || loadedPreviewText;
  const pages = splitPreviewTextIntoPages(previewText);
  const pageCount = attachmentPageCount(attachment, previewText);
  const [page, setPage] = useState(1);
  const boundedPage = Math.min(page, Math.max(pageCount, pages.length));
  const pageText = pages[Math.min(boundedPage - 1, pages.length - 1)] ?? "";

  useEffect(() => {
    setPage(1);
    setLoadedPreviewText("");
    setLoadingPreviewText(false);
    if (metadataPreviewText || !attachment.url) return;
    let cancelled = false;
    const loadPreviewText = async () => {
      setLoadingPreviewText(true);
      try {
        const response = await fetch(attachment.url!, { cache: "force-cache" });
        if (!response.ok) throw new Error("Could not load attachment preview.");
        const blob = await response.blob();
        const file = new File([blob], attachment.fileName, { type: attachment.contentType });
        const metadata = await buildPostAttachmentMetadata(file, attachment.contentType);
        if (!cancelled) setLoadedPreviewText(metadataString(metadata, "previewText"));
      } catch {
        if (!cancelled) setLoadedPreviewText("");
      } finally {
        if (!cancelled) setLoadingPreviewText(false);
      }
    };
    void loadPreviewText();
    return () => { cancelled = true; };
  }, [attachment.contentType, attachment.fileName, attachment.id, attachment.url, metadataPreviewText]);

  return (
    <div className={`attachment-document attachment-document-${mode}`}>
      <div className="attachment-pagebar">
        <span>Page {boundedPage}/{Math.max(pageCount, pages.length)}</span>
        {Math.max(pageCount, pages.length) > 1 ? (
          <div>
            <button
              type="button"
              title="Previous page"
              disabled={boundedPage <= 1}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              title="Next page"
              disabled={boundedPage >= Math.max(pageCount, pages.length)}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.min(Math.max(pageCount, pages.length), current + 1));
              }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        ) : null}
      </div>
      {pageText ? (
        <pre data-attachment-selectable="true" data-attachment-page={boundedPage} style={mode === "expanded" ? { fontSize: `${0.86 * zoom}rem` } : undefined}>{pageText}</pre>
      ) : (
        <div className="attachment-file-shell">
          {attachmentIcon(attachment)}
          <strong>{attachment.fileName}</strong>
          <span>{loadingPreviewText ? "Preparing preview…" : formatAttachmentBytes(attachment.byteSize)}</span>
        </div>
      )}
    </div>
  );
}

function DocxAttachmentPreview({
  attachment,
  mode,
  zoom = 1
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  zoom?: number;
}) {
  const metadataPreviewText = metadataString(attachment.metadata, "previewText");
  const [loadedPreviewText, setLoadedPreviewText] = useState("");
  const fallbackText = metadataPreviewText || loadedPreviewText;
  const fallbackBlocks = useMemo(
    () => plainTextToDocxBlocks(fallbackText),
    [fallbackText]
  );
  const fallbackPages = useMemo(() => paginateDocxBlocks(fallbackBlocks), [fallbackBlocks]);
  const metadataPageCount = attachmentPageCount(attachment, fallbackText);
  const renderTargetRef = useRef<HTMLDivElement>(null);
  const [renderedPageCount, setRenderedPageCount] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [parseFailed, setParseFailed] = useState(false);
  const [page, setPage] = useState(1);
  const originalTotalPages = Math.max(1, renderedPageCount || metadataPageCount || fallbackPages.length);
  const boundedPage = Math.min(page, originalTotalPages);
  const fallbackPageBlocks = fallbackPages[Math.min(boundedPage - 1, fallbackPages.length - 1)] ?? [];
  const loadTranslationSource = useCallback(async () => {
    const target = renderTargetRef.current;
    const renderedPage = renderedPageCount
      ? Array.from(target?.querySelectorAll<HTMLElement>("section.symposium-docx") ?? [])[boundedPage - 1]
      : undefined;
    if (attachment.url && !parseFailed && !renderedPageCount) {
      throw new Error("This page is still being prepared. Please try again in a moment.");
    }
    const renderedBlocks = renderedPage
      ? Array.from(renderedPage.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li"))
        .map((block) => block.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean)
      : [];
    const fallbackBody = fallbackPageBlocks
      .map((block) => block.runs.map((run) => run.text).join(""))
      .join("\n\n")
      .trim();
    const body = (renderedBlocks.length
      ? renderedBlocks.join("\n\n")
      : renderedPage?.textContent?.replace(/\s+/g, " ").trim()) || fallbackBody;
    return boundedDocumentTranslationSource(
      body ? [{ pageNumber: boundedPage, body }] : [],
      Boolean(body)
    );
  }, [attachment.url, boundedPage, fallbackPageBlocks, parseFailed, renderedPageCount]);
  const translation = useDocumentTranslation({
    attachmentId: attachment.id,
    sourceTitle: attachment.fileName,
    sourceKind: "docx",
    pageNumber: boundedPage,
    loadSource: loadTranslationSource
  });
  const translatedPages = translation.result?.status === "translated" ? translation.result.pages : [];
  const totalPages = originalTotalPages;
  const translatedPage = translatedPages.find((translatedSourcePage) => translatedSourcePage.pageNumber === boundedPage);
  const translatedPageBlocks = plainTextToDocxBlocks(translatedPage?.body ?? "");
  const renderedZoom = fitScale * (mode === "expanded" ? clampAttachmentZoom(zoom) : 1);
  const renderedStyle = {
    "--docx-preview-scale": renderedZoom
  } as CSSProperties;

  useEffect(() => {
    setPage(1);
  }, [attachment.id]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const target = renderTargetRef.current;
    if (target) target.replaceChildren();
    setRenderedPageCount(0);
    setFitScale(1);
    setParseFailed(false);
    setLoadedPreviewText("");

    if (!attachment.url || !target) return;
    const attachmentUrl = attachment.url;

    const loadDocx = async () => {
      try {
        const response = await fetch(attachmentUrl, { cache: "force-cache" });
        if (!response.ok) throw new Error("Could not load document.");
        const bytes = await response.arrayBuffer();
        if (!metadataPreviewText) {
          const extracted = await extractDocxMetadata(new File([bytes], attachment.fileName, { type: attachment.contentType }));
          if (!cancelled) setLoadedPreviewText(metadataString(extracted, "previewText"));
        }
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;

        await renderAsync(bytes, target, target, {
          breakPages: true,
          className: "symposium-docx",
          experimental: true,
          ignoreFonts: false,
          ignoreHeight: false,
          ignoreLastRenderedPageBreak: false,
          ignoreWidth: false,
          inWrapper: true,
          renderComments: false,
          renderEndnotes: true,
          renderFooters: true,
          renderFootnotes: true,
          renderHeaders: true,
          renderAltChunks: false,
          useBase64URL: true
        });

        if (cancelled) return;
        sanitizeRenderedDocx(target);
        const renderedPages = Array.from(target.querySelectorAll<HTMLElement>("section.symposium-docx"));
        if (!renderedPages.length) throw new Error("Document pages missing.");
        renderedPages.forEach((renderedPage, index) => {
          renderedPage.hidden = index !== 0;
          renderedPage.dataset.attachmentSelectable = "true";
          renderedPage.dataset.attachmentPage = String(index + 1);
        });
        const firstPageWidth = renderedPages[0]?.getBoundingClientRect().width ?? 0;
        const updateFitScale = () => {
          const availableWidth = Math.max(1, target.clientWidth - 28);
          setFitScale(firstPageWidth > 0 ? Math.min(1, availableWidth / firstPageWidth) : 1);
        };
        updateFitScale();
        resizeObserver = new ResizeObserver(updateFitScale);
        resizeObserver.observe(target);
        setRenderedPageCount(renderedPages.length);
      } catch {
        if (!cancelled) {
          target.replaceChildren();
          setParseFailed(true);
        }
      }
    };

    void loadDocx();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      target.replaceChildren();
    };
  }, [attachment.contentType, attachment.fileName, attachment.id, attachment.url, metadataPreviewText, mode]);

  useEffect(() => {
    const target = renderTargetRef.current;
    if (!target || !renderedPageCount) return;
    const renderedPages = Array.from(target.querySelectorAll<HTMLElement>("section.symposium-docx"));
    renderedPages.forEach((renderedPage, index) => {
      renderedPage.hidden = translation.showTranslation || index !== boundedPage - 1;
    });
    target.closest<HTMLElement>(".attachment-docx-scroll")?.scrollTo({ top: 0, left: 0 });
  }, [boundedPage, renderedPageCount, translation.showTranslation]);

  return (
    <div className={`attachment-document attachment-document-${mode} attachment-docx`}>
      <div className="attachment-pagebar">
        <span>Page {boundedPage}/{totalPages}</span>
        <div className="attachment-page-actions">
          <DocumentTranslationControl state={translation} />
          {totalPages > 1 ? (
            <>
            <button
              type="button"
              title="Previous page"
              disabled={boundedPage <= 1}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              title="Next page"
              disabled={boundedPage >= totalPages}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.min(totalPages, current + 1));
              }}
            >
              <ChevronRight size={15} />
            </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="attachment-docx-scroll">
        <div
          ref={renderTargetRef}
          className="attachment-docx-rendered"
          style={renderedStyle}
          aria-label={`${attachment.fileName} document preview`}
        />
        {translation.showTranslation && translatedPage ? (
          <article
            className="attachment-docx-page attachment-docx-derived"
            data-attachment-selectable="true"
            data-attachment-page={translatedPage.pageNumber}
          >
            {translatedPageBlocks.map((block) => (
              <p key={block.id} className={`attachment-docx-block attachment-docx-block-${block.style}`}>
                {block.runs.map((run) => run.text).join("")}
              </p>
            ))}
          </article>
        ) : !renderedPageCount ? (
          <article className="attachment-docx-page attachment-docx-fallback" data-attachment-selectable="true" data-attachment-page={boundedPage}>
            {fallbackPageBlocks.length ? (
              fallbackPageBlocks.map((block) => (
                <p key={block.id} className={`attachment-docx-block attachment-docx-block-${block.style}`}>
                  {block.style === "list" ? <span className="attachment-docx-bullet" aria-hidden="true">•</span> : null}
                  <span>
                    {block.runs.map((run, runIndex) => (
                      <span
                        key={`${block.id}-${runIndex}`}
                        className={[
                          run.bold ? "attachment-docx-bold" : "",
                          run.italic ? "attachment-docx-italic" : "",
                          run.underline ? "attachment-docx-underline" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {run.text}
                      </span>
                    ))}
                  </span>
                </p>
              ))
            ) : (
              <div className="attachment-file-shell">
                {attachmentIcon(attachment)}
                <strong>{attachment.fileName}</strong>
                <span>{parseFailed ? "Document formatting could not be rendered. Showing the available text preview." : "Preparing original document formatting."}</span>
              </div>
            )}
          </article>
        ) : null}
      </div>
    </div>
  );
}

function ImageRegionOverlay({
  active,
  region,
  onChange
}: {
  active: boolean;
  region: ImageRegion | null;
  onChange: (region: ImageRegion | null) => void;
}) {
  const startRef = useRef<UnitPoint | null>(null);
  const pointerRef = useRef<number | null>(null);

  const pointForEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)))
    };
  };

  if (!active) return null;
  return (
    <div
      className="attachment-image-region-overlay"
      role="application"
      aria-label="Drag over the image to select a region"
      onPointerDown={(event) => {
        if (event.button !== 0 && event.pointerType === "mouse") return;
        event.preventDefault();
        event.stopPropagation();
        const point = pointForEvent(event);
        startRef.current = point;
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        onChange(orderedImageRegion(point, point));
      }}
      onPointerMove={(event) => {
        if (pointerRef.current !== event.pointerId || !startRef.current) return;
        event.preventDefault();
        onChange(orderedImageRegion(startRef.current, pointForEvent(event)));
      }}
      onPointerUp={(event) => {
        if (pointerRef.current !== event.pointerId || !startRef.current) return;
        event.preventDefault();
        const next = orderedImageRegion(startRef.current, pointForEvent(event));
        pointerRef.current = null;
        startRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        onChange(next.width >= 0.01 && next.height >= 0.01 ? next : null);
      }}
      onPointerCancel={(event) => {
        if (pointerRef.current !== event.pointerId) return;
        pointerRef.current = null;
        startRef.current = null;
        onChange(null);
      }}
    >
      {region ? <span className="attachment-image-region-selection" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} /> : null}
    </div>
  );
}

function ExpandedMediaPreview({
  attachment,
  zoom,
  viewportSize,
  imageSelectionActive = false,
  imageRegion = null,
  onImageRegionChange = () => undefined
}: {
  attachment: InquiryAttachment;
  zoom: number;
  viewportSize: AttachmentViewportSize | null;
  imageSelectionActive?: boolean;
  imageRegion?: ImageRegion | null;
  onImageRegionChange?: (region: ImageRegion | null) => void;
}) {
  const kind = attachmentRenderKind(attachment);
  const [intrinsicSize, setIntrinsicSize] = useState<MediaIntrinsicSize | null>(() =>
    attachmentMediaSize(attachment)
  );
  const mediaSize = fitMediaSizeToViewport(intrinsicSize, viewportSize, clampAttachmentZoom(zoom));
  const mediaStyle = mediaSize
    ? ({
        width: `${mediaSize.width}px`,
        height: `${mediaSize.height}px`
      } satisfies CSSProperties)
    : undefined;
  const mediaShellStyle =
    mediaSize && viewportSize
      ? ({
          width: `${Math.max(mediaSize.width, viewportSize.width)}px`,
          height: `${Math.max(mediaSize.height, viewportSize.height)}px`
        } satisfies CSSProperties)
      : undefined;

  useEffect(() => {
    setIntrinsicSize(attachmentMediaSize(attachment));
  }, [attachment.id]);

  if (kind === "image" && attachment.url) {
    return (
      <div className="attachment-expanded-media" style={mediaShellStyle}>
        <div className="attachment-expanded-image" style={mediaStyle ?? { width: "100%", height: "100%" }}>
          <img
            src={attachment.url}
            alt=""
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                setIntrinsicSize({ width: image.naturalWidth, height: image.naturalHeight });
              }
            }}
          />
          <ImageRegionOverlay active={imageSelectionActive} region={imageRegion} onChange={onImageRegionChange} />
        </div>
      </div>
    );
  }

  if (kind === "video" && attachment.url) {
    return (
      <div className="attachment-expanded-media" style={mediaShellStyle}>
        <video
          src={attachment.url}
          controls
          playsInline
          preload="metadata"
          style={mediaStyle}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setIntrinsicSize({ width: video.videoWidth, height: video.videoHeight });
            }
          }}
        />
      </div>
    );
  }

  return null;
}

export function AttachmentExpandedPane({
  attachment,
  zoom,
  viewportSize,
  imageSelectionActive,
  imageRegion,
  onImageRegionChange,
  onCite,
  onViewContextChange
}: {
  attachment: InquiryAttachment;
  zoom: number;
  viewportSize: AttachmentViewportSize | null;
  imageSelectionActive: boolean;
  imageRegion: ImageRegion | null;
  onImageRegionChange: (region: ImageRegion | null) => void;
  onCite?: (excerpt: string, locator: DocumentCitationLocatorContract) => void;
  onViewContextChange?: (context: PdfAttachmentViewContext | null) => void;
}) {
  const kind = attachmentRenderKind(attachment);
  if (kind === "image" || kind === "video") {
    return <ExpandedMediaPreview attachment={attachment} zoom={zoom} viewportSize={viewportSize} imageSelectionActive={imageSelectionActive} imageRegion={imageRegion} onImageRegionChange={onImageRegionChange} />;
  }

  if (kind === "pdf" && attachment.url) {
    return <PdfAttachmentPreview attachment={attachment} mode="expanded" zoom={zoom} onViewContextChange={onViewContextChange} />;
  }

  if (kind === "code" || kind === "spreadsheet" || kind === "presentation") {
    return <StructuredAttachmentPreviewPane attachment={attachmentForRendering(attachment)} mode="expanded" zoom={zoom} onCite={onCite} />;
  }

  if (kind === "document" && isDocxAttachment(attachment)) {
    return <DocxAttachmentPreview attachment={attachment} mode="expanded" zoom={zoom} />;
  }

  if (kind === "text" || kind === "document") {
    return <TextAttachmentPreview attachment={attachment} mode="expanded" zoom={zoom} />;
  }

  return (
    <div className="attachment-document attachment-document-expanded">
      <div className="attachment-file-shell">
        {attachmentIcon(attachment)}
        <strong>{attachment.fileName}</strong>
        <span>{formatAttachmentBytes(attachment.byteSize)}</span>
      </div>
    </div>
  );
}
