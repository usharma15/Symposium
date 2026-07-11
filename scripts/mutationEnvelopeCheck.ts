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

  const postRoutes = readFileSync("apps/api/src/routes/postRoutes.ts", "utf8");
  for (const scope of ["post.update", "post.delete", "comment.update", "comment.delete"]) {
    assert.match(postRoutes, new RegExp(`mutationContextFromRequest\\(request, "${scope.replace(".", "\\.")}"`));
  }
  const postProxy = readFileSync("app/api/posts/[id]/route.ts", "utf8");
  const commentProxy = readFileSync("app/api/posts/[id]/comments/[commentId]/route.ts", "utf8");
  const profileRoutes = readFileSync("apps/api/src/routes/profileRoutes.ts", "utf8");
  const profileProxy = readFileSync("app/api/profiles/route.ts", "utf8");
  const followProxy = readFileSync("app/api/profiles/[handle]/follow/route.ts", "utf8");
  for (const scope of ["profile.upsert", "profile.follow", "profile.unfollow"]) {
    assert.match(profileRoutes, new RegExp(`mutationContextFromRequest\\(request, "${scope.replace(".", "\\.")}"`));
  }
  assert.equal((postProxy.match(/idempotencyKey/g) ?? []).length >= 4, true);
  assert.equal((commentProxy.match(/idempotencyKey/g) ?? []).length >= 4, true);
  assert.equal((profileProxy.match(/idempotencyKey/g) ?? []).length >= 2, true);
  assert.equal((followProxy.match(/idempotencyKey/g) ?? []).length >= 4, true);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "stable mutation hashing",
          "idempotency key validation",
          "response replay",
          "payload conflict rejection",
          "transactional event staging",
          "private event audience defaults",
          "edit and delete idempotency coverage",
          "profile and follow idempotency coverage"
        ]
      },
      null,
      2
    )
  );
};

void main();

export {};
