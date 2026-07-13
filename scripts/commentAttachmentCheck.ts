import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createAttachmentUploadInputSchema,
  createCommentInputSchema,
  inquiryCommentSchema,
  updateCommentInputSchema,
  updatePostInputSchema
} from "@/packages/contracts/src";
import { commentTreesFromRows } from "@/apps/api/src/repository/foundation";
import { inquiryItems, type InquiryAttachment } from "@/lib/mockData";
import { tombstoneCommentInItem } from "@/lib/symposiumCore";

const attachmentId = "00000000-0000-4000-8000-000000000001";
const attachment: InquiryAttachment = {
  id: attachmentId,
  fileName: "evidence.pdf",
  contentType: "application/pdf",
  byteSize: 2048,
  kind: "pdf",
  status: "uploaded",
  url: "https://attachments.example/comment/evidence.pdf"
};

const main = async () => {
assert.equal(
  createAttachmentUploadInputSchema.safeParse({
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
    ownerType: "comment"
  }).success,
  true
);
assert.equal(
  createCommentInputSchema.safeParse({ body: "Attached evidence", attachmentIds: [attachmentId] }).success,
  true
);
assert.equal(
  updatePostInputSchema.safeParse({
    title: "Revised post",
    body: "Revised body",
    expectedEditedAt: null,
    attachmentIds: [attachmentId]
  }).success,
  true
);
assert.equal(
  updateCommentInputSchema.safeParse({
    body: "Revised comment",
    expectedEditedAt: null,
    attachmentIds: [attachmentId]
  }).success,
  true
);

const commentId = "comment-with-attachment";
const commentTree = commentTreesFromRows(
  [
    {
      id: commentId,
      revision: 1,
      postId: "post-with-comment",
      parentId: null,
      authorHandle: "@researcher",
      authorName: "Researcher",
      stance: "Comment",
      body: "Attached evidence",
      createdAt: new Date(0)
    }
  ],
  new Map([[commentId, [attachment]]])
);
const hydratedComment = commentTree.get("post-with-comment")?.[0];
assert.deepEqual(hydratedComment?.attachments, [attachment]);
assert.equal(inquiryCommentSchema.safeParse(hydratedComment).success, true);

const baseItem = inquiryItems[0]!;
const itemWithComment = { ...baseItem, comments: [hydratedComment!] };
const deletion = tombstoneCommentInItem(itemWithComment, commentId, new Date(1).toISOString());
assert.deepEqual(deletion.deletedComment?.attachments, []);

const root = process.cwd();
const [commentRepository, postRepository, maintenance, controller, commentViews, localCommentRoute, localAttachmentStore] = await Promise.all([
  readFile(path.join(root, "apps/api/src/repository/comments.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/repository/posts.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/services/maintenance.ts"), "utf8"),
  readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8"),
  readFile(path.join(root, "features/comments/CommentThread.tsx"), "utf8"),
  readFile(path.join(root, "app/api/posts/[id]/comments/[commentId]/route.ts"), "utf8"),
  readFile(path.join(root, "lib/localAttachmentStore.ts"), "utf8")
]);
assert.match(commentRepository, /replaceOwnerAttachments/);
assert.match(commentRepository, /queueAttachmentsForOwnerStorageDeletion/);
assert.match(postRepository, /"comment",[\s\S]*commentIds,[\s\S]*"post_deleted"/);
assert.match(maintenance, /owner_type IN \('post', 'comment', 'note'\)/);
assert.match(controller, /attachmentIds: attachments\.map/);
assert.match(commentViews, /<AttachmentCarousel/);
assert.match(localCommentRoute, /existingComment\.editedAt \?\? null/);
assert.match(localAttachmentStore, /record\.actorHandle !== input\.actorHandle/);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "comment upload owner contract",
        "post and comment attachment editing contracts",
        "comment attachment bootstrap hydration",
        "attachment-free comment tombstones",
        "transactional comment ownership replacement",
        "comment and parent-post deletion cleanup",
        "abandoned comment upload maintenance",
        "optimistic identity-only comment mutation",
        "shared comment attachment rendering",
        "local stale-edit protection",
        "local uploader ownership enforcement"
      ]
    },
    null,
    2
  )
);
};

void main();
