import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  entryModeForBrowserSession,
  resolvePresentedEntryMode,
  shouldCompleteEntryAfterAccountSync
} from "@/features/entrance/browserSession";
import {
  persistCachedBootstrap,
  readCachedBootstrapSnapshot,
  resolveCachedBootstrap
} from "@/features/bootstrap/cachedBootstrap";
import {
  persistCachedProfileActivity,
  persistCachedProfileSocial,
  profileReadCacheMaxAgeMs,
  readCachedProfileActivity,
  readCachedProfileSocial
} from "@/features/profiles/profileReadCache";
import {
  cachedIdentityMaxAgeMs,
  persistCachedIdentity,
  readCachedIdentity
} from "@/features/identity/cachedIdentity";
import { emptyProfileActivityCounts } from "@/lib/profileActivity";
import { inquiryItems, profile } from "@/lib/mockData";

const storage = (value: string | null): Pick<Storage, "getItem"> => ({ getItem: () => value });

const main = async () => {
  assert.equal(entryModeForBrowserSession(null), "loading");
  assert.equal(entryModeForBrowserSession(true), "approach");
  assert.equal(entryModeForBrowserSession(false), "complete");
  assert.equal(shouldCompleteEntryAfterAccountSync("loading"), true);
  assert.equal(shouldCompleteEntryAfterAccountSync("approach"), false);
  assert.equal(shouldCompleteEntryAfterAccountSync("auth"), true);
  assert.equal(shouldCompleteEntryAfterAccountSync("complete"), false);
  const returningClerkSession = {
    entryMode: "complete" as const,
    clerkEnabled: true,
    authLoaded: true,
    initialIsSignedIn: true,
    isSignedIn: true,
    accountSynced: false,
    authError: ""
  };
  assert.equal(resolvePresentedEntryMode(returningClerkSession), "complete");
  assert.equal(resolvePresentedEntryMode({ ...returningClerkSession, accountSynced: true }), "complete");
  assert.equal(resolvePresentedEntryMode({ ...returningClerkSession, isSignedIn: false }), "auth");
  assert.equal(resolvePresentedEntryMode({ ...returningClerkSession, authError: "Sync failed" }), "auth");
  assert.equal(resolvePresentedEntryMode({ ...returningClerkSession, entryMode: "approach" }), "approach");
  assert.equal(resolvePresentedEntryMode({ ...returningClerkSession, authLoaded: false }), "complete");
  assert.equal(
    resolvePresentedEntryMode({ ...returningClerkSession, authLoaded: false, initialIsSignedIn: false }),
    "auth"
  );
  assert.equal(readCachedBootstrapSnapshot(storage("not-json")), null);

  const cachedProfile = { ...profile, handle: "@cached", name: "Cached researcher" };
  const cachedItem = { ...inquiryItems[0]!, id: "cached-item" };
  const resolved = resolveCachedBootstrap({
    fallbackProfile: profile,
    preferredHandle: cachedProfile.handle,
    seedItems: inquiryItems,
    snapshot: { items: [cachedItem], profiles: { [cachedProfile.handle]: cachedProfile } }
  });
  assert.equal(resolved.currentProfile.handle, cachedProfile.handle);
  assert.equal(resolved.items[0]?.id, cachedItem.id);
  let storageAttempts = 0;
  assert.deepEqual(
    persistCachedBootstrap(
      {
        setItem: () => {
          storageAttempts += 1;
          throw new Error("quota");
        }
      },
      { items: [cachedItem], profiles: { [cachedProfile.handle]: cachedProfile } },
      cachedProfile.handle
    ),
    { profileHandleStored: false, snapshotStored: false }
  );
  assert.equal(storageAttempts, 2);

  const identityCacheValues = new Map<string, string>();
  const identityCacheStorage = {
    getItem: (key: string) => identityCacheValues.get(key) ?? null,
    setItem: (key: string, value: string) => { identityCacheValues.set(key, value); }
  };
  assert.equal(persistCachedIdentity(identityCacheStorage, "clerk-user-1", cachedProfile, 20_000), true);
  assert.deepEqual(readCachedIdentity(identityCacheStorage, "clerk-user-1", 20_001), cachedProfile);
  assert.equal(readCachedIdentity(identityCacheStorage, "clerk-user-2", 20_001), null);
  assert.equal(readCachedIdentity(
    identityCacheStorage,
    "clerk-user-1",
    20_000 + cachedIdentityMaxAgeMs + 1
  ), null);

  const profileCacheValues = new Map<string, string>();
  const profileCacheStorage = {
    getItem: (key: string) => profileCacheValues.get(key) ?? null,
    setItem: (key: string, value: string) => { profileCacheValues.set(key, value); }
  };
  const activityResponse = {
    entries: [],
    nextCursor: null,
    authoredComments: [],
    commentsNextCursor: null,
    hiddenCommunityCounts: emptyProfileActivityCounts(),
    totals: emptyProfileActivityCounts(),
    items: [cachedItem],
    profiles: { [cachedProfile.handle]: cachedProfile }
  };
  assert.equal(persistCachedProfileActivity(profileCacheStorage, {
    viewerHandle: "@viewer",
    targetHandle: cachedProfile.handle,
    scope: "all",
    response: activityResponse
  }, 10_000), true);
  assert.deepEqual(readCachedProfileActivity(profileCacheStorage, {
    viewerHandle: "@viewer",
    targetHandle: cachedProfile.handle,
    scope: "all"
  }, 10_001), JSON.parse(JSON.stringify(activityResponse)));
  assert.equal(readCachedProfileActivity(profileCacheStorage, {
    viewerHandle: "@another-viewer",
    targetHandle: cachedProfile.handle,
    scope: "all"
  }, 10_001), null);
  assert.equal(readCachedProfileActivity(profileCacheStorage, {
    viewerHandle: "@viewer",
    targetHandle: cachedProfile.handle,
    scope: "all"
  }, 10_000 + profileReadCacheMaxAgeMs + 1), null);
  assert.equal(persistCachedProfileSocial(profileCacheStorage, {
    viewerHandle: "@viewer",
    targetHandle: cachedProfile.handle,
    lists: { following: ["@one", "@one"], followers: ["@two"] }
  }, 10_000), true);
  assert.deepEqual(readCachedProfileSocial(profileCacheStorage, {
    viewerHandle: "@viewer",
    targetHandle: cachedProfile.handle
  }, 10_001), { following: ["@one"], followers: ["@two"] });

  const component = await readFile(path.join(process.cwd(), "components/SymposiumV0.tsx"), "utf8");
  const symposiumPage = await readFile(path.join(process.cwd(), "app/SymposiumPage.tsx"), "utf8");
  const entryViews = await readFile(path.join(process.cwd(), "features/shell/SymposiumShellViews.tsx"), "utf8");
  assert.match(symposiumPage, /cookies\(\)/);
  assert.match(symposiumPage, /Boolean\(\(await auth\(\)\)\.userId\)/);
  assert.match(symposiumPage, /initialShouldPlayEntrance={browserSessionSeen \? false : null}/);
  assert.match(symposiumPage, /liveBackendUrl={liveBackendUrl}/);
  assert.match(component, /hydrateCachedBootstrap\(storedProfileHandle\);/);
  assert.match(component, /const sessionEntryMode = entryModeForBrowserSession\(shouldPlayEntrance\);/);
  assert.match(component, /useLayoutEffect\(\(\) => \{\s+if \(shouldPlayEntrance === null\) return;/);
  assert.match(component, /if \(sessionEntryMode === "complete"\) \{\s+applyInitialRouteState\(\);/);
  assert.match(component, /startedAt \+ 5000 - Date\.now\(\)/);
  assert.match(component, /if \(shouldCompleteEntryAfterAccountSync\(entryModeRef\.current\)\) \{/);
  assert.doesNotMatch(component, /\[authLoaded, clerkEnabled, entryMode, isSignedIn, syncedClerkUserId, userId\]/);
  assert.match(component, /if \(!clerkEnabled\) \{\s+refreshData\(storedProfileHandle \?\? undefined\)/);
  assert.match(component, /setSignedIn\(true\);[\s\S]*void refreshData\(data\.profile\.handle\)/);
  assert.doesNotMatch(component, /await refreshData\(data\.profile\.handle\)/);
  assert.match(component, /entranceStartedAtRef\.current = Date\.now\(\);\s+replayEntrance\(\);\s+setEntryMode\("approach"\);/);
  assert.match(component, /const presentedEntryMode = resolvePresentedEntryMode\(/);
  assert.match(component, /profileActivityInFlightRef/);
  assert.match(component, /readCachedProfileActivity/);
  assert.match(component, /page\?\.loaded && !page\.stale/);
  assert.match(component, /if \(selectedProfile\?\.handle\) return;/);
  assert.match(component, /const readSessionReady = browserReadStateHydrated &&/);
  assert.match(component, /setBrowserReadStateHydrated\(true\);\s+if \(!clerkEnabled\)/);
  assert.match(component, /const cachedIdentity = readCachedIdentity\(window\.localStorage, userId\)/);
  assert.match(component, /persistCachedIdentity\(window\.localStorage, userId, data\.profile\)/);
  assert.match(component, /window\.setTimeout\(\(\) => controller\.abort\(\), 15_000\)/);
  assert.match(component, /canonicalActivityError=/);
  assert.match(entryViews, /className={`entry-image \$\{playApproach \? "approaching" : "stationary"\}`}/);
  assert.doesNotMatch(entryViews, /\{playApproach \? <Image/);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "first browser-session entrance",
          "zero-frame repeat-session entry",
          "server-side browser-session decision",
          "cached bootstrap selection",
          "non-fatal cached-bootstrap quota pressure",
          "canonical route hydration",
          "late authentication route preservation",
          "first-session authentication completion",
          "logout entrance replay",
          "stationary authentication background",
          "authenticated identity-only visibility gate",
          "non-blocking bootstrap and profile activity",
          "bounded inline profile activity loading",
          "single authenticated bootstrap request",
          "persisted-viewer read hydration gate",
          "exact-Clerk-user cached identity isolation",
          "bounded viewer-scoped profile read projections"
        ]
      },
      null,
      2
    )
  );
};

void main();
