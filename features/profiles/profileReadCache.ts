import type { ProfileActivityResponseContract } from "@/packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";

export type CachedProfileActivityScope = "all" | "comments" | "reshares" | "likes" | "saved";
export type CachedProfileSocialLists = { following: string[]; followers: string[] };

type CachedProfileActivityPage = {
  viewerHandle: string;
  targetHandle: string;
  scope: CachedProfileActivityScope;
  savedAt: number;
  response: ProfileActivityResponseContract;
};

type CachedProfileSocialPage = {
  viewerHandle: string;
  targetHandle: string;
  savedAt: number;
  lists: CachedProfileSocialLists;
};

type ProfileReadCache = {
  version: 1;
  activity: CachedProfileActivityPage[];
  social: CachedProfileSocialPage[];
};

const profileReadCacheKey = "symposium-profile-read-cache-v1";
const profileActivityCacheLimit = 8;
const profileSocialCacheLimit = 16;
export const profileReadCacheMaxAgeMs = 24 * 60 * 60 * 1000;

const normalizedHandle = (value: string) => {
  const handle = cleanHandle(value);
  return handle && handle !== "@" ? handle : null;
};

const normalizedHandles = (values: string[]) =>
  Array.from(new Set(values.map(normalizedHandle).filter((handle): handle is string => Boolean(handle))));

const emptyCache = (): ProfileReadCache => ({ version: 1, activity: [], social: [] });

const readCache = (storage: Pick<Storage, "getItem">): ProfileReadCache => {
  try {
    const raw = storage.getItem(profileReadCacheKey);
    if (!raw) return emptyCache();
    const parsed = JSON.parse(raw) as Partial<ProfileReadCache>;
    if (parsed.version !== 1) return emptyCache();
    return {
      version: 1,
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      social: Array.isArray(parsed.social) ? parsed.social : []
    };
  } catch {
    return emptyCache();
  }
};

const writeCache = (storage: Pick<Storage, "setItem">, cache: ProfileReadCache) => {
  try {
    storage.setItem(profileReadCacheKey, JSON.stringify(cache));
    return true;
  } catch {
    // Browser storage accelerates reads only. The server remains authoritative.
    return false;
  }
};

const activityIdentity = (page: Pick<CachedProfileActivityPage, "viewerHandle" | "targetHandle" | "scope">) =>
  `${page.viewerHandle}:${page.targetHandle}:${page.scope}`;

const socialIdentity = (page: Pick<CachedProfileSocialPage, "viewerHandle" | "targetHandle">) =>
  `${page.viewerHandle}:${page.targetHandle}`;

const isFresh = (savedAt: number, now: number) =>
  Number.isFinite(savedAt) && savedAt <= now && now - savedAt <= profileReadCacheMaxAgeMs;

export const readCachedProfileActivity = (
  storage: Pick<Storage, "getItem">,
  input: { viewerHandle: string; targetHandle: string; scope: CachedProfileActivityScope },
  now = Date.now()
) => {
  const viewerHandle = normalizedHandle(input.viewerHandle);
  const targetHandle = normalizedHandle(input.targetHandle);
  if (!viewerHandle || !targetHandle) return null;
  const page = readCache(storage).activity.find((candidate) =>
    activityIdentity(candidate) === activityIdentity({ ...input, viewerHandle, targetHandle })
  );
  if (!page || !isFresh(page.savedAt, now)) return null;
  if (!Array.isArray(page.response?.entries)) return null;
  if (page.response.items && !Array.isArray(page.response.items)) return null;
  if (page.response.profiles && typeof page.response.profiles !== "object") return null;
  return page.response;
};

export const persistCachedProfileActivity = (
  storage: Pick<Storage, "getItem" | "setItem">,
  input: {
    viewerHandle: string;
    targetHandle: string;
    scope: CachedProfileActivityScope;
    response: ProfileActivityResponseContract;
  },
  now = Date.now()
) => {
  const viewerHandle = normalizedHandle(input.viewerHandle);
  const targetHandle = normalizedHandle(input.targetHandle);
  if (!viewerHandle || !targetHandle) return false;
  const cache = readCache(storage);
  const nextPage: CachedProfileActivityPage = {
    viewerHandle,
    targetHandle,
    scope: input.scope,
    savedAt: now,
    response: {
      ...input.response,
      entries: input.response.entries.slice(0, 50),
      authoredComments: input.response.authoredComments?.slice(0, 50),
      items: input.response.items?.slice(0, 100),
      profiles: input.response.profiles
        ? Object.fromEntries(Object.entries(input.response.profiles).slice(0, 200))
        : undefined
    }
  };
  const identity = activityIdentity(nextPage);
  cache.activity = [
    nextPage,
    ...cache.activity.filter((page) => activityIdentity(page) !== identity && isFresh(page.savedAt, now))
  ].slice(0, profileActivityCacheLimit);
  cache.social = cache.social.filter((page) => isFresh(page.savedAt, now)).slice(0, profileSocialCacheLimit);
  return writeCache(storage, cache);
};

export const readCachedProfileSocial = (
  storage: Pick<Storage, "getItem">,
  input: { viewerHandle: string; targetHandle: string },
  now = Date.now()
) => {
  const viewerHandle = normalizedHandle(input.viewerHandle);
  const targetHandle = normalizedHandle(input.targetHandle);
  if (!viewerHandle || !targetHandle) return null;
  const page = readCache(storage).social.find((candidate) =>
    socialIdentity(candidate) === socialIdentity({ viewerHandle, targetHandle })
  );
  if (!page || !isFresh(page.savedAt, now)) return null;
  if (!Array.isArray(page.lists?.following) || !Array.isArray(page.lists?.followers)) return null;
  return {
    following: normalizedHandles(page.lists.following),
    followers: normalizedHandles(page.lists.followers)
  };
};

export const persistCachedProfileSocial = (
  storage: Pick<Storage, "getItem" | "setItem">,
  input: { viewerHandle: string; targetHandle: string; lists: CachedProfileSocialLists },
  now = Date.now()
) => {
  const viewerHandle = normalizedHandle(input.viewerHandle);
  const targetHandle = normalizedHandle(input.targetHandle);
  if (!viewerHandle || !targetHandle) return false;
  const cache = readCache(storage);
  const nextPage: CachedProfileSocialPage = {
    viewerHandle,
    targetHandle,
    savedAt: now,
    lists: {
      following: normalizedHandles(input.lists.following),
      followers: normalizedHandles(input.lists.followers)
    }
  };
  const identity = socialIdentity(nextPage);
  cache.social = [
    nextPage,
    ...cache.social.filter((page) => socialIdentity(page) !== identity && isFresh(page.savedAt, now))
  ].slice(0, profileSocialCacheLimit);
  cache.activity = cache.activity.filter((page) => isFresh(page.savedAt, now)).slice(0, profileActivityCacheLimit);
  return writeCache(storage, cache);
};
