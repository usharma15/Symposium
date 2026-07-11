import type { PoolClient } from "pg";
import { cleanHandle } from "@/lib/symposiumCore";
import { defaultProfile } from "./foundation";

const viewDedupeWindowMs = 60 * 60 * 1000;
type ViewTargetType = "post" | "comment";
const memoryContentViews = new Map<string, number>();

const normalizeViewActorHandle = (handle: string) => {
  const normalized = cleanHandle(handle || defaultProfile.handle);
  return normalized === "@" ? defaultProfile.handle : normalized;
};

const contentViewKey = (targetType: ViewTargetType, targetId: string, actorHandle: string) =>
  `${targetType}:${targetId}:${normalizeViewActorHandle(actorHandle)}`;

const pruneMemoryContentViews = (now = Date.now()) => {
  for (const [key, timestamp] of memoryContentViews.entries()) {
    if (now - timestamp >= viewDedupeWindowMs) memoryContentViews.delete(key);
  }
};

export const recordMemoryContentView = (targetType: ViewTargetType, targetId: string, actorHandle: string) => {
  const now = Date.now();
  pruneMemoryContentViews(now);
  const key = contentViewKey(targetType, targetId, actorHandle);
  const lastViewedAt = memoryContentViews.get(key);
  if (lastViewedAt && now - lastViewedAt < viewDedupeWindowMs) return false;

  memoryContentViews.set(key, now);
  return true;
};

export const recordContentView = async (
  client: PoolClient,
  targetType: ViewTargetType,
  targetId: string,
  actorHandle: string,
  trigger?: string,
  surface?: string
) => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO content_views (target_type, target_id, actor_handle, bucket_start, trigger, surface)
     VALUES ($1, $2, $3, date_trunc('hour', now()), $4, $5)
     ON CONFLICT (target_type, target_id, actor_handle, bucket_start) DO NOTHING
     RETURNING id`,
    [targetType, targetId, normalizeViewActorHandle(actorHandle), trigger ?? null, surface ?? null]
  );
  return (result.rowCount ?? 0) > 0;
};
