import assert from "node:assert/strict";
import {
  SymposiumApiError,
  createRetryMutationRegistry,
  createSymposiumApiClient,
  shouldRetainRetryMutation
} from "@/features/api/symposiumApiClient";
import { profileAvatarForPersistence } from "@/features/profiles/profilePersistence";

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });

const main = async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const client = createSymposiumApiClient(async (input, init) => {
    requests.push({ input, init });
    return jsonResponse({ ok: true });
  });

  const result = await client.request<{ ok: boolean }>("/api/posts/p1", {
    method: "PATCH",
    idempotencyKey: "mutation-1",
    body: { title: "Revision-safe" },
    cache: "no-store",
    keepalive: true
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(requests[0]?.input, "/api/posts/p1");
  assert.equal(requests[0]?.init?.method, "PATCH");
  assert.equal(new Headers(requests[0]?.init?.headers).get("Idempotency-Key"), "mutation-1");
  assert.equal(new Headers(requests[0]?.init?.headers).get("Content-Type"), "application/json");
  assert.equal(requests[0]?.init?.body, JSON.stringify({ title: "Revision-safe" }));
  assert.equal(requests[0]?.init?.keepalive, true);

  const conflictClient = createSymposiumApiClient(async () => jsonResponse({ error: "Still processing" }, 409));
  const conflict = await conflictClient.request("/api/posts", { method: "POST", body: {} }).catch((error) => error);
  assert.ok(conflict instanceof SymposiumApiError);
  assert.equal(conflict.message, "Still processing");
  assert.equal(conflict.status, 409);
  assert.equal(shouldRetainRetryMutation(conflict), true);

  const invalidClient = createSymposiumApiClient(async () => jsonResponse({ error: "Invalid post" }, 400));
  const invalid = await invalidClient.request("/api/posts", { method: "POST", body: {} }).catch((error) => error);
  assert.ok(invalid instanceof SymposiumApiError);
  assert.equal(shouldRetainRetryMutation(invalid), false);

  const offlineClient = createSymposiumApiClient(async () => {
    throw new TypeError("offline");
  });
  const offline = await offlineClient.request("/api/bootstrap").catch((error) => error);
  assert.ok(offline instanceof SymposiumApiError);
  assert.equal(offline.status, null);
  assert.equal(shouldRetainRetryMutation(offline), true);

  const registry = createRetryMutationRegistry();
  const first = registry.acquire("post-create", "same-payload");
  const retry = registry.acquire("post-create", "same-payload");
  assert.equal(first.idempotencyKey, retry.idempotencyKey);
  assert.equal(registry.size(), 1);
  registry.clear(first.fingerprintKey);
  assert.equal(registry.size(), 0);
  assert.notEqual(registry.acquire("post-create", "same-payload").idempotencyKey, first.idempotencyKey);
  assert.equal(profileAvatarForPersistence("data:image/png;base64,abc"), undefined);
  assert.equal(profileAvatarForPersistence("blob:http://localhost/avatar"), undefined);
  assert.equal(profileAvatarForPersistence(" https://cdn.example/avatar.webp "), "https://cdn.example/avatar.webp");

  console.log(JSON.stringify({ ok: true, checked: [
    "JSON request normalization",
    "idempotency header propagation",
    "lifecycle keepalive propagation",
    "structured API errors",
    "retry retention policy",
    "stable retry mutation identities",
    "persistent profile-avatar URL boundary"
  ] }, null, 2));
};

void main();
