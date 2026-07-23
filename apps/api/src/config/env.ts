import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "off"].includes(normalized)) return false;
    }
    return value;
  }, z.boolean());

const safeHttpUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
}, "Use an http or https URL without embedded credentials.");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().optional(),
  POSTGRES_URL: z.string().optional(),
  POSTGRES_PRISMA_URL: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(4),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  DATABASE_APPLICATION_NAME: z.string().trim().min(1).max(63).default("symposium-api"),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_JWT_AUDIENCE: z.string().optional(),
  SYMPOSIUM_OWNER_CLERK_USER_ID: z.string().optional(),
  SYMPOSIUM_OWNER_HANDLE: z.string().default("@udayan"),
  SYMPOSIUM_WEB_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  SYMPOSIUM_REQUIRE_AUTH: booleanFromEnv(process.env.NODE_ENV === "production"),
  SYMPOSIUM_ALLOW_DEV_ACTOR: booleanFromEnv(process.env.NODE_ENV !== "production"),
  SYMPOSIUM_STRICT_ENV: booleanFromEnv(process.env.NODE_ENV === "production"),
  SYMPOSIUM_SEED_ON_BOOT: booleanFromEnv(true),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_BASE_URL: safeHttpUrl.optional().or(z.literal("")),
  APP_VERSION: z.string().max(120).optional(),
  RENDER_GIT_COMMIT: z.string().max(120).optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().max(120).optional(),
  OPENAI_API_KEY: z.string().optional(),
  SYMPOSIUM_AI_ENABLED: booleanFromEnv(false),
  SYMPOSIUM_AI_MODEL: z.enum(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]).default("gpt-5.6-terra"),
  SYMPOSIUM_AI_REASONING_EFFORT: z.enum(["none", "low", "medium"]).default("low"),
  SYMPOSIUM_AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(200).max(1200).default(700),
  SYMPOSIUM_AI_USER_DAILY_LIMIT: z.coerce.number().int().min(10).max(10).default(10),
  SYMPOSIUM_AI_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(1).max(500).default(40),
  SYMPOSIUM_AI_DAILY_BUDGET_USD: z.coerce.number().positive().max(10).default(1.25),
  SYMPOSIUM_AI_MONTHLY_BUDGET_USD: z.coerce.number().positive().max(40).default(40)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid SYMPOSIUM API environment: ${message}`);
}

export const env = parsed.data;

export const databaseUrl = env.POSTGRES_PRISMA_URL ?? env.POSTGRES_URL ?? env.DATABASE_URL;

export const webOrigins = env.SYMPOSIUM_WEB_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const requireAuthForWrites = env.SYMPOSIUM_REQUIRE_AUTH;

export const hasRedisConfig = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);

export const hasR2Config = Boolean(
  env.R2_ACCOUNT_ID &&
    env.R2_BUCKET &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY
);
