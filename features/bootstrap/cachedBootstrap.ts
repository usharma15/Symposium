import type { InquiryItem, ResearchCommunity, ResearchProfile } from "@/lib/mockData";

const snapshotStorageKey = "symposium-local-snapshot";
const profileHandleStorageKey = "symposium-profile-handle";
export const cachedBootstrapItemLimit = 32;
export const localPreviewBootstrapScopeKey = "local-preview";

export type CachedBootstrapSnapshot = {
  profiles: Record<string, ResearchProfile>;
  items: InquiryItem[];
  communities?: ResearchCommunity[];
  currentProfileHandle?: string;
};

type StoredCachedBootstrapSnapshot = CachedBootstrapSnapshot & {
  cacheScopeKey?: string;
};

export const readCachedBootstrapSnapshot = (
  storage: Pick<Storage, "getItem">,
  cacheScopeKey: string | null = localPreviewBootstrapScopeKey
): CachedBootstrapSnapshot | null => {
  try {
    if (!cacheScopeKey) return null;
    const raw = storage.getItem(snapshotStorageKey);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<StoredCachedBootstrapSnapshot>;
    if (!Array.isArray(snapshot.items) || !snapshot.profiles || typeof snapshot.profiles !== "object") return null;
    const storedScopeKey =
      typeof snapshot.cacheScopeKey === "string"
        ? snapshot.cacheScopeKey
        : localPreviewBootstrapScopeKey;
    if (storedScopeKey !== cacheScopeKey) return null;
    return {
      items: snapshot.items.slice(0, cachedBootstrapItemLimit),
      profiles: snapshot.profiles,
      communities: Array.isArray(snapshot.communities) ? snapshot.communities : undefined,
      currentProfileHandle:
        typeof snapshot.currentProfileHandle === "string"
          ? snapshot.currentProfileHandle
          : undefined
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
  const currentProfile =
    profiles[
      input.preferredHandle ??
      input.snapshot?.currentProfileHandle ??
      input.fallbackProfile.handle
    ] ?? input.fallbackProfile;
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
  currentProfileHandle: string,
  cacheScopeKey = localPreviewBootstrapScopeKey
) => {
  let snapshotStored = false;
  let profileHandleStored = false;
  try {
    storage.setItem(snapshotStorageKey, JSON.stringify({
      ...snapshot,
      cacheScopeKey,
      currentProfileHandle,
      items: snapshot.items.slice(0, cachedBootstrapItemLimit)
    }));
    snapshotStored = true;
  } catch {
    // Cached bootstrap is an acceleration layer; quota pressure must never fail a live mutation.
  }
  if (cacheScopeKey === localPreviewBootstrapScopeKey) {
    try {
      storage.setItem(profileHandleStorageKey, currentProfileHandle);
      profileHandleStored = true;
    } catch {
      // The authenticated server snapshot remains authoritative when browser storage is unavailable.
    }
  }
  return { profileHandleStored, snapshotStored };
};

export const clearCachedBootstrap = (
  storage: Pick<Storage, "removeItem">
) => {
  for (const key of [snapshotStorageKey, profileHandleStorageKey]) {
    try {
      storage.removeItem(key);
    } catch {
      // Cache retirement is best-effort and must not block sign-out.
    }
  }
};
