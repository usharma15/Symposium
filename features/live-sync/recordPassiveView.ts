import type { ViewActionOptions } from "@/features/actions/actionTypes";
import { createClientMutationId, symposiumApi } from "@/features/api/symposiumApiClient";
import type { InquiryItem } from "@/lib/mockData";

export type PassiveViewResponse = {
  accepted?: boolean;
  action?: "read";
  commentId?: string;
  commentRevision?: number;
  item?: InquiryItem;
  itemId?: string;
  metrics?: Partial<InquiryItem["metrics"]>;
  revision?: number;
  targetType?: "post" | "comment";
};

export const recordPassiveView = async (
  target: "post" | "comment",
  itemId: string,
  commentId: string | null,
  actorHandle: string,
  options: ViewActionOptions
) => {
  const path = target === "post"
    ? `/api/posts/${itemId}/actions`
    : `/api/posts/${itemId}/comments/${commentId}/actions`;
  try {
    return await symposiumApi.request<PassiveViewResponse>(path, {
      method: "POST",
      idempotencyKey: createClientMutationId(`${target}-view`),
      body: { action: "read", actorHandle, trigger: options.trigger, surface: options.surface }
    });
  } catch {
    return null;
  }
};
