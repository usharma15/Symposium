import { Redis } from "@upstash/redis";
import { env, hasRedisConfig } from "../config/env";

let redis: Redis | null = null;

export const getRedis = () => {
  if (!hasRedisConfig) return null;

  if (!redis) {
    redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL!,
      token: env.UPSTASH_REDIS_REST_TOKEN!
    });
  }

  return redis;
};
