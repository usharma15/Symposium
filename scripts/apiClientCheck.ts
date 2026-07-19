import assert from "node:assert/strict";
import {
  SymposiumApiError,
  createRetryMutationRegistry,
  createSymposiumApiClient,
  resolveSymposiumApiRequest,
  shouldRetainRetryMutation
} from "@/features/api/symposiumApiClient";
import { profileAvatarForPersistence } from "@/features/profiles/profilePersistence";
import { uploadPreparedAttachmentContent } from "@/features/attachments/attachmentUploadClient";

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

  assert.deepEqual(
    resolveSymposiumApiRequest(
      "/api/communities/research/membership",
      { method: "POST", body: { action: "leave", actorHandle: "@ada" } },
      "https://api.example/"
    ),
    {
      body: {},
      direct: true,
      input: "https://api.example/v1/communities/research/membership",
      method: "DELETE"
    }
  );
  assert.deepEqual(
    resolveSymposiumApiRequest(
      "/api/workspace/documents/note-1/publish",
      { method: "POST", body: { expectedRevision: 3 } },
      "https://api.example"
    ),
    {
      body: { expectedRevision: 3, noteId: "note-1" },
      direct: true,
      input: "https://api.example/v1/notes/publish",
      method: "POST"
    }
  );
  assert.equal(
    resolveSymposiumApiRequest(
      "/api/posts/p1/actions",
      { method: "POST", body: { action: "read", actorHandle: "@ada" } },
      "https://api.example"
    ).input,
    "https://api.example/v1/posts/p1/views"
  );
  assert.equal(
    resolveSymposiumApiRequest("/api/auth/sync", { method: "POST" }, "https://api.example").direct,
    false
  );

  const directRequests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const directClient = createSymposiumApiClient(async (input, init) => {
    directRequests.push({ input, init });
    return jsonResponse({ ok: true });
  }, {
    backendUrl: "https://api.example",
    getAccessToken: async () => "token-1"
  });
  await directClient.request("/api/posts?limit=24", { cache: "no-store" });
  assert.equal(directRequests[0]?.input, "https://api.example/v1/posts?limit=24");
  assert.equal(new Headers(directRequests[0]?.init?.headers).get("Authorization"), "Bearer token-1");
  const attachmentBody = new Blob(["bounded attachment"]);
  await directClient.uploadBinary(
    "/api/attachments/00000000-0000-4000-8000-000000000001/content",
    attachmentBody,
    { actorHandle: "@ada" }
  );
  assert.equal(
    directRequests[1]?.input,
    "https://api.example/v1/attachments/00000000-0000-4000-8000-000000000001/content"
  );
  assert.equal(directRequests[1]?.init?.method, "PUT");
  assert.equal(new Headers(directRequests[1]?.init?.headers).get("Authorization"), "Bearer token-1");
  assert.equal(new Headers(directRequests[1]?.init?.headers).get("Content-Type"), "application/octet-stream");
  assert.equal(directRequests[1]?.init?.body, attachmentBody);

  const preparedUploads: Array<{ path: string; body: Blob; actorHandle?: string }> = [];
  await uploadPreparedAttachmentContent({
    actorHandle: "@ada",
    contentType: "image/png",
    file: new Blob(["profile-photo"], { type: "image/png" }) as File,
    upload: {
      attachmentId: "00000000-0000-4000-8000-000000000002",
      uploadUrl: "/api/attachments/00000000-0000-4000-8000-000000000002/content",
      uploadTransport: "authenticated_api"
    }
  }, {
    uploadBinary: async <T>(path: string, body: Blob, options: { actorHandle?: string; signal?: AbortSignal } = {}) => {
      preparedUploads.push({ path, body, actorHandle: options.actorHandle });
      return undefined as T;
    }
  });
  assert.deepEqual(preparedUploads.map(({ path, actorHandle }) => ({ path, actorHandle })), [{
    path: "/api/attachments/00000000-0000-4000-8000-000000000002/content",
    actorHandle: "@ada"
  }]);

  const fallbackRequests: string[] = [];
  const fallbackClient = createSymposiumApiClient(async (input) => {
    fallbackRequests.push(String(input));
    if (String(input).startsWith("https://api.example")) throw new TypeError("cors");
    return jsonResponse({ ok: true });
  }, { backendUrl: "https://api.example", getAccessToken: async () => "token-1" });
  await fallbackClient.request("/api/posts?limit=24");
  assert.deepEqual(fallbackRequests, ["https://api.example/v1/posts?limit=24", "/api/posts?limit=24"]);

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
    "authenticated binary upload routing",
    "shared prepared-upload transport for profile photos",
    "structured API errors",
    "retry retention policy",
    "stable retry mutation identities",
    "persistent profile-avatar URL boundary"
  ] }, null, 2));
};

void main();
