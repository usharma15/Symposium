import type { ResearchProfile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";

type CachedIdentityRecord = {
  userId: string;
  savedAt: number;
  profile: ResearchProfile;
};

type CachedIdentityStore = {
  version: 1;
  records: CachedIdentityRecord[];
};

const cachedIdentityStorageKey = "symposium-auth-records";
const cachedIdentityLimit = 4;
export const cachedIdentityMaxAgeMs = 24 * 60 * 60 * 1000;

const readStore = (storage: Pick<Storage, "getItem">): CachedIdentityStore => {
  try {
    const raw = storage.getItem(cachedIdentityStorageKey);
    if (!raw) return { version: 1, records: [] };
    const parsed = JSON.parse(raw) as Partial<CachedIdentityStore>;
    return parsed.version === 1 && Array.isArray(parsed.records)
      ? { version: 1, records: parsed.records }
      : { version: 1, records: [] };
  } catch {
    return { version: 1, records: [] };
  }
};

const recordIsFresh = (record: CachedIdentityRecord, now: number) =>
  Number.isFinite(record.savedAt) && record.savedAt <= now && now - record.savedAt <= cachedIdentityMaxAgeMs;

export const readCachedIdentity = (
  storage: Pick<Storage, "getItem">,
  userId: string,
  now = Date.now()
) => {
  if (!userId) return null;
  const record = readStore(storage).records.find((candidate) => candidate.userId === userId);
  if (!record || !recordIsFresh(record, now)) return null;
  const handle = cleanHandle(record.profile?.handle ?? "");
  if (!handle || handle === "@" || !record.profile?.name) return null;
  return { ...record.profile, handle };
};

export const persistCachedIdentity = (
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  profile: ResearchProfile,
  now = Date.now()
) => {
  const handle = cleanHandle(profile.handle);
  if (!userId || !handle || handle === "@") return false;
  const store = readStore(storage);
  const next: CachedIdentityRecord = { userId, savedAt: now, profile: { ...profile, handle } };
  store.records = [
    next,
    ...store.records.filter((record) => record.userId !== userId && recordIsFresh(record, now))
  ].slice(0, cachedIdentityLimit);
  try {
    storage.setItem(cachedIdentityStorageKey, JSON.stringify(store));
    return true;
  } catch {
    // Identity caching is an acceleration layer; Clerk and the backend remain authoritative.
    return false;
  }
};
