import { TRPCError } from "@trpc/server";
import type { FastifyRequest } from "fastify";
import type { Actor } from "./auth";
import { getRedis } from "./redis";

type MemoryBucket = {
  count: number;
  resetAt: number;
};

const memoryBuckets = new Map<string, MemoryBucket>();
let memoryOperations = 0;
let lastRedisWarningAt = 0;

const clientIp = (request: FastifyRequest) =>
  request.ip || String(request.headers["x-forwarded-for"] ?? "unknown").split(",")[0]?.trim() || "unknown";

export const rateLimit = async (
  request: FastifyRequest,
  actor: Actor,
  scope: string,
  limit: number,
  windowSeconds: number
) => {
  const key = `rate:${scope}:${actor.handle ?? actor.clerkUserId ?? clientIp(request)}`;
  const redis = getRedis();

  if (redis) {
    try {
      const [count] = await redis.multi().incr(key).expire(key, windowSeconds, "NX").exec();
      if (count > limit) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded." });
      }
      return;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      const now = Date.now();
      if (now - lastRedisWarningAt > 60_000) {
        lastRedisWarningAt = now;
        console.warn("SYMPOSIUM shared rate limiter unavailable; using the process-local limiter.", error);
      }
    }
  }

  const now = Date.now();
  memoryOperations += 1;
  if (memoryOperations % 256 === 0) {
    for (const [bucketKey, bucket] of memoryBuckets) {
      if (bucket.resetAt <= now) memoryBuckets.delete(bucketKey);
    }
  }
  const current = memoryBuckets.get(key);
  if (!current || current.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return;
  }

  current.count += 1;
  if (current.count > limit) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Rate limit exceeded." });
  }
};
