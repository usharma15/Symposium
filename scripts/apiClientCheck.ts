import assert from "node:assert/strict";
import { reportCheck } from "@/scripts/checkReport";
import {
  SymposiumApiError,
  createRetryMutationRegistry,
  createSymposiumApiClient,
  resolveSymposiumApiRequest,
  shouldRetainRetryMutation
} from "@/features/api/symposiumApiClient";
import { profileAvatarForPersistence } from "@/features/profiles/profilePersistence";
import { uploadPreparedAttachmentContent } from "@/features/attachments/attachmentUploadClient";
import { hashMutationPayload } from "@/apps/api/src/services/mutations";
import {
  mapSymposiumApiRoute,
  normalizeSymposiumBackendUrl
} from "@/lib/symposiumApiRoute";

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
      body: { expectedRevision: 3, noteId: "note-1", visibility: "public" },
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
    resolveSymposiumApiRequest(
      "/api/posts/p1/comments/c1/actions",
      { method: "POST", body: { action: "read", actorHandle: "@ada" } },
      "https://api.example"
    ).input,
    "https://api.example/v1/posts/p1/comments/c1/views"
  );
  assert.equal(
    resolveSymposiumApiRequest("/api/auth/sync", { method: "POST" }, "https://api.example").direct,
    false
  );
  assert.equal(normalizeSymposiumBackendUrl("https://api.example/root/"), "https://api.example/root");
  for (const invalidBackend of ["javascript:alert(1)", "https://user:secret@api.example", "not a url"]) {
    assert.equal(normalizeSymposiumBackendUrl(invalidBackend), null);
  }
  assert.equal(mapSymposiumApiRoute("https://untrusted.example/api/posts").boundary, "non-api");

  const boundaries = [
    ["/api/auth/sync", "auth-sync", "/v1/auth/sync"],
    ["/api/attachments/local/a/file.pdf", "local-attachment", null],
    ["/api/assistant-attachments/a", "protected-assistant-attachment", "/v1/assistant-attachments/a/access"],
    ["/api/message-attachments/a", "protected-message-attachment", "/v1/message-attachments/a/access"],
    ["/api/opportunity-attachments/a", "protected-opportunity-attachment", "/v1/opportunity-attachments/a/access"],
    ["/api/workspace/attachments/a", "protected-workspace-attachment", "/v1/workspace/attachments/a/access"]
  ] as const;
  for (const [path, boundary, livePath] of boundaries) {
    const mapping = mapSymposiumApiRoute(path);
    assert.equal(mapping.boundary, boundary, path);
    assert.equal(mapping.livePath, livePath, path);
    assert.equal(resolveSymposiumApiRequest(path, {}, "https://api.example").direct, false, path);
  }

  const encoded = mapSymposiumApiRoute("/api/posts/paper%2Fencoded?cursor=a%2Fb");
  assert.equal(encoded.livePath, "/v1/posts/paper%2Fencoded?cursor=a%2Fb");
  assert.deepEqual(
    mapSymposiumApiRoute("/api/workspace/documents/n1", {
      method: "PATCH",
      body: { title: "Canonical", actorHandle: "@ada" }
    }).body,
    { title: "Canonical" }
  );
  mapSymposiumApiRoute("/api/workspace/documents/bad%percent/publish", {
    method: "POST",
    body: { expectedRevision: 2 }
  });
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
  await directClient.request("/api/assistant/actions/office-post-drafts", {
    method: "POST",
    actorHandle: "@ada",
    idempotencyKey: "assistant-action-1",
    body: {
      assistantMessageId: "00000000-0000-4000-8000-000000000001",
      postKind: "thought"
    }
  });
  assert.equal(
    directRequests[1]?.input,
    "https://api.example/v1/assistant/actions/office-post-drafts"
  );
  assert.equal(
    directRequests[1]?.init?.body,
    JSON.stringify({
      assistantMessageId: "00000000-0000-4000-8000-000000000001",
      postKind: "thought"
    })
  );
  assert.equal(
    new Headers(directRequests[1]?.init?.headers).get("Authorization"),
    "Bearer token-1"
  );
  assert.equal(
    new Headers(directRequests[1]?.init?.headers).get("Idempotency-Key"),
    "assistant-action-1"
  );
  const attachmentBody = new Blob(["bounded attachment"]);
  await directClient.uploadBinary(
    "/api/attachments/00000000-0000-4000-8000-000000000001/content",
    attachmentBody,
    { actorHandle: "@ada" }
  );
  assert.equal(
    directRequests[2]?.input,
    "https://api.example/v1/attachments/00000000-0000-4000-8000-000000000001/content"
  );
  assert.equal(directRequests[2]?.init?.method, "PUT");
  assert.equal(new Headers(directRequests[2]?.init?.headers).get("Authorization"), "Bearer token-1");
  assert.equal(new Headers(directRequests[2]?.init?.headers).get("Content-Type"), "application/octet-stream");
  assert.equal(directRequests[2]?.init?.body, attachmentBody);

  const developmentRequests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const developmentClient = createSymposiumApiClient(async (input, init) => {
    developmentRequests.push({ input, init });
    return jsonResponse({ ok: true });
  }, {
    backendUrl: "https://api.example",
    getAccessToken: async () => null
  });
  const thoughtBody = {
    title: "",
    body: "A titleless Thought",
    kind: "thought",
    postType: "thought",
    room: "amphitheater",
    authorHandle: "@hypatia",
    attachmentIds: []
  };
  const commentBody = {
    body: "A direct comment",
    stance: "Comment",
    parentId: null,
    authorHandle: "@hypatia",
    attachmentIds: []
  };
  const developmentCases: Array<[string, string, string, Record<string, unknown>, string, unknown?]> = [
    ["/api/communities/research/membership", "membership-1", "@ada", { action: "join", actorHandle: "@ada" }, "https://api.example/v1/communities/research/join", {}],
    ["/api/posts", "post-create-author-1", "@hypatia", thoughtBody, "https://api.example/v1/posts"],
    ["/api/posts/post-1/comments", "comment-create-author-1", "@hypatia", commentBody, "https://api.example/v1/posts/post-1/comments"]
  ];
  for (const [path, idempotencyKey, actorHandle, body, input, expectedBody = body] of developmentCases) {
    await developmentClient.request(path, { method: "POST", idempotencyKey, body });
    const request = developmentRequests.at(-1)!;
    assert.equal(request.input, input, path);
    assert.equal(new Headers(request.init?.headers).get("x-symposium-handle"), actorHandle, path);
    assert.deepEqual(JSON.parse(String(request.init?.body)), expectedBody, path);
  }

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

  const responseLossProbe = async (path: string, idempotencyKey: string, body: Record<string, unknown>, method: "POST" | "DELETE" = "POST") => {
    const requests: Array<{ actorHandle: string | null; input: string; body: unknown }> = [];
    const probe = createSymposiumApiClient(async (input, init) => {
      requests.push({
        actorHandle: new Headers(init?.headers).get("x-symposium-handle"),
        input: String(input),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
      });
      if (String(input).startsWith("https://api.example")) throw new TypeError("response lost");
      return jsonResponse({ ok: true });
    }, { backendUrl: "https://api.example", getAccessToken: async () => "token-1" });
    await probe.request(path, { method, actorHandle: "@ada", idempotencyKey, body });
    const [direct, fallback] = requests;
    const facadeBody = mapSymposiumApiRoute(fallback!.input, { method, body: fallback!.body }).body;
    assert.equal(hashMutationPayload(facadeBody), hashMutationPayload(direct!.body), path);
    return { direct: direct!, fallback: fallback! };
  };
  const assistantBody = {
    assistantMessageId: "00000000-0000-4000-8000-000000000002",
    postKind: "paper"
  };
  const assistantLoss = await responseLossProbe(
    "/api/assistant/actions/office-post-drafts",
    "assistant-action-fallback-1",
    assistantBody
  );
  assert.deepEqual([assistantLoss.direct.input, assistantLoss.fallback.input], [
    "https://api.example/v1/assistant/actions/office-post-drafts",
    "/api/assistant/actions/office-post-drafts"
  ]);
  assert.deepEqual([assistantLoss.direct.actorHandle, assistantLoss.fallback.actorHandle], [null, "@ada"]);
  assert.deepEqual(assistantLoss.fallback.body, { ...assistantBody, actorHandle: "@ada" });

  type ResponseLossCase = [string, string, Record<string, unknown>, ("POST" | "DELETE")?, unknown?, string?];
  const responseLossCases: ResponseLossCase[] = [
    ["/api/workspace/documents/note-1/publish", "publication-fallback-1", { expectedRevision: 3, publicationTarget: "thought" }, "POST", { noteId: "note-1", expectedRevision: 3, publicationTarget: "thought", visibility: "public" }],
    ["/api/posts/post-1/opportunity/application", "opportunity-fallback-1", { statement: "Evidence", attachmentIds: [] }],
    ["/api/messages", "legacy-message-fallback-1", { actorHandle: "@ada", body: "Hello", recipientHandle: "@grace" }],
    ["/api/conversations/groups", "legacy-group-fallback-1", { actorHandle: "@ada", title: "Research", inviteeHandles: ["@grace"] }],
    ["/api/profiles/hypatia/follow", "profile-unfollow-fallback-1", { actorHandle: "@ada" }, "DELETE", { actorHandle: "@ada", targetHandle: "@hypatia" }],
    ["/api/profiles/hypatia/follow", "profile-follow-fallback-1", { actorHandle: "@ada" }, "POST", { targetHandle: "@hypatia", status: "active" }, "https://api.example/v1/profiles/%40hypatia/follow"]
  ];
  for (const [path, key, body, method = "POST", expectedBody = body, expectedInput] of responseLossCases) {
    const loss = await responseLossProbe(path, key, body, method);
    assert.deepEqual(loss.direct.body, expectedBody, `${method} ${path} canonical body`);
    if (expectedInput) assert.equal(loss.direct.input, expectedInput, `${method} ${path} target`);
  }

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

  reportCheck([
    "JSON request normalization",
    "idempotency header propagation",
    "strict action payload authentication separation",
    "canonical route mapping and protected-delivery boundaries",
    "pre-transformation development actor capture",
    "direct create author identity promotion",
    "actor-aware Next-route mutation failover",
    "cross-transport idempotency hash equivalence after response loss",
    "lifecycle keepalive propagation",
    "authenticated binary upload routing",
    "shared prepared-upload transport for profile photos",
    "structured API errors",
    "retry retention policy",
    "stable retry mutation identities",
    "persistent profile-avatar URL boundary"
  ]);
};

void main();
