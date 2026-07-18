import type { InquiryItem, ResearchCommunity, ResearchProfile } from "@/lib/mockData";

const snapshotStorageKey = "symposium-local-snapshot";
const profileHandleStorageKey = "symposium-profile-handle";
export const cachedBootstrapItemLimit = 32;

export type CachedBootstrapSnapshot = {
  profiles: Record<string, ResearchProfile>;
  items: InquiryItem[];
  communities?: ResearchCommunity[];
};

export const readCachedBootstrapSnapshot = (storage: Pick<Storage, "getItem">): CachedBootstrapSnapshot | null => {
  try {
    const raw = storage.getItem(snapshotStorageKey);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<CachedBootstrapSnapshot>;
    if (!Array.isArray(snapshot.items) || !snapshot.profiles || typeof snapshot.profiles !== "object") return null;
    return {
      items: snapshot.items.slice(0, cachedBootstrapItemLimit),
      profiles: snapshot.profiles,
      communities: Array.isArray(snapshot.communities) ? snapshot.communities : undefined
    };
  } catch {
    return null;
  }
};

export const resolveCachedBootstrap = (input: {
  fallbackProfile: ResearchProfile;
  preferredHandle?: string | null;
  seedItems: InquiryItem[];
  snapshot: CachedBootstrapSnapshot | null;
}) => {
  const profiles = input.snapshot?.profiles ?? { [input.fallbackProfile.handle]: input.fallbackProfile };
  const currentProfile = profiles[input.preferredHandle ?? input.fallbackProfile.handle] ?? input.fallbackProfile;
  return {
    currentProfile,
    items: input.snapshot?.items ?? input.seedItems,
    profiles,
    communities: input.snapshot?.communities
  };
};

export const persistCachedBootstrap = (
  storage: Pick<Storage, "setItem">,
  snapshot: CachedBootstrapSnapshot,
  currentProfileHandle: string
) => {
  let snapshotStored = false;
  let profileHandleStored = false;
  try {
    storage.setItem(snapshotStorageKey, JSON.stringify({
      ...snapshot,
      items: snapshot.items.slice(0, cachedBootstrapItemLimit)
    }));
    snapshotStored = true;
  } catch {
    // Cached bootstrap is an acceleration layer; quota pressure must never fail a live mutation.
  }
  try {
    storage.setItem(profileHandleStorageKey, currentProfileHandle);
    profileHandleStored = true;
  } catch {
    // The authenticated server snapshot remains authoritative when browser storage is unavailable.
  }
  return { profileHandleStored, snapshotStored };
};
