"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Code2, FileSpreadsheet, MousePointer2, PenLine, Presentation, X } from "lucide-react";
import type { InquiryAttachment } from "@/lib/mockData";
import type { DocumentCitationLocatorContract } from "@/packages/contracts/src";
import { splitPreviewTextIntoPages } from "@/lib/attachmentRules";
import {
  buildStructuredAttachmentMetadata,
  parseCsvPreview,
  sourceLanguageForFileName,
  structuredPreviewFromMetadata,
  type StructuredAttachmentPreview
} from "@/lib/structuredAttachmentPreview";
import {
  readDocumentReadingPosition,
  rememberDocumentReadingPosition,
  subscribeDocumentReadingPosition
} from "@/features/attachments/documentViewerSession";

type PreviewMode = "feed" | "detail" | "modal" | "expanded";
type CellPoint = { row: number; column: number };

const spreadsheetColumn = (column: number) => {
  let value = column + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

const orderedRange = (anchor: CellPoint, focus: CellPoint) => ({
  top: Math.min(anchor.row, focus.row),
  bottom: Math.max(anchor.row, focus.row),
  left: Math.min(anchor.column, focus.column),
  right: Math.max(anchor.column, focus.column)
});

const metadataText = (metadata: Record<string, unknown> | undefined, key: string) =>
  typeof metadata?.[key] === "string" ? metadata[key] as string : "";

const PageControls = ({ current, total, onChange }: { current: number; total: number; onChange: (page: number) => void }) => (
  <div>
    <button type="button" title="Previous page" disabled={current <= 1} onClick={(event) => { event.stopPropagation(); onChange(Math.max(1, current - 1)); }}><ChevronLeft size={15} /></button>
    <button type="button" title="Next page" disabled={current >= total} onClick={(event) => { event.stopPropagation(); onChange(Math.min(total, current + 1)); }}><ChevronRight size={15} /></button>
  </div>
);

export function StructuredAttachmentPreviewPane({ attachment, mode, zoom = 1, onCite }: {
  attachment: InquiryAttachment;
  mode: PreviewMode;
  zoom?: number;
  onCite?: (excerpt: string, locator: DocumentCitationLocatorContract) => void;
}) {
  const viewerInstanceId = useId();
  const initialText = metadataText(attachment.metadata, "previewText");
  const initialStructured = useMemo(() => structuredPreviewFromMetadata(attachment.metadata)
    ?? (attachment.fileName.toLowerCase().endsWith(".csv") && initialText ? parseCsvPreview(initialText) : null), [attachment.fileName, attachment.metadata, initialText]);
  const [structured, setStructured] = useState<StructuredAttachmentPreview | null>(initialStructured);
  const [previewText, setPreviewText] = useState(initialText);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(() => readDocumentReadingPosition(attachment.id).pageNumber);
  const [selectingCells, setSelectingCells] = useState(false);
  const [cellAnchor, setCellAnchor] = useState<CellPoint | null>(null);
  const [cellFocus, setCellFocus] = useState<CellPoint | null>(null);
  const [draggingCells, setDraggingCells] = useState(false);

  useEffect(() => {
    setStructured(initialStructured);
    setPreviewText(initialText);
    setPage(readDocumentReadingPosition(attachment.id).pageNumber);
    setSelectingCells(false);
    setCellAnchor(null);
    setCellFocus(null);
  }, [attachment.id, initialStructured, initialText]);

  useEffect(() => subscribeDocumentReadingPosition(
    attachment.id,
    (position, sourceId) => {
      if (sourceId !== viewerInstanceId) setPage(position.pageNumber);
    }
  ), [attachment.id, viewerInstanceId]);

  useEffect(() => {
    if (!draggingCells) return;
    const finish = () => setDraggingCells(false);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [draggingCells]);

  const changePage = (nextPage: number) => {
    setPage(nextPage);
    rememberDocumentReadingPosition(attachment.id, {
      pageNumber: nextPage,
      pageProgress: 0
    }, viewerInstanceId);
    setCellAnchor(null);
    setCellFocus(null);
    setDraggingCells(false);
  };

  useEffect(() => {
    if ((structured || previewText) || !attachment.url) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(attachment.url!, { cache: "force-cache" });
        if (!response.ok) throw new Error("Could not load attachment preview.");
        const blob = await response.blob();
        const file = new File([blob], attachment.fileName, { type: attachment.contentType });
        const metadata = await buildStructuredAttachmentMetadata(file, attachment.kind);
        if (cancelled) return;
        setStructured(structuredPreviewFromMetadata(metadata));
        setPreviewText(metadataText(metadata, "previewText"));
      } catch {
        if (!cancelled) setPreviewText("");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [attachment.contentType, attachment.fileName, attachment.kind, attachment.url, previewText, structured]);

  if (attachment.kind === "code") {
    const pages = splitPreviewTextIntoPages(previewText);
    const bounded = Math.min(page, pages.length);
    return (
      <div className={`attachment-document attachment-document-${mode} attachment-code-preview`}>
        <div className="attachment-pagebar">
          <span><Code2 size={14} />{metadataText(attachment.metadata, "language") || sourceLanguageForFileName(attachment.fileName)} · Page {bounded}/{pages.length}</span>
          {pages.length > 1 ? <PageControls current={bounded} total={pages.length} onChange={changePage} /> : null}
        </div>
        {previewText ? <pre data-attachment-selectable="true" data-attachment-page={bounded} style={mode === "expanded" ? { fontSize: `${0.86 * zoom}rem` } : undefined}><code>{pages[bounded - 1] ?? ""}</code></pre> : <PreviewUnavailable icon={<Code2 size={34} />} attachment={attachment} loading={loading} />}
      </div>
    );
  }

  if (structured?.type === "spreadsheet") {
    const total = Math.max(1, structured.sheets.length);
    const bounded = Math.min(page, total);
    const sheet = structured.sheets[bounded - 1];
    const selected = cellAnchor && cellFocus ? orderedRange(cellAnchor, cellFocus) : null;
    const rangeLabel = selected
      ? `${spreadsheetColumn(selected.left)}${selected.top + 1}:${spreadsheetColumn(selected.right)}${selected.bottom + 1}`
      : null;
    const selectedExcerpt = selected
      ? (sheet?.rows ?? [])
          .slice(selected.top, selected.bottom + 1)
          .map((row) => row.slice(selected.left, selected.right + 1).join("\t"))
          .join("\n")
          .slice(0, 4000)
      : "";
    const toggleCellSelection = () => {
      setSelectingCells((current) => !current);
      setCellAnchor(null);
      setCellFocus(null);
      setDraggingCells(false);
    };
    return (
      <div className={`attachment-document attachment-document-${mode} attachment-spreadsheet-preview`}>
        <div className="attachment-pagebar">
          <span><FileSpreadsheet size={14} />{sheet?.name || `Sheet ${bounded}`} · {bounded}/{total}</span>
          <div>
            {onCite ? <button type="button" className={selectingCells ? "active" : ""} title={selectingCells ? "Cancel range selection" : "Select a cell range"} aria-pressed={selectingCells} onClick={(event) => { event.stopPropagation(); toggleCellSelection(); }}>{selectingCells ? <X size={15} /> : <MousePointer2 size={15} />}</button> : null}
            {onCite && selected && rangeLabel ? <button type="button" className="attachment-cite-range" title={`Cite ${rangeLabel} in Scribble`} onClick={(event) => {
              event.stopPropagation();
              onCite(selectedExcerpt || `${sheet?.name || `Sheet ${bounded}`} ${rangeLabel}`, {
                kind: "spreadsheet-range",
                sheet: sheet?.name || `Sheet ${bounded}`,
                range: rangeLabel
              });
              setSelectingCells(false);
              setCellAnchor(null);
              setCellFocus(null);
            }}><PenLine size={14} /><span>{rangeLabel}</span></button> : null}
            {total > 1 ? <PageControls current={bounded} total={total} onChange={changePage} /> : null}
          </div>
        </div>
        <div className="attachment-sheet-scroll" style={mode === "expanded" ? { fontSize: `${0.82 * zoom}rem` } : undefined}>
          <table>
            <tbody>
              {(sheet?.rows ?? []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => {
                const point = { row: rowIndex, column: cellIndex };
                const inSelection = Boolean(selected
                  && rowIndex >= selected.top && rowIndex <= selected.bottom
                  && cellIndex >= selected.left && cellIndex <= selected.right);
                const cellProps = selectingCells ? {
                  className: inSelection ? "attachment-sheet-cell-selected" : "attachment-sheet-cell-selectable",
                  role: "button" as const,
                  tabIndex: 0,
                  onPointerDown: (event: React.PointerEvent<HTMLTableCellElement>) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setCellAnchor(point);
                    setCellFocus(point);
                    setDraggingCells(true);
                  },
                  onPointerEnter: () => {
                    if (draggingCells) setCellFocus(point);
                  },
                  onKeyDown: (event: React.KeyboardEvent<HTMLTableCellElement>) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (!cellAnchor) setCellAnchor(point);
                    setCellFocus(point);
                  }
                } : {};
                return rowIndex === 0
                  ? <th key={cellIndex} {...cellProps}>{cell}</th>
                  : <td key={cellIndex} {...cellProps}>{cell}</td>;
              })}</tr>)}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (structured?.type === "presentation") {
    const total = Math.max(1, structured.slides.length);
    const bounded = Math.min(page, total);
    const slide = structured.slides[bounded - 1];
    return (
      <div className={`attachment-document attachment-document-${mode} attachment-presentation-preview`}>
        <div className="attachment-pagebar">
          <span><Presentation size={14} />Slide {bounded}/{total}</span>
          <div>
            {onCite ? <button type="button" title={`Cite slide ${bounded} in Scribble`} onClick={(event) => {
              event.stopPropagation();
              onCite([slide?.title, ...(slide?.lines ?? [])].filter(Boolean).join("\n") || `Slide ${bounded}`, { kind: "presentation-slide", slide: bounded });
            }}><PenLine size={15} /></button> : null}
            {total > 1 ? <PageControls current={bounded} total={total} onChange={changePage} /> : null}
          </div>
        </div>
        <article className="attachment-slide" data-attachment-selectable="true" data-attachment-page={bounded} style={mode === "expanded" ? { fontSize: `${zoom}rem` } : undefined}>
          <span className="attachment-slide-number">{bounded}</span>
          <h3>{slide?.title || `Slide ${bounded}`}</h3>
          {slide?.lines.length ? <ul>{slide.lines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul> : <p>Presentation slide</p>}
        </article>
      </div>
    );
  }

  if (previewText) {
    const pages = splitPreviewTextIntoPages(previewText);
    const bounded = Math.min(page, pages.length);
    return (
      <div className={`attachment-document attachment-document-${mode}`}>
        <div className="attachment-pagebar"><span>Page {bounded}/{pages.length}</span>{pages.length > 1 ? <PageControls current={bounded} total={pages.length} onChange={changePage} /> : null}</div>
        <pre data-attachment-selectable="true" data-attachment-page={bounded}>{pages[bounded - 1] ?? ""}</pre>
      </div>
    );
  }

  return <div className={`attachment-document attachment-document-${mode}`}><PreviewUnavailable icon={attachment.kind === "spreadsheet" ? <FileSpreadsheet size={34} /> : <Presentation size={34} />} attachment={attachment} loading={loading} /></div>;
}

function PreviewUnavailable({ icon, attachment, loading }: { icon: React.ReactNode; attachment: InquiryAttachment; loading: boolean }) {
  return <div className="attachment-file-shell">{icon}<strong>{attachment.fileName}</strong><span>{loading ? "Preparing preview…" : "Preview unavailable for this legacy file. Open the original file to continue."}</span></div>;
}
