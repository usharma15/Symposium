import type { InquiryAttachmentContract } from "@/packages/contracts/src";
import type { PdfAttachmentViewContext } from "@/features/attachments/pdfAttachmentClient";

export const tabletAttachmentTextLimit = 8000;

const buildActivePdfContext = (view: PdfAttachmentViewContext) => {
  if (view.status === "loading") {
    return `Currently viewing PDF page ${view.page} of ${view.pageCount}. Machine-readable page text is still loading.`;
  }
  if (view.status === "unavailable") {
    return `Currently viewing PDF page ${view.page} of ${view.pageCount}. The controlled PDF preview could not extract this page.`;
  }

  return [
    `Currently viewing PDF page ${view.page} of ${view.pageCount}.`,
    view.currentPageText
      ? `Current page ${view.page} text:\n${view.currentPageText.slice(0, 5200)}`
      : `Current page ${view.page} has no machine-readable text. Do not infer its visual contents.`,
    view.previousPageText
      ? `Previous page ${view.page - 1} context:\n${view.previousPageText.slice(0, 1200)}`
      : "",
    view.nextPageText
      ? `Next page ${view.page + 1} context:\n${view.nextPageText.slice(0, 1200)}`
      : ""
  ].filter(Boolean).join("\n\n");
};

export const buildTabletAttachmentContext = (
  attachment: InquiryAttachmentContract,
  pdfView?: PdfAttachmentViewContext | null
) => {
  const metadata = attachment.metadata ?? {};
  const previewText = typeof metadata.previewText === "string"
    ? metadata.previewText.trim().slice(0, tabletAttachmentTextLimit)
    : "";
  const structuredPreview = metadata.structuredPreview && typeof metadata.structuredPreview === "object"
    ? JSON.stringify(metadata.structuredPreview).slice(0, tabletAttachmentTextLimit)
    : "";
  const pageCount = typeof metadata.pageCount === "number" && Number.isFinite(metadata.pageCount)
    ? Math.max(1, Math.trunc(metadata.pageCount))
    : null;

  const activePdfContext = pdfView?.attachmentId === attachment.id ? buildActivePdfContext(pdfView) : "";
  const fallbackContext = previewText
    ? `Extracted attachment text:\n${previewText}`
    : structuredPreview
      ? `Extracted structured attachment preview:\n${structuredPreview}`
      : metadata.pdfTextStatus === "none"
        ? "No machine-readable text was found in the PDF preview. Visual PDF understanding is not active."
        : "Attachment contents are not extracted in the current Assistant context.";

  return [
    `Attachment: ${attachment.fileName}`,
    `Type: ${attachment.contentType} · Kind: ${attachment.kind}`,
    pageCount ? `Pages or preview segments: ${pageCount}` : "",
    activePdfContext || fallbackContext
  ].filter(Boolean).join("\n").slice(0, tabletAttachmentTextLimit);
};
