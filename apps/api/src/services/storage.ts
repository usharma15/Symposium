import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

export const createUploadUrl = async (objectKey: string, contentType: string) => {
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET!,
    Key: objectKey,
    ContentType: contentType
  });

  return getSignedUrl(getS3Client(), command, { expiresIn: 60 * 5 });
};
