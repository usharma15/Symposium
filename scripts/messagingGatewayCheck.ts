import assert from "node:assert/strict";
import {
  SymposiumApiError,
  type SymposiumApiRequestOptions
} from "@/features/api/symposiumApiClient";
import {
  conversationDraftFromConflict,
  createMessagingGateway,
  missingMessagingResource,
  retryableMessagingFailure
} from "@/features/messages/messagingGateway";
import {
  messageDraftStorageKey,
  persistFailedMessageDraft,
  readLocalMessageDraft,
  removeLocalMessageDraft,
  writeLocalMessageDraft
} from "@/features/messages/messageDraftStorage";
import type { MessageContract } from "@/packages/contracts/src";
import { reportCheck } from "@/scripts/checkReport";

type RecordedRequest = { path: string; options: SymposiumApiRequestOptions };

const message = {
  id: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000001",
  body: "hello",
  revision: 3,
  starred: false
} as MessageContract;

const main = async () => {
  const calls: RecordedRequest[] = [];
  const request = async <T>(path: string, options: SymposiumApiRequestOptions = {}) => {
    calls.push({ path, options });
    return {} as T;
  };
  const gateway = createMessagingGateway(request);
  const conversationId = message.conversationId;
  const actorHandle = "@ada";

  assert.equal(
    gateway.attachmentUrl({ id: "attachment/1", url: null } as never, actorHandle),
    "/api/message-attachments/attachment%2F1?actorHandle=%40ada"
  );
  await gateway.searchProfiles("grace hopper", 40, actorHandle);
  await gateway.discardAttachment("attachment/1", actorHandle);
  await gateway.markRead(conversationId, actorHandle, 19);
  await gateway.listConversations(actorHandle, 24, "next cursor");
  await gateway.getMessages(conversationId, actorHandle, 50, "older cursor");
  await gateway.getConversation(conversationId, actorHandle);
  await gateway.saveDraft(conversationId, actorHandle, "draft", 4, "client-4");
  await gateway.createGroup(actorHandle, "Operators", ["@grace"]);
  await gateway.sendMessage({
    actorHandle,
    recipientHandle: "@grace",
    body: "hello",
    attachmentIds: ["attachment-1"],
    draftRevision: 4,
    draftClientVersion: "client-4"
  });
  await gateway.setStarred(message, actorHandle, true);
  await gateway.editMessage(message, actorHandle, "edited");
  await gateway.deleteMessage(message, actorHandle, "everyone");
  await gateway.changePreferences(conversationId, actorHandle, { muted: true });
  await gateway.clearConversation(conversationId, actorHandle);
  await gateway.deleteConversation(conversationId, actorHandle);
  await gateway.setBlocked(actorHandle, "@grace", true);
  await gateway.searchMessages(conversationId, actorHandle, "search words", 24, "search cursor");
  await gateway.discoverMessages(conversationId, actorHandle, "starred", 24, "media cursor");
  await gateway.addParticipants(conversationId, actorHandle, ["@grace"]);
  await gateway.updateParticipantRole(conversationId, actorHandle, "@grace", "admin");
  await gateway.removeParticipant(conversationId, actorHandle, "@grace");
  await gateway.leaveConversation(conversationId, actorHandle);
  await gateway.getMessageContext(conversationId, message.id, actorHandle);

  assert.equal(calls.length, 23);
  assert.deepEqual(calls.map(({ path, options }) => [path, options.method ?? "GET"]), [
    ["/api/profiles?q=grace+hopper&limit=40&actorHandle=%40ada", "GET"],
    ["/api/attachments/attachment%2F1?actorHandle=%40ada", "DELETE"],
    [`/api/conversations/${conversationId}/read`, "POST"],
    ["/api/conversations?limit=24&cursor=next+cursor&actorHandle=%40ada", "GET"],
    [`/api/conversations/${conversationId}/messages?limit=50&cursor=older+cursor&actorHandle=%40ada`, "GET"],
    [`/api/conversations/${conversationId}?actorHandle=%40ada`, "GET"],
    [`/api/conversations/${conversationId}/draft`, "PATCH"],
    ["/api/conversations/groups", "POST"],
    ["/api/messages", "POST"],
    [`/api/conversations/${conversationId}/messages/${message.id}/star`, "POST"],
    [`/api/conversations/${conversationId}/messages/${message.id}`, "PATCH"],
    [`/api/conversations/${conversationId}/messages/${message.id}`, "DELETE"],
    [`/api/conversations/${conversationId}/preferences`, "PATCH"],
    [`/api/conversations/${conversationId}/clear`, "POST"],
    [`/api/conversations/${conversationId}`, "DELETE"],
    ["/api/blocks", "POST"],
    [`/api/conversations/${conversationId}/search?query=search+words&limit=24&cursor=search+cursor&actorHandle=%40ada`, "GET"],
    [`/api/conversations/${conversationId}/starred?limit=24&cursor=media+cursor&actorHandle=%40ada`, "GET"],
    [`/api/conversations/${conversationId}/participants`, "POST"],
    [`/api/conversations/${conversationId}/participants/%40grace`, "PATCH"],
    [`/api/conversations/${conversationId}/participants/%40grace`, "DELETE"],
    [`/api/conversations/${conversationId}/leave`, "POST"],
    [`/api/conversations/${conversationId}/messages/${message.id}/context?actorHandle=%40ada`, "GET"]
  ]);

  assert.equal(typeof calls[6]?.options.idempotencyKey, "string");
  assert.equal(typeof calls[7]?.options.idempotencyKey, "string");
  assert.equal(typeof calls[8]?.options.idempotencyKey, "string");
  assert.deepEqual(calls[11]?.options.body, {
    actorHandle,
    mode: "everyone",
    expectedRevision: message.revision
  });
  assert.deepEqual(calls[17]?.options, { cache: "no-store" });
  assert.equal(retryableMessagingFailure(new Error("offline")), true);
  assert.equal(retryableMessagingFailure(new SymposiumApiError("bad request", { status: 400 })), false);
  assert.equal(retryableMessagingFailure(new SymposiumApiError("busy", { status: 429 })), true);
  assert.equal(missingMessagingResource(new SymposiumApiError("missing", { status: 404 })), true);
  assert.equal(missingMessagingResource(new SymposiumApiError("busy", { status: 503 })), false);
  assert.deepEqual(conversationDraftFromConflict(new SymposiumApiError("conflict", {
    status: 409,
    payload: {
      draft: {
        body: "canonical",
        revision: 8,
        clientVersion: "server-client",
        updatedAt: "2026-07-31T00:00:00.000Z"
      }
    }
  })), {
    body: "canonical",
    revision: 8,
    clientVersion: "server-client",
    updatedAt: "2026-07-31T00:00:00.000Z"
  });
  assert.equal(conversationDraftFromConflict(new SymposiumApiError("conflict", {
    status: 409,
    payload: { draft: { body: "invalid", revision: 0 } }
  })), null);

  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  let rejectWrites = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (rejectWrites) throw new Error("quota exceeded");
          values.set(key, value);
        },
        removeItem: (key: string) => {
          if (rejectWrites) throw new Error("storage unavailable");
          values.delete(key);
        }
      }
    }
  });
  try {
    const storageConversationId = "direct:@grace";
    const stored = {
      version: 1 as const,
      body: "survives refresh",
      clientVersion: "draft-client-1",
      baseRevision: 7,
      updatedAt: "2026-07-31T00:00:00.000Z",
      recovery: null
    };
    assert.equal(messageDraftStorageKey(" @Ada ", storageConversationId), "symposium:message-draft:@ada:direct:@grace");
    assert.equal(writeLocalMessageDraft(actorHandle, storageConversationId, stored), true);
    assert.deepEqual(readLocalMessageDraft(actorHandle, storageConversationId), stored);
    assert.equal(persistFailedMessageDraft({
      actorHandle,
      conversationId: storageConversationId,
      failures: [
        { sequence: 2, body: "second", baseRevision: 7, updatedAt: "2026-07-31T00:00:02.000Z" },
        { sequence: 1, body: "first", baseRevision: 6, updatedAt: "2026-07-31T00:00:01.000Z" }
      ],
      latestDraft: { revision: 9 }
    }), true);
    const recovered = readLocalMessageDraft(actorHandle, storageConversationId);
    assert.equal(recovered?.body, "first\nsecond\nsurvives refresh");
    assert.equal(recovered?.baseRevision, 9);
    assert.equal(removeLocalMessageDraft(actorHandle, storageConversationId), true);
    assert.equal(readLocalMessageDraft(actorHandle, storageConversationId), null);
    rejectWrites = true;
    assert.equal(writeLocalMessageDraft(actorHandle, storageConversationId, stored), false);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }

  reportCheck([
    "23-operation Messaging route and method authority",
    "actor, cursor, query, and identifier encoding",
    "revision and idempotency request contracts",
    "retry, missing-resource, and draft-conflict classification",
    "draft storage read, write, removal, failure, and ordered-send recovery",
    "46 direct assertions"
  ]);
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
