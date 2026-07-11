import type { InquiryItem, ResearchProfile } from "@/lib/mockData";

const snapshotStorageKey = "symposium-local-snapshot";
const profileHandleStorageKey = "symposium-profile-handle";

export type CachedBootstrapSnapshot = {
  profiles: Record<string, ResearchProfile>;
  items: InquiryItem[];
};

export const readCachedBootstrapSnapshot = (storage: Pick<Storage, "getItem">): CachedBootstrapSnapshot | null => {
  try {
    const raw = storage.getItem(snapshotStorageKey);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<CachedBootstrapSnapshot>;
    if (!Array.isArray(snapshot.items) || !snapshot.profiles || typeof snapshot.profiles !== "object") return null;
    return { items: snapshot.items, profiles: snapshot.profiles };
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
    profiles
  };
};

export const persistCachedBootstrap = (
  storage: Pick<Storage, "setItem">,
  snapshot: CachedBootstrapSnapshot,
  currentProfileHandle: string
) => {
  storage.setItem(snapshotStorageKey, JSON.stringify(snapshot));
  storage.setItem(profileHandleStorageKey, currentProfileHandle);
};
