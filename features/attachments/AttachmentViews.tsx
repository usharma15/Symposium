"use client";

import {
  useEffect,
  useLayoutEffect,
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
  ExternalLink,
  Fullscreen,
  ImageIcon,
  Paperclip,
  Presentation,
  RotateCcw,
  Shrink,
  X,
  ZoomIn,
  ZoomOut
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
import { feedPreviewAttachments } from "@/lib/documentModel";
import { deletedPostContextTitle, isDeletedPost } from "@/lib/symposiumCore";
import { isSafeExternalUrl } from "@/packages/contracts/src";

export type AttachmentPreviewHandler = (item: InquiryItem, attachmentId: string) => void;
export type AttachmentUploadHandler = (file: File) => Promise<InquiryAttachment>;
type AttachmentRenderMode = "feed" | "detail" | "modal" | "expanded";
type MediaIntrinsicSize = { width: number; height: number };
type AttachmentViewportSize = { width: number; height: number };
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

const clampAttachmentZoom = (value: number) =>
  Math.min(maxAttachmentZoom, Math.max(minAttachmentZoom, Math.round(value * 100) / 100));

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

const extractPdfMetadata = async (file: File) => {
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length ? { pageCount: matches.length } : {};
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
    if (contentType === "application/pdf") return extractPdfMetadata(file);
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

const startAttachmentDrag = (attachment: InquiryAttachment) => (event: React.DragEvent<HTMLElement>) => {
  if (!attachment.url) return;
  const url = new URL(attachment.url, window.location.href).toString();
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("DownloadURL", `${attachment.contentType}:${attachment.fileName}:${url}`);
};


function postPreviewAttachments(item: InquiryItem) {
  if (isDeletedPost(item)) return [];
  return feedPreviewAttachments(item.document, item.attachments ?? []).filter((attachment) => attachment.url);
}

const visibleAttachments = (attachments: InquiryAttachment[]) =>
  attachments.filter((attachment) => attachment.url);

export function AttachmentCarousel({
  attachments: sourceAttachments,
  label = "Attachments",
  onOpenPreview,
  variant = "feed"
}: {
  attachments: InquiryAttachment[];
  label?: string;
  onOpenPreview: (attachmentId: string) => void;
  variant?: "feed" | "detail" | "comment";
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
        <AttachmentPreviewPane attachment={activeAttachment} mode={previewMode} onOpenPreview={openPreview} />
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
  variant = "feed"
}: {
  item: InquiryItem;
  onOpenPreview: AttachmentPreviewHandler;
  variant?: "feed" | "detail";
}) {
  return (
    <AttachmentCarousel
      attachments={postPreviewAttachments(item)}
      label="Post attachments"
      variant={variant}
      onOpenPreview={(attachmentId) => onOpenPreview(item, attachmentId)}
    />
  );
}

export function attachmentIcon(attachment: InquiryAttachment) {
  if (attachment.kind === "image") return <ImageIcon size={15} />;
  if (attachment.kind === "video") return <Film size={15} />;
  if (attachment.kind === "code") return <Code2 size={15} />;
  if (attachment.kind === "spreadsheet") return <FileSpreadsheet size={15} />;
  if (attachment.kind === "presentation") return <Presentation size={15} />;
  if (attachment.kind === "pdf" || attachment.kind === "text" || attachment.kind === "document") {
    return <FileText size={15} />;
  }
  return <Paperclip size={15} />;
}

function AttachmentPreviewPane({
  attachment,
  mode,
  onOpenPreview
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  onOpenPreview?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  if (attachment.kind === "image" && attachment.url) {
    return (
      <div className={`attachment-media attachment-media-${mode}`}>
        <img src={attachment.url} alt="" style={attachmentFocalStyle(attachment)} />
      </div>
    );
  }

  if (attachment.kind === "video" && attachment.url) {
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

  if (attachment.kind === "pdf" && attachment.url) {
    return <PdfAttachmentPreview attachment={attachment} mode={mode} />;
  }

  if (attachment.kind === "code" || attachment.kind === "spreadsheet" || attachment.kind === "presentation") {
    return <StructuredAttachmentPreviewPane attachment={attachment} mode={mode} />;
  }

  if (attachment.kind === "document" && isDocxAttachment(attachment)) {
    return <DocxAttachmentPreview attachment={attachment} mode={mode} />;
  }

  if (attachment.kind === "text" || attachment.kind === "document") {
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
  zoom = 1
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  zoom?: number;
}) {
  const zoomFragment = mode === "expanded" ? `#zoom=${Math.round(zoom * 100)}` : "";
  const source = attachment.url ? `${attachment.url}${zoomFragment}` : undefined;

  return (
    <div className={`attachment-document attachment-document-${mode} attachment-pdf`}>
      {source ? <iframe title={attachment.fileName} src={source} /> : null}
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
  const previewText = metadataString(attachment.metadata, "previewText");
  const pages = splitPreviewTextIntoPages(previewText);
  const pageCount = attachmentPageCount(attachment, previewText);
  const [page, setPage] = useState(1);
  const boundedPage = Math.min(page, Math.max(pageCount, pages.length));
  const pageText = pages[Math.min(boundedPage - 1, pages.length - 1)] ?? "";

  useEffect(() => {
    setPage(1);
  }, [attachment.id]);

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
        <pre style={mode === "expanded" ? { fontSize: `${0.86 * zoom}rem` } : undefined}>{pageText}</pre>
      ) : (
        <div className="attachment-file-shell">
          {attachmentIcon(attachment)}
          <strong>{attachment.fileName}</strong>
          <span>{formatAttachmentBytes(attachment.byteSize)}</span>
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
  const fallbackBlocks = useMemo(
    () => plainTextToDocxBlocks(metadataString(attachment.metadata, "previewText")),
    [attachment.metadata]
  );
  const fallbackPages = paginateDocxBlocks(fallbackBlocks);
  const metadataPageCount = attachmentPageCount(attachment, metadataString(attachment.metadata, "previewText"));
  const renderTargetRef = useRef<HTMLDivElement>(null);
  const [renderedPageCount, setRenderedPageCount] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [parseFailed, setParseFailed] = useState(false);
  const totalPages = Math.max(1, renderedPageCount || metadataPageCount || fallbackPages.length);
  const [page, setPage] = useState(1);
  const boundedPage = Math.min(page, totalPages);
  const fallbackPageBlocks = fallbackPages[Math.min(boundedPage - 1, fallbackPages.length - 1)] ?? [];
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

    if (!attachment.url || !target) return;
    const attachmentUrl = attachment.url;

    const loadDocx = async () => {
      try {
        const response = await fetch(attachmentUrl, { cache: "force-cache" });
        if (!response.ok) throw new Error("Could not load document.");
        const bytes = await response.arrayBuffer();
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
  }, [attachment.id, attachment.url, mode]);

  useEffect(() => {
    const target = renderTargetRef.current;
    if (!target || !renderedPageCount) return;
    const renderedPages = Array.from(target.querySelectorAll<HTMLElement>("section.symposium-docx"));
    renderedPages.forEach((renderedPage, index) => {
      renderedPage.hidden = index !== boundedPage - 1;
    });
    target.closest<HTMLElement>(".attachment-docx-scroll")?.scrollTo({ top: 0, left: 0 });
  }, [boundedPage, renderedPageCount]);

  return (
    <div className={`attachment-document attachment-document-${mode} attachment-docx`}>
      <div className="attachment-pagebar">
        <span>Page {boundedPage}/{totalPages}</span>
        {totalPages > 1 ? (
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
              disabled={boundedPage >= totalPages}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.min(totalPages, current + 1));
              }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="attachment-docx-scroll">
        <div
          ref={renderTargetRef}
          className="attachment-docx-rendered"
          style={renderedStyle}
          aria-label={`${attachment.fileName} document preview`}
        />
        {!renderedPageCount ? (
          <article className="attachment-docx-page attachment-docx-fallback">
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

function ExpandedMediaPreview({
  attachment,
  zoom,
  viewportSize
}: {
  attachment: InquiryAttachment;
  zoom: number;
  viewportSize: AttachmentViewportSize | null;
}) {
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

  if (attachment.kind === "image" && attachment.url) {
    return (
      <div className="attachment-expanded-media" style={mediaShellStyle}>
        <img
          src={attachment.url}
          alt=""
          style={mediaStyle}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              setIntrinsicSize({ width: image.naturalWidth, height: image.naturalHeight });
            }
          }}
        />
      </div>
    );
  }

  if (attachment.kind === "video" && attachment.url) {
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

function AttachmentExpandedPane({
  attachment,
  zoom,
  viewportSize
}: {
  attachment: InquiryAttachment;
  zoom: number;
  viewportSize: AttachmentViewportSize | null;
}) {
  if (attachment.kind === "image" || attachment.kind === "video") {
    return <ExpandedMediaPreview attachment={attachment} zoom={zoom} viewportSize={viewportSize} />;
  }

  if (attachment.kind === "pdf" && attachment.url) {
    return <PdfAttachmentPreview attachment={attachment} mode="expanded" zoom={zoom} />;
  }

  if (attachment.kind === "code" || attachment.kind === "spreadsheet" || attachment.kind === "presentation") {
    return <StructuredAttachmentPreviewPane attachment={attachment} mode="expanded" zoom={zoom} />;
  }

  if (attachment.kind === "document" && isDocxAttachment(attachment)) {
    return <DocxAttachmentPreview attachment={attachment} mode="expanded" zoom={zoom} />;
  }

  if (attachment.kind === "text" || attachment.kind === "document") {
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

export function AttachmentPreviewModal({
  item,
  attachmentId,
  onClose
}: {
  item: InquiryItem;
  attachmentId: string;
  onClose: () => void;
}) {
  const attachments = postPreviewAttachments(item);
  const attachmentIdsKey = attachments.map((attachment) => attachment.id).join("|");
  const initialIndex = Math.max(0, attachments.findIndex((attachment) => attachment.id === attachmentId));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeAttachment = attachments[Math.min(activeIndex, Math.max(attachments.length - 1, 0))];
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stageSize, setStageSize] = useState<AttachmentViewportSize | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveIndex(Math.max(0, attachments.findIndex((attachment) => attachment.id === attachmentId)));
  }, [attachmentId, attachmentIdsKey]);

  useEffect(() => {
    if (!activeAttachment) return;
    setZoom(1);
  }, [activeAttachment?.id]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateStageSize = () => {
      const nextSize = {
        width: stage.clientWidth,
        height: stage.clientHeight
      };
      if (nextSize.width <= 0 || nextSize.height <= 0) return;
      setStageSize((currentSize) =>
        currentSize?.width === nextSize.width && currentSize?.height === nextSize.height ? currentSize : nextSize
      );
    };
    updateStageSize();
    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(stage);
    window.addEventListener("resize", updateStageSize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateStageSize);
    };
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let secondFrame = 0;
    let firstTimeout = 0;
    let secondTimeout = 0;
    const centerStage = () => {
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
    };
    const frame = window.requestAnimationFrame(() => {
      centerStage();
      secondFrame = window.requestAnimationFrame(centerStage);
      firstTimeout = window.setTimeout(centerStage, 60);
      secondTimeout = window.setTimeout(centerStage, 180);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (firstTimeout) window.clearTimeout(firstTimeout);
      if (secondTimeout) window.clearTimeout(secondTimeout);
    };
  }, [activeAttachment?.id, stageSize?.height, stageSize?.width, zoom]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === modalRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) onClose();
      if (event.key === "ArrowLeft" && attachments.length > 1) {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + attachments.length) % attachments.length);
      }
      if (event.key === "ArrowRight" && attachments.length > 1) {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % attachments.length);
      }
      if ((event.key === "+" || event.key === "=") && activeAttachment) {
        event.preventDefault();
        setZoom((current) => clampAttachmentZoom(current + zoomInStep));
      }
      if (event.key === "-" && activeAttachment) {
        event.preventDefault();
        setZoom((current) => clampAttachmentZoom(current - zoomOutStep));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeAttachment, attachments.length, onClose]);

  if (!activeAttachment) return null;

  const closeModal = () => {
    if (document.fullscreenElement === modalRef.current) {
      void document.exitFullscreen().then(onClose, onClose);
      return;
    }
    onClose();
  };

  const resetZoom = () => setZoom(1);
  const adjustZoom = (delta: number) => {
    setZoom((current) => clampAttachmentZoom(current + delta));
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === modalRef.current) {
        await document.exitFullscreen();
      } else {
        await modalRef.current?.requestFullscreen();
      }
    } catch {
      setIsFullscreen(false);
    }
  };
  const zoomControls = (
    <div className="attachment-zoom-controls">
      <button type="button" title="Zoom out" onClick={() => adjustZoom(-zoomOutStep)}>
        <ZoomOut size={15} />
      </button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" title="Zoom in" onClick={() => adjustZoom(zoomInStep)}>
        <ZoomIn size={15} />
      </button>
      <button type="button" title="Reset zoom" onClick={resetZoom}>
        <RotateCcw size={15} />
      </button>
    </div>
  );
  const fullscreenButton = (
    <button type="button" title={isFullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
      {isFullscreen ? <Shrink size={15} /> : <Fullscreen size={15} />}
    </button>
  );
  const openDedicatedViewer = () => {
    if (item.id === "composer-preview") return;
    const href = `/posts/${encodeURIComponent(item.id)}?viewer=full&attachment=${encodeURIComponent(activeAttachment.id)}`;
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="attachment-modal-backdrop" role="presentation" onClick={closeModal}>
      <section
        ref={modalRef}
        className={`attachment-modal${isFullscreen ? " attachment-modal-fullscreen" : ""}`}
        aria-label="Attachment preview"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div className="attachment-modal-title">
            <span>{deletedPostContextTitle(item)}</span>
          </div>
          <div className="attachment-modal-header-controls" role="group" aria-label="Attachment viewing controls">
            {isFullscreen ? zoomControls : null}
            {isFullscreen ? fullscreenButton : null}
            {item.id !== "composer-preview" ? <button type="button" title="Open in a new tab" onClick={openDedicatedViewer}><ExternalLink size={15} /></button> : null}
            {activeAttachment.url ? <a href={activeAttachment.url} target="_blank" rel="noopener noreferrer" title="Open original file" aria-label="Open original file"><FileText size={15} /></a> : null}
            <button type="button" title="Close" onClick={closeModal}>
              <X size={17} />
            </button>
          </div>
        </header>

        {!isFullscreen ? (
          <div className="attachment-modal-toolbar" aria-label="Attachment viewing controls">
            {zoomControls}
            {fullscreenButton}
          </div>
        ) : null}

        <div
          ref={stageRef}
          className={`attachment-modal-stage attachment-modal-stage-${activeAttachment.kind}`}
          draggable={Boolean(activeAttachment.url)}
          onDragStart={startAttachmentDrag(activeAttachment)}
        >
          <AttachmentExpandedPane attachment={activeAttachment} zoom={zoom} viewportSize={stageSize} />
        </div>

        <footer className="attachment-modal-footer">
          {attachments.length > 1 ? (
            <div className="attachment-modal-navigation">
              <button type="button" title="Previous attachment" onClick={() => setActiveIndex((current) => (current - 1 + attachments.length) % attachments.length)}>
                <ChevronLeft size={17} />
              </button>
              <span>{activeIndex + 1}/{attachments.length}</span>
              <button type="button" title="Next attachment" onClick={() => setActiveIndex((current) => (current + 1) % attachments.length)}>
                <ChevronRight size={17} />
              </button>
            </div>
          ) : (
            <span />
          )}
          <small>{formatAttachmentBytes(activeAttachment.byteSize)}</small>
        </footer>
      </section>
    </div>
  );
}
