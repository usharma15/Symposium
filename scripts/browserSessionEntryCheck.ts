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
    isSignedIn: true,
    accountSynced: false,
    authError: ""
  };
  assert.equal(resolvePresentedEntryMode(returningClerkSession), "loading");
  assert.equal(resolvePresentedEntryMode({ ...returningClerkSession, accountSynced: true }), "complete");
  assert.equal(resolvePresentedEntryMode({ ...returningClerkSession, isSignedIn: false }), "auth");
  assert.equal(resolvePresentedEntryMode({ ...returningClerkSession, authError: "Sync failed" }), "auth");
  assert.equal(resolvePresentedEntryMode({ ...returningClerkSession, entryMode: "approach" }), "approach");
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

  const component = await readFile(path.join(process.cwd(), "components/SymposiumV0.tsx"), "utf8");
  const symposiumPage = await readFile(path.join(process.cwd(), "app/SymposiumPage.tsx"), "utf8");
  const entryViews = await readFile(path.join(process.cwd(), "features/shell/SymposiumShellViews.tsx"), "utf8");
  assert.doesNotMatch(symposiumPage, /cookies\(\)/);
  assert.match(symposiumPage, /initialShouldPlayEntrance={null}/);
  assert.match(symposiumPage, /liveBackendUrl={liveBackendUrl}/);
  assert.match(component, /hydrateCachedBootstrap\(storedProfileHandle\);/);
  assert.match(component, /const sessionEntryMode = entryModeForBrowserSession\(shouldPlayEntrance\);/);
  assert.match(component, /if \(sessionEntryMode === "complete"\) \{\s+applyInitialRouteState\(\);/);
  assert.match(component, /startedAt \+ 5000 - Date\.now\(\)/);
  assert.match(component, /if \(shouldCompleteEntryAfterAccountSync\(entryModeRef\.current\)\) \{/);
  assert.doesNotMatch(component, /\[authLoaded, clerkEnabled, entryMode, isSignedIn, syncedClerkUserId, userId\]/);
  assert.match(component, /if \(!clerkEnabled\) \{\s+refreshData\(storedProfileHandle \?\? undefined\)/);
  assert.match(component, /setSignedIn\(true\);[\s\S]*void refreshData\(data\.profile\.handle\)/);
  assert.doesNotMatch(component, /await refreshData\(data\.profile\.handle\)/);
  assert.match(component, /const presentedEntryMode = resolvePresentedEntryMode\(/);
  assert.match(component, /profileActivityInFlightRef/);
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
          "instant subsequent-tab entry",
          "static server shell with client-side session detection",
          "cached bootstrap selection",
          "non-fatal cached-bootstrap quota pressure",
          "canonical route hydration",
          "late authentication route preservation",
          "first-session authentication completion",
          "stationary authentication background",
          "authenticated identity-only visibility gate",
          "non-blocking bootstrap and profile activity",
          "bounded inline profile activity loading",
          "single authenticated bootstrap request"
        ]
      },
      null,
      2
    )
  );
};

void main();
