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
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: T }> => {
  const headers = body === undefined
    ? authHeaders()
    : {
        "content-type": "application/json",
        ...authHeaders(),
        ...extraHeaders
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
type CanonicalActivity = {
  subjectType: "post" | "comment";
  subjectId: string;
  postId: string;
  actorHandle: string;
  action: "save" | "signal" | "fork";
  active: boolean;
  count: number;
  revision: number;
};

const requireActionList = (label: string, item: Record<string, unknown> | undefined, key: ActionListKey) => {
  const value = item?.[key];
  if (!Array.isArray(value) || !value.every((handle) => typeof handle === "string")) {
    throw new Error(`${label} did not return ${key}: ${JSON.stringify(item)}`);
  }
  return [...value].sort();
};

const requireCanonicalActivity = (label: string, value: unknown): CanonicalActivity => {
  const activity = value as Partial<CanonicalActivity> | undefined;
  if (
    !activity ||
    (activity.subjectType !== "post" && activity.subjectType !== "comment") ||
    typeof activity.subjectId !== "string" ||
    typeof activity.postId !== "string" ||
    typeof activity.actorHandle !== "string" ||
    (activity.action !== "save" && activity.action !== "signal" && activity.action !== "fork") ||
    typeof activity.active !== "boolean" ||
    typeof activity.count !== "number" ||
    typeof activity.revision !== "number"
  ) {
    throw new Error(`${label} did not return canonical activity: ${JSON.stringify(value)}`);
  }
  return activity as CanonicalActivity;
};

const main = async () => {
  const bootstrap = await requestJson<{
    items?: Array<{ id?: string }>;
    communities?: Array<{ id?: string; visibility?: string }>;
    profiles?: Record<string, unknown>;
  }>("GET", "/v1/bootstrap");
  assertOk("/v1/bootstrap", bootstrap);

  const seededPostId = requireId("Seeded post", bootstrap.body.items?.[0]?.id);
  const communityId = requireId(
    "Seeded community",
    bootstrap.body.communities?.find((community) => community.visibility === "public")?.id ??
      bootstrap.body.communities?.[0]?.id
  );
  const alternateHandle = Object.keys(bootstrap.body.profiles ?? {}).find((handle) => handle !== smokeHandle);
  const stamp = new Date().toISOString();

  const createPostPayload = {
    title: `Smoke write verification ${stamp}`,
    body: "Verifies the SYMPOSIUM REST write route wiring after backend refactors.",
    kind: "thought",
    room: "symposium"
  };
  const createPostKey = `smoke-post-${Date.now().toString(36)}`;
  const createdPost = await requestJson<{ item?: { id?: string; savedBy?: string[]; forkedBy?: string[] } }>(
    "POST",
    "/v1/posts",
    createPostPayload,
    { "idempotency-key": createPostKey }
  );
  assertOk("POST /v1/posts", createdPost);
  const createdPostId = requireId("Created post", createdPost.body.item?.id);

  const replayedPost = await requestJson<{ item?: { id?: string } }>(
    "POST",
    "/v1/posts",
    createPostPayload,
    { "idempotency-key": createPostKey }
  );
  assertOk("Replay POST /v1/posts", replayedPost);
  if (replayedPost.body.item?.id !== createdPostId) {
    throw new Error(`Post idempotency replay diverged: ${JSON.stringify(replayedPost.body)}`);
  }

  const conflictingPost = await requestJson<{ error?: string }>(
    "POST",
    "/v1/posts",
    { ...createPostPayload, title: `${createPostPayload.title} conflict` },
    { "idempotency-key": createPostKey }
  );
  if (conflictingPost.status !== 409) {
    throw new Error(`Conflicting idempotency payload returned ${conflictingPost.status}.`);
  }

  const verifyPostActionPersistence = async (action: "save" | "fork", key: ActionListKey) => {
    const activationKey = `smoke-${action}-${Date.now().toString(36)}`;
    const activated = await requestJson<{ item?: Record<string, unknown>; activity?: unknown }>(
      "POST",
      `/v1/posts/${createdPostId}/actions`,
      { action, active: true },
      { "idempotency-key": activationKey }
    );
    assertOk(`Activate ${action}`, activated);
    const activeActivity = requireCanonicalActivity(`Activate ${action}`, activated.body.activity);
    if (
      !activeActivity.active ||
      activeActivity.count !== 1 ||
      activeActivity.action !== action ||
      activeActivity.postId !== createdPostId
    ) {
      throw new Error(`Activate ${action} returned inconsistent activity: ${JSON.stringify(activeActivity)}`);
    }
    const activeHandles = requireActionList(`Activate ${action}`, activated.body.item, key);
    if (activeHandles.length !== 1) {
      throw new Error(`Activate ${action} returned an unexpected ${key}: ${JSON.stringify(activeHandles)}`);
    }

    const replayedActivation = await requestJson<{ item?: Record<string, unknown>; activity?: unknown }>(
      "POST",
      `/v1/posts/${createdPostId}/actions`,
      { action, active: true },
      { "idempotency-key": activationKey }
    );
    assertOk(`Replay ${action}`, replayedActivation);
    const replayedActivity = requireCanonicalActivity(`Replay ${action}`, replayedActivation.body.activity);
    if (replayedActivity.revision !== activeActivity.revision) {
      throw new Error(`${action} replay advanced revision: ${JSON.stringify(replayedActivity)}`);
    }

    const persistedActive = await requestJson<{ items?: Array<Record<string, unknown>> }>("GET", "/v1/bootstrap");
    assertOk(`Persist ${action}`, persistedActive);
    const persistedActiveItem = persistedActive.body.items?.find((item) => item.id === createdPostId);
    const persistedActiveHandles = requireActionList(`Persist ${action}`, persistedActiveItem, key);
    if (JSON.stringify(persistedActiveHandles) !== JSON.stringify(activeHandles)) {
      throw new Error(`${action} did not persist: ${JSON.stringify({ activeHandles, persistedActiveHandles })}`);
    }

    const activeProjection = await requestJson<{ entries?: CanonicalActivity[] }>(
      "GET",
      `/v1/profiles/${encodeURIComponent(activeActivity.actorHandle)}/activity?limit=500`
    );
    assertOk(`Project ${action}`, activeProjection);
    const projectedActive = activeProjection.body.entries?.find(
      (entry) => entry.subjectType === "post" && entry.subjectId === createdPostId && entry.action === action
    );
    if (!projectedActive?.active || projectedActive.revision !== activeActivity.revision) {
      throw new Error(`${action} projection was not canonical: ${JSON.stringify(projectedActive)}`);
    }

    const deactivated = await requestJson<{ item?: Record<string, unknown>; activity?: unknown }>(
      "POST",
      `/v1/posts/${createdPostId}/actions`,
      { action, active: false }
    );
    assertOk(`Deactivate ${action}`, deactivated);
    const inactiveActivity = requireCanonicalActivity(`Deactivate ${action}`, deactivated.body.activity);
    if (inactiveActivity.active || inactiveActivity.count !== 0 || inactiveActivity.revision <= activeActivity.revision) {
      throw new Error(`${action} deactivation did not advance revision: ${JSON.stringify(inactiveActivity)}`);
    }
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
    const inactiveProjection = await requestJson<{ entries?: CanonicalActivity[] }>(
      "GET",
      `/v1/profiles/${encodeURIComponent(activeActivity.actorHandle)}/activity?limit=500`
    );
    assertOk(`Project ${action} removal`, inactiveProjection);
    const projectedInactive = inactiveProjection.body.entries?.find(
      (entry) => entry.subjectType === "post" && entry.subjectId === createdPostId && entry.action === action
    );
    if (projectedInactive?.active !== false || projectedInactive.revision !== inactiveActivity.revision) {
      throw new Error(`${action} removal projection was stale: ${JSON.stringify(projectedInactive)}`);
    }
  };

  await verifyPostActionPersistence("save", "savedBy");
  await verifyPostActionPersistence("fork", "forkedBy");

  const commentPayload = {
    body: `Smoke comment verification ${stamp}`,
    stance: "Verification"
  };
  const commentKey = `smoke-comment-${Date.now().toString(36)}`;
  const comment = await requestJson<{ comment?: { id?: string } }>(
    "POST",
    `/v1/posts/${seededPostId}/comments`,
    commentPayload,
    { "idempotency-key": commentKey }
  );
  assertOk("POST /v1/posts/:id/comments", comment);
  const commentId = requireId("Created comment", comment.body.comment?.id);
  const replayedComment = await requestJson<{ comment?: { id?: string } }>(
    "POST",
    `/v1/posts/${seededPostId}/comments`,
    commentPayload,
    { "idempotency-key": commentKey }
  );
  assertOk("Replay POST /v1/posts/:id/comments", replayedComment);
  if (replayedComment.body.comment?.id !== commentId) {
    throw new Error(`Comment idempotency replay diverged: ${JSON.stringify(replayedComment.body)}`);
  }

  const callPayload = {
    title: `Smoke call ${stamp}`,
    kind: "voice",
    startsAt: stamp
  };
  const callKey = `smoke-call-${Date.now().toString(36)}`;
  const call = await requestJson<{ call?: { id?: string } }>(
    "POST",
    `/v1/communities/${communityId}/calls`,
    callPayload,
    { "idempotency-key": callKey }
  );
  assertOk("POST /v1/communities/:id/calls", call);
  const callId = requireId("Created call", call.body.call?.id);
  const replayedCall = await requestJson<{ call?: { id?: string } }>(
    "POST",
    `/v1/communities/${communityId}/calls`,
    callPayload,
    { "idempotency-key": callKey }
  );
  assertOk("Replay community call", replayedCall);
  if (replayedCall.body.call?.id !== callId) throw new Error("Community call replay diverged.");

  const joinedCall = await requestJson("POST", `/v1/calls/${callId}/join`);
  assertOk("POST /v1/calls/:id/join", joinedCall);

  if (!smokeToken && alternateHandle) {
    const unauthorizedEnd = await requestJson<{ error?: string }>(
      "POST",
      `/v1/calls/${callId}/end`,
      {},
      { "x-symposium-handle": alternateHandle, "x-symposium-name": "Boundary actor" }
    );
    if (unauthorizedEnd.status !== 403) {
      throw new Error(`Non-host call end returned ${unauthorizedEnd.status}.`);
    }
  }

  const endedCall = await requestJson("POST", `/v1/calls/${callId}/end`);
  assertOk("POST /v1/calls/:id/end", endedCall);

  const opportunityPayload = {
    title: `Smoke opportunity ${stamp}`,
    body: "Verifies opportunity creation through the REST API.",
    kind: "collaboration",
    status: "open",
    communityId,
    location: "Remote",
    compensation: "Verification",
    tags: ["smoke"]
  };
  const opportunityKey = `smoke-opportunity-${Date.now().toString(36)}`;
  const opportunity = await requestJson<{ opportunity?: { id?: string } }>(
    "POST",
    "/v1/opportunities",
    opportunityPayload,
    { "idempotency-key": opportunityKey }
  );
  assertOk("POST /v1/opportunities", opportunity);
  const opportunityId = requireId("Created opportunity", opportunity.body.opportunity?.id);
  const replayedOpportunity = await requestJson<{ opportunity?: { id?: string } }>(
    "POST",
    "/v1/opportunities",
    opportunityPayload,
    { "idempotency-key": opportunityKey }
  );
  assertOk("Replay opportunity", replayedOpportunity);
  if (replayedOpportunity.body.opportunity?.id !== opportunityId) throw new Error("Opportunity replay diverged.");

  let messageId: string | undefined;
  if (alternateHandle) {
    const messagePayload = {
      recipientHandle: alternateHandle,
      body: `Smoke direct message ${stamp}`
    };
    const messageKey = `smoke-message-${Date.now().toString(36)}`;
    const message = await requestJson<{
      message?: { conversationId?: string; id?: string };
    }>("POST", "/v1/messages", messagePayload, { "idempotency-key": messageKey });
    assertOk("POST /v1/messages", message);
    messageId = requireId("Created message", message.body.message?.id);
    const conversationId = requireId("Created conversation", message.body.message?.conversationId);
    const replayedMessage = await requestJson<{ message?: { id?: string } }>(
      "POST",
      "/v1/messages",
      messagePayload,
      { "idempotency-key": messageKey }
    );
    assertOk("Replay direct message", replayedMessage);
    if (replayedMessage.body.message?.id !== messageId) throw new Error("Message replay diverged.");

    if (!smokeToken) {
      const outsiderHandle = Object.keys(bootstrap.body.profiles ?? {}).find(
        (handle) => handle !== smokeHandle && handle !== alternateHandle
      );
      if (outsiderHandle) {
        const foreignMessage = await requestJson<{ error?: string }>(
          "POST",
          "/v1/messages",
          { conversationId, body: "Cross-conversation write attempt" },
          { "x-symposium-handle": outsiderHandle, "x-symposium-name": "Boundary actor" }
        );
        if (foreignMessage.status !== 404) {
          throw new Error(`Foreign conversation write returned ${foreignMessage.status}.`);
        }
      }
    }
  }

  const blockPayload = {
    body: `Smoke note block ${stamp}`,
    visibility: "private"
  };
  const blockKey = `smoke-block-${Date.now().toString(36)}`;
  const block = await requestJson<{ block?: { id?: string } }>(
    "POST",
    "/v1/notes/blocks",
    blockPayload,
    { "idempotency-key": blockKey }
  );
  assertOk("POST /v1/notes/blocks", block);
  const blockId = requireId("Created note block", block.body.block?.id);
  const replayedBlock = await requestJson<{ block?: { id?: string } }>(
    "POST",
    "/v1/notes/blocks",
    blockPayload,
    { "idempotency-key": blockKey }
  );
  assertOk("Replay note block", replayedBlock);
  if (replayedBlock.body.block?.id !== blockId) throw new Error("Note block replay diverged.");

  if (!smokeToken && alternateHandle) {
    const foreignBlock = await requestJson<{ error?: string }>(
      "POST",
      "/v1/notes/blocks",
      { blockId, body: "Cross-owner write attempt", visibility: "private" },
      { "x-symposium-handle": alternateHandle, "x-symposium-name": "Boundary actor" }
    );
    if (foreignBlock.status !== 404) throw new Error(`Foreign note block write returned ${foreignBlock.status}.`);
  }

  const publicationPayload = {
    title: `Smoke paper ${stamp}`,
    body: "Verifies note publishing can still create a paper-shaped post.",
    visibility: "public"
  };
  const publicationKey = `smoke-publication-${Date.now().toString(36)}`;
  const publication = await requestJson<{ item?: { id?: string } }>(
    "POST",
    "/v1/notes/publish",
    publicationPayload,
    { "idempotency-key": publicationKey }
  );
  assertOk("POST /v1/notes/publish", publication);
  const publicationPostId = requireId("Published note post", publication.body.item?.id);
  const replayedPublication = await requestJson<{ item?: { id?: string } }>(
    "POST",
    "/v1/notes/publish",
    publicationPayload,
    { "idempotency-key": publicationKey }
  );
  assertOk("Replay note publication", replayedPublication);
  if (replayedPublication.body.item?.id !== publicationPostId) throw new Error("Note publication replay diverged.");

  const assistantPayload = {
    message: "Verify the assistant route after REST route module extraction.",
    contextType: "general"
  };
  const assistantKey = `smoke-assistant-${Date.now().toString(36)}`;
  const assistant = await requestJson<{ conversationId?: string; message?: { id?: string }; status?: string }>(
    "POST",
    "/v1/assistant/messages",
    assistantPayload,
    { "idempotency-key": assistantKey }
  );
  assertOk("POST /v1/assistant/messages", assistant);
  const assistantConversationId = requireId("Assistant conversation", assistant.body.conversationId);
  const assistantMessageId = requireId("Assistant message", assistant.body.message?.id);
  const replayedAssistant = await requestJson<{ conversationId?: string; message?: { id?: string } }>(
    "POST",
    "/v1/assistant/messages",
    assistantPayload,
    { "idempotency-key": assistantKey }
  );
  assertOk("Replay assistant message", replayedAssistant);
  if (replayedAssistant.body.message?.id !== assistantMessageId) throw new Error("Assistant replay diverged.");

  if (!smokeToken && alternateHandle) {
    const foreignAssistant = await requestJson<{ error?: string }>(
      "POST",
      "/v1/assistant/messages",
      { conversationId: assistantConversationId, message: "Cross-owner write attempt", contextType: "general" },
      { "x-symposium-handle": alternateHandle, "x-symposium-name": "Boundary actor" }
    );
    if (foreignAssistant.status !== 404) {
      throw new Error(`Foreign assistant conversation write returned ${foreignAssistant.status}.`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        actor: smokeToken ? "bearer-token" : smokeHandle,
        seededPostId,
        createdPostId,
        callId,
        opportunityId,
        messageId,
        noteBlockId: blockId,
        publicationPostId,
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
