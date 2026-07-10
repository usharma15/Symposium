import assert from "node:assert/strict";
import {
  attachmentContentTypesMatch,
  validateAttachmentContentSignature,
  validateAttachmentNameAndContentType,
  validatePostAttachmentDetails
} from "@/lib/attachmentRules";
import { confirmAttachmentInputSchema } from "@/packages/contracts/src";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (value: string) => new TextEncoder().encode(value);

assert.equal(attachmentContentTypesMatch("image/jpg", "image/jpeg"), true);
assert.equal(validateAttachmentNameAndContentType("result.pdf", "image/png"), "The .pdf file extension does not match the declared attachment type.");
assert.equal(validateAttachmentNameAndContentType("figure.PNG", "image/png"), null);
assert.match(validatePostAttachmentDetails("payload.pdf", "image/png", 200) ?? "", /does not match/);

assert.equal(
  validateAttachmentContentSignature("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
  null
);
assert.equal(validateAttachmentContentSignature("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)), null);
assert.equal(validateAttachmentContentSignature("image/gif", ascii("GIF89a")), null);
assert.equal(validateAttachmentContentSignature("application/pdf", ascii("%PDF-1.7")), null);
assert.equal(
  validateAttachmentContentSignature(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes(0x50, 0x4b, 0x03, 0x04)
  ),
  null
);
assert.equal(validateAttachmentContentSignature("video/webm", bytes(0x1a, 0x45, 0xdf, 0xa3)), null);
assert.equal(validateAttachmentContentSignature("video/ogg", ascii("OggS")), null);
assert.equal(validateAttachmentContentSignature("video/mp4", bytes(0, 0, 0, 20, ...ascii("ftyp"))), null);
assert.equal(validateAttachmentContentSignature("text/plain", ascii("research notes")), null);
assert.match(validateAttachmentContentSignature("text/plain", bytes(65, 0, 66)) ?? "", /do not match/);
assert.match(validateAttachmentContentSignature("application/pdf", ascii("not a pdf")) ?? "", /do not match/);

const validConfirmation = confirmAttachmentInputSchema.safeParse({
  attachmentId: "00000000-0000-4000-8000-000000000001",
  metadata: { previewText: "bounded" }
});
assert.equal(validConfirmation.success, true);
assert.equal(
  confirmAttachmentInputSchema.safeParse({
    attachmentId: "not-an-id",
    metadata: {}
  }).success,
  false
);
assert.equal(
  confirmAttachmentInputSchema.safeParse({
    attachmentId: "00000000-0000-4000-8000-000000000001",
    metadata: { previewText: "x".repeat(65 * 1024) }
  }).success,
  false
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "extension and MIME agreement",
        "image signatures",
        "document signatures",
        "video signatures",
        "text binary rejection",
        "attachment identifier validation",
        "metadata size bounds"
      ]
    },
    null,
    2
  )
);

export {};
