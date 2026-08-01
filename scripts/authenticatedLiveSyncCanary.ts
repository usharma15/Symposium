import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  consumeLiveEventStream,
  type ServerSentEvent
} from "@/features/live-sync/liveEventTransport";
import { plainTextDocument } from "@/lib/documentModel";

export const authenticatedCanaryAcknowledgement =
  "authenticated-production-writes-with-automatic-cleanup";
export const defaultAuthenticatedCanaryUrl = "https://symposium-api-ue3p.onrender.com";

type Environment = Record<string, string | undefined>;
type FetchImplementation = typeof fetch;
type ActorLabel = "actor-a" | "actor-b" | "anonymous";

export type AuthenticatedCanaryConfig = {
  baseUrl: string;
  expectedRelease: string;
  requestTimeoutMs: number;
  settleMs: number;
  tokenA: string;
  tokenB: string;
};

export type AuthenticatedCanaryReport = {
  ok: true;
  release: string;
  runId: string;
  checks: string[];
  latencyMs: {
    commentFanout: number;
    privateFanout: number;
    publicFanout: number;
    reconnectReplay: number;
  };
  cleanup: {
    comment: "deleted";
    post: "deleted";
    workspaceDocument: "deleted";
  };
};

type StoredCanaryEvent = {
  actorHandle?: string;
  audienceHandles?: string[];
  createdAt: string;
  cursor: string;
  id: string;
  kind: string;
  payload?: Record<string, unknown>;
  subjectId: string;
  subjectType: string;
  visibility?: "community" | "private" | "public";
};

type JsonResponse<T> = { body: T; status: number };

const positiveInteger = (value: string | undefined, fallback: number, label: string) => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
};

export const authenticatedCanaryConfigFromEnvironment = (
  environment: Environment = process.env
): AuthenticatedCanaryConfig => {
  if (environment.SYMPOSIUM_AUTHENTICATED_CANARY_ACK !== authenticatedCanaryAcknowledgement) {
    throw new Error(
      `Set SYMPOSIUM_AUTHENTICATED_CANARY_ACK=${authenticatedCanaryAcknowledgement} to acknowledge namespaced writes and automatic cleanup.`
    );
  }
  const tokenA = environment.SYMPOSIUM_CANARY_TOKEN_A ?? "";
  const tokenB = environment.SYMPOSIUM_CANARY_TOKEN_B ?? "";
  if (tokenA.length < 20 || tokenB.length < 20) {
    throw new Error("Two short-lived Clerk session tokens are required for the authenticated canary.");
  }
  if (tokenA === tokenB) throw new Error("The authenticated canary requires two distinct Clerk session tokens.");
  const expectedRelease = environment.SYMPOSIUM_CANARY_EXPECTED_RELEASE ?? "";
  if (!/^[0-9a-f]{40}$/i.test(expectedRelease)) {
    throw new Error("SYMPOSIUM_CANARY_EXPECTED_RELEASE must be the exact 40-character backend release SHA.");
  }

  const url = new URL(environment.SYMPOSIUM_CANARY_URL ?? defaultAuthenticatedCanaryUrl);
  if (url.protocol !== "https:") throw new Error("The authenticated canary only runs against HTTPS.");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The authenticated canary URL cannot contain credentials, a query, or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");

  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    expectedRelease,
    requestTimeoutMs: positiveInteger(
      environment.SYMPOSIUM_CANARY_TIMEOUT_MS,
      20_000,
      "SYMPOSIUM_CANARY_TIMEOUT_MS"
    ),
    settleMs: positiveInteger(environment.SYMPOSIUM_CANARY_SETTLE_MS, 350, "SYMPOSIUM_CANARY_SETTLE_MS"),
    tokenA,
    tokenB
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const requireString = (label: string, value: unknown) => {
  if (typeof value !== "string" || !value) throw new Error(`${label} was missing from the canonical response.`);
  return value;
};

const requirePositiveRevision = (label: string, value: unknown) => {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} was missing from the canonical response.`);
  }
  return Number(value);
};

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class LiveObservation {
  readonly events: StoredCanaryEvent[] = [];
  readonly controller = new AbortController();
  readyCount = 0;
  failure: unknown;
  private runPromise: Promise<void> | undefined;

  constructor(
    readonly label: ActorLabel,
    private readonly fetchImpl: FetchImplementation,
    private readonly token: string | null,
    private readonly url: string
  ) {}

  start() {
    this.runPromise = consumeLiveEventStream({
      fetchImpl: this.fetchImpl,
      onEvent: (event) => this.accept(event),
      onOpen: () => undefined,
      signal: this.controller.signal,
      token: this.token,
      url: this.url
    }).catch((error: unknown) => {
      if (!this.controller.signal.aborted) this.failure = error;
    });
    return this;
  }

  private accept(event: ServerSentEvent) {
    if (event.event === "symposium-ready") {
      this.readyCount += 1;
      return;
    }
    if (event.event !== "symposium-event") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      this.failure = new Error(`${this.label} received malformed live-event JSON.`);
      return;
    }
    if (
      !isRecord(parsed) ||
      typeof parsed.id !== "string" ||
      typeof parsed.cursor !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.kind !== "string" ||
      typeof parsed.subjectId !== "string" ||
      typeof parsed.subjectType !== "string" ||
      event.id !== parsed.cursor
    ) {
      this.failure = new Error(`${this.label} received a malformed canonical live event.`);
      return;
    }
    this.events.push(parsed as StoredCanaryEvent);
  }

  matching(kind: string, subjectId: string) {
    return this.events.filter((event) => event.kind === kind && event.subjectId === subjectId);
  }

  async waitFor(
    predicate: () => boolean,
    label: string,
    timeoutMs: number
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.failure) throw new Error(`${this.label} live stream failed during ${label}.`);
      if (predicate()) return;
      await delay(20);
    }
    throw new Error(`${this.label} timed out during ${label}.`);
  }

  waitUntilReady(timeoutMs: number) {
    return this.waitFor(() => this.readyCount > 0, "stream readiness", timeoutMs);
  }

  async stop() {
    this.controller.abort();
    await this.runPromise;
  }
}

class CanaryApi {
  constructor(
    private readonly config: AuthenticatedCanaryConfig,
    private readonly fetchImpl: FetchImplementation
  ) {}

  private tokenFor(actor: ActorLabel) {
    return actor === "actor-a" ? this.config.tokenA : actor === "actor-b" ? this.config.tokenB : null;
  }

  async request<T>(
    actor: ActorLabel,
    method: "DELETE" | "GET" | "PATCH" | "POST",
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<JsonResponse<T>> {
    const token = this.tokenFor(actor);
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      method,
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${method} ${path} returned non-JSON status ${response.status}.`);
    }
    return { body: payload as T, status: response.status };
  }

  async ok<T>(
    actor: ActorLabel,
    method: "DELETE" | "GET" | "PATCH" | "POST",
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ) {
    const response = await this.request<T>(actor, method, path, body, idempotencyKey);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${method} ${path} failed with status ${response.status}.`);
    }
    return response.body;
  }

  stream(actor: ActorLabel, cursor?: string) {
    const streamUrl = new URL(`${this.config.baseUrl}/v1/events/stream`);
    if (cursor) streamUrl.searchParams.set("cursor", cursor);
    return new LiveObservation(actor, this.fetchImpl, this.tokenFor(actor), streamUrl.toString()).start();
  }
}

const eventLatency = (startedAt: number) => Math.max(0, Date.now() - startedAt);

const assertExactlyOnce = (observation: LiveObservation, kind: string, subjectId: string, label: string) => {
  const count = observation.matching(kind, subjectId).length;
  if (count !== 1) throw new Error(`${label} was delivered ${count} times; expected exactly once.`);
};

const assertNoPrivateEvent = (observation: LiveObservation, noteId: string) => {
  if (observation.events.some((event) => event.subjectId === noteId)) {
    throw new Error(`${observation.label} received an event for actor-a's private draft.`);
  }
};

const flattenComments = (comments: unknown[]): Record<string, unknown>[] => comments.flatMap((comment) => {
  if (!isRecord(comment)) return [];
  const replies = Array.isArray(comment.replies) ? flattenComments(comment.replies) : [];
  return [comment, ...replies];
});

export const runAuthenticatedLiveSyncCanary = async (
  config: AuthenticatedCanaryConfig,
  options: { fetchImpl?: FetchImplementation; runId?: string } = {}
): Promise<AuthenticatedCanaryReport> => {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const api = new CanaryApi(config, fetchImpl);
  const runId = options.runId ?? `${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const idempotency = (operation: string) => `authenticated-canary-${runId}-${operation}`;
  const checks: string[] = [];
  const streams: LiveObservation[] = [];
  let actorA: LiveObservation | undefined;
  let actorB: LiveObservation | undefined;
  let anonymous: LiveObservation | undefined;
  let postId: string | undefined;
  let commentId: string | undefined;
  let noteId: string | undefined;
  let noteRevision: number | undefined;
  let actorAHandle: string | undefined;
  let actorBHandle: string | undefined;
  let release = "";
  let cleanupComplete = false;
  const latencyMs = { commentFanout: 0, privateFanout: 0, publicFanout: 0, reconnectReplay: 0 };

  const cleanup = async (strict: boolean) => {
    const failures: string[] = [];
    if (noteId && noteRevision) {
      try {
        await api.ok("actor-a", "DELETE", `/v1/workspace/documents/${encodeURIComponent(noteId)}`, {
          expectedRevision: noteRevision
        }, idempotency("workspace-delete"));
        noteId = undefined;
        noteRevision = undefined;
      } catch {
        failures.push("workspace document");
      }
    }
    if (commentId && postId) {
      try {
        await api.ok("actor-b", "DELETE", `/v1/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, {}, idempotency("comment-delete"));
        commentId = undefined;
      } catch {
        failures.push("comment");
      }
    }
    if (postId) {
      try {
        await api.ok("actor-a", "DELETE", `/v1/posts/${encodeURIComponent(postId)}`, undefined, idempotency("post-delete"));
        postId = undefined;
      } catch {
        failures.push("post");
      }
    }
    if (strict && failures.length) throw new Error(`Automatic canary cleanup failed for: ${failures.join(", ")}.`);
    return failures;
  };

  try {
    const readiness = await api.ok<{
      issues?: unknown[];
      migrations?: { pendingMigrationIds?: unknown[] };
      ok?: boolean;
      release?: string;
      status?: string;
      strict?: boolean;
    }>("anonymous", "GET", "/readyz?probe=database");
    if (
      readiness.ok !== true || readiness.status !== "ready" || readiness.strict !== true ||
      !Array.isArray(readiness.issues) || readiness.issues.length ||
      !Array.isArray(readiness.migrations?.pendingMigrationIds) || readiness.migrations.pendingMigrationIds.length ||
      readiness.release !== config.expectedRelease
    ) {
      throw new Error("Strict deep readiness did not authorize the authenticated canary.");
    }
    release = readiness.release ?? "";
    checks.push("strict deep readiness and exact release identity");

    actorA = api.stream("actor-a");
    actorB = api.stream("actor-b");
    anonymous = api.stream("anonymous");
    streams.push(actorA, actorB, anonymous);
    await Promise.all(streams.map((stream) => stream.waitUntilReady(config.requestTimeoutMs)));
    checks.push("three isolated live streams ready");

    const publicStartedAt = Date.now();
    const createdPost = await api.ok<{ item?: Record<string, unknown> }>("actor-a", "POST", "/v1/posts", {
      body: `Authenticated live-sync canary ${runId}. This temporary public Thought is deleted automatically.`,
      kind: "thought",
      postType: "thought",
      room: "symposium",
      title: ""
    }, idempotency("post-create"));
    postId = requireString("Created post id", createdPost.item?.id);
    actorAHandle = requireString("Actor A handle", createdPost.item?.authorHandle);
    await Promise.all([
      actorA.waitFor(() => actorA!.matching("post.created", postId!).length > 0, "public post fanout", config.requestTimeoutMs),
      actorB.waitFor(() => actorB!.matching("post.created", postId!).length > 0, "public post fanout", config.requestTimeoutMs),
      anonymous.waitFor(() => anonymous!.matching("post.created", postId!).length > 0, "public post fanout", config.requestTimeoutMs)
    ]);
    latencyMs.publicFanout = eventLatency(publicStartedAt);
    await delay(config.settleMs);
    for (const stream of streams) assertExactlyOnce(stream, "post.created", postId, `${stream.label} public create`);
    checks.push("public create converged exactly once across authenticated and anonymous streams");

    const commentStartedAt = Date.now();
    const createdComment = await api.ok<{ comment?: Record<string, unknown>; item?: Record<string, unknown> }>(
      "actor-b",
      "POST",
      `/v1/posts/${encodeURIComponent(postId)}/comments`,
      { body: `Actor B convergence marker ${runId}.`, stance: "Canary" },
      idempotency("comment-create")
    );
    commentId = requireString("Created comment id", createdComment.comment?.id);
    actorBHandle = requireString("Actor B handle", createdComment.comment?.authorHandle);
    if (actorAHandle === actorBHandle) throw new Error("The two Clerk sessions resolved to the same canonical actor.");
    await Promise.all(streams.map((stream) => stream.waitFor(
      () => stream.matching("comment.created", postId!).some((event) => event.payload?.commentId === commentId),
      "comment fanout",
      config.requestTimeoutMs
    )));
    latencyMs.commentFanout = eventLatency(commentStartedAt);
    await delay(config.settleMs);
    for (const stream of streams) assertExactlyOnce(stream, "comment.created", postId, `${stream.label} comment create`);
    checks.push("two distinct canonical actors and cross-actor comment convergence");

    const persistedForA = await api.ok<{ item?: Record<string, unknown> }>("actor-a", "GET", `/v1/posts/${encodeURIComponent(postId)}`);
    const persistedForB = await api.ok<{ item?: Record<string, unknown> }>("actor-b", "GET", `/v1/posts/${encodeURIComponent(postId)}`);
    for (const [label, detail] of [["actor-a", persistedForA], ["actor-b", persistedForB]] as const) {
      const comments = Array.isArray(detail.item?.comments) ? flattenComments(detail.item.comments) : [];
      if (!comments.some((comment) =>
        comment.id === commentId &&
        comment.authorHandle === actorBHandle &&
        comment.body === `Actor B convergence marker ${runId}.`
      )) {
        throw new Error(`${label} did not read the canonical persisted comment.`);
      }
    }
    checks.push("canonical persistence read back identically for both actors");

    const actorBCursor = requireString(
      "Actor B comment cursor",
      actorB.matching("comment.created", postId)[0]?.cursor
    );
    await actorB.stop();
    streams.splice(streams.indexOf(actorB), 1);

    const firstUpdateBody = `Reconnect replay marker ${runId}.`;
    await api.ok("actor-a", "PATCH", `/v1/posts/${encodeURIComponent(postId)}`, {
      body: firstUpdateBody,
      title: ""
    }, idempotency("post-update-reconnect"));
    await Promise.all([actorA, anonymous].map((stream) => stream.waitFor(
      () => stream.matching("post.updated", postId!).length > 0,
      "online update fanout",
      config.requestTimeoutMs
    )));

    const reconnectStartedAt = Date.now();
    actorB = api.stream("actor-b", actorBCursor);
    streams.push(actorB);
    await Promise.all([
      actorB.waitFor(() => actorB!.matching("post.updated", postId!).length > 0, "cursor replay", config.requestTimeoutMs),
      actorB.waitUntilReady(config.requestTimeoutMs)
    ]);
    await delay(config.settleMs);
    latencyMs.reconnectReplay = eventLatency(reconnectStartedAt);
    assertExactlyOnce(actorB, "post.updated", postId, "actor-b reconnect replay");
    const replayedUpdate = actorB.matching("post.updated", postId)[0];
    if (!replayedUpdate || replayedUpdate.cursor <= actorBCursor) {
      throw new Error("Actor B reconnect replay did not advance its durable cursor.");
    }
    const replayReadback = await api.ok<{ item?: Record<string, unknown> }>(
      "actor-b",
      "GET",
      `/v1/posts/${encodeURIComponent(postId)}`
    );
    if (replayReadback.item?.body !== firstUpdateBody) {
      throw new Error("Actor B replay advanced but canonical readback did not contain the missed mutation.");
    }
    checks.push("offline mutation replayed from the durable cursor exactly once without reload");

    const privateStartedAt = Date.now();
    const privateDocumentBody = `Private isolation marker ${runId}.`;
    const createdDocument = await api.ok<{ document?: Record<string, unknown> }>(
      "actor-a",
      "POST",
      "/v1/workspace/documents",
      {
        attachmentIds: [],
        body: privateDocumentBody,
        document: plainTextDocument(privateDocumentBody),
        kind: "note",
        notebookId: null,
        opportunity: null,
        proposal: null,
        publicationTarget: "undecided",
        targetId: null,
        title: `Private canary ${runId}`
      },
      idempotency("workspace-create")
    );
    noteId = requireString("Private draft id", createdDocument.document?.id);
    noteRevision = requirePositiveRevision("Private draft revision", createdDocument.document?.revision);
    await actorA.waitFor(
      () => actorA!.matching("note.document.created", noteId!).length > 0,
      "private draft delivery",
      config.requestTimeoutMs
    );
    latencyMs.privateFanout = eventLatency(privateStartedAt);
    const privateCursor = requireString(
      "Private draft cursor",
      actorA.matching("note.document.created", noteId)[0]?.cursor
    );

    const markerBody = `Privacy ordering marker ${runId}.`;
    const markerCounts = new Map(streams.map((stream) => [stream.label, stream.matching("post.updated", postId!).length]));
    await api.ok("actor-a", "PATCH", `/v1/posts/${encodeURIComponent(postId)}`, {
      body: markerBody,
      title: ""
    }, idempotency("post-update-privacy-marker"));
    await Promise.all(streams.map((stream) => stream.waitFor(
      () => stream.matching("post.updated", postId!).length > (markerCounts.get(stream.label) ?? 0),
      "privacy ordering marker",
      config.requestTimeoutMs
    )));
    const actorAMarker = actorA.matching("post.updated", postId).at(-1);
    if (!actorAMarker || actorAMarker.cursor <= privateCursor) {
      throw new Error("The public privacy marker did not advance beyond the private event cursor.");
    }
    assertNoPrivateEvent(actorB, noteId);
    assertNoPrivateEvent(anonymous, noteId);
    assertExactlyOnce(actorA, "note.document.created", noteId, "actor-a private create");

    const workspaceA = await api.ok<{ documents?: Record<string, unknown>[] }>("actor-a", "GET", "/v1/workspace");
    const workspaceB = await api.ok<{ documents?: Record<string, unknown>[] }>("actor-b", "GET", "/v1/workspace");
    if (!workspaceA.documents?.some((document) => document.id === noteId && document.body === privateDocumentBody)) {
      throw new Error("Actor A could not read back the private canonical draft.");
    }
    if (workspaceB.documents?.some((document) => document.id === noteId)) {
      throw new Error("Actor B could read actor A's private canonical draft.");
    }
    checks.push("private draft visible to owner only across streams and persisted reads");

    const cleanupNoteId = noteId;
    const cleanupCommentId = commentId;
    const cleanupPostId = postId;
    await cleanup(true);
    cleanupComplete = true;
    await Promise.all([
      actorA.waitFor(() => actorA!.matching("note.document.deleted", cleanupNoteId).length > 0, "private cleanup event", config.requestTimeoutMs),
      ...streams.map((stream) => stream.waitFor(
        () => stream.matching("post.deleted", cleanupPostId).length > 0,
        "public cleanup event",
        config.requestTimeoutMs
      )),
      ...streams.map((stream) => stream.waitFor(
        () => stream.matching("comment.deleted", cleanupCommentId).length > 0,
        "comment cleanup event",
        config.requestTimeoutMs
      ))
    ]);
    assertNoPrivateEvent(actorB, cleanupNoteId);
    assertNoPrivateEvent(anonymous, cleanupNoteId);
    const workspaceAfterCleanup = await api.ok<{ documents?: Record<string, unknown>[] }>("actor-a", "GET", "/v1/workspace");
    if (workspaceAfterCleanup.documents?.some((document) => document.id === cleanupNoteId)) {
      throw new Error("The private draft remained visible after automatic cleanup.");
    }
    const postAfterCleanup = await api.request("actor-a", "GET", `/v1/posts/${encodeURIComponent(cleanupPostId)}`);
    if (postAfterCleanup.status !== 404) throw new Error("The public canary post remained readable after cleanup.");
    checks.push("automatic cleanup converged and canonical readback shows no live artifacts");

    return {
      checks,
      cleanup: { comment: "deleted", post: "deleted", workspaceDocument: "deleted" },
      latencyMs,
      ok: true,
      release,
      runId
    };
  } finally {
    const cleanupFailures = cleanupComplete ? [] : await cleanup(false);
    await Promise.all(streams.map((stream) => stream.stop()));
    if (cleanupFailures.length) {
      throw new Error(`Automatic canary cleanup failed for: ${cleanupFailures.join(", ")}.`);
    }
  }
};

const main = async () => {
  const report = await runAuthenticatedLiveSyncCanary(authenticatedCanaryConfigFromEnvironment());
  console.log(JSON.stringify(report, null, 2));
};

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Authenticated canary failed.");
    process.exitCode = 1;
  });
}
