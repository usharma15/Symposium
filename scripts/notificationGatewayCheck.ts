import assert from "node:assert/strict";
import {
  SymposiumApiError,
  type SymposiumApiRequestOptions
} from "@/features/api/symposiumApiClient";
import { createNotificationGateway } from "@/features/notifications/notificationGateway";
import { reportCheck } from "@/scripts/checkReport";

type RecordedRequest = { path: string; options: SymposiumApiRequestOptions };

const main = async () => {
  const calls: RecordedRequest[] = [];
  const request = async <T>(path: string, options: SymposiumApiRequestOptions = {}) => {
    calls.push({ path, options });
    return {} as T;
  };
  const gateway = createNotificationGateway(request);
  const actorHandle = "@Ada Lovelace/Δ";
  const notificationId = "00000000-0000-4000-8000-000000000001";
  const groupKey = "post /+?&= group";

  await gateway.list(actorHandle, 50);
  await gateway.list(actorHandle, 50, "next cursor/+?&=");
  await gateway.getUnreadCount(actorHandle);
  await gateway.getPreferences(actorHandle);
  await gateway.updatePreferences(actorHandle, 7, { commentsAndReplies: false });
  await gateway.markRead(actorHandle, notificationId, groupKey);
  await gateway.markAllRead(actorHandle);
  await gateway.archive(actorHandle, notificationId, groupKey);
  await gateway.clearRead(actorHandle);

  assert.equal(calls.length, 9);
  assert.deepEqual(calls.map(({ path, options }) => [path, options.method ?? "GET"]), [
    ["/api/notifications?actorHandle=%40Ada+Lovelace%2F%CE%94&limit=50", "GET"],
    ["/api/notifications?actorHandle=%40Ada+Lovelace%2F%CE%94&limit=50&cursor=next+cursor%2F%2B%3F%26%3D", "GET"],
    ["/api/notifications/unread?actorHandle=%40Ada+Lovelace%2F%CE%94", "GET"],
    ["/api/notifications/preferences?actorHandle=%40Ada+Lovelace%2F%CE%94", "GET"],
    ["/api/notifications/preferences", "PATCH"],
    ["/api/notifications/read", "POST"],
    ["/api/notifications/read", "POST"],
    ["/api/notifications/archive", "POST"],
    ["/api/notifications/archive", "POST"]
  ]);
  assert.equal(calls[0]?.path.includes("cursor="), false);
  for (const index of [0, 1, 2, 3]) {
    assert.deepEqual(calls[index]?.options, { cache: "no-store" });
  }
  assert.deepEqual(calls[4]?.options, {
    method: "PATCH",
    body: {
      actorHandle,
      expectedRevision: 7,
      changes: { commentsAndReplies: false }
    }
  });
  assert.deepEqual(calls[5]?.options, {
    method: "POST",
    keepalive: true,
    body: { actorHandle, notificationId, groupKey }
  });
  assert.deepEqual(calls[6]?.options, {
    method: "POST",
    body: { actorHandle, all: true }
  });
  assert.deepEqual(calls[7]?.options, {
    method: "POST",
    body: { actorHandle, notificationId, groupKey }
  });
  assert.deepEqual(calls[8]?.options, {
    method: "POST",
    body: { actorHandle, clearRead: true }
  });
  assert.deepEqual(
    calls.flatMap(({ options }, index) => options.keepalive ? [index] : []),
    [5],
    "Only the fire-and-follow single-read mutation may use keepalive."
  );

  const responseIdentity = { notifications: [], unreadCount: 0, nextCursor: null };
  const passthrough = createNotificationGateway(async <T>() => responseIdentity as T);
  assert.strictEqual(await passthrough.list(actorHandle, 50), responseIdentity);

  const failures: { operation: () => Promise<unknown>; error: unknown }[] = [
    {
      error: new SymposiumApiError("bad request", { status: 400 }),
      operation: () => Promise.resolve()
    },
    {
      error: new SymposiumApiError("server unavailable", { status: 503 }),
      operation: () => Promise.resolve()
    },
    { error: new Error("offline"), operation: () => Promise.resolve() },
    { error: { arbitrary: true }, operation: () => Promise.resolve() }
  ];
  const rejectionOperations = [
    (failedGateway: ReturnType<typeof createNotificationGateway>) => failedGateway.list(actorHandle, 50),
    (failedGateway: ReturnType<typeof createNotificationGateway>) =>
      failedGateway.updatePreferences(actorHandle, 7, { likes: false }),
    (failedGateway: ReturnType<typeof createNotificationGateway>) =>
      failedGateway.markRead(actorHandle, notificationId, groupKey),
    (failedGateway: ReturnType<typeof createNotificationGateway>) => failedGateway.clearRead(actorHandle)
  ];
  failures.forEach((failure, index) => {
    failure.operation = () => {
      const failedGateway = createNotificationGateway(async () => { throw failure.error; });
      return rejectionOperations[index]!(failedGateway);
    };
  });
  for (const failure of failures) {
    await assert.rejects(failure.operation(), (error) => error === failure.error);
  }

  reportCheck([
    "eight-operation Notifications browser transport authority",
    "nine exact list, unread, preference, read, and archive request shapes",
    "actor, cursor, limit, notification, and group identity preservation",
    "private read cache and single-read keepalive isolation",
    "preference revision and mutation body contracts",
    "resolved-value identity and exact error propagation",
    "31 direct assertions"
  ]);
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
