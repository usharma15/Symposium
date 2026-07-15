import type {
  DocumentCitationLocatorContract,
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
