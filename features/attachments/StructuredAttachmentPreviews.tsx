"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Code2, FileSpreadsheet, Presentation } from "lucide-react";
import type { InquiryAttachment } from "@/lib/mockData";
import { splitPreviewTextIntoPages } from "@/lib/attachmentRules";
import {
  buildStructuredAttachmentMetadata,
  sourceLanguageForFileName,
  structuredPreviewFromMetadata,
  type StructuredAttachmentPreview
} from "@/lib/structuredAttachmentPreview";

type PreviewMode = "feed" | "detail" | "modal" | "expanded";

const metadataText = (metadata: Record<string, unknown> | undefined, key: string) =>
  typeof metadata?.[key] === "string" ? metadata[key] as string : "";

const PageControls = ({ current, total, onChange }: { current: number; total: number; onChange: (page: number) => void }) => (
  <div>
    <button type="button" title="Previous page" disabled={current <= 1} onClick={(event) => { event.stopPropagation(); onChange(Math.max(1, current - 1)); }}><ChevronLeft size={15} /></button>
    <button type="button" title="Next page" disabled={current >= total} onClick={(event) => { event.stopPropagation(); onChange(Math.min(total, current + 1)); }}><ChevronRight size={15} /></button>
  </div>
);

export function StructuredAttachmentPreviewPane({ attachment, mode, zoom = 1 }: {
  attachment: InquiryAttachment;
  mode: PreviewMode;
  zoom?: number;
}) {
  const initialStructured = useMemo(() => structuredPreviewFromMetadata(attachment.metadata), [attachment.metadata]);
  const initialText = metadataText(attachment.metadata, "previewText");
  const [structured, setStructured] = useState<StructuredAttachmentPreview | null>(initialStructured);
  const [previewText, setPreviewText] = useState(initialText);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setStructured(initialStructured);
    setPreviewText(initialText);
    setPage(1);
  }, [attachment.id, initialStructured, initialText]);

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
          {pages.length > 1 ? <PageControls current={bounded} total={pages.length} onChange={setPage} /> : null}
        </div>
        {previewText ? <pre style={mode === "expanded" ? { fontSize: `${0.86 * zoom}rem` } : undefined}><code>{pages[bounded - 1] ?? ""}</code></pre> : <PreviewUnavailable icon={<Code2 size={34} />} attachment={attachment} loading={loading} />}
      </div>
    );
  }

  if (structured?.type === "spreadsheet") {
    const total = Math.max(1, structured.sheets.length);
    const bounded = Math.min(page, total);
    const sheet = structured.sheets[bounded - 1];
    return (
      <div className={`attachment-document attachment-document-${mode} attachment-spreadsheet-preview`}>
        <div className="attachment-pagebar">
          <span><FileSpreadsheet size={14} />{sheet?.name || `Sheet ${bounded}`} · {bounded}/{total}</span>
          {total > 1 ? <PageControls current={bounded} total={total} onChange={setPage} /> : null}
        </div>
        <div className="attachment-sheet-scroll" style={mode === "expanded" ? { fontSize: `${0.82 * zoom}rem` } : undefined}>
          <table>
            <tbody>
              {(sheet?.rows ?? []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}
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
          {total > 1 ? <PageControls current={bounded} total={total} onChange={setPage} /> : null}
        </div>
        <article className="attachment-slide" style={mode === "expanded" ? { fontSize: `${zoom}rem` } : undefined}>
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
        <div className="attachment-pagebar"><span>Page {bounded}/{pages.length}</span>{pages.length > 1 ? <PageControls current={bounded} total={pages.length} onChange={setPage} /> : null}</div>
        <pre>{pages[bounded - 1] ?? ""}</pre>
      </div>
    );
  }

  return <div className={`attachment-document attachment-document-${mode}`}><PreviewUnavailable icon={attachment.kind === "spreadsheet" ? <FileSpreadsheet size={34} /> : <Presentation size={34} />} attachment={attachment} loading={loading} /></div>;
}

function PreviewUnavailable({ icon, attachment, loading }: { icon: React.ReactNode; attachment: InquiryAttachment; loading: boolean }) {
  return <div className="attachment-file-shell">{icon}<strong>{attachment.fileName}</strong><span>{loading ? "Preparing preview…" : "Preview unavailable for this legacy file. Open the original file to continue."}</span></div>;
}
