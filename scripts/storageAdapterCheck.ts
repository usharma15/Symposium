import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

const main = async () => {
if (process.argv.includes("--strict-child")) {
  const root = await mkdtemp(path.join(tmpdir(), "symposium-storage-strict-"));
  Object.assign(process.env, {
    NODE_ENV: "production",
    SYMPOSIUM_STRICT_ENV: "true",
    SYMPOSIUM_ATTACHMENT_STORAGE: "filesystem",
    SYMPOSIUM_FILESYSTEM_STORAGE_ROOT: root,
    SYMPOSIUM_FILESYSTEM_STORAGE_BASE_URL: "http://127.0.0.1:4000",
    SYMPOSIUM_FILESYSTEM_STORAGE_SIGNING_SECRET: "strict-check-signing-secret-is-at-least-32-characters",
    SYMPOSIUM_WEB_ORIGINS: "https://symposium.example",
    SYMPOSIUM_REQUIRE_AUTH: "true",
    SYMPOSIUM_ALLOW_DEV_ACTOR: "false"
  });
  const { deploymentEnvIssues } = await import("../apps/api/src/config/preflight");
  const issues = deploymentEnvIssues();
  assert.ok(
    issues.includes("Strict live mode requires the R2 attachment storage backend."),
    "strict live mode must reject filesystem attachment storage"
  );
  await rm(root, { recursive: true, force: true });
  process.exit(0);
}

const root = await mkdtemp(path.join(tmpdir(), "symposium-storage-adapter-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  SYMPOSIUM_STRICT_ENV: "false",
  SYMPOSIUM_ATTACHMENT_STORAGE: "filesystem",
  SYMPOSIUM_FILESYSTEM_STORAGE_ROOT: root,
  SYMPOSIUM_FILESYSTEM_STORAGE_BASE_URL: "http://127.0.0.1:4000",
  SYMPOSIUM_FILESYSTEM_STORAGE_SIGNING_SECRET: "adapter-check-signing-secret-is-at-least-32-characters",
  SYMPOSIUM_FILESYSTEM_STORAGE_BUCKET: "symposium-adapter-check"
});

const {
  assertSafeStorageObjectKey,
  createPrivateDownloadUrl,
  deleteUploadedObject,
  inspectUploadedObject,
  openFilesystemStoredObject,
  promoteUploadedObject,
  publicStorageObjectUrl,
  storageBucket,
  storeUploadedObject,
  verifyPrivateFilesystemDownload
} = await import("../apps/api/src/services/storage");

const readStream = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

try {
  assert.equal(storageBucket(), "symposium-adapter-check");
  assert.equal(
    publicStorageObjectUrl("post/2026-07-30/report.pdf"),
    "http://127.0.0.1:4000/v1/storage/public/post/2026-07-30/report.pdf"
  );

  for (const unsafeKey of [
    "",
    "/absolute",
    "../secret",
    "post/../secret",
    "post//secret",
    "post\\secret",
    "post/\0secret"
  ]) {
    assert.throws(() => assertSafeStorageObjectKey(unsafeKey), /Invalid attachment storage key/);
  }

  const stagedKey = "pending/11111111-1111-4111-8111-111111111111";
  const canonicalKey = "post/2026-07-30/11111111-1111-4111-8111-111111111111-report.txt";
  const body = Buffer.from("SYMPOSIUM canonical filesystem attachment\n", "utf8");
  await storeUploadedObject(stagedKey, "text/plain", body.length, Readable.from(body));

  const inspection = await inspectUploadedObject(stagedKey, true, "text/plain");
  assert.equal(inspection.byteSize, body.length);
  assert.equal(inspection.contentType, "text/plain");
  assert.deepEqual(Buffer.from(inspection.body!), body);
  assert.deepEqual(Buffer.from(inspection.prefix), body);

  await promoteUploadedObject(stagedKey, canonicalKey);
  const promoted = await inspectUploadedObject(canonicalKey, false, "text/plain");
  assert.equal(promoted.byteSize, body.length);
  assert.deepEqual(Buffer.from(promoted.prefix), body);

  const range = await openFilesystemStoredObject(canonicalKey, { start: 10, end: 18 });
  assert.equal(range.byteSize, body.length);
  assert.equal((await readStream(range.stream)).toString("utf8"), body.subarray(10, 19).toString("utf8"));
  await assert.rejects(
    openFilesystemStoredObject(canonicalKey, { start: body.length }),
    /Invalid attachment byte range/
  );

  const privateUrl = new URL(await createPrivateDownloadUrl(canonicalKey, 60));
  const expires = privateUrl.searchParams.get("expires")!;
  const signature = privateUrl.searchParams.get("signature")!;
  assert.equal(privateUrl.pathname, `/v1/storage/private/${canonicalKey}`);
  assert.equal(verifyPrivateFilesystemDownload(canonicalKey, expires, signature), true);
  assert.equal(verifyPrivateFilesystemDownload(`${canonicalKey}-tampered`, expires, signature), false);
  const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
  assert.notEqual(tamperedSignature, signature);
  assert.equal(verifyPrivateFilesystemDownload(canonicalKey, expires, tamperedSignature), false);
  assert.equal(
    verifyPrivateFilesystemDownload(canonicalKey, String(Math.floor(Date.now() / 1000) - 1), signature),
    false
  );
  assert.equal(
    verifyPrivateFilesystemDownload(canonicalKey, String(Math.floor(Date.now() / 1000) + 901), signature),
    false
  );

  const mismatchKey = "pending/22222222-2222-4222-8222-222222222222";
  await assert.rejects(
    storeUploadedObject(mismatchKey, "text/plain", body.length + 1, Readable.from(body)),
    /Stored attachment size did not match/
  );
  await assert.rejects(inspectUploadedObject(mismatchKey, false, "text/plain"), /Upload the attachment before confirming/);

  const concurrentKey = "pending/33333333-3333-4333-8333-333333333333";
  const left = Buffer.alloc(64 * 1024, "L");
  const right = Buffer.alloc(64 * 1024, "R");
  await Promise.all([
    storeUploadedObject(concurrentKey, "application/octet-stream", left.length, Readable.from(left)),
    storeUploadedObject(concurrentKey, "application/octet-stream", right.length, Readable.from(right))
  ]);
  const concurrentBytes = await readFile(path.join(root, ...concurrentKey.split("/")));
  assert.ok(
    concurrentBytes.equals(left) || concurrentBytes.equals(right),
    "concurrent atomic writes must leave one complete object"
  );

  const filesBeforeDeletion = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  assert.equal(filesBeforeDeletion.some((name) => name.endsWith(".json")), false);
  assert.equal(filesBeforeDeletion.some((name) => name.endsWith(".tmp")), false);

  await deleteUploadedObject(stagedKey);
  await deleteUploadedObject(canonicalKey);
  await deleteUploadedObject(concurrentKey);
  await deleteUploadedObject(canonicalKey);
  assert.deepEqual(await readdir(root), []);

  const strict = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, "--strict-child"],
    { encoding: "utf8" }
  );
  assert.equal(strict.status, 0, strict.stderr || strict.stdout);

  console.log(
    "Attachment storage adapter atomicity, traversal safety, byte/type inspection, promotion, ranges, signed access, cleanup, concurrency, metadata authority, and strict-live refusal passed."
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
