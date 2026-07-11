import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { entryModeForBrowserSession } from "@/features/entrance/browserSession";
import {
  readCachedBootstrapSnapshot,
  resolveCachedBootstrap
} from "@/features/bootstrap/cachedBootstrap";
import { inquiryItems, profile } from "@/lib/mockData";

const storage = (value: string | null): Pick<Storage, "getItem"> => ({ getItem: () => value });

const main = async () => {
  assert.equal(entryModeForBrowserSession(null), "loading");
  assert.equal(entryModeForBrowserSession(true), "approach");
  assert.equal(entryModeForBrowserSession(false), "complete");
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

  const component = await readFile(path.join(process.cwd(), "components/SymposiumV0.tsx"), "utf8");
  const symposiumPage = await readFile(path.join(process.cwd(), "app/SymposiumPage.tsx"), "utf8");
  assert.match(symposiumPage, /cookies\(\)/);
  assert.match(symposiumPage, /initialShouldPlayEntrance={browserSessionSeen \? false : null}/);
  assert.match(component, /hydrateCachedBootstrap\(storedProfileHandle\);/);
  assert.match(component, /const sessionEntryMode = entryModeForBrowserSession\(shouldPlayEntrance\);/);
  assert.match(component, /if \(sessionEntryMode === "complete"\) \{\s+applyInitialRouteState\(\);/);
  assert.match(component, /startedAt \+ 5000 - Date\.now\(\)/);
  assert.match(component, /if \(entryMode !== "complete" && shouldPlayEntrance === false\) \{/);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "first browser-session entrance",
          "instant subsequent-tab entry",
          "cached bootstrap selection",
          "canonical route hydration",
          "late authentication route preservation"
        ]
      },
      null,
      2
    )
  );
};

void main();
