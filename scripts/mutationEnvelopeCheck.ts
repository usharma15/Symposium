import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { publishStoredEvent, stageEvent } from "@/apps/api/src/services/events";
import {
  claimMutation,
  completeMutation,
  hashMutationPayload,
  validateIdempotencyKey,
  type MutationContext
} from "@/apps/api/src/services/mutations";
import { subscribeLocalLiveEvents } from "@/apps/api/src/services/liveBus";
import { runTransaction } from "@/apps/api/src/services/transactions";
import { createSymposiumApiClient } from "@/features/api/symposiumApiClient";
import { reportCheck } from "@/scripts/checkReport";

type Receipt = {
  requestHash: string;
  response: unknown;
  status: "pending" | "completed";
};

const receipts = new Map<string, Receipt>();
const fakeClient = {
  query: async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("INSERT INTO mutation_receipts")) {
      const key = `${params[0]}:${params[1]}:${params[2]}`;
      if (receipts.has(key)) return { rowCount: 0, rows: [] };
      receipts.set(key, { requestHash: String(params[3]), response: null, status: "pending" });
      return { rowCount: 1, rows: [{ id: "receipt-1" }] };
    }
    if (normalized.startsWith("SELECT request_hash AS \"requestHash\"")) {
      const key = `${params[0]}:${params[1]}:${params[2]}`;
      const receipt = receipts.get(key);
      return { rowCount: receipt ? 1 : 0, rows: receipt ? [receipt] : [] };
    }
    if (normalized.startsWith("UPDATE mutation_receipts")) {
      const key = `${params[0]}:${params[1]}:${params[2]}`;
      const receipt = receipts.get(key);
      if (!receipt || receipt.requestHash !== params[4] || receipt.status !== "pending") {
        return { rowCount: 0, rows: [] };
      }
      receipt.status = "completed";
      receipt.response = JSON.parse(String(params[3]));
      return { rowCount: 1, rows: [] };
    }
    if (normalized.startsWith("INSERT INTO events")) {
      return {
        rowCount: 1,
        rows: [{
          id: "00000000-0000-4000-8000-000000000001",
          kind: params[0],
          actorHandle: params[1],
          audienceHandles: JSON.parse(String(params[2])),
          subjectType: params[3],
          subjectId: params[4],
          visibility: params[5],
          payload: JSON.parse(String(params[6])),
          createdAt: "2026-07-10T12:00:00.000Z"
        }]
      };
    }
    throw new Error(`Unexpected SQL in mutation envelope check: ${normalized}`);
  }
} as unknown as PoolClient;

const main = async () => {
  assert.equal(
    hashMutationPayload({ beta: 2, alpha: { zed: 1, aye: true } }),
    hashMutationPayload({ alpha: { aye: true, zed: 1 }, beta: 2 })
  );
  assert.notEqual(hashMutationPayload({ value: 1 }), hashMutationPayload({ value: 2 }));
  assert.equal(validateIdempotencyKey("symposium:post:12345678"), "symposium:post:12345678");
  assert.throws(() => validateIdempotencyKey("short"), /8-200/);
  assert.throws(() => validateIdempotencyKey("invalid key spaces"), /URL-safe/);

  const context: MutationContext = {
    idempotencyKey: "symposium:post:12345678",
    requestHash: hashMutationPayload({ title: "Canonical mutation" }),
    scope: "post.create"
  };
  const firstClaim = await claimMutation<{ id: string }>(fakeClient, "@ada", context);
  assert.deepEqual(firstClaim, { replayed: false });
  await completeMutation(fakeClient, "@ada", context, { id: "post-1" });
  const replay = await claimMutation<{ id: string }>(fakeClient, "@ada", context);
  assert.deepEqual(replay, { replayed: true, response: { id: "post-1" } });

  await assert.rejects(
    claimMutation(fakeClient, "@ada", {
      ...context,
      requestHash: hashMutationPayload({ title: "Different mutation" })
    }),
    /different mutation payload/
  );

  const receivedEvents: string[] = [];
  const unsubscribe = subscribeLocalLiveEvents((event) => receivedEvents.push(event.id));
  const staged = await stageEvent(fakeClient, {
    kind: "post.created",
    actorHandle: "@ada",
    subjectType: "post",
    subjectId: "post-1",
    payload: { itemId: "post-1" }
  });
  assert.deepEqual(receivedEvents, []);
  await publishStoredEvent(staged);
  assert.deepEqual(receivedEvents, [staged.id]);
  const privateEvent = await stageEvent(fakeClient, {
    kind: "note.updated",
    actorHandle: "@ada",
    subjectType: "note",
    subjectId: "note-1",
    visibility: "private"
  });
  assert.deepEqual(privateEvent.audienceHandles, ["@ada"]);
  unsubscribe();

  const transactionCalls: string[] = [];
  const transactionClient = {
    query: async (sql: string) => {
      transactionCalls.push(sql);
      return { rowCount: 0, rows: [] };
    }
  } as unknown as PoolClient;
  assert.deepEqual(
    await runTransaction(transactionClient, async () => {
      transactionCalls.push("operation");
      return { value: "committed" };
    }),
    { value: "committed" }
  );
  assert.deepEqual(transactionCalls, ["BEGIN", "operation", "COMMIT"]);
  transactionCalls.length = 0;
  await assert.rejects(
    runTransaction(transactionClient, async () => {
      transactionCalls.push("operation");
      throw new Error("abort");
    }),
    /abort/
  );
  assert.deepEqual(transactionCalls, ["BEGIN", "operation", "ROLLBACK"]);

  for (const [path, atomicCount, allowPool] of [
    ["apps/api/src/repository/posts.ts", 4, false],
    ["apps/api/src/repository/comments.ts", 4, false],
    ["apps/api/src/repository/identity.ts", 2, false],
    ["apps/api/src/repository/inquiryViews.ts", 2, false],
    ["apps/api/src/repository/opportunityApplications.ts", 4, true]
  ] as const) {
    const source = readFileSync(path, "utf8");
    assert.equal(
      source.match(/\brunAtomic(?:<[^\n]+>)?\(/g)?.length,
      atomicCount,
      `${path} atomic mutation count`
    );
    const forbiddenPatterns = [
      /\bpublishStoredEvent\(/,
      /client\.query\("BEGIN"\)/,
      /client\.query\("COMMIT"\)/,
      /client\.query\("ROLLBACK"\)/
    ];
    if (!allowPool) forbiddenPatterns.push(/\bgetPool\(\)\.connect\(/);
    for (const forbidden of forbiddenPatterns) {
      assert.doesNotMatch(source, forbidden, `${path} bypasses canonical transactions`);
    }
  }

  const postRoutes = readFileSync("apps/api/src/routes/postRoutes.ts", "utf8");
  for (const scope of ["post.update", "post.delete", "comment.update", "comment.delete"]) {
    assert.match(postRoutes, new RegExp(`mutationContextFromRequest\\(request, "${scope.replace(".", "\\.")}"`));
  }
  const profileRoutes = readFileSync("apps/api/src/routes/profileRoutes.ts", "utf8");
  const profileProxy = readFileSync("app/api/profiles/route.ts", "utf8");
  const followProxy = readFileSync("app/api/profiles/[handle]/follow/route.ts", "utf8");
  for (const scope of ["profile.upsert", "profile.follow", "profile.unfollow"]) {
    assert.match(profileRoutes, new RegExp(`mutationContextFromRequest\\(request, "${scope.replace(".", "\\.")}"`));
  }
  for (const proxy of [profileProxy, followProxy]) {
    assert.match(proxy, /proxyLiveApiRequest/);
  }
  const mutableEnv = process.env as Record<string, string | undefined>;
  const savedEnv = Object.fromEntries(
    ["SYMPOSIUM_API_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]
      .map((key) => [key, mutableEnv[key]])
  );
  const originalFetch = globalThis.fetch;
  const forwarded: Array<{ input: string; init: RequestInit }> = [];
  let protectedReply: "redirect" | "denied" | "malformed" = "redirect";
  try {
    mutableEnv.SYMPOSIUM_API_URL = "https://route-probe.example";
    delete mutableEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete mutableEnv.CLERK_SECRET_KEY;
    globalThis.fetch = (async (input, init) => {
      forwarded.push({ input: String(input), init: init ?? {} });
      if (String(input).endsWith("/access")) {
        const payload = protectedReply === "redirect"
          ? { url: "https://private-storage.example/signed" }
          : protectedReply === "denied"
            ? { error: "Denied" }
            : {};
        return new Response(JSON.stringify(payload), {
          status: protectedReply === "denied" ? 403 : 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ preserved: true }), {
        status: 207,
        headers: { "Content-Type": "application/json", "X-Request-Id": "route-probe" }
      });
    }) as typeof fetch;

    const [posts, post, postActions, comments, comment, commentActions, workspaceAttachment] = await Promise.all([
      import("../app/api/posts/route"),
      import("../app/api/posts/[id]/route"),
      import("../app/api/posts/[id]/actions/route"),
      import("../app/api/posts/[id]/comments/route"),
      import("../app/api/posts/[id]/comments/[commentId]/route"),
      import("../app/api/posts/[id]/comments/[commentId]/actions/route"),
      import("../app/api/workspace/attachments/[attachmentId]/route")
    ]);
    type Method = "GET" | "POST" | "PATCH" | "DELETE";
    type Handler = (request: Request) => Promise<Response>;
    type Probe = [string, Method, Record<string, unknown> | undefined, Handler, string?];
    const postContext = { params: Promise.resolve({ id: "post-1" }) };
    const commentContext = { params: Promise.resolve({ id: "post-1", commentId: "comment-1" }) };
    const document = {
      version: 1,
      nodes: [{ id: "p", type: "paragraph", content: [{ text: "Evidence" }], align: "left", indent: 0 }]
    };
    const create = (input: Record<string, unknown>): Probe =>
      ["/api/posts", "POST", { authorHandle: "@ada", attachmentIds: [], ...input }, posts.POST];
    const probes: Probe[] = [
      ["/api/posts?limit=7&actorHandle=%40ada", "GET", undefined, posts.GET],
      create({ title: "", body: " Titleless Thought ", kind: "thought", postType: "thought", room: "amphitheater" }),
      create({ title: " Paper ", body: "Evidence", document, kind: "paper", postType: "paper", room: "library", communityId: "community-1", quoteSource: { sourceType: "post", sourceId: "source-1" } }),
      create({ title: "Proposal", body: "Fund it", kind: "paper", postType: "proposal", room: "funding", patronage: { goalMinorUnits: 25000 } }),
      create({ title: "Research grant", body: "Join us", kind: "thought", postType: "opportunity", room: "opportunities", opportunity: { kind: "grant" } }),
      ["/api/posts/post-1?actorHandle=%40ada", "GET", undefined, (request) => post.GET(request, postContext)],
      ["/api/posts/post-1", "PATCH", { title: " Revised ", body: "Body", actorHandle: "@legacy", expectedEditedAt: null, quoteSource: null }, (request) => post.PATCH(request, postContext), "@ada"],
      ["/api/posts/post-1", "DELETE", { actorHandle: "@ada" }, (request) => post.DELETE(request, postContext)],
      ["/api/posts/post-1/actions", "POST", { action: "save", active: true, actorHandle: "@ada", clientContext: "legacy" }, (request) => postActions.POST(request, postContext)],
      ["/api/posts/post-1/comments", "POST", { body: " Comment ", document, stance: "Comment", authorHandle: "@ada", attachmentIds: [], quoteSource: { sourceType: "post", sourceId: "source-1" } }, (request) => comments.POST(request, postContext)],
      ["/api/posts/post-1/comments/comment-1", "PATCH", { body: " Revised ", actorHandle: "@ada", expectedEditedAt: null, quoteSource: null }, (request) => comment.PATCH(request, commentContext)],
      ["/api/posts/post-1/comments/comment-1", "DELETE", { actorHandle: "@ada" }, (request) => comment.DELETE(request, commentContext)],
      ["/api/posts/post-1/comments/comment-1/actions", "POST", { action: "read", actorHandle: "@ada", surface: "detail", clientContext: "legacy" }, (request) => commentActions.POST(request, commentContext)]
    ];

    let activeHandler: Handler = async () => assert.fail("Missing route probe handler.");
    const direct: Array<{ input: string; init: RequestInit }> = [];
    const client = createSymposiumApiClient(async (input, init) => {
      if (String(input).startsWith("https://route-probe.example")) {
        direct.push({ input: String(input), init: init ?? {} });
        throw new TypeError("response lost after commit");
      }
      return activeHandler(new Request(`https://next-probe.example${String(input)}`, init));
    }, { backendUrl: "https://route-probe.example", getAccessToken: async () => null });

    for (const [path, method, body, handler, actorHandle] of probes) {
      activeHandler = handler;
      const response = await client.request<{ preserved: boolean }>(path, {
        method,
        body,
        actorHandle,
        idempotencyKey: method === "GET" ? undefined : `route-probe-${direct.length + 1}`
      });
      assert.deepEqual(response, { preserved: true }, `${method} ${path} response`);
      const directRequest = direct.at(-1)!;
      const forwardedRequest = forwarded.at(-1)!;
      const parseBody = (init: RequestInit) =>
        init.body === undefined ? undefined : JSON.parse(String(init.body));
      assert.equal(forwardedRequest.input, directRequest.input, `${method} ${path} target`);
      assert.equal(
        hashMutationPayload(parseBody(forwardedRequest.init)),
        hashMutationPayload(parseBody(directRequest.init)),
        `${method} ${path} receipt`
      );
      assert.equal(
        new Headers(forwardedRequest.init.headers).get("x-symposium-handle"),
        new Headers(directRequest.init.headers).get("x-symposium-handle"),
        `${method} ${path} actor`
      );
    }

    for (const [label, body] of [["missing", undefined], ["malformed", "{"]] as const) {
      const response = await post.DELETE(
        new Request("https://next-probe.example/api/posts/post-1", {
          method: "DELETE",
          body,
          headers: { "Idempotency-Key": `route-probe-${label}-delete`, "x-symposium-handle": "@ada" }
        }),
        postContext
      );
      assert.equal(response.status, 207, label);
      assert.equal(new Headers(forwarded.at(-1)?.init.headers).get("x-symposium-handle"), "@ada");
    }
    const attachmentContext = { params: Promise.resolve({ attachmentId: "attachment-1" }) };
    const protectedResponses: Response[] = [];
    for (protectedReply of ["redirect", "denied", "malformed"] as const) {
      protectedResponses.push(await workspaceAttachment.GET(
        new Request("https://next-probe.example/api/workspace/attachments/attachment-1?actorHandle=%40ada"),
        attachmentContext
      ));
    }
    assert.deepEqual(protectedResponses.map(({ status }) => status), [307, 403, 502]);
    assert.equal(protectedResponses[0]?.headers.get("location"), "https://private-storage.example/signed");
    assert.deepEqual(await protectedResponses[1]?.json(), { error: "Denied" });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete mutableEnv[key];
      else mutableEnv[key] = value;
    }
  }

  reportCheck([
    "stable mutation hashing",
    "idempotency key validation",
    "response replay",
    "payload conflict rejection",
    "transactional event staging",
    "private event audience defaults",
    "canonical commit and rollback ordering",
    "canonical mutation transaction authority",
    "edit and delete idempotency coverage",
    "profile and follow idempotency coverage",
    "direct and facade post mutation hash parity"
  ]);
};

void main();

export {};
