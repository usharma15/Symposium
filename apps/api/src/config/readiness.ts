import { cleanHandle } from "@/lib/symposiumCore";
import { getPool } from "../db/client";
import {
  getMigrationStatus,
  latestMigrationId,
  migrationIds,
  type MigrationStatus
} from "../db/migrate";
import { getMaintenanceStatus } from "../services/maintenance";
import {
  databaseUrl,
  env,
  hasR2Config,
  hasRedisConfig,
  requireAuthForWrites,
  webOrigins
} from "./env";
import { clerkSecretMode, deploymentEnvIssues, deploymentEnvWarnings } from "./preflight";

type RuntimeCheck = {
  key: string;
  label: string;
  configured: boolean;
  required: boolean;
  ok: boolean;
  detail?: string;
};

export type RuntimeReadiness = {
  ok: boolean;
  status: "ready" | "local" | "not_ready";
  strict: boolean;
  checkedAt: string;
  checks: RuntimeCheck[];
  issues: string[];
  warnings: string[];
  maintenance: ReturnType<typeof getMaintenanceStatus>;
  migrations: MigrationStatus;
  release: string | null;
};

const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

const requiredCheck = (
  key: string,
  label: string,
  configured: boolean,
  required: boolean,
  detail?: string
): RuntimeCheck => ({
  key,
  label,
  configured,
  required,
  ok: !required || configured,
  detail
});

export const getRuntimeReadiness = async (): Promise<RuntimeReadiness> => {
  const strict = env.SYMPOSIUM_STRICT_ENV;
  const ownerHandle = cleanHandle(env.SYMPOSIUM_OWNER_HANDLE);
  const ownerBindingReady = ownerHandle !== "@udayan" || Boolean(env.SYMPOSIUM_OWNER_CLERK_USER_ID);
  const issues = [...deploymentEnvIssues()];
  const warnings = deploymentEnvWarnings();
  const maintenance = getMaintenanceStatus();
  const checks: RuntimeCheck[] = [];
  let migrations: MigrationStatus = {
    appliedCount: 0,
    currentMigrationId: null,
    latestMigrationId,
    pendingMigrationIds: databaseUrl ? migrationIds : []
  };

  const databaseCheck = requiredCheck(
    "database",
    "Neon/Postgres connection string",
    Boolean(databaseUrl),
    strict,
    databaseUrl ? "configured" : "missing"
  );

  if (databaseUrl) {
    try {
      await getPool().query("SELECT 1");
      databaseCheck.detail = "connection verified";
      migrations = await getMigrationStatus();
      if (migrations.pendingMigrationIds.length) {
        databaseCheck.ok = false;
        databaseCheck.detail = `${migrations.pendingMigrationIds.length} migration(s) pending`;
        issues.push("Database migrations are not current.");
      }
    } catch {
      databaseCheck.ok = false;
      databaseCheck.detail = "connection failed";
      issues.push("Database connection check failed.");
    }
  }

  checks.push(
    databaseCheck,
    requiredCheck(
      "clerk_secret",
      "Clerk backend secret",
      Boolean(env.CLERK_SECRET_KEY),
      strict || requireAuthForWrites,
      env.CLERK_SECRET_KEY ? `${clerkSecretMode(env.CLERK_SECRET_KEY)} key configured` : "missing"
    ),
    {
      key: "write_auth",
      label: "Authenticated writes",
      configured: requireAuthForWrites,
      required: strict,
      ok: !strict || requireAuthForWrites,
      detail: requireAuthForWrites ? "required" : "not enforced"
    },
    {
      key: "dev_actor",
      label: "Development actor fallback disabled",
      configured: !env.SYMPOSIUM_ALLOW_DEV_ACTOR,
      required: strict,
      ok: !strict || !env.SYMPOSIUM_ALLOW_DEV_ACTOR,
      detail: env.SYMPOSIUM_ALLOW_DEV_ACTOR ? "enabled" : "disabled"
    },
    {
      key: "web_origins",
      label: "Deployed web origins",
      configured: webOrigins.length > 0,
      required: strict,
      ok:
        !strict ||
        (webOrigins.length > 0 && webOrigins.every((origin) => !localOriginPattern.test(origin))),
      detail: `${webOrigins.length} origin${webOrigins.length === 1 ? "" : "s"} configured`
    },
    requiredCheck(
      "redis",
      "Upstash authenticated-write limiter",
      hasRedisConfig,
      strict,
      hasRedisConfig ? "configured" : "missing"
    ),
    requiredCheck(
      "r2",
      "Cloudflare R2 attachments",
      hasR2Config,
      strict,
      hasR2Config ? "configured" : "missing"
    ),
    requiredCheck(
      "r2_public_url",
      "Public attachment delivery URL",
      Boolean(env.R2_PUBLIC_BASE_URL),
      strict,
      env.R2_PUBLIC_BASE_URL ? "configured" : "missing"
    ),
    {
      key: "storage_deletion_worker",
      label: "Durable R2 deletion worker",
      configured: maintenance.active,
      required: strict,
      ok: !strict || maintenance.active,
      detail: maintenance.active ? "active" : "inactive"
    },
    {
      key: "owner_binding",
      label: "Reserved owner handle binding",
      configured: ownerBindingReady,
      required: strict,
      ok: !strict || ownerBindingReady,
      detail: env.SYMPOSIUM_OWNER_CLERK_USER_ID ? "configured" : "missing"
    },
    {
      key: "ai_provider",
      label: "AI tablet provider",
      configured: Boolean(env.OPENAI_API_KEY),
      required: false,
      ok: true,
      detail: env.OPENAI_API_KEY ? "configured" : "fallback mode"
    }
  );

  if ((maintenance.lastStorageDeletionResult?.failed ?? 0) > 0) {
    warnings.push(
      `${maintenance.lastStorageDeletionResult?.failed} R2 deletion job(s) are awaiting a provider retry.`
    );
  }

  const requiredFailures = checks
    .filter((check) => check.required && !check.ok)
    .map((check) => `${check.label} is not ready.`);

  const uniqueIssues = [...new Set([...issues, ...requiredFailures])];
  const ok = uniqueIssues.length === 0;

  return {
    ok,
    status: ok ? (strict ? "ready" : "local") : "not_ready",
    strict,
    checkedAt: new Date().toISOString(),
    checks,
    issues: uniqueIssues,
    warnings,
    maintenance,
    migrations,
    release: env.APP_VERSION ?? env.RENDER_GIT_COMMIT ?? env.VERCEL_GIT_COMMIT_SHA ?? null
  };
};
