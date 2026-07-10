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
import { randomUUID } from "node:crypto";
import { env, hasR2Config } from "../config/env";

let s3: S3Client | null = null;

const getS3Client = () => {
  if (!hasR2Config) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "R2 is not configured for attachment uploads."
    });
  }

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

export const createObjectKey = (ownerType: string, fileName: string) => {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${ownerType}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName || "upload"}`;
};

export const createUploadObjectKey = (attachmentId: string) => `pending/${attachmentId}`;

export const createUploadUrl = async (objectKey: string, contentType: string) => {
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET!,
    Key: objectKey,
    ContentType: contentType
  });

  return getSignedUrl(getS3Client(), command, { expiresIn: 60 * 5 });
};

const readObjectBytes = async (objectKey: string, range?: string) => {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: objectKey,
      ...(range ? { Range: range } : {})
    })
  );
  if (!response.Body) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded attachment could not be read." });
  }
  return response.Body.transformToByteArray();
};

export const inspectUploadedObject = async (objectKey: string, includeBody = false) => {
  let head;
  try {
    head = await getS3Client().send(
      new HeadObjectCommand({
        Bucket: env.R2_BUCKET!,
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

  const body = includeBody ? await readObjectBytes(objectKey) : undefined;
  const prefix = body ?? (await readObjectBytes(objectKey, "bytes=0-65535"));
  return {
    body,
    byteSize,
    contentType: head.ContentType?.trim().toLowerCase(),
    prefix: prefix.slice(0, 65_536)
  };
};

const copySource = (objectKey: string) =>
  `${env.R2_BUCKET!}/${objectKey}`
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export const promoteUploadedObject = async (uploadObjectKey: string, objectKey: string) => {
  if (uploadObjectKey === objectKey) return;
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: env.R2_BUCKET!,
      CopySource: copySource(uploadObjectKey),
      Key: objectKey
    })
  );
};

export const deleteUploadedObject = async (objectKey: string) => {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: objectKey
    })
  );
};
