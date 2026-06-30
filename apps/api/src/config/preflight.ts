import { cleanHandle } from "@/lib/symposiumCore";
import {
  databaseUrl,
  env,
  hasR2Config,
  hasRedisConfig,
  requireAuthForWrites,
  webOrigins
} from "./env";

const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

export const deploymentEnvIssues = () => {
  if (!env.SYMPOSIUM_STRICT_ENV) return [];

  const issues: string[] = [];

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

  if (webOrigins.some((origin) => localOriginPattern.test(origin))) {
    issues.push("SYMPOSIUM_WEB_ORIGINS must not include localhost-only origins in strict live mode.");
  }

  if (!hasRedisConfig) {
    issues.push("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for shared live rate limits/events.");
  }

  if (!hasR2Config) {
    issues.push("R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required for live attachments.");
  }

  const ownerHandle = cleanHandle(env.SYMPOSIUM_OWNER_HANDLE);
  if (ownerHandle === "@usharma" && !env.SYMPOSIUM_OWNER_CLERK_USER_ID) {
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
