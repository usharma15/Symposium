"use client";

import { useState } from "react";
import type { InquiryItem, ResearchProfile } from "@/lib/mockData";
import { buildPostAttachmentMetadata } from "@/features/attachments/AttachmentViews";
import { uploadConfirmedAttachment } from "@/features/attachments/attachmentUploadClient";
import { createClientMutationId } from "@/features/api/symposiumApiClient";
import { OpportunityApplyModal, OpportunityApplicationsView } from "@/features/opportunities/OpportunityViews";
import type { ViewSnapshot } from "@/features/navigation/viewState";

export const opportunityPostView = (postId: string): Partial<ViewSnapshot> => ({
  activeRoom: "opportunities",
  applicationReviewPostId: null,
  selectedApplicationId: null,
  selectedItemId: postId,
  selectedCommentId: null,
  selectedProfileName: null
});

export const opportunityApplicationsView = (postId: string): Partial<ViewSnapshot> => ({
  activeRoom: "opportunities",
  selectedItemId: null,
  selectedCommentId: null,
  selectedProfileName: null,
  applicationReviewPostId: postId,
  selectedApplicationId: null
});

export const OpportunityApplicationsStage = ({
  item,
  actorHandle,
  profiles,
  selectedApplicationId,
  onSelectApplication,
  onBack
}: {
  item: InquiryItem;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  selectedApplicationId?: string;
  onSelectApplication: (applicationId: string | null) => void;
  onBack: (postId: string) => void;
}) => (
  <OpportunityApplicationsView
    item={item}
    actorHandle={actorHandle}
    profiles={profiles}
    selectedApplicationId={selectedApplicationId}
    onSelectApplication={onSelectApplication}
    onBack={() => onBack(item.id)}
  />
);

export const useOpportunityApplicationComposer = (actorHandle: string, onApplied: () => void) => {
  const [item, setItem] = useState<InquiryItem | null>(null);
  const uploadAttachment = async (file: File) => {
    const contentType = file.type || "application/octet-stream";
    const metadata = await buildPostAttachmentMetadata(file, contentType);
    return uploadConfirmedAttachment({
      actorHandle,
      file,
      idempotencyKey: createClientMutationId("opportunity-application-attachment-prepare"),
      metadata,
      ownerType: "opportunity_application"
    });
  };

  return {
    beginApplication: setItem,
    applicationComposer: item ? (
      <OpportunityApplyModal
        item={item}
        actorHandle={actorHandle}
        onClose={() => setItem(null)}
        onUploadAttachment={uploadAttachment}
        onApplied={onApplied}
      />
    ) : null
  };
};
