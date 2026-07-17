import { cleanHandle } from "@/lib/symposiumCore";
import {
  databaseUrl,
  env,
  hasR2Config,
  hasRedisConfig,
  requireAuthForWrites,
  webOrigins
} from "../apps/api/src/config/env";

type EnvCheck = {
  key: string;
  label: string;
  configured: boolean;
  ok: boolean;
  detail?: string;
};

type EnvSection = {
  ok: boolean;
  checks: EnvCheck[];
};

const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

const isSet = (value: string | undefined) => Boolean(value?.trim());

const check = (
  key: string,
  label: string,
  ok: boolean,
  configured = ok,
  detail?: string
): EnvCheck => ({
  key,
  label,
  configured,
  ok,
  detail
});

const section = (checks: EnvCheck[]): EnvSection => ({
  ok: checks.every((item) => item.ok),
  checks
});

const ownerHandle = cleanHandle(env.SYMPOSIUM_OWNER_HANDLE);
const ownerBindingReady = ownerHandle !== "@udayan" || isSet(env.SYMPOSIUM_OWNER_CLERK_USER_ID);
const hasNonLocalWebOrigin =
  webOrigins.length > 0 && webOrigins.every((origin) => !localOriginPattern.test(origin));

const backend = section([
  check(
    "NODE_ENV",
    "Render runtime is production",
    env.NODE_ENV === "production",
    isSet(process.env.NODE_ENV),
    env.NODE_ENV
  ),
  check(
    "SYMPOSIUM_STRICT_ENV",
    "Strict live env gate enabled",
    env.SYMPOSIUM_STRICT_ENV,
    isSet(process.env.SYMPOSIUM_STRICT_ENV),
    env.SYMPOSIUM_STRICT_ENV ? "enabled" : "disabled"
  ),
  check(
    "DATABASE_URL|POSTGRES_URL|POSTGRES_PRISMA_URL",
    "Neon/Postgres connection string",
    Boolean(databaseUrl),
    Boolean(databaseUrl),
    databaseUrl ? "configured" : "missing"
  ),
  check(
    "CLERK_SECRET_KEY",
    "Clerk backend secret",
    isSet(env.CLERK_SECRET_KEY),
    isSet(env.CLERK_SECRET_KEY),
    env.CLERK_SECRET_KEY ? "configured" : "missing"
  ),
  check(
    "SYMPOSIUM_REQUIRE_AUTH",
    "Authenticated writes required",
    requireAuthForWrites,
    isSet(process.env.SYMPOSIUM_REQUIRE_AUTH),
    requireAuthForWrites ? "required" : "not enforced"
  ),
  check(
    "SYMPOSIUM_ALLOW_DEV_ACTOR",
    "Development actor fallback disabled",
    !env.SYMPOSIUM_ALLOW_DEV_ACTOR,
    isSet(process.env.SYMPOSIUM_ALLOW_DEV_ACTOR),
    env.SYMPOSIUM_ALLOW_DEV_ACTOR ? "enabled" : "disabled"
  ),
  check(
    "SYMPOSIUM_WEB_ORIGINS",
    "Vercel web origins are non-local",
    hasNonLocalWebOrigin,
    isSet(process.env.SYMPOSIUM_WEB_ORIGINS),
    `${webOrigins.length} origin${webOrigins.length === 1 ? "" : "s"} configured`
  ),
  check(
    "UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN",
    "Upstash authenticated-write limiter",
    hasRedisConfig,
    hasRedisConfig,
    hasRedisConfig ? "configured" : "missing"
  ),
  check(
    "R2_ACCOUNT_ID|R2_BUCKET|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY",
    "Cloudflare R2 attachments",
    hasR2Config,
    hasR2Config,
    hasR2Config ? "configured" : "missing"
  ),
  check(
    "R2_PUBLIC_BASE_URL",
    "Public attachment delivery URL",
    isSet(env.R2_PUBLIC_BASE_URL),
    isSet(env.R2_PUBLIC_BASE_URL),
    env.R2_PUBLIC_BASE_URL ? "configured" : "missing"
  ),
  check(
    "SYMPOSIUM_OWNER_CLERK_USER_ID",
    "Reserved owner handle binding",
    ownerBindingReady,
    isSet(env.SYMPOSIUM_OWNER_CLERK_USER_ID),
    ownerBindingReady ? "configured" : `missing for ${ownerHandle}`
  )
]);

const frontend = section([
  check(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "Clerk publishable key",
    isSet(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    isSet(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? "configured" : "missing"
  ),
  check(
    "CLERK_SECRET_KEY",
    "Clerk secret key for Next routes",
    isSet(process.env.CLERK_SECRET_KEY),
    isSet(process.env.CLERK_SECRET_KEY),
    process.env.CLERK_SECRET_KEY ? "configured" : "missing"
  ),
  check(
    "SYMPOSIUM_API_URL",
    "Render API URL",
    isSet(process.env.SYMPOSIUM_API_URL),
    isSet(process.env.SYMPOSIUM_API_URL),
    process.env.SYMPOSIUM_API_URL ? "configured" : "missing"
  )
]);

const optional = section([
  check(
    "OPENAI_API_KEY",
    "AI tablet model provider",
    true,
    isSet(env.OPENAI_API_KEY),
    env.OPENAI_API_KEY ? "configured" : "fallback mode"
  ),
  check(
    "SYMPOSIUM_AI_MODEL",
    "AI tablet model name",
    true,
    isSet(process.env.SYMPOSIUM_AI_MODEL),
    process.env.SYMPOSIUM_AI_MODEL ? "configured" : "defaulted"
  ),
  check(
    "CLERK_JWT_AUDIENCE",
    "Clerk token audience constraint",
    true,
    isSet(env.CLERK_JWT_AUDIENCE),
    env.CLERK_JWT_AUDIENCE ? "configured" : "not constrained"
  )
]);

const report = {
  ok: backend.ok && frontend.ok,
  generatedAt: new Date().toISOString(),
  backend,
  frontend,
  optional
};

console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--strict") && !report.ok) {
  process.exit(1);
}
