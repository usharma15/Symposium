import type {
  DocumentCitationLocatorContract,
  DocumentCitationStyleContract,
  DocumentNativeCitationContract,
  VersionedDocumentContract,
  DocumentSourceSnapshotContract
} from "@/packages/contracts/src";

export const documentSourceKey = (source: DocumentSourceSnapshotContract) =>
  `${source.kind}:${source.sourceId}`;

export const documentCitationLocatorLabel = (
  locator: DocumentCitationLocatorContract | null | undefined
) => {
  if (!locator) return "Source snapshot";
  if (locator.kind === "whole") return "Whole attachment";
  if (locator.kind === "image-region") {
    const width = Math.max(1, Math.round(locator.width * 100));
    const height = Math.max(1, Math.round(locator.height * 100));
    return `Image region · ${width}% × ${height}%`;
  }
  if (locator.kind === "pdf-text") return `PDF page ${locator.page}`;
  if (locator.kind === "spreadsheet-range") return `${locator.sheet} · ${locator.range}`;
  if (locator.kind === "presentation-slide") return `Slide ${locator.slide}`;
  return "Selected text";
};

export const documentSourceContextLabel = (source: DocumentSourceSnapshotContract) => {
  const kind = source.kind === "attachment" ? source.attachment?.kind ?? "attachment" : source.kind;
  const revision = source.sourceRevision ? ` · snapshot r${source.sourceRevision}` : "";
  return `${kind}${source.author ? ` · ${source.author}` : ""}${revision}`;
};

export const documentNativeCitations = (
  document: VersionedDocumentContract
): DocumentNativeCitationContract[] => {
  const ordered: DocumentNativeCitationContract[] = [];
  const seen = new Set<string>();
  const collect = (citation: DocumentNativeCitationContract | undefined) => {
    if (!citation || seen.has(citation.id)) return;
    seen.add(citation.id);
    ordered.push(citation);
  };
  for (const node of document.nodes) {
    if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") {
      node.content.forEach((run) => collect(run.citation));
    } else if (node.type === "list") {
      node.items.forEach((item) => item.forEach((run) => collect(run.citation)));
    }
  }
  return ordered;
};

export const documentCitationOrdinals = (
  document: VersionedDocumentContract
) => new Map(documentNativeCitations(document).map((citation, index) => [citation.id, index + 1]));

const citationYear = (citation: DocumentNativeCitationContract) => {
  const match = citation.source.createdAt?.match(/\b(?:19|20)\d{2}\b/);
  return match?.[0] ?? "n.d.";
};

const terminalPunctuation = (value: string) =>
  /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;

export const documentCitationBibliographyEntry = (
  citation: DocumentNativeCitationContract,
  style: DocumentCitationStyleContract
) => {
  const author = citation.source.author?.trim() || citation.source.authorHandle?.trim() || "Unknown author";
  const title = citation.source.title?.trim() || citation.source.attachment?.fileName || "Untitled source";
  const year = citationYear(citation);
  const url = citation.source.canonicalPath;
  if (style === "mla") {
    return `${terminalPunctuation(author)} “${title}.” Symposium, ${year}, ${url}.`;
  }
  if (style === "chicago") {
    return `${terminalPunctuation(author)} “${title}.” Symposium. ${year}. ${url}.`;
  }
  return `${terminalPunctuation(author)} (${year}). ${terminalPunctuation(title)} Symposium. ${url}`;
};

export const documentCitationStyleLabel = (
  style: DocumentCitationStyleContract
) => style === "apa" ? "APA" : style === "mla" ? "MLA" : "Chicago";
