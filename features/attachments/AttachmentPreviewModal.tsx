"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  ExternalLink,
  FileText,
  Fullscreen,
  PenLine,
  RotateCcw,
  Shrink,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { InquiryAttachment, InquiryItem } from "@/lib/mockData";
import { formatAttachmentBytes } from "@/lib/attachmentRules";
import { deletedPostContextTitle } from "@/lib/symposiumCore";
import type { DocumentCitationLocatorContract } from "@/packages/contracts/src";
import {
  AttachmentExpandedPane,
  attachmentRenderKind,
  clampAttachmentZoom,
  postPreviewAttachments,
  startAttachmentDrag,
  textOffsetWithin,
  visibleAttachments,
  type AttachmentCitationCapture,
  type AttachmentViewportSize,
  type ImageRegion
} from "@/features/attachments/AttachmentViews";
import {
  readDocumentReadingPosition,
  reapplyDocumentReadingPosition
} from "@/features/attachments/documentViewerSession";
import type { PdfAttachmentViewContext } from "@/features/attachments/pdfAttachmentClient";

const zoomInStep = 0.2;
const zoomOutStep = 0.1;

export function AttachmentPreviewModal({
  item,
  attachments: sourceAttachments,
  contextTitle,
  attachmentId,
  onClose,
  onCapture,
  onViewContextChange
}: {
  item?: InquiryItem;
  attachments?: InquiryAttachment[];
  contextTitle?: string;
  attachmentId: string;
  onClose: () => void;
  onCapture?: (capture: AttachmentCitationCapture) => void;
  onViewContextChange?: (context: PdfAttachmentViewContext | null) => void;
}) {
  const attachments = sourceAttachments ? visibleAttachments(sourceAttachments) : item ? postPreviewAttachments(item) : [];
  const attachmentIdsKey = attachments.map((attachment) => attachment.id).join("|");
  const initialIndex = Math.max(0, attachments.findIndex((attachment) => attachment.id === attachmentId));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeAttachment = attachments[Math.min(activeIndex, Math.max(attachments.length - 1, 0))];
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stageSize, setStageSize] = useState<AttachmentViewportSize | null>(null);
  const [imageSelectionActive, setImageSelectionActive] = useState(false);
  const [imageRegion, setImageRegion] = useState<ImageRegion | null>(null);
  const [textSelection, setTextSelection] = useState<{
    excerpt: string;
    left: number;
    top: number;
    locator: DocumentCitationLocatorContract;
  } | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewTransitionAnchorRef = useRef<ReturnType<typeof readDocumentReadingPosition> | null>(null);

  useEffect(() => {
    setActiveIndex(Math.max(0, attachments.findIndex((attachment) => attachment.id === attachmentId)));
  }, [attachmentId, attachmentIdsKey]);

  useEffect(() => {
    if (!activeAttachment) return;
    setZoom(1);
    setImageSelectionActive(false);
    setImageRegion(null);
    setTextSelection(null);
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

  useLayoutEffect(() => {
    const anchor = viewTransitionAnchorRef.current;
    if (!anchor || !activeAttachment) return;
    const sourceId = "attachment-modal-view-transition";
    let secondFrame = 0;
    let firstTimeout = 0;
    let secondTimeout = 0;
    const restoreAnchor = () => {
      reapplyDocumentReadingPosition(activeAttachment.id, anchor, sourceId);
    };
    restoreAnchor();
    const frame = window.requestAnimationFrame(() => {
      restoreAnchor();
      secondFrame = window.requestAnimationFrame(restoreAnchor);
      firstTimeout = window.setTimeout(restoreAnchor, 80);
      secondTimeout = window.setTimeout(() => {
        restoreAnchor();
        if (viewTransitionAnchorRef.current === anchor) {
          viewTransitionAnchorRef.current = null;
        }
      }, 180);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (firstTimeout) window.clearTimeout(firstTimeout);
      if (secondTimeout) window.clearTimeout(secondTimeout);
    };
  }, [activeAttachment?.id, isFullscreen, stageSize?.height, stageSize?.width, zoom]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === modalRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && imageSelectionActive) {
        event.preventDefault();
        setImageSelectionActive(false);
        setImageRegion(null);
        return;
      }
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
  }, [activeAttachment, attachments.length, imageSelectionActive, onClose]);

  if (!activeAttachment) return null;

  const closeModal = () => {
    if (document.fullscreenElement === modalRef.current) {
      void document.exitFullscreen().then(onClose, onClose);
      return;
    }
    onClose();
  };

  const preserveReadingAnchor = () => {
    viewTransitionAnchorRef.current = readDocumentReadingPosition(activeAttachment.id);
  };
  const resetZoom = () => {
    preserveReadingAnchor();
    setZoom(1);
  };
  const adjustZoom = (delta: number) => {
    preserveReadingAnchor();
    setZoom((current) => clampAttachmentZoom(current + delta));
  };
  const toggleFullscreen = async () => {
    preserveReadingAnchor();
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
    if (!item || sourceAttachments || item.id === "composer-preview") return;
    const href = `/posts/${encodeURIComponent(item.id)}?viewer=full&attachment=${encodeURIComponent(activeAttachment.id)}`;
    window.open(href, "_blank", "noopener,noreferrer");
  };
  const capture = (excerpt: string, locator: DocumentCitationLocatorContract) => {
    onCapture?.({ attachment: activeAttachment, excerpt: excerpt.trim().slice(0, 4000), locator });
  };
  const captureWholeAttachment = () => capture(activeAttachment.fileName, { kind: "whole" });
  const captureImageRegion = () => {
    if (!imageRegion) return;
    capture(`Image region from ${activeAttachment.fileName}`, imageRegion);
    setImageSelectionActive(false);
    setImageRegion(null);
  };
  const inspectTextSelection = () => {
    if (!onCapture || imageSelectionActive) {
      setTextSelection(null);
      return;
    }
    const selected = window.getSelection();
    const range = selected?.rangeCount ? selected.getRangeAt(0) : null;
    const stage = stageRef.current;
    if (!selected || !range || !stage || selected.isCollapsed || !stage.contains(range.commonAncestorContainer)) {
      setTextSelection(null);
      return;
    }
    const startElement = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement)?.closest<HTMLElement>("[data-attachment-selectable]");
    const endElement = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement)?.closest<HTMLElement>("[data-attachment-selectable]");
    if (!startElement || !endElement || startElement !== endElement || !stage.contains(startElement)) {
      setTextSelection(null);
      return;
    }
    const excerpt = selected.toString().replace(/\s+/g, " ").trim().slice(0, 4000);
    if (!excerpt) {
      setTextSelection(null);
      return;
    }
    const bounds = range.getBoundingClientRect();
    const page = Math.max(1, Number(startElement.dataset.attachmentPage) || 1);
    const locator: DocumentCitationLocatorContract = startElement.dataset.attachmentKind === "pdf"
      ? { kind: "pdf-text", page, excerpt }
      : {
          kind: "text",
          startBlockId: `attachment-page-${page}`,
          endBlockId: `attachment-page-${page}`,
          startOffset: textOffsetWithin(startElement, range.startContainer, range.startOffset),
          endOffset: textOffsetWithin(endElement, range.endContainer, range.endOffset)
        };
    setTextSelection({
      excerpt,
      left: Math.max(12, Math.min(window.innerWidth - 168, bounds.left + bounds.width / 2 - 78)),
      top: Math.max(12, bounds.top - 46),
      locator
    });
  };
  const captureControls = (compact: boolean) => onCapture ? (
    <div className={`attachment-citation-controls${compact ? " compact" : ""}`} role="group" aria-label="Scribble citation controls">
      <button type="button" className="attachment-citation-button" title="Add the whole attachment to Scribble" onClick={captureWholeAttachment}><PenLine size={15} />{compact ? null : <span>Whole file</span>}</button>
      {attachmentRenderKind(activeAttachment) === "image" ? <button type="button" className={`attachment-citation-button${imageSelectionActive ? " active" : ""}`} title={imageSelectionActive ? "Cancel image region selection" : "Select an image region"} aria-pressed={imageSelectionActive} onClick={() => {
        setImageSelectionActive((current) => !current);
        setImageRegion(null);
        setTextSelection(null);
      }}>{imageSelectionActive ? <X size={15} /> : <Crop size={15} />}{compact ? null : <span>{imageSelectionActive ? "Cancel region" : "Select region"}</span>}</button> : null}
      {imageSelectionActive && imageRegion ? <button type="button" className="attachment-citation-button primary" title="Cite selected image region in Scribble" onClick={captureImageRegion}><PenLine size={15} />{compact ? null : <span>Add region</span>}</button> : null}
    </div>
  ) : null;

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
            <span>{contextTitle ?? (item ? deletedPostContextTitle(item) : "Private draft attachment")}</span>
          </div>
          <div className="attachment-modal-header-controls" role="group" aria-label="Attachment viewing controls">
            {isFullscreen ? captureControls(true) : null}
            {isFullscreen ? zoomControls : null}
            {isFullscreen ? fullscreenButton : null}
            {item && !sourceAttachments && item.id !== "composer-preview" ? <button type="button" title="Open in a new tab" onClick={openDedicatedViewer}><ExternalLink size={15} /></button> : null}
            {activeAttachment.url ? <a href={activeAttachment.url} target="_blank" rel="noopener noreferrer" title="Open original file" aria-label="Open original file"><FileText size={15} /></a> : null}
            <button type="button" title="Close" onClick={closeModal}>
              <X size={17} />
            </button>
          </div>
        </header>

        {!isFullscreen ? (
          <div className="attachment-modal-toolbar" aria-label="Attachment viewing controls">
            {captureControls(false)}
            {zoomControls}
            {fullscreenButton}
          </div>
        ) : null}

        <div
          ref={stageRef}
          className={`attachment-modal-stage attachment-modal-stage-${activeAttachment.kind}${imageSelectionActive ? " selecting-image-region" : ""}`}
          draggable={Boolean(activeAttachment.url)}
          onDragStart={startAttachmentDrag(activeAttachment)}
          onMouseUp={inspectTextSelection}
          onKeyUp={inspectTextSelection}
        >
          <AttachmentExpandedPane
            attachment={activeAttachment}
            zoom={zoom}
            viewportSize={stageSize}
            imageSelectionActive={imageSelectionActive}
            imageRegion={imageRegion}
            onImageRegionChange={setImageRegion}
            onCite={onCapture ? (excerpt, locator) => capture(excerpt, locator) : undefined}
            onViewContextChange={onViewContextChange}
          />
        </div>

        {textSelection ? <button type="button" className="attachment-selection-citation-action" style={{ left: textSelection.left, top: textSelection.top }} onMouseDown={(event) => event.preventDefault()} onClick={(event) => {
          event.stopPropagation();
          capture(textSelection.excerpt, textSelection.locator);
          window.getSelection()?.removeAllRanges();
          setTextSelection(null);
        }}><PenLine size={14} />Cite selection</button> : null}

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
