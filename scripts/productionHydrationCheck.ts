import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

for (const artifactPath of staticArtifacts) {
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
