"use client";

import { AttachmentPreviewModal } from "@/features/attachments/AttachmentPreviewModal";
import {
  attachmentScribbleSource,
  commentScribbleSource,
  postScribbleSource,
  useScribble
} from "@/features/scribble/ScribbleContext";
import type { InquiryComment, InquiryItem } from "@/lib/mockData";

export function ScribbleAttachmentPreview({
  item,
  comment,
  attachmentId,
  onClose
}: {
  item: InquiryItem;
  comment?: InquiryComment | null;
  attachmentId: string;
  onClose: () => void;
}) {
  const scribble = useScribble();
  const parentSource = comment ? commentScribbleSource(comment, item.id) : postScribbleSource(item);

  return (
    <AttachmentPreviewModal
      item={item}
      attachments={comment ? comment.attachments ?? [] : undefined}
      contextTitle={comment ? `Comment on ${item.title}` : undefined}
      attachmentId={attachmentId}
      onClose={onClose}
      onCapture={({ attachment, excerpt, locator }) => {
        const source = attachmentScribbleSource(attachment, parentSource);
        if (locator.kind === "whole") scribble.addReference(source);
        else scribble.addCitation(source, excerpt, locator);
      }}
    />
  );
}
