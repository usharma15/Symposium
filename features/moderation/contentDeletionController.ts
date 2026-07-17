import type { MutableRefObject } from "react";
import { createClientMutationId, symposiumApi } from "@/features/api/symposiumApiClient";
import type { InquiryItem, ResearchCommunity } from "@/lib/mockData";
import { invalidateQuotedSource } from "@/lib/contentQuotes";
import {
  cleanHandle,
  findCommentInTree,
  isDeletedComment,
  isDeletedPost,
  tombstoneCommentInItem,
  tombstonePost
} from "@/lib/symposiumCore";

type ContentDeletionControllerInput = {
  itemsRef: MutableRefObject<InquiryItem[]>;
  communitiesRef: MutableRefObject<ResearchCommunity[]>;
  actorHandle: string;
  beginMutation: (itemId: string) => void;
  completeMutation: (itemId: string) => void;
  replaceItems: (items: InquiryItem[]) => void;
  persistItems: (items: InquiryItem[]) => void;
  reconcileItem: (incoming: InquiryItem, current: InquiryItem | undefined) => InquiryItem;
  clearPostEditor: () => void;
  clearCommentEditor: (itemId: string, commentId: string) => void;
  setStatus: (status: string) => void;
};

const communityManagement = (
  communities: ResearchCommunity[],
  item: InquiryItem,
  actorHandle: string
) => {
  const community = item.communityId
    ? communities.find((candidate) => candidate.id === item.communityId) ?? null
    : null;
  const isManager = community?.viewerRole === "owner" || community?.viewerRole === "moderator";
  return { community, isManager, actorHandle: cleanHandle(actorHandle) };
};

export const createContentDeletionController = (input: ContentDeletionControllerInput) => {
  const deletePost = async (itemId: string) => {
    const item = input.itemsRef.current.find((current) => current.id === itemId);
    if (!item || isDeletedPost(item)) return;
    const policy = communityManagement(input.communitiesRef.current, item, input.actorHandle);
    const isAuthor = cleanHandle(item.authorHandle ?? item.author) === policy.actorHandle;
    const mayModerate = item.postType !== "paper" && policy.isManager;
    if (!isAuthor && !mayModerate) return;
    if (!window.confirm(isAuthor ? `Delete "${item.title}"?` : `Remove "${item.title}" from ${policy.community?.name ?? "this community"}?`)) return;

    input.beginMutation(itemId);
    const previousItems = input.itemsRef.current;
    const nextItems = invalidateQuotedSource(
      previousItems.map((current) => current.id === itemId ? tombstonePost(item) : current),
      { sourceType: "post", sourceId: itemId, sourcePostId: itemId }
    );
    input.replaceItems(nextItems);
    input.persistItems(nextItems);
    input.clearPostEditor();
    input.setStatus("Deleting post");

    try {
      const data = await symposiumApi.request<{ item?: InquiryItem }>(`/api/posts/${itemId}`, {
        method: "DELETE",
        idempotencyKey: createClientMutationId("post-delete"),
        body: { actorHandle: input.actorHandle }
      });
      if (data.item) {
        const committedItems = invalidateQuotedSource(
          input.itemsRef.current.map((current) =>
            current.id === itemId ? input.reconcileItem(data.item!, current) : current
          ),
          { sourceType: "post", sourceId: itemId, sourcePostId: itemId }
        );
        input.replaceItems(committedItems);
        input.persistItems(committedItems);
      }
      input.setStatus("Post deleted");
    } catch {
      input.replaceItems(previousItems);
      input.persistItems(previousItems);
      input.setStatus("Post delete could not sync");
    } finally {
      input.completeMutation(itemId);
    }
  };

  const deleteComment = async (itemId: string, commentId: string) => {
    const item = input.itemsRef.current.find((current) => current.id === itemId);
    const comment = item ? findCommentInTree(item.comments, commentId) : undefined;
    if (!item || !comment || isDeletedComment(comment)) return;
    const policy = communityManagement(input.communitiesRef.current, item, input.actorHandle);
    const isAuthor = cleanHandle(comment.authorHandle ?? comment.author) === policy.actorHandle;
    if (!isAuthor && !policy.isManager) return;
    if (!window.confirm(isAuthor ? "Delete this comment?" : `Remove this comment from ${policy.community?.name ?? "the community"}?`)) return;

    input.beginMutation(itemId);
    const previousItems = input.itemsRef.current;
    const nextItems = invalidateQuotedSource(previousItems.map((current) =>
      current.id === itemId ? tombstoneCommentInItem(current, commentId).item : current
    ), { sourceType: "comment", sourceId: commentId, sourcePostId: itemId });
    input.replaceItems(nextItems);
    input.persistItems(nextItems);
    input.clearCommentEditor(itemId, commentId);
    input.setStatus("Deleting comment");

    try {
      const data = await symposiumApi.request<{ item?: InquiryItem }>(
        `/api/posts/${itemId}/comments/${commentId}`,
        {
          method: "DELETE",
          idempotencyKey: createClientMutationId("comment-delete"),
          body: { actorHandle: input.actorHandle }
        }
      );
      if (data.item) {
        const committedItems = invalidateQuotedSource(
          input.itemsRef.current.map((current) =>
            current.id === itemId ? input.reconcileItem(data.item!, current) : current
          ),
          { sourceType: "comment", sourceId: commentId, sourcePostId: itemId }
        );
        input.replaceItems(committedItems);
        input.persistItems(committedItems);
      }
      input.setStatus("Comment deleted");
    } catch {
      input.replaceItems(previousItems);
      input.persistItems(previousItems);
      input.setStatus("Comment delete could not sync");
    } finally {
      input.completeMutation(itemId);
    }
  };

  return { deletePost, deleteComment };
};
