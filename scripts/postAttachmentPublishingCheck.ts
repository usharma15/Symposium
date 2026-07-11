import assert from "node:assert/strict";
import { TRPCError } from "@trpc/server";
import { createPostInputSchema } from "@/packages/contracts/src";
import {
  assertClaimablePostAttachments,
  canonicalPostAttachmentIds
} from "@/apps/api/src/services/postAttachmentClaims";

const attachmentId = "00000000-0000-4000-8000-000000000001";
const secondAttachmentId = "00000000-0000-4000-8000-000000000002";
const baseRow = {
  id: attachmentId,
  ownerId: null,
  ownerType: "post",
  uploaderHandle: "@usera",
  fileName: "result.png",
  contentType: "image/png",
  byteSize: 120,
  status: "uploaded" as const,
  metadata: {},
  objectKey: "post/result.png",
  createdAt: new Date(0)
};

const parsed = createPostInputSchema.parse({
  title: "Attachment contract",
  body: "The post mutation carries stable attachment identities only.",
  kind: "thought",
  room: "amphitheater",
  attachmentIds: [attachmentId]
});
assert.deepEqual(canonicalPostAttachmentIds(parsed), [attachmentId]);
assert.deepEqual(assertClaimablePostAttachments([baseRow], [attachmentId], "@usera", "post-1"), [baseRow]);

assert.throws(
  () => assertClaimablePostAttachments([{ ...baseRow, status: "pending" as never }], [attachmentId], "@usera", "post-1"),
  (error) => error instanceof TRPCError && error.code === "BAD_REQUEST"
);
assert.throws(
  () => assertClaimablePostAttachments([{ ...baseRow, ownerId: "post-other" }], [attachmentId], "@usera", "post-1"),
  (error) => error instanceof TRPCError && error.code === "BAD_REQUEST"
);
assert.throws(
  () =>
    createPostInputSchema.parse({
      title: "Mismatched references",
      body: "Legacy and canonical references must agree during the rollout window.",
      kind: "thought",
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
        "confirmed attachment ownership claims",
        "legacy rollout consistency"
      ]
    },
    null,
    2
  )
);
