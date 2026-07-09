import assert from "node:assert/strict";
import {
  liveBackendUnavailableMessage,
  liveBackendUnavailableResponse,
  localDataFallbackAllowed,
  localPreviewRouteUnavailableResponse
} from "@/lib/runtimeSafety";

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

    const { proxyLiveBackend } = await import("@/lib/liveBackendClient");
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
          "browser security headers"
        ]
      },
      null,
      2
    )
  );
};

void main();
