"use client";

import { File } from "lucide-react";
import type {
  AssistantMessageView
} from "@/features/assistant/assistantControllerModel";
import { AssistantMessageBody } from "@/features/assistant/AssistantMessageBody";
import { AssistantEvidenceMap } from "@/features/assistant/AssistantEvidenceMap";
import {
  AssistantQuickNoteDraftCard,
  AssistantTranslationCard
} from "@/features/assistant/AssistantQuickNoteCards";
import { AssistantOfficeDraftCard } from "@/features/assistant/AssistantActionCards";
import { assistantAttachmentProcessingLabel } from "@/features/assistant/assistantPresentation";
import { formatAttachmentBytes } from "@/lib/attachmentRules";
import type { InquiryAttachmentContract } from "@/packages/contracts/src";

export function AssistantMessageCard({
  message,
  actorHandle,
  onOpenAttachment,
  onSaved
}: {
  message: AssistantMessageView;
  actorHandle: string;
  onOpenAttachment: (
    attachments: InquiryAttachmentContract[],
    attachmentId: string
  ) => void;
  onSaved: (conversationId: string) => void;
}) {
  return (
    <article
      className={`tablet-message ${message.role}${
        message.translation ? " has-translation" : ""
      }`}
      data-assistant-message-id={message.id}
    >
      <span>
        {message.role === "assistant"
          ? "Assistant"
          : message.role === "system"
            ? "Context"
            : "You"}
      </span>
      <AssistantMessageBody body={message.body} />
      {message.attachments?.length ? (
        <div
          className="tablet-message-attachments"
          aria-label="Attached files"
        >
          {message.attachments.map((attachment) => (
            <button
              type="button"
              key={attachment.id}
              onClick={() =>
                onOpenAttachment(message.attachments!, attachment.id)
              }
            >
              <File size={13} />
              <span>
                <strong>{attachment.fileName}</strong>
                <small>
                  {formatAttachmentBytes(attachment.byteSize)} ·{" "}
                  {assistantAttachmentProcessingLabel(attachment)}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {message.role === "assistant" ? (
        <AssistantEvidenceMap message={message} />
      ) : null}
      {message.role === "assistant" &&
      message.translation &&
      message.conversationId ? (
        <AssistantTranslationCard
          actorHandle={actorHandle}
          conversationId={message.conversationId}
          messageId={message.id}
          translation={message.translation}
          savedQuickNote={message.quickNoteResult}
          onSaved={() => onSaved(message.conversationId!)}
        />
      ) : null}
      {message.role === "assistant" &&
      message.quickNote &&
      message.conversationId ? (
        <AssistantQuickNoteDraftCard
          actorHandle={actorHandle}
          conversationId={message.conversationId}
          messageId={message.id}
          quickNote={message.quickNote}
          savedQuickNote={message.quickNoteResult}
          onSaved={() => onSaved(message.conversationId!)}
        />
      ) : null}
      {message.role === "assistant" &&
      message.actionProposal &&
      message.conversationId ? (
        <AssistantOfficeDraftCard
          actorHandle={actorHandle}
          conversationId={message.conversationId}
          messageId={message.id}
          proposal={message.actionProposal}
          receipt={message.actionReceipt}
          onSaved={() => onSaved(message.conversationId!)}
        />
      ) : null}
    </article>
  );
}
