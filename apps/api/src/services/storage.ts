import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TRPCError } from "@trpc/server";
import {
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  rename,
  rmdir,
  stat,
  unlink
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  attachmentPublicBaseUrl,
  attachmentStorageBucket,
  attachmentStorageMode,
  env,
  hasAttachmentStorage,
  hasFilesystemStorageConfig,
  hasR2Config
} from "../config/env";

let s3: S3Client | null = null;

const storageUnavailable = () => new TRPCError({
  code: "PRECONDITION_FAILED",
  message: "Persistent attachment storage is not configured."
});

const getS3Client = () => {
  if (attachmentStorageMode !== "r2" || !hasR2Config) throw storageUnavailable();

  if (!s3) {
    s3 = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!
      }
    });
  }

  return s3;
};

const requireFilesystemStorage = () => {
  if (attachmentStorageMode !== "filesystem" || !hasFilesystemStorageConfig) {
    throw storageUnavailable();
  }
  return path.resolve(env.SYMPOSIUM_FILESYSTEM_STORAGE_ROOT!);
};

export const assertSafeStorageObjectKey = (objectKey: string) => {
  if (
    !objectKey ||
    objectKey.length > 1024 ||
    objectKey.includes("\0") ||
    objectKey.includes("\\") ||
    path.posix.isAbsolute(objectKey)
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid attachment storage key." });
  }
  const segments = objectKey.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid attachment storage key." });
  }
  return objectKey;
};

const filesystemObjectPath = (objectKey: string) => {
  const root = requireFilesystemStorage();
  const resolved = path.resolve(root, ...assertSafeStorageObjectKey(objectKey).split("/"));
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid attachment storage key." });
  }
  return { resolved, root };
};

const removeEmptyObjectDirectories = async (start: string, root: string) => {
  let current = path.dirname(start);
  while (current !== root && current.startsWith(`${root}${path.sep}`)) {
    try {
      await rmdir(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
};

const storeFilesystemObject = async (objectKey: string, body: Readable) => {
  const { resolved } = filesystemObjectPath(objectKey);
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporaryPath = `${resolved}.${randomUUID()}.tmp`;
  try {
    await pipeline(body, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
    await rename(temporaryPath, resolved);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

const readFilesystemBytes = async (objectKey: string, start = 0, end?: number) => {
  const { resolved } = filesystemObjectPath(objectKey);
  const handle = await open(resolved, "r");
  try {
    const metadata = await handle.stat();
    const finalEnd = Math.min(end ?? metadata.size - 1, metadata.size - 1);
    if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || start < 0 || finalEnd < start) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded attachment has an invalid size." });
    }
    const buffer = Buffer.alloc(finalEnd - start + 1);
    const result = await handle.read(buffer, 0, buffer.length, start);
    return new Uint8Array(buffer.subarray(0, result.bytesRead));
  } finally {
    await handle.close();
  }
};

export const createObjectKey = (ownerType: string, fileName: string) => {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${ownerType}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName || "upload"}`;
};

export const createUploadObjectKey = (attachmentId: string) => `pending/${attachmentId}`;

export const storageBucket = () => {
  if (!hasAttachmentStorage || !attachmentStorageBucket) throw storageUnavailable();
  return attachmentStorageBucket;
};

export const publicStorageObjectUrl = (objectKey: string) =>
  attachmentPublicBaseUrl
    ? `${attachmentPublicBaseUrl.replace(/\/$/, "")}/${assertSafeStorageObjectKey(objectKey)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`
    : null;

export const storeUploadedObject = async (
  objectKey: string,
  contentType: string,
  byteSize: number,
  body: Readable
) => {
  assertSafeStorageObjectKey(objectKey);
  if (attachmentStorageMode === "filesystem") {
    await storeFilesystemObject(objectKey, body);
    const metadata = await stat(filesystemObjectPath(objectKey).resolved);
    if (metadata.size !== byteSize) {
      await deleteUploadedObject(objectKey);
      throw new Error("Stored attachment size did not match the declared upload size.");
    }
    return;
  }
  await getS3Client().send(new PutObjectCommand({
    Bucket: storageBucket(),
    Key: objectKey,
    ContentType: contentType,
    ContentLength: byteSize,
    Body: body
  }));
};

const filesystemSignature = (objectKey: string, expiresAt: number) =>
  createHmac("sha256", env.SYMPOSIUM_FILESYSTEM_STORAGE_SIGNING_SECRET!)
    .update(`${expiresAt}\n${assertSafeStorageObjectKey(objectKey)}`)
    .digest("hex");

export const createPrivateDownloadUrl = async (objectKey: string, expiresIn = 60) => {
  assertSafeStorageObjectKey(objectKey);
  if (attachmentStorageMode === "filesystem") {
    requireFilesystemStorage();
    const expiresAt = Math.floor(Date.now() / 1000) + Math.min(Math.max(Math.trunc(expiresIn), 1), 15 * 60);
    const baseUrl = env.SYMPOSIUM_FILESYSTEM_STORAGE_BASE_URL!.replace(/\/$/, "");
    const encodedKey = objectKey.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    return `${baseUrl}/v1/storage/private/${encodedKey}?expires=${expiresAt}&signature=${filesystemSignature(objectKey, expiresAt)}`;
  }
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: storageBucket(), Key: objectKey }),
    { expiresIn }
  );
};

export const verifyPrivateFilesystemDownload = (
  objectKey: string,
  expiresValue: string | undefined,
  signatureValue: string | undefined,
  now = Math.floor(Date.now() / 1000)
) => {
  if (attachmentStorageMode !== "filesystem" || !hasFilesystemStorageConfig) return false;
  const expiresAt = Number(expiresValue);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < now ||
    expiresAt > now + 15 * 60 ||
    !signatureValue ||
    !/^[a-f0-9]{64}$/.test(signatureValue)
  ) {
    return false;
  }
  try {
    const actual = Buffer.from(signatureValue, "hex");
    const expected = Buffer.from(filesystemSignature(objectKey, expiresAt), "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

const readR2ObjectBytes = async (objectKey: string, range?: string) => {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: storageBucket(),
      Key: objectKey,
      ...(range ? { Range: range } : {})
    })
  );
  if (!response.Body) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded attachment could not be read." });
  }
  return response.Body.transformToByteArray();
};

export const inspectUploadedObject = async (
  objectKey: string,
  includeBody = false,
  authoritativeContentType?: string
) => {
  assertSafeStorageObjectKey(objectKey);
  if (attachmentStorageMode === "filesystem") {
    let metadata;
    try {
      metadata = await stat(filesystemObjectPath(objectKey).resolved);
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Upload the attachment before confirming it." });
    }
    if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded attachment has an invalid size." });
    }
    const body = includeBody ? await readFilesystemBytes(objectKey) : undefined;
    const prefix = body ?? await readFilesystemBytes(objectKey, 0, 65_535);
    return {
      body,
      byteSize: metadata.size,
      contentType: authoritativeContentType?.trim().toLowerCase(),
      prefix: prefix.slice(0, 65_536)
    };
  }

  let head;
  try {
    head = await getS3Client().send(
      new HeadObjectCommand({
        Bucket: storageBucket(),
        Key: objectKey
      })
    );
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Upload the attachment before confirming it." });
  }

  const byteSize = Number(head.ContentLength);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded attachment has an invalid size." });
  }

  const body = includeBody ? await readR2ObjectBytes(objectKey) : undefined;
  const prefix = body ?? (await readR2ObjectBytes(objectKey, "bytes=0-65535"));
  return {
    body,
    byteSize,
    contentType: head.ContentType?.trim().toLowerCase(),
    prefix: prefix.slice(0, 65_536)
  };
};

const copySource = (objectKey: string) =>
  `${storageBucket()}/${objectKey}`
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export const promoteUploadedObject = async (uploadObjectKey: string, objectKey: string) => {
  assertSafeStorageObjectKey(uploadObjectKey);
  assertSafeStorageObjectKey(objectKey);
  if (uploadObjectKey === objectKey) return;
  if (attachmentStorageMode === "filesystem") {
    const source = filesystemObjectPath(uploadObjectKey);
    const destination = filesystemObjectPath(objectKey);
    await mkdir(path.dirname(destination.resolved), { recursive: true });
    const temporaryPath = `${destination.resolved}.${randomUUID()}.tmp`;
    try {
      await copyFile(source.resolved, temporaryPath);
      await rename(temporaryPath, destination.resolved);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return;
  }
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: storageBucket(),
      CopySource: copySource(uploadObjectKey),
      Key: objectKey
    })
  );
};

export const deleteUploadedObject = async (objectKey: string, bucket = storageBucket()) => {
  assertSafeStorageObjectKey(objectKey);
  if (bucket !== storageBucket()) {
    throw new Error("Attachment deletion job belongs to a different storage bucket.");
  }
  if (attachmentStorageMode === "filesystem") {
    const object = filesystemObjectPath(objectKey);
    await unlink(object.resolved).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await removeEmptyObjectDirectories(object.resolved, object.root);
    return;
  }
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey
    })
  );
};

export type StoredObjectRange = {
  byteSize: number;
  end: number;
  start: number;
  stream: Readable;
};

export const openFilesystemStoredObject = async (
  objectKey: string,
  range?: { end?: number; start: number }
): Promise<StoredObjectRange> => {
  const object = filesystemObjectPath(objectKey);
  const metadata = await stat(object.resolved);
  if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
  }
  const start = range?.start ?? 0;
  const end = Math.min(range?.end ?? metadata.size - 1, metadata.size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= metadata.size) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid attachment byte range." });
  }
  return {
    byteSize: metadata.size,
    end,
    start,
    stream: createReadStream(object.resolved, { start, end })
  };
};
