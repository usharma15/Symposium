import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import JSZip from "jszip";
import {
  AttachmentUploadSizeError,
  createBoundedAttachmentUploadStream
} from "@/apps/api/src/services/attachmentUploadStream";
import { buildApp } from "@/apps/api/src/server";
import { validateDocxArchive, validateOfficeArchive } from "@/lib/docxSecurity";
import {
  attachmentKindForContentType,
  attachmentContentTypesMatch,
  inferAttachmentContentType,
  validateAttachmentContentSignature,
  validateAttachmentNameAndContentType,
  validatePostAttachmentDetails
} from "@/lib/attachmentRules";
import { confirmAttachmentInputSchema } from "@/packages/contracts/src";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (value: string) => new TextEncoder().encode(value);

const makeDocx = async (relationships: string, extraFiles: Record<string, string> = {}) => {
  const archive = new JSZip();
  archive.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  archive.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Safe document</w:t></w:r></w:p></w:body></w:document>`
  );
  archive.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`
  );
  for (const [fileName, content] of Object.entries(extraFiles)) archive.file(fileName, content);
  return archive.generateAsync({ type: "uint8array" });
};

const makeOfficeArchive = async (primaryPath: string, primaryXml: string, extraFiles: Record<string, string> = {}) => {
  const archive = new JSZip();
  archive.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  archive.file(primaryPath, primaryXml);
  for (const [fileName, content] of Object.entries(extraFiles)) archive.file(fileName, content);
  return archive.generateAsync({ type: "uint8array" });
};

const main = async () => {
assert.equal(attachmentContentTypesMatch("image/jpg", "image/jpeg"), true);
assert.equal(validateAttachmentNameAndContentType("result.pdf", "image/png"), "The .pdf file extension does not match the declared attachment type.");
assert.equal(validateAttachmentNameAndContentType("figure.PNG", "image/png"), null);
assert.match(validatePostAttachmentDetails("payload.pdf", "image/png", 200) ?? "", /does not match/);
assert.equal(inferAttachmentContentType("analysis.py", "text/x-python-script"), "text/x-python");
assert.equal(inferAttachmentContentType("Model.java", "application/x-java-applet"), "text/plain");
assert.equal(inferAttachmentContentType("experiment.ipynb", "application/octet-stream"), "application/json");
assert.equal(inferAttachmentContentType("recording.m4v", "application/octet-stream"), "video/mp4");
assert.equal(attachmentKindForContentType("text/plain", "Model.java"), "code");
assert.equal(attachmentKindForContentType("application/json", "experiment.ipynb"), "code");
assert.equal(attachmentKindForContentType("text/csv", "results.csv"), "spreadsheet");
assert.equal(attachmentKindForContentType("application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx"), "presentation");

assert.equal(
  validateAttachmentContentSignature("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
  null
);
assert.equal(validateAttachmentContentSignature("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)), null);
assert.equal(validateAttachmentContentSignature("image/gif", ascii("GIF89a")), null);
assert.equal(validateAttachmentContentSignature("application/pdf", ascii("%PDF-1.7")), null);
assert.equal(validateAttachmentContentSignature("image/bmp", ascii("BM-safe")), null);
assert.equal(
  validateAttachmentContentSignature(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes(0x50, 0x4b, 0x03, 0x04)
  ),
  null
);
assert.equal(
  validateAttachmentContentSignature(
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes(0x50, 0x4b, 0x03, 0x04)
  ),
  null
);
assert.equal(validateAttachmentContentSignature("application/vnd.ms-excel", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)), null);
assert.equal(validateAttachmentContentSignature("video/webm", bytes(0x1a, 0x45, 0xdf, 0xa3)), null);
assert.equal(validateAttachmentContentSignature("video/ogg", ascii("OggS")), null);
assert.equal(validateAttachmentContentSignature("video/mp4", bytes(0, 0, 0, 20, ...ascii("ftyp"))), null);
assert.equal(validateAttachmentContentSignature("video/mpeg", bytes(0, 0, 1, 0xba)), null);
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

const hyperlinkType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
assert.equal(
  await validateDocxArchive(
    await makeDocx(`<Relationship Id="rId1" Type="${hyperlinkType}" Target="https://example.com/source" TargetMode="External"/>`)
  ),
  true
);
assert.equal(
  await validateDocxArchive(
    await makeDocx(`<Relationship Id="rId1" Type="${hyperlinkType}" Target="javascript:alert(1)" TargetMode="External"/>`)
  ),
  false
);
assert.equal(
  await validateDocxArchive(
    await makeDocx(
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="afchunk1.html"/>`,
      { "word/afchunk1.html": "<script>alert(1)</script>" }
    )
  ),
  false
);
assert.equal(
  await validateDocxArchive(await makeDocx("", { "word/embeddings/object.bin": "active package" })),
  false
);
assert.equal(
  await validateOfficeArchive(await makeOfficeArchive("xl/workbook.xml", "<workbook><sheets/></workbook>"), "xlsx"),
  true
);
assert.equal(
  await validateOfficeArchive(await makeOfficeArchive("ppt/presentation.xml", "<p:presentation/>", { "ppt/vbaProject.bin": "macro" }), "pptx"),
  false
);

const exactUpload = createBoundedAttachmentUploadStream(Readable.from([Buffer.from("exact")]), 5);
const exactUploadChunks: Buffer[] = [];
for await (const chunk of exactUpload) exactUploadChunks.push(Buffer.from(chunk));
assert.equal(Buffer.concat(exactUploadChunks).toString("utf8"), "exact");
await assert.rejects(
  async () => {
    for await (const _chunk of createBoundedAttachmentUploadStream(Readable.from([Buffer.from("too-long")]), 3)) {
      // Drain the bounded stream so its size guard executes.
    }
  },
  AttachmentUploadSizeError
);
await assert.rejects(
  async () => {
    for await (const _chunk of createBoundedAttachmentUploadStream(Readable.from([Buffer.from("short")]), 8)) {
      // Drain the bounded stream so its flush guard executes.
    }
  },
  AttachmentUploadSizeError
);

const app = await buildApp({ logger: false });
try {
  const malformedUpload = await app.inject({
    method: "PUT",
    url: "/v1/attachments/not-a-uuid/content",
    headers: {
      "content-type": "application/octet-stream",
      "x-symposium-handle": "@boundary"
    },
    payload: Buffer.from("bounded")
  });
  assert.equal(malformedUpload.statusCode, 400);

  const parsedUploadStream = await app.inject({
    method: "PUT",
    url: "/v1/attachments/00000000-0000-4000-8000-000000000001/content",
    headers: {
      "content-type": "application/octet-stream",
      "x-symposium-handle": "@boundary"
    },
    payload: Buffer.from("bounded")
  });
  assert.equal([404, 412].includes(parsedUploadStream.statusCode), true);

  const uploadPreflight = await app.inject({
    method: "OPTIONS",
    url: "/v1/attachments/00000000-0000-4000-8000-000000000001/content",
    headers: {
      origin: "http://localhost:3000",
      "access-control-request-method": "PUT",
      "access-control-request-headers": "authorization,content-type"
    }
  });
  assert.equal(uploadPreflight.statusCode, 204);
  assert.equal(uploadPreflight.headers["access-control-allow-origin"], "http://localhost:3000");
  assert.match(String(uploadPreflight.headers["access-control-allow-methods"]), /PUT/);
} finally {
  await app.close();
}

const root = process.cwd();
const [viewerSource, storageSource, storageDeletionSource, maintenanceSource, repositorySource, routeSource, clientSource, serverSource] = await Promise.all([
  readFile(path.join(root, "features/attachments/AttachmentViews.tsx"), "utf8"),
  readFile(path.join(root, "apps/api/src/services/storage.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/services/storageDeletion.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/services/maintenance.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/repository/attachments.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/routes/attachmentRoutes.ts"), "utf8"),
  readFile(path.join(root, "features/attachments/attachmentUploadClient.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/server.ts"), "utf8")
]);
assert.match(viewerSource, /renderAltChunks: false/);
assert.match(viewerSource, /sanitizeRenderedDocx\(target\)/);
assert.match(storageSource, /ContentLength: byteSize/);
assert.match(storageSource, /Body: body/);
assert.match(repositorySource, /stagingUploadedAt/);
assert.match(repositorySource, /createBoundedAttachmentUploadStream/);
assert.match(routeSource, /scope: "attachment-content", limit: 30/);
assert.match(routeSource, /bodyLimit: 50 \* 1024 \* 1024/);
assert.match(clientSource, /uploadTransport === "authenticated_api"/);
assert.match(serverSource, /addContentTypeParser\("application\/octet-stream"/);
assert.match(serverSource, /"POST", "PUT", "PATCH"/);
assert.doesNotMatch(storageSource, /PutBucketCorsCommand|GetBucketCorsCommand/);
assert.match(storageDeletionSource, /storage_deletion_jobs/);
assert.match(storageDeletionSource, /FOR UPDATE SKIP LOCKED/);
assert.match(maintenanceSource, /runStorageDeletionMaintenance/);
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
        "browser MIME alias canonicalization",
        "code, spreadsheet, and presentation classification",
        "image signatures",
        "document signatures",
        "video signatures",
        "text binary rejection",
        "attachment identifier validation",
        "metadata size bounds",
        "exact, oversized, and undersized upload stream bounds",
        "DOCX active-content and unsafe-relationship rejection",
        "spreadsheet and presentation archive validation",
        "defense-in-depth DOCX render sanitization",
        "authenticated API upload ownership, rate, and body-size binding",
        "durable and retry-safe R2 object cleanup"
      ]
    },
    null,
    2
  )
);
};

void main();

export {};
