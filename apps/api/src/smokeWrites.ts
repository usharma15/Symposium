const baseUrl = (
  process.env.SYMPOSIUM_SMOKE_URL ??
  process.env.SYMPOSIUM_API_URL ??
  "http://localhost:4000"
).replace(/\/$/, "");

const smokeHandle = process.env.SYMPOSIUM_SMOKE_HANDLE ?? "@udayan";
const smokeName = process.env.SYMPOSIUM_SMOKE_NAME ?? "SYMPOSIUM Smoke";
const smokeToken = process.env.SYMPOSIUM_SMOKE_TOKEN;

const authHeaders = () =>
  smokeToken
    ? { authorization: `Bearer ${smokeToken}` }
    : {
        "x-symposium-handle": smokeHandle,
        "x-symposium-name": smokeName
      };

const requestJson = async <T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ status: number; body: T }> => {
  const headers = body === undefined
    ? authHeaders()
    : {
        "content-type": "application/json",
        ...authHeaders()
      };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = (await response.json()) as T;
  return { status: response.status, body: payload };
};

const assertOk = (label: string, response: { status: number; body: unknown }) => {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
};

const requireId = (label: string, value: unknown): string => {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} did not return an id: ${JSON.stringify(value)}`);
  }
  return value;
};

type ActionListKey = "savedBy" | "forkedBy";

const requireActionList = (label: string, item: Record<string, unknown> | undefined, key: ActionListKey) => {
  const value = item?.[key];
  if (!Array.isArray(value) || !value.every((handle) => typeof handle === "string")) {
    throw new Error(`${label} did not return ${key}: ${JSON.stringify(item)}`);
  }
  return [...value].sort();
};

const main = async () => {
  const bootstrap = await requestJson<{
    items?: Array<{ id?: string }>;
    communities?: Array<{ id?: string }>;
  }>("GET", "/v1/bootstrap");
  assertOk("/v1/bootstrap", bootstrap);

  const seededPostId = requireId("Seeded post", bootstrap.body.items?.[0]?.id);
  const communityId = requireId("Seeded community", bootstrap.body.communities?.[0]?.id);
  const stamp = new Date().toISOString();

  const createdPost = await requestJson<{ item?: { id?: string; savedBy?: string[]; forkedBy?: string[] } }>("POST", "/v1/posts", {
    title: `Smoke write verification ${stamp}`,
    body: "Verifies the SYMPOSIUM REST write route wiring after backend refactors.",
    kind: "thought",
    room: "symposium"
  });
  assertOk("POST /v1/posts", createdPost);
  const createdPostId = requireId("Created post", createdPost.body.item?.id);

  const verifyPostActionPersistence = async (action: "save" | "fork", key: ActionListKey) => {
    const activated = await requestJson<{ item?: Record<string, unknown> }>(
      "POST",
      `/v1/posts/${createdPostId}/actions`,
      { action, active: true }
    );
    assertOk(`Activate ${action}`, activated);
    const activeHandles = requireActionList(`Activate ${action}`, activated.body.item, key);
    if (activeHandles.length !== 1) {
      throw new Error(`Activate ${action} returned an unexpected ${key}: ${JSON.stringify(activeHandles)}`);
    }

    const persistedActive = await requestJson<{ items?: Array<Record<string, unknown>> }>("GET", "/v1/bootstrap");
    assertOk(`Persist ${action}`, persistedActive);
    const persistedActiveItem = persistedActive.body.items?.find((item) => item.id === createdPostId);
    const persistedActiveHandles = requireActionList(`Persist ${action}`, persistedActiveItem, key);
    if (JSON.stringify(persistedActiveHandles) !== JSON.stringify(activeHandles)) {
      throw new Error(`${action} did not persist: ${JSON.stringify({ activeHandles, persistedActiveHandles })}`);
    }

    const deactivated = await requestJson<{ item?: Record<string, unknown> }>(
      "POST",
      `/v1/posts/${createdPostId}/actions`,
      { action, active: false }
    );
    assertOk(`Deactivate ${action}`, deactivated);
    const inactiveHandles = requireActionList(`Deactivate ${action}`, deactivated.body.item, key);
    if (inactiveHandles.length) {
      throw new Error(`Deactivate ${action} left stale ${key}: ${JSON.stringify(inactiveHandles)}`);
    }

    const persistedInactive = await requestJson<{ items?: Array<Record<string, unknown>> }>("GET", "/v1/bootstrap");
    assertOk(`Persist ${action} removal`, persistedInactive);
    const persistedInactiveItem = persistedInactive.body.items?.find((item) => item.id === createdPostId);
    const persistedInactiveHandles = requireActionList(`Persist ${action} removal`, persistedInactiveItem, key);
    if (persistedInactiveHandles.length) {
      throw new Error(`${action} removal did not persist: ${JSON.stringify(persistedInactiveHandles)}`);
    }
  };

  await verifyPostActionPersistence("save", "savedBy");
  await verifyPostActionPersistence("fork", "forkedBy");

  const comment = await requestJson<{ comment?: { id?: string } }>("POST", `/v1/posts/${seededPostId}/comments`, {
    body: `Smoke comment verification ${stamp}`,
    stance: "Verification"
  });
  assertOk("POST /v1/posts/:id/comments", comment);

  const call = await requestJson<{ call?: { id?: string } }>("POST", `/v1/communities/${communityId}/calls`, {
    title: `Smoke call ${stamp}`,
    kind: "voice",
    startsAt: stamp
  });
  assertOk("POST /v1/communities/:id/calls", call);
  const callId = requireId("Created call", call.body.call?.id);

  const joinedCall = await requestJson("POST", `/v1/calls/${callId}/join`);
  assertOk("POST /v1/calls/:id/join", joinedCall);

  const endedCall = await requestJson("POST", `/v1/calls/${callId}/end`);
  assertOk("POST /v1/calls/:id/end", endedCall);

  const opportunity = await requestJson<{ opportunity?: { id?: string } }>("POST", "/v1/opportunities", {
    title: `Smoke opportunity ${stamp}`,
    body: "Verifies opportunity creation through the REST API.",
    kind: "collaboration",
    status: "open",
    communityId,
    location: "Remote",
    compensation: "Verification",
    tags: ["smoke"]
  });
  assertOk("POST /v1/opportunities", opportunity);

  const block = await requestJson<{ block?: { id?: string } }>("POST", "/v1/notes/blocks", {
    body: `Smoke note block ${stamp}`,
    visibility: "private"
  });
  assertOk("POST /v1/notes/blocks", block);

  const publication = await requestJson<{ item?: { id?: string } }>("POST", "/v1/notes/publish", {
    title: `Smoke paper ${stamp}`,
    body: "Verifies note publishing can still create a paper-shaped post.",
    visibility: "public"
  });
  assertOk("POST /v1/notes/publish", publication);

  const assistant = await requestJson<{ conversationId?: string; status?: string }>("POST", "/v1/assistant/messages", {
    message: "Verify the assistant route after REST route module extraction.",
    contextType: "general"
  });
  assertOk("POST /v1/assistant/messages", assistant);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        actor: smokeToken ? "bearer-token" : smokeHandle,
        seededPostId,
        createdPostId,
        callId,
        opportunityId: opportunity.body.opportunity?.id,
        noteBlockId: block.body.block?.id,
        publicationPostId: publication.body.item?.id,
        assistantStatus: assistant.body.status
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
