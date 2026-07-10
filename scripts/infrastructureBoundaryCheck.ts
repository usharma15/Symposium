import assert from "node:assert/strict";
import { buildApp } from "@/apps/api/src/server";
import { latestMigrationId, migrationIds } from "@/apps/api/src/db/migrate";
import { events, posts } from "@/apps/api/src/db/schema";
import { parseEventCursor } from "@/apps/api/src/services/events";

const main = async () => {
  assert.equal(latestMigrationId, "0012_operational_integrity");
  assert.equal(migrationIds.at(-1), latestMigrationId);
  assert.ok(migrationIds.length >= 12);
  assert.ok("audienceHandles" in events);
  assert.equal("audienceHandles" in posts, false);

  const validCursor = "2026-07-10T12:00:00.000Z::00000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseEventCursor(validCursor), {
    createdAt: "2026-07-10T12:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001"
  });
  assert.equal(parseEventCursor("bad-cursor"), null);
  assert.equal(parseEventCursor(`2026-07-10T12:00:00.000Z::${"x".repeat(220)}`), null);

  const app = await buildApp({ logger: false });
  try {
    const health = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.headers["x-content-type-options"], "nosniff");
    assert.ok(health.headers["x-request-id"]);

    const invalidCursor = await app.inject({ method: "GET", url: "/v1/events?cursor=invalid" });
    assert.equal(invalidCursor.statusCode, 400);
    assert.equal(invalidCursor.headers["cache-control"], "no-store");
    assert.equal(invalidCursor.json().requestId, invalidCursor.headers["x-request-id"]);

    const invalidMutation = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: { "content-type": "application/json", "x-symposium-handle": "@boundary" },
      payload: {}
    });
    assert.equal(invalidMutation.statusCode, 400);
    assert.equal(invalidMutation.json().error, "Invalid request payload.");
    assert.equal(invalidMutation.json().requestId, invalidMutation.headers["x-request-id"]);

    const oversized = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: { "content-type": "application/json", "x-symposium-handle": "@boundary" },
      payload: { body: "x".repeat(1024 * 1024 + 1) }
    });
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.json().error, "Request body is too large.");
    assert.equal(oversized.json().requestId, oversized.headers["x-request-id"]);
  } finally {
    await app.close();
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "migration manifest visibility",
          "event audience schema placement",
          "strict event cursor parsing",
          "request correlation headers",
          "no-store API policy",
          "structured validation errors",
          "one-megabyte API body ceiling"
        ]
      },
      null,
      2
    )
  );
};

void main();

export {};
