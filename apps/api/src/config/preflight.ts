import { cleanHandle } from "@/lib/symposiumCore";
import {
  attachmentStorageMode,
  databaseUrl,
  env,
  hasAttachmentStorage,
  hasFilesystemStorageConfig,
  hasR2Config,
  hasRedisConfig,
  requireAuthForWrites,
  webOrigins
} from "./env";
import path from "node:path";

const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

export const validWebOrigin = (origin: string, strict = env.SYMPOSIUM_STRICT_ENV) => {
  if (origin === "*") return false;
  try {
    const parsed = new URL(origin);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    if (parsed.protocol !== "https:" && (!(!strict && parsed.protocol === "http:"))) return false;
    return parsed.origin === origin.replace(/\/$/, "");
  } catch {
    return false;
  }
};

export const clerkSecretMode = (secret?: string | null) => {
  if (!secret) return "missing" as const;
  if (secret.startsWith("sk_live_")) return "production" as const;
  if (secret.startsWith("sk_test_")) return "development" as const;
  return "unknown" as const;
};

export const deploymentEnvWarnings = () => {
  if (!env.SYMPOSIUM_STRICT_ENV) return [];

  const warnings: string[] = [];
  const clerkMode = clerkSecretMode(env.CLERK_SECRET_KEY);
  if (clerkMode === "development") {
    warnings.push("Clerk development keys are active on the public deployment; migrate to a production Clerk instance.");
  } else if (clerkMode === "unknown") {
    warnings.push("The Clerk secret key mode could not be identified from its prefix.");
  }
  return warnings;
};

export const deploymentEnvIssues = () => {
  const issues: string[] = [];
  if (attachmentStorageMode === "filesystem") {
    if (!hasFilesystemStorageConfig) {
      issues.push("Filesystem attachment storage requires a root, local base URL, and signing secret.");
    }
    if (
      env.SYMPOSIUM_FILESYSTEM_STORAGE_ROOT &&
      !path.isAbsolute(env.SYMPOSIUM_FILESYSTEM_STORAGE_ROOT)
    ) {
      issues.push("SYMPOSIUM_FILESYSTEM_STORAGE_ROOT must be an absolute path.");
    }
    if (env.SYMPOSIUM_FILESYSTEM_STORAGE_BASE_URL) {
      const baseUrl = new URL(env.SYMPOSIUM_FILESYSTEM_STORAGE_BASE_URL);
      if (
        baseUrl.protocol !== "http:" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)
      ) {
        issues.push("Filesystem attachment delivery must use a loopback HTTP base URL.");
      }
    }
  }

  if (!env.SYMPOSIUM_STRICT_ENV) return issues;

  if (attachmentStorageMode !== "r2") {
    issues.push("Strict live mode requires the R2 attachment storage backend.");
  }

  if (!databaseUrl) {
    issues.push("DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL is required for live persistence.");
  }

  if (!env.CLERK_SECRET_KEY) {
    issues.push("CLERK_SECRET_KEY is required so the API can verify Clerk session tokens.");
  }

  if (!requireAuthForWrites) {
    issues.push("SYMPOSIUM_REQUIRE_AUTH must stay true for live public-beta writes.");
  }

  if (env.SYMPOSIUM_ALLOW_DEV_ACTOR) {
    issues.push("SYMPOSIUM_ALLOW_DEV_ACTOR must be false outside local development.");
  }

  if (!webOrigins.length) {
    issues.push("SYMPOSIUM_WEB_ORIGINS must include the deployed Vercel origin.");
  }

  if (webOrigins.some((origin) => !validWebOrigin(origin, true))) {
    issues.push("SYMPOSIUM_WEB_ORIGINS must contain exact HTTPS origins without wildcards, credentials, paths, or query strings.");
  }

  if (webOrigins.some((origin) => localOriginPattern.test(origin))) {
    issues.push("SYMPOSIUM_WEB_ORIGINS must not include localhost-only origins in strict live mode.");
  }

  if (!hasRedisConfig) {
    issues.push("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for shared authenticated-mutation rate limits.");
  }

  if (!hasR2Config) {
    issues.push("R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required for live attachments.");
  }

  if (!hasAttachmentStorage) {
    issues.push("The selected persistent attachment storage backend is not configured.");
  }

  if (!env.R2_PUBLIC_BASE_URL) {
    issues.push("R2_PUBLIC_BASE_URL is required for persistent public post and profile attachments.");
  } else if (new URL(env.R2_PUBLIC_BASE_URL).protocol !== "https:") {
    issues.push("R2_PUBLIC_BASE_URL must use HTTPS in strict live mode.");
  }

  const ownerHandle = cleanHandle(env.SYMPOSIUM_OWNER_HANDLE);
  if (ownerHandle === "@udayan" && !env.SYMPOSIUM_OWNER_CLERK_USER_ID) {
    issues.push("Set SYMPOSIUM_OWNER_CLERK_USER_ID before the owner handle is allowed to bind to a Clerk account.");
  }

  return issues;
};

export const assertDeploymentEnv = () => {
  const issues = deploymentEnvIssues();
  if (!issues.length) return;

  throw new Error(`Invalid live SYMPOSIUM deployment environment:\n- ${issues.join("\n- ")}`);
};

if (process.argv[1]?.endsWith("preflight.ts")) {
  try {
    assertDeploymentEnv();
    console.log("SYMPOSIUM API deployment preflight passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
