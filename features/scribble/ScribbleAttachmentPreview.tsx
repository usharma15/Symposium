"use client";

import { AttachmentPreviewModal } from "@/features/attachments/AttachmentPreviewModal";
import type { PdfAttachmentViewContext } from "@/features/attachments/pdfAttachmentClient";
import {
  attachmentScribbleSource,
  commentScribbleSource,
  postScribbleSource,
  useScribble
} from "@/features/scribble/ScribbleContext";
import type { InquiryComment, InquiryItem } from "@/lib/mockData";
import { postToneForItem } from "@/lib/postTone";
import { postContextLabel } from "@/lib/postSemantics";
import { useNativeCitation } from "@/features/citations/NativeCitationContext";

export function ScribbleAttachmentPreview({
  item,
  comment,
  attachmentId,
  onClose,
  onViewContextChange
}: {
  item: InquiryItem;
  comment?: InquiryComment | null;
  attachmentId: string;
  onClose: () => void;
  onViewContextChange?: (context: PdfAttachmentViewContext | null) => void;
}) {
  const scribble = useScribble();
  const nativeCitation = useNativeCitation();
  const parentSource = comment
    ? commentScribbleSource(comment, item.id, postToneForItem(item))
    : postScribbleSource(item);

  return (
    <AttachmentPreviewModal
      item={item}
      attachments={comment ? comment.attachments ?? [] : undefined}
      contextTitle={comment ? `Comment on ${postContextLabel(item)}` : undefined}
      attachmentId={attachmentId}
      onClose={onClose}
      onViewContextChange={onViewContextChange}
      onCapture={({ attachment, excerpt, locator }) => {
        const source = attachmentScribbleSource(attachment, parentSource);
        if (locator.kind === "whole") scribble.addReference(source);
        else scribble.addCitation(source, excerpt, locator);
      }}
      onNativeCapture={({ attachment, excerpt, locator }) => {
        nativeCitation.stageCitation(
          attachmentScribbleSource(attachment, parentSource),
          excerpt,
          locator
        );
      }}
    />
  );
}
