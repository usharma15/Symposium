import { jsonError, readJson } from "@/lib/api";
import { addComment, createPost, updateComment, updatePost } from "@/lib/dataStore";
import {
  promoteLocalWorkspaceCommentAttachments,
  promoteLocalWorkspaceDocumentAttachments
} from "@/lib/localAttachmentStore";
import { getLocalWorkspaceComments } from "@/lib/localWorkspaceCommentStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { getLocalWorkspaceRevision, markLocalWorkspacePublished } from "@/lib/localWorkspaceStore";
import type { InquiryComment, InquiryItem } from "@/lib/mockData";
import { findCommentInTree } from "@/lib/symposiumCore";
import { privateWorkspaceResponse, workspaceActorHandle, workspaceRouteError } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ noteId: string }> };
type PublishBody = {
  actorHandle?: string;
  expectedRevision?: number;
  publicationTarget?: "paper" | "thought" | "proposal" | "opportunity";
};

const publishLocalWorkspaceDiscussion = async (input: {
  noteId: string;
  postId: string;
  rootParentId: string | null;
  actorHandle: string;
  initialItem: InquiryItem;
}) => {
  const discussion = await getLocalWorkspaceComments(input.noteId, input.actorHandle);
  let item = input.initialItem;
  const publishComments = async (comments: InquiryComment[], parentId: string | null): Promise<void> => {
    for (const comment of comments) {
      if (comment.deletedAt || !comment.id) {
        await publishComments(comment.replies ?? [], parentId);
        continue;
      }
      const publicCommentId = `comment-workspace-${comment.id}`;
      const attachments = await promoteLocalWorkspaceCommentAttachments(
        comment.id,
        publicCommentId,
        comment.authorHandle ?? input.actorHandle
      );
      const published = await addComment(input.postId, {
        id: publicCommentId,
        body: comment.body,
        document: comment.document,
        stance: comment.stance,
        parentId,
        attachments
      }, comment.authorHandle ?? input.actorHandle);
      if (!published) throw new Error("The draft discussion could not be published with its post.");
      item = published.item;
      await publishComments(comment.replies ?? [], publicCommentId);
    }
  };
  await publishComments(discussion.comments, input.rootParentId);
  return item;
};

export async function POST(request: Request, context: Context) {
  const { noteId } = await context.params;
  const body = await readJson<PublishBody>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const payload = {
    noteId,
    expectedRevision: body?.expectedRevision,
    publicationTarget: body?.publicationTarget,
    visibility: "public" as const
  };
  const live = await proxyLiveBackend("/v1/notes/publish", {
    method: "POST",
    body: payload,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;

  try {
    if (!body?.expectedRevision) return jsonError("Publishing requires the exact draft revision.", 428);
    const { document, checkpoint } = await getLocalWorkspaceRevision(noteId, body.expectedRevision, actorHandle);
    if (!document.body.trim()) return jsonError("Add some content before publishing this draft.", 400);
    const target = document.kind === "paper" && document.publicationTarget === "proposal"
      ? "proposal"
      : document.kind === "thought" && document.publicationTarget === "opportunity"
        ? "opportunity"
      : document.kind === "note"
        ? body.publicationTarget ?? document.publicationTarget
        : document.kind;
    if (target === "paper" || target === "thought" || target === "proposal" || target === "opportunity") {
      if (target === "proposal" && !document.proposal) {
        return jsonError("Add funding details before publishing this Patronage Proposal.", 400);
      }
      if (target === "opportunity" && !document.opportunity) {
        return jsonError("Add opportunity details before publishing this Opportunity.", 400);
      }
      const createdItem = await createPost({
        title: document.title,
        body: document.body,
        document: document.document,
        kind: target === "proposal" ? "paper" : target === "opportunity" ? "thought" : target,
        room: target === "proposal" ? "funding" : target === "opportunity" ? "opportunities" : target === "paper" ? "library" : "amphitheater",
        patronage: target === "proposal" ? document.proposal ?? undefined : undefined,
        opportunity: target === "opportunity" ? document.opportunity ?? undefined : undefined,
        attachments: []
      }, actorHandle);
      const attachments = await promoteLocalWorkspaceDocumentAttachments(noteId, "post", createdItem.id, actorHandle);
      const publicItem = attachments.length
        ? await updatePost(createdItem.id, {
            title: document.title,
            body: document.body,
            document: document.document,
            attachments
          }, actorHandle)
        : createdItem;
      if (!publicItem) return jsonError("The draft attachments could not be published with their post.", 409);
      const item = await publishLocalWorkspaceDiscussion({
        noteId,
        postId: createdItem.id,
        rootParentId: null,
        actorHandle,
        initialItem: publicItem
      });
      await markLocalWorkspacePublished(noteId, document.revision, item.id, actorHandle);
      return privateWorkspaceResponse({
        item,
        publication: {
          noteId,
          revision: document.revision,
          checkpointId: checkpoint.checkpointId,
          target,
          postId: item.id,
          visibility: "public"
        }
      });
    }
    if (target !== "comment" && target !== "reply") {
      return jsonError("Choose whether this generic note becomes a Paper or a Thought.", 400);
    }
    if (!document.targetId) return jsonError("Link this draft to its destination before publishing.", 400);
    const separator = document.targetId.indexOf(":");
    const postId = target === "reply" && separator > 0 ? document.targetId.slice(0, separator) : document.targetId;
    const parentId = target === "reply" && separator > 0 ? document.targetId.slice(separator + 1) : null;
    if (target === "reply" && !parentId) return jsonError("A reply draft must be linked as post-id:comment-id.", 400);
    let result = await addComment(postId, {
      body: document.body,
      document: document.document,
      stance: document.title,
      parentId,
      attachments: []
    }, actorHandle);
    if (!result?.comment?.id) return jsonError("The comment draft could not be published.", 409);
    const publicCommentId = result.comment.id;
    const attachments = await promoteLocalWorkspaceDocumentAttachments(
      noteId,
      "comment",
      publicCommentId,
      actorHandle
    );
    if (attachments.length) {
      const updatedItem = await updateComment(postId, publicCommentId, {
        body: document.body,
        document: document.document,
        attachments
      }, actorHandle);
      const updatedComment = updatedItem ? findCommentInTree(updatedItem.comments, publicCommentId) : undefined;
      if (!updatedItem || !updatedComment) return jsonError("The draft attachments could not be published with their comment.", 409);
      result = { item: updatedItem, comment: updatedComment };
    }
    const item = await publishLocalWorkspaceDiscussion({
      noteId,
      postId,
      rootParentId: publicCommentId,
      actorHandle,
      initialItem: result.item
    });
    await markLocalWorkspacePublished(noteId, document.revision, postId, actorHandle);
    return privateWorkspaceResponse({
      ...result,
      item,
      publication: {
        noteId,
        revision: document.revision,
        checkpointId: checkpoint.checkpointId,
        target,
        postId,
        commentId: result?.comment?.id ?? null,
        visibility: "public"
      }
    });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
