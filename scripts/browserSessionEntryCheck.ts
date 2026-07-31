import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { reportCheck } from "@/scripts/checkReport";
import {
  entryModeForBrowserSession,
  resolvePresentedEntryMode,
  shouldCompleteEntryAfterAccountSync
} from "@/features/session/symposiumSessionLifecycle";
import {
  clearCachedBootstrap,
  localPreviewBootstrapScopeKey,
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
  assert.equal(
    readCachedBootstrapSnapshot(
      storage(JSON.stringify({ items: [], profiles: {} })),
      "clerk-user-1"
    ),
    null,
    "legacy browser-wide bootstrap state must not enter an authenticated session"
  );

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
  const bootstrapCacheValues = new Map<string, string>();
  const bootstrapCacheStorage = {
    getItem: (key: string) => bootstrapCacheValues.get(key) ?? null,
    setItem: (key: string, value: string) => {
      bootstrapCacheValues.set(key, value);
    },
    removeItem: (key: string) => {
      bootstrapCacheValues.delete(key);
    }
  };
  assert.deepEqual(
    persistCachedBootstrap(
      bootstrapCacheStorage,
      {
        items: [cachedItem],
        profiles: { [cachedProfile.handle]: cachedProfile }
      },
      cachedProfile.handle,
      "clerk-user-1"
    ),
    { profileHandleStored: false, snapshotStored: true }
  );
  assert.equal(
    readCachedBootstrapSnapshot(
      bootstrapCacheStorage,
      "clerk-user-2"
    ),
    null,
    "one Clerk user must never hydrate another Clerk user's cached projection"
  );
  assert.equal(
    readCachedBootstrapSnapshot(
      bootstrapCacheStorage,
      "clerk-user-1"
    )?.currentProfileHandle,
    cachedProfile.handle
  );
  clearCachedBootstrap(bootstrapCacheStorage);
  assert.equal(
    readCachedBootstrapSnapshot(
      bootstrapCacheStorage,
      "clerk-user-1"
    ),
    null
  );
  assert.doesNotThrow(() =>
    clearCachedBootstrap({
      removeItem: () => {
        throw new Error("storage unavailable");
      }
    })
  );
  assert.equal(
    readCachedBootstrapSnapshot(
      storage(JSON.stringify({
        items: [cachedItem],
        profiles: { [cachedProfile.handle]: cachedProfile }
      })),
      localPreviewBootstrapScopeKey
    )?.items[0]?.id,
    cachedItem.id,
    "legacy bootstrap state remains compatible with local preview"
  );

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
  const sessionController = await readFile(
    path.join(
      process.cwd(),
      "features/session/useSymposiumSessionController.ts"
    ),
    "utf8"
  );
  const profileController = await readFile(
    path.join(process.cwd(), "features/profiles/useProfileController.ts"),
    "utf8"
  );
  const profileActivityController = await readFile(
    path.join(process.cwd(), "features/profiles/useProfileActivityController.ts"),
    "utf8"
  );
  const symposiumPage = await readFile(path.join(process.cwd(), "app/SymposiumPage.tsx"), "utf8");
  const entryViews = await readFile(path.join(process.cwd(), "features/shell/SymposiumShellViews.tsx"), "utf8");
  const entranceController = await readFile(
    path.join(
      process.cwd(),
      "features/entrance/useBrowserSessionEntrance.ts"
    ),
    "utf8"
  );
  assert.match(symposiumPage, /cookies\(\)/);
  assert.match(symposiumPage, /Boolean\(\(await auth\(\)\)\.userId\)/);
  assert.match(symposiumPage, /initialShouldPlayEntrance={browserSessionSeen \? false : null}/);
  assert.match(symposiumPage, /liveBackendUrl={liveBackendUrl}/);
  assert.match(
    sessionController,
    /if \(!clerkEnabled\) \{\s+identity\.hydrateCachedBootstrap\(\s+storedProfileHandle,\s+localPreviewBootstrapScopeKey/
  );
  assert.match(
    sessionController,
    /identity\.hydrateCachedBootstrap\(\s+cachedIdentity\?\.handle \?\? null,\s+userId,\s+cachedIdentity/
  );
  assert.match(sessionController, /clearCachedBootstrap\(window\.localStorage\)/);
  assert.match(
    sessionController,
    /const sessionEntryMode = entryModeForBrowserSession\(shouldPlayEntrance\);/
  );
  assert.match(
    sessionController,
    /useLayoutEffect\(\(\) => \{\s+if \(shouldPlayEntrance === null\) return;/
  );
  assert.match(
    sessionController,
    /if \(sessionEntryMode === "complete"\) \{\s+environment\.applyInitialRouteState\(\);/
  );
  assert.match(sessionController, /startedAt \+ 5000 - Date\.now\(\)/);
  assert.match(
    sessionController,
    /shouldCompleteEntryAfterAccountSync\(\s+lifecycleRef\.current\.entryMode/
  );
  assert.doesNotMatch(
    component,
    /setSignedIn|setSyncedClerkUserId|entryAuthStateRef|entryModeRef/
  );
  assert.match(
    sessionController,
    /if \(!clerkEnabled\) \{\s+identity\.refreshData\(storedProfileHandle \?\? undefined\)/
  );
  assert.match(
    sessionController,
    /if \(crossUserTransition\) \{[\s\S]*await identity\.refreshData\([\s\S]*dispatch\(\{ type: "identity_sync_succeeded", userId \}\);/
  );
  assert.match(
    sessionController,
    /if \(!crossUserTransition\) \{\s+void identity\.refreshData\(syncedProfile\.handle/
  );
  assert.match(
    sessionController,
    /dispatch\(\{ type: "signed_out" \}\);\s+entranceStartedAtRef\.current = Date\.now\(\);\s+replayEntrance\(\);/
  );
  assert.match(sessionController, /onStatus\("Sign out failed"\)/);
  assert.match(entranceController, /const readSessionMarker = \(\) => \{\s+try \{/);
  assert.match(entranceController, /new BroadcastChannel\(fallbackPresenceChannel\);\s+\} catch \{/);
  assert.match(
    sessionController,
    /const presentedEntryMode = resolvePresentedEntryMode\(/
  );
  assert.match(profileActivityController, /inFlightRef/);
  assert.match(profileActivityController, /readCachedProfileActivity/);
  assert.match(profileActivityController, /page\?\.loaded && !page\.stale/);
  assert.match(
    profileActivityController,
    /input\.selectedProfile\?\.handle\) \{\s+return;/
  );
  assert.match(
    sessionController,
    /const readSessionReady = sessionReadStateIsReady\(/
  );
  assert.match(
    sessionController,
    /dispatch\(\{ type: "browser_read_state_hydrated" \}\);\s+if \(!clerkEnabled\)/
  );
  assert.match(profileController, /const cachedIdentity = readCachedIdentity\(window\.localStorage, userId\)/);
  assert.match(profileController, /persistCachedIdentity\(window\.localStorage, userId, data\.profile\)/);
  assert.match(
    component,
    /socialHydrationEnabled: sessionController\.socialHydrationEnabled/
  );
  assert.match(
    profileController,
    /if \(!input\.socialHydrationEnabled \|\| !currentProfile\.handle\) return;/
  );
  assert.match(profileController, /if \(inputRef\.current\.localPreview\) return;/);
  assert.match(profileActivityController, /window\.setTimeout\(\(\) => controller\.abort\(\), 15_000\)/);
  assert.match(component, /canonicalActivityError=/);
  assert.match(entryViews, /className={`entry-image \$\{playApproach \? "approaching" : "stationary"\}`}/);
  assert.doesNotMatch(entryViews, /\{playApproach \? <Image/);

  reportCheck([
    "first browser-session entrance",
    "zero-frame repeat-session entry",
    "server-side browser-session decision",
    "cached bootstrap selection",
    "non-fatal cached-bootstrap quota pressure",
    "canonical route hydration",
    "late authentication route preservation",
    "first-session authentication completion",
    "logout entrance replay",
    "failed-provider sign-out preservation",
    "storage-denied entrance fallback",
    "stationary authentication background",
    "authenticated identity-only visibility gate",
    "non-blocking bootstrap and profile activity",
    "bounded inline profile activity loading",
    "single authenticated bootstrap request",
    "persisted-viewer read hydration gate",
    "exact-Clerk-user cached identity isolation",
    "exact-Clerk-user bootstrap cache isolation",
    "authenticated cache purge on identity retirement",
    "bounded viewer-scoped profile read projections",
    "returning local-preview social hydration"
  ]);
};

void main();
