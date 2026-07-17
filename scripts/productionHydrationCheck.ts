import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createLocalContentSecurityPolicy } from "@/lib/contentSecurityPolicy";

const staticArtifacts = [
  ".next/server/app/index.html",
  ".next/server/app/communities.html",
  ".next/server/app/funding.html",
  ".next/server/app/opportunities.html"
];

const policy = createLocalContentSecurityPolicy(false);
assert.match(policy, /script-src 'self' 'unsafe-inline'/);
assert.doesNotMatch(policy, /nonce-|strict-dynamic/);

const proxySource = readFileSync("proxy.ts", "utf8");
assert.match(proxySource, /contentSecurityPolicy: \{\s+strict: false,/);
assert.doesNotMatch(proxySource, /x-nonce|strict: true/);

const symposiumPageSource = readFileSync("app/SymposiumPage.tsx", "utf8");
assert.match(
  symposiumPageSource,
  /\(await cookies\(\)\)\.get\(entranceSessionCookieName\)/,
  "Page requests must decide the browser-session entrance before emitting their first frame."
);

const appPaths = JSON.parse(readFileSync(".next/server/app-paths-manifest.json", "utf8")) as Record<string, string>;
for (const route of ["/page", "/communities/page", "/funding/page", "/opportunities/page"]) {
  assert.ok(appPaths[route], `${route} must have a production server entry.`);
  assert.ok(existsSync(`.next/server/${appPaths[route]}`), `${route} production server entry must exist.`);
}

for (const artifactPath of staticArtifacts) {
  if (!existsSync(artifactPath)) continue;
  const html = readFileSync(artifactPath, "utf8");
  assert.match(html, /<script[^>]+src=/, `${artifactPath} must include its client runtime.`);
  assert.match(html, /self\.__next_f/, `${artifactPath} must include its inline hydration payload.`);
  assert.doesNotMatch(
    html,
    /<script[^>]+nonce=/,
    `${artifactPath} is prerendered and must not depend on a per-request nonce.`
  );
}

console.log("Production hydration boundary checks passed.");
