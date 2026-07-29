import assert from "node:assert/strict";
import { TRPCError } from "@trpc/server";
import {
  createCommentInputSchema,
  createPostInputSchema,
  updateCommentInputSchema,
  updatePostInputSchema
} from "@/packages/contracts/src";
import {
  assertClaimableOwnerAttachments,
  canonicalAttachmentIds
} from "@/apps/api/src/services/attachmentOwnership";

const attachmentId = "00000000-0000-4000-8000-000000000001";
const secondAttachmentId = "00000000-0000-4000-8000-000000000002";
const baseRow = {
  id: attachmentId,
  attachmentId,
  bucket: "symposium",
  ownerId: null,
  ownerType: "post",
  uploaderHandle: "@usera",
  fileName: "result.png",
  contentType: "image/png",
  byteSize: 120,
  status: "uploaded" as const,
  metadata: {},
  objectKey: "post/result.png",
  uploadObjectKey: `pending/${attachmentId}`,
  createdAt: new Date(0)
};

const parsed = createPostInputSchema.parse({
  title: "",
  body: "The post mutation carries stable attachment identities only.",
  kind: "thought",
  postType: "thought",
  room: "amphitheater",
  attachmentIds: [attachmentId]
});
assert.deepEqual(canonicalAttachmentIds(parsed), [attachmentId]);
assert.deepEqual(
  assertClaimableOwnerAttachments([baseRow], [attachmentId], {
    ownerId: "post-1",
    ownerType: "post",
    uploaderHandle: "@usera"
  }),
  [baseRow]
);

assert.throws(
  () => assertClaimableOwnerAttachments([{ ...baseRow, status: "pending" as never }], [attachmentId], {
    ownerId: "post-1",
    ownerType: "post",
    uploaderHandle: "@usera"
  }),
  (error) => error instanceof TRPCError && error.code === "BAD_REQUEST"
);
assert.throws(
  () => assertClaimableOwnerAttachments([{ ...baseRow, ownerId: "post-other" }], [attachmentId], {
    ownerId: "post-1",
    ownerType: "post",
    uploaderHandle: "@usera"
  }),
  (error) => error instanceof TRPCError && error.code === "BAD_REQUEST"
);

const commentRow = { ...baseRow, ownerType: "comment", objectKey: "comment/result.png" };
assert.deepEqual(
  assertClaimableOwnerAttachments([commentRow], [attachmentId], {
    ownerId: "comment-1",
    ownerType: "comment",
    uploaderHandle: "@usera"
  }),
  [commentRow]
);
assert.equal(
  createCommentInputSchema.safeParse({ body: "Evidence attached.", attachmentIds: [attachmentId] }).success,
  true
);
assert.equal(
  updatePostInputSchema.safeParse({
    title: "Revised",
    body: "Revised body",
    attachmentIds: [attachmentId]
  }).success,
  false
);
assert.equal(
  updateCommentInputSchema.safeParse({ body: "Revised", attachmentIds: [attachmentId] }).success,
  false
);
assert.equal(
  updateCommentInputSchema.safeParse({ body: "Revised", expectedEditedAt: null, attachmentIds: [] }).success,
  true
);
assert.throws(
  () =>
    createPostInputSchema.parse({
      title: "",
      body: "Legacy and canonical references must agree during the rollout window.",
      kind: "thought",
      postType: "thought",
      room: "amphitheater",
      attachmentIds: [attachmentId],
      attachments: [
        {
          id: secondAttachmentId,
          fileName: "other.png",
          contentType: "image/png",
          byteSize: 10,
          kind: "image"
        }
      ]
    })
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "identity-only post attachment contract",
        "shared post and comment ownership claims",
        "content-version-guarded attachment replacement",
        "legacy rollout consistency"
      ]
    },
    null,
    2
  )
);
