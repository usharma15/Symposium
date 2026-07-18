import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type CORSRule
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { env, hasR2Config, webOrigins } from "../config/env";

let s3: S3Client | null = null;
let uploadCorsStatus: {
  checkedAt: string | null;
  configured: boolean;
  error: string | null;
  origins: string[];
} = {
  checkedAt: null,
  configured: false,
  error: null,
  origins: []
};

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

const normalizedWebOrigins = () => Array.from(new Set(webOrigins.flatMap((value) => {
  try {
    return [new URL(value).origin];
  } catch {
    return [];
  }
})));

const normalizedCorsRule = (rule: CORSRule): CORSRule => ({
  AllowedHeaders: rule.AllowedHeaders,
  AllowedMethods: rule.AllowedMethods,
  AllowedOrigins: rule.AllowedOrigins,
  ExposeHeaders: rule.ExposeHeaders,
  MaxAgeSeconds: rule.MaxAgeSeconds
});

const ruleAllowsBrowserUploads = (rule: CORSRule, origins: string[]) => {
  const methods = new Set((rule.AllowedMethods ?? []).map((value) => value.toUpperCase()));
  const headers = new Set((rule.AllowedHeaders ?? []).map((value) => value.toLowerCase()));
  const allowedOrigins = new Set(rule.AllowedOrigins ?? []);
  return methods.has("PUT") &&
    (headers.has("*") || headers.has("content-type")) &&
    origins.every((origin) => allowedOrigins.has(origin));
};

export const getR2UploadCorsStatus = () => ({ ...uploadCorsStatus, origins: [...uploadCorsStatus.origins] });

export const ensureR2BrowserUploadCors = async () => {
  const origins = normalizedWebOrigins();
  if (!hasR2Config || !env.R2_BUCKET || !origins.length) {
    uploadCorsStatus = {
      checkedAt: new Date().toISOString(),
      configured: false,
      error: "R2 or deployed web origins are not configured.",
      origins
    };
    return uploadCorsStatus;
  }

  try {
    let currentRules: CORSRule[] = [];
    try {
      const current = await getS3Client().send(new GetBucketCorsCommand({ Bucket: env.R2_BUCKET }));
      currentRules = (current.CORSRules ?? []).map(normalizedCorsRule);
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = error instanceof Error ? error.name : "";
      if (statusCode !== 404 && name !== "NoSuchCORSConfiguration") throw error;
    }

    if (!currentRules.some((rule) => ruleAllowsBrowserUploads(rule, origins))) {
      const uploadRuleIndex = currentRules.findIndex((rule) =>
        (rule.AllowedMethods ?? []).some((method) => method.toUpperCase() === "PUT")
      );
      const uploadRule: CORSRule = uploadRuleIndex >= 0
        ? currentRules[uploadRuleIndex]!
        : { AllowedMethods: [], AllowedOrigins: [] };
      const nextUploadRule: CORSRule = {
        AllowedOrigins: Array.from(new Set([...(uploadRule.AllowedOrigins ?? []), ...origins])),
        AllowedMethods: Array.from(new Set([...(uploadRule.AllowedMethods ?? []), "PUT"])),
        AllowedHeaders: Array.from(new Set([...(uploadRule.AllowedHeaders ?? []), "Content-Type"])),
        ExposeHeaders: Array.from(new Set([...(uploadRule.ExposeHeaders ?? []), "ETag"])),
        MaxAgeSeconds: Math.max(uploadRule.MaxAgeSeconds ?? 0, 3600)
      };
      const nextRules = uploadRuleIndex >= 0
        ? currentRules.map((rule, index) => index === uploadRuleIndex ? nextUploadRule : rule)
        : [...currentRules, nextUploadRule];
      await getS3Client().send(new PutBucketCorsCommand({
        Bucket: env.R2_BUCKET,
        CORSConfiguration: { CORSRules: nextRules }
      }));
    }

    uploadCorsStatus = {
      checkedAt: new Date().toISOString(),
      configured: true,
      error: null,
      origins
    };
    return uploadCorsStatus;
  } catch (error) {
    uploadCorsStatus = {
      checkedAt: new Date().toISOString(),
      configured: false,
      error: error instanceof Error ? error.message : "R2 CORS verification failed.",
      origins
    };
    throw error;
  }
};

export const createObjectKey = (ownerType: string, fileName: string) => {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${ownerType}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName || "upload"}`;
};

export const createUploadObjectKey = (attachmentId: string) => `pending/${attachmentId}`;

export const createUploadUrl = async (objectKey: string, contentType: string, byteSize: number) => {
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET!,
    Key: objectKey,
    ContentType: contentType,
    ContentLength: byteSize
  });

  return getSignedUrl(getS3Client(), command, {
    expiresIn: 60 * 5,
    signableHeaders: new Set(["content-type"])
  });
};

export const createPrivateDownloadUrl = async (objectKey: string) =>
  getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: env.R2_BUCKET!, Key: objectKey }),
    { expiresIn: 60 }
  );

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

export const deleteUploadedObject = async (objectKey: string, bucket = env.R2_BUCKET!) => {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey
    })
  );
};
