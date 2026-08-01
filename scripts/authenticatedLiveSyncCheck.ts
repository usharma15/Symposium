import assert from "node:assert/strict";
import {
  authenticatedCanaryAcknowledgement,
  authenticatedCanaryConfigFromEnvironment,
  runAuthenticatedLiveSyncCanary,
  type AuthenticatedCanaryConfig
} from "@/scripts/authenticatedLiveSyncCanary";

type FixtureActor = "@canary_a" | "@canary_b" | null;
type FixtureEvent = {
  actorHandle?: string;
  audienceHandles: string[];
  createdAt: string;
  cursor: string;
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  subjectId: string;
  subjectType: string;
  visibility: "private" | "public";
};
type FixtureSubscriber = {
  actor: FixtureActor;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

const tokenA = "fixture-clerk-token-a-000000";
const tokenB = "fixture-clerk-token-b-000000";
const encoder = new TextEncoder();

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

class AuthenticatedCanaryFixture {
  readonly requests: Array<{ actor: FixtureActor; method: string; path: string }> = [];
  readonly events: FixtureEvent[] = [];
  readonly subscribers = new Set<FixtureSubscriber>();
  cleanup = { comment: 0, post: 0, workspaceDocument: 0 };
  document: Record<string, unknown> | null = null;
  post: Record<string, unknown> | null = null;
  private sequence = 0;

  constructor(private readonly faults: { duplicateReplay?: boolean; leakPrivate?: boolean } = {}) {}

  private actor(headers: Headers) {
    const authorization = headers.get("authorization");
    if (authorization === `Bearer ${tokenA}`) return "@canary_a" as const;
    if (authorization === `Bearer ${tokenB}`) return "@canary_b" as const;
    return null;
  }

  private visible(event: FixtureEvent, actor: FixtureActor) {
    return event.visibility === "public" || this.faults.leakPrivate === true || Boolean(
      actor && event.audienceHandles.includes(actor)
    );
  }

  private frame(event: FixtureEvent) {
    return encoder.encode(`id: ${event.cursor}\nevent: symposium-event\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private send(subscriber: FixtureSubscriber, value: Uint8Array) {
    try {
      subscriber.controller.enqueue(value);
    } catch {
      this.subscribers.delete(subscriber);
    }
  }

  private publish(
    kind: string,
    subjectId: string,
    actor: Exclude<FixtureActor, null>,
    visibility: "private" | "public",
    payload: Record<string, unknown> = {}
  ) {
    this.sequence += 1;
    const createdAt = new Date(Date.UTC(2026, 6, 31, 16, 0, 0, this.sequence)).toISOString();
    const id = `00000000-0000-4000-8000-${this.sequence.toString().padStart(12, "0")}`;
    const event: FixtureEvent = {
      actorHandle: actor,
      audienceHandles: visibility === "private" ? [actor] : [],
      createdAt,
      cursor: `${createdAt}::${id}`,
      id,
      kind,
      payload,
      subjectId,
      subjectType: kind.startsWith("note.") ? "note" : kind.startsWith("comment.") ? "comment" : "post",
      visibility
    };
    this.events.push(event);
    for (const subscriber of this.subscribers) {
      if (this.visible(event, subscriber.actor)) this.send(subscriber, this.frame(event));
    }
    return event;
  }

  private json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
      status
    });
  }

  private stream(actor: FixtureActor, url: URL, signal: AbortSignal | null) {
    const cursor = url.searchParams.get("cursor");
    let subscriber: FixtureSubscriber | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriber = { actor, controller };
        this.subscribers.add(subscriber);
        const replay = this.events.filter((event) => (!cursor || event.cursor > cursor) && this.visible(event, actor));
        for (const event of replay) this.send(subscriber, this.frame(event));
        if (this.faults.duplicateReplay && cursor) {
          const duplicated = replay.find((event) => event.kind === "post.updated");
          if (duplicated) this.send(subscriber, this.frame(duplicated));
        }
        this.send(subscriber, encoder.encode(
          `event: symposium-ready\ndata: ${JSON.stringify({ ok: true, cursor: replay.at(-1)?.cursor ?? cursor })}\n\n`
        ));
        signal?.addEventListener("abort", () => {
          if (!subscriber) return;
          this.subscribers.delete(subscriber);
          try {
            controller.error(new DOMException("Aborted", "AbortError"));
          } catch {
            // The stream may already have been canceled by the reader.
          }
        }, { once: true });
      },
      cancel: () => {
        if (subscriber) this.subscribers.delete(subscriber);
      }
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const actor = this.actor(headers);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const path = `${url.pathname}${url.search}`;
    this.requests.push({ actor, method, path });

    if (url.pathname === "/readyz") {
      return this.json({
        issues: [],
        migrations: { pendingMigrationIds: [] },
        ok: true,
        release: "a".repeat(40),
        status: "ready",
        strict: true
      });
    }
    if (url.pathname === "/v1/events/stream") return this.stream(actor, url, init?.signal ?? null);
    if (!actor) return this.json({ error: "Authentication required." }, 401);

    const payload = init?.body ? record(JSON.parse(String(init.body))) : {};
    if (method === "POST" && url.pathname === "/v1/posts") {
      this.post = {
        ...payload,
        authorHandle: actor,
        comments: [],
        id: "10000000-0000-4000-8000-000000000001",
        revision: 1
      };
      this.publish("post.created", String(this.post.id), actor, "public", { item: this.post });
      return this.json({ item: this.post });
    }
    if (this.post && url.pathname === `/v1/posts/${this.post.id}` && method === "GET") {
      if (this.post.deletedAt) return this.json({ error: "Post not found." }, 404);
      return this.json({ item: this.post });
    }
    if (this.post && url.pathname === `/v1/posts/${this.post.id}` && method === "PATCH") {
      this.post = { ...this.post, ...payload, revision: Number(this.post.revision) + 1 };
      this.publish("post.updated", String(this.post.id), actor, "public", { itemId: this.post.id });
      return this.json({ item: this.post });
    }
    if (this.post && url.pathname === `/v1/posts/${this.post.id}` && method === "DELETE") {
      this.post = { ...this.post, body: "", deletedAt: new Date().toISOString(), revision: Number(this.post.revision) + 1 };
      this.cleanup.post += 1;
      this.publish("post.deleted", String(this.post.id), actor, "public", { itemId: this.post.id });
      return this.json({ item: this.post, deleted: { id: this.post.id } });
    }
    if (this.post && url.pathname === `/v1/posts/${this.post.id}/comments` && method === "POST") {
      const comment = {
        ...payload,
        authorHandle: actor,
        id: "20000000-0000-4000-8000-000000000002",
        revision: 1
      };
      this.post = { ...this.post, comments: [comment], revision: Number(this.post.revision) + 1 };
      this.publish("comment.created", String(this.post.id), actor, "public", {
        commentId: comment.id,
        itemId: this.post.id
      });
      return this.json({ comment, item: this.post });
    }
    if (
      this.post && method === "DELETE" &&
      url.pathname === `/v1/posts/${this.post.id}/comments/20000000-0000-4000-8000-000000000002`
    ) {
      this.cleanup.comment += 1;
      this.post = {
        ...this.post,
        comments: (this.post.comments as Record<string, unknown>[]).map((comment) => ({
          ...comment,
          body: "",
          deletedAt: new Date().toISOString()
        })),
        revision: Number(this.post.revision) + 1
      };
      this.publish("comment.deleted", "20000000-0000-4000-8000-000000000002", actor, "public", {
        commentId: "20000000-0000-4000-8000-000000000002",
        itemId: this.post.id
      });
      return this.json({ item: this.post });
    }
    if (url.pathname === "/v1/workspace/documents" && method === "POST") {
      this.document = {
        ...payload,
        id: "30000000-0000-4000-8000-000000000003",
        ownerHandle: actor,
        revision: 1
      };
      this.publish("note.document.created", String(this.document.id), actor, "private", {
        noteId: this.document.id,
        revision: 1
      });
      return this.json({ document: this.document });
    }
    if (url.pathname === "/v1/workspace" && method === "GET") {
      const documents = this.document && this.document.ownerHandle === actor ? [this.document] : [];
      return this.json({ documents, notebooks: [], workspace: null });
    }
    if (
      this.document && method === "DELETE" &&
      url.pathname === `/v1/workspace/documents/${this.document.id}`
    ) {
      const id = String(this.document.id);
      this.cleanup.workspaceDocument += 1;
      this.document = null;
      this.publish("note.document.deleted", id, actor, "private");
      return this.json({ deleted: true, noteId: id });
    }
    return this.json({ error: "Not found." }, 404);
  }) as typeof fetch;
}

const config = (): AuthenticatedCanaryConfig => ({
  baseUrl: "https://fixture.example",
  expectedRelease: "a".repeat(40),
  requestTimeoutMs: 2_000,
  settleMs: 20,
  tokenA,
  tokenB
});

const main = async () => {
  assert.throws(() => authenticatedCanaryConfigFromEnvironment({}), /acknowledge namespaced writes/);
  assert.throws(() => authenticatedCanaryConfigFromEnvironment({
    SYMPOSIUM_AUTHENTICATED_CANARY_ACK: authenticatedCanaryAcknowledgement,
    SYMPOSIUM_CANARY_TOKEN_A: tokenA,
    SYMPOSIUM_CANARY_TOKEN_B: tokenB,
    SYMPOSIUM_CANARY_EXPECTED_RELEASE: "a".repeat(40),
    SYMPOSIUM_CANARY_URL: "http://symposium-api.example"
  }), /only runs against HTTPS/);
  assert.throws(() => authenticatedCanaryConfigFromEnvironment({
    SYMPOSIUM_AUTHENTICATED_CANARY_ACK: authenticatedCanaryAcknowledgement,
    SYMPOSIUM_CANARY_TOKEN_A: tokenA,
    SYMPOSIUM_CANARY_TOKEN_B: tokenA,
    SYMPOSIUM_CANARY_EXPECTED_RELEASE: "a".repeat(40)
  }), /two distinct Clerk session tokens/);
  const parsed = authenticatedCanaryConfigFromEnvironment({
    SYMPOSIUM_AUTHENTICATED_CANARY_ACK: authenticatedCanaryAcknowledgement,
    SYMPOSIUM_CANARY_TOKEN_A: tokenA,
    SYMPOSIUM_CANARY_TOKEN_B: tokenB,
    SYMPOSIUM_CANARY_EXPECTED_RELEASE: "a".repeat(40),
    SYMPOSIUM_CANARY_URL: "https://fixture.example/"
  });
  assert.deepEqual(parsed, { ...config(), requestTimeoutMs: 20_000, settleMs: 350 });

  const healthy = new AuthenticatedCanaryFixture();
  const report = await runAuthenticatedLiveSyncCanary(config(), {
    fetchImpl: healthy.fetch,
    runId: "healthy-fixture"
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 8);
  assert.deepEqual(report.cleanup, { comment: "deleted", post: "deleted", workspaceDocument: "deleted" });
  assert.deepEqual(healthy.cleanup, { comment: 1, post: 1, workspaceDocument: 1 });
  assert.equal(healthy.document, null);
  assert.ok(healthy.post?.deletedAt);
  assert.equal(healthy.subscribers.size, 0);
  assert.equal(healthy.requests.some((request) => request.actor === null && request.path === "/v1/events/stream"), true);
  assert.equal(healthy.requests.some((request) => request.actor === "@canary_a"), true);
  assert.equal(healthy.requests.some((request) => request.actor === "@canary_b"), true);

  const duplicate = new AuthenticatedCanaryFixture({ duplicateReplay: true });
  await assert.rejects(
    runAuthenticatedLiveSyncCanary(config(), { fetchImpl: duplicate.fetch, runId: "duplicate-fixture" }),
    /reconnect replay was delivered 2 times/
  );
  assert.deepEqual(duplicate.cleanup, { comment: 1, post: 1, workspaceDocument: 0 });
  assert.equal(duplicate.subscribers.size, 0);
  assert.ok(duplicate.post?.deletedAt);

  const leaked = new AuthenticatedCanaryFixture({ leakPrivate: true });
  await assert.rejects(
    runAuthenticatedLiveSyncCanary(config(), { fetchImpl: leaked.fetch, runId: "privacy-fixture" }),
    /received an event for actor-a's private draft/
  );
  assert.deepEqual(leaked.cleanup, { comment: 1, post: 1, workspaceDocument: 1 });
  assert.equal(leaked.document, null);
  assert.equal(leaked.subscribers.size, 0);

  console.log("Authenticated multi-actor live-sync canary checks passed.");
};

void main();
