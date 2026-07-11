import assert from "node:assert/strict";
import {
  liveBackendUnavailableMessage,
  liveBackendUnavailableResponse,
  localDataFallbackAllowed,
  localPreviewRouteUnavailableResponse
} from "@/lib/runtimeSafety";
import { actorHandle } from "@/apps/api/src/repository/foundation";
import { joinOrRequestCommunity } from "@/apps/api/src/repository/communities";
import { upsertProfile } from "@/apps/api/src/repository/identity";
import { search } from "@/apps/api/src/repository/search";
import { getPublicInitialState } from "@/apps/api/src/repository/foundation";
import { readJson } from "@/lib/api";

const main = async () => {
  assert.equal(localDataFallbackAllowed("development"), true);
  assert.equal(localDataFallbackAllowed("test"), true);
  assert.equal(localDataFallbackAllowed("production"), false);

  const unavailable = liveBackendUnavailableResponse();
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.deepEqual(await unavailable.json(), { error: liveBackendUnavailableMessage });

  const localOnly = localPreviewRouteUnavailableResponse();
  assert.equal(localOnly.status, 404);
  assert.equal(localOnly.headers.get("cache-control"), "no-store");
  assert.deepEqual(await localOnly.json(), { error: "Not found." });

  assert.deepEqual(
    await readJson<{ safe: boolean }>(
      new Request("http://localhost/json", { method: "POST", body: JSON.stringify({ safe: true }) })
    ),
    { safe: true }
  );
  assert.equal(
    await readJson(
      new Request("http://localhost/json", { method: "POST", body: JSON.stringify({ oversized: "x".repeat(100) }) }),
      32
    ),
    null
  );

  const publicState = await getPublicInitialState();
  assert.ok(Object.values(publicState.profiles).every((person) => person.email === undefined));
  assert.ok(publicState.items.every((item) => item.room !== "office" && item.kind !== "draft"));
  assert.ok(publicState.items.every((item) => (item.savedBy ?? []).length === 0));
  assert.ok(
    (publicState.communities ?? [])
      .filter((community) => community.visibility === "private")
      .every((community) => community.memberHandles.length === 0)
  );
  const searchResults = await search({ query: "private", limit: 20 });
  assert.ok(searchResults.profiles.every((person) => person.email === undefined));
  assert.ok(searchResults.posts.every((item) => (item.savedBy ?? []).length === 0));
  assert.ok(
    searchResults.communities
      .filter((community) => community.visibility === "private")
      .every((community) => community.memberHandles.length === 0)
  );
  const privateCommunity = publicState.communities?.find((community) => community.visibility === "private");
  assert.ok(privateCommunity);
  const privateRequest = await joinOrRequestCommunity(
    { communityId: privateCommunity.id },
    { handle: "@boundary_requester", isAuthenticated: true, source: "dev" }
  );
  assert.equal(privateRequest.status, "requested");
  assert.deepEqual(privateRequest.community.memberHandles, []);

  assert.equal(
    actorHandle({ handle: "@verified", isAuthenticated: true, source: "clerk" }, "@attacker"),
    "@verified"
  );
  assert.throws(
    () => actorHandle({ isAuthenticated: true, source: "clerk" }, "@attacker"),
    /must be synchronized/
  );
  assert.equal(
    actorHandle({ isAuthenticated: true, source: "dev" }, "@local-preview"),
    "@local_preview"
  );
  await assert.rejects(
    upsertProfile(
      {
        name: "Victim",
        handle: "@victim",
        role: "Researcher",
        location: "Symposium",
        bio: "Ownership boundary test.",
        fields: ["Security"]
      },
      { handle: "@attacker", isAuthenticated: true, source: "clerk" }
    ),
    /only be updated by their owner/
  );

  // @ts-expect-error Next's JavaScript config intentionally has no TypeScript declaration file.
  const { default: nextConfig } = await import("../next.config.mjs");
  assert.equal(nextConfig.poweredByHeader, false);
  assert.equal(typeof nextConfig.headers, "function");
  const headerRules = await nextConfig.headers();
  const globalRule = headerRules.find((rule: { source: string }) => rule.source === "/:path*");
  assert.ok(globalRule);

  const headers = new Map(
    globalRule.headers.map((header: { key: string; value: string }) => [header.key.toLowerCase(), header.value])
  );
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");

  const mutableEnv = process.env as Record<string, string | undefined>;
  const originalNodeEnv = mutableEnv.NODE_ENV;
  const originalBackendUrl = mutableEnv.SYMPOSIUM_API_URL;
  const originalConsoleError = console.error;
  try {
    mutableEnv.NODE_ENV = "production";
    delete mutableEnv.SYMPOSIUM_API_URL;
    console.error = () => undefined;

    const { liveBackendResponseHeaders, proxyLiveBackend } = await import("@/lib/liveBackendClient");
    const forwardedHeaders = liveBackendResponseHeaders(
      new Response(null, {
        headers: {
          "cache-control": "public, max-age=3600",
          "content-type": "application/json",
          vary: "Origin, authorization",
          "x-request-id": "req-live-boundary"
        }
      })
    );
    assert.equal(forwardedHeaders.get("cache-control"), "no-store");
    assert.equal(forwardedHeaders.get("x-request-id"), "req-live-boundary");
    assert.equal(forwardedHeaders.get("vary"), "Origin, authorization, Cookie");
    assert.equal(
      liveBackendResponseHeaders(new Response(null)).get("cache-control"),
      "no-store"
    );
    const proxied = await proxyLiveBackend("/v1/bootstrap");
    assert.ok(proxied);
    assert.equal(proxied.status, 503);

    const { GET: readLocalAttachment } = await import(
      "../app/api/attachments/local/[attachmentId]/[fileName]/route"
    );
    const localRead = await readLocalAttachment(new Request("http://localhost/local-file"), {
      params: Promise.resolve({ attachmentId: "untrusted", fileName: "file.pdf" })
    });
    assert.equal(localRead.status, 404);

    const { PUT: writeLocalAttachment } = await import(
      "../app/api/attachments/local-upload/[attachmentId]/route"
    );
    const localWrite = await writeLocalAttachment(
      new Request("http://localhost/local-upload", { method: "PUT", body: "untrusted" }),
      { params: Promise.resolve({ attachmentId: "untrusted" }) }
    );
    assert.equal(localWrite.status, 404);
  } finally {
    if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = originalNodeEnv;
    if (originalBackendUrl === undefined) delete mutableEnv.SYMPOSIUM_API_URL;
    else mutableEnv.SYMPOSIUM_API_URL = originalBackendUrl;
    console.error = originalConsoleError;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "production fallback policy",
          "503 response contract",
          "local-only route contract",
          "production route enforcement",
          "bounded JSON request parsing",
          "public bootstrap, search, and private-community projection",
          "server-derived mutation identity",
          "profile ownership enforcement",
          "live bridge cache isolation",
          "browser security headers"
        ]
      },
      null,
      2
    )
  );
};

void main();
