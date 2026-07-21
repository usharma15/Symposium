import assert from "node:assert/strict";
import { buildApp } from "@/apps/api/src/server";
import { latestMigrationId, migrationIds } from "@/apps/api/src/db/migrate";
import {
  aiUsage,
  comments,
  communities,
  conversations,
  conversationParticipants,
  documentTranslations,
  communityMemberships,
  events,
  maintenanceLeases,
  messages,
  messageStars,
  noteBlocks,
  notes,
  opportunityApplicationComments,
  opportunityApplications,
  patronageContributions,
  patronageProposals,
  posts,
  profileFollows,
  profiles,
  storageDeletionJobs,
  workspaceNotebooks,
  workspaceNoteComments,
  workspaceNoteCommentActions,
  workspaceNoteRevisions,
  workspaceNotebookGrants,
  workspaceNoteGrants
} from "@/apps/api/src/db/schema";
import { parseEventCursor } from "@/apps/api/src/services/events";
import { clerkSecretMode } from "@/apps/api/src/config/preflight";

const main = async () => {
  assert.equal(latestMigrationId, "0040_owner_daily_ai_quota_reset");
  assert.equal(clerkSecretMode("sk_test_example"), "development");
  assert.equal(clerkSecretMode("sk_live_example"), "production");
  assert.equal(clerkSecretMode(undefined), "missing");
  assert.equal(migrationIds.at(-1), latestMigrationId);
  assert.ok(migrationIds.length >= 18);
  assert.ok("audienceHandles" in events);
  assert.ok("leaseExpiresAt" in maintenanceLeases);
  assert.equal("audienceHandles" in posts, false);
  assert.ok("revision" in posts);
  assert.ok("revision" in comments);
  assert.ok("revision" in profiles);
  assert.ok("revision" in profileFollows);
  assert.ok("revision" in notes);
  assert.ok("patronage" in posts);
  assert.ok("opportunity" in posts);
  assert.ok("communityId" in posts);
  assert.ok("moderatorHandles" in communities);
  assert.ok("lastAccessedAt" in communityMemberships);
  assert.ok("revision" in conversations);
  assert.ok("nextMessageSequence" in conversations);
  assert.ok("status" in conversationParticipants);
  assert.ok("clearedThroughSequence" in conversationParticipants);
  assert.ok("sequence" in messages);
  assert.ok("revision" in messages);
  assert.ok("profileHandle" in messageStars);
  assert.ok("reservedCostMicros" in aiUsage);
  assert.ok("actualCostMicros" in aiUsage);
  assert.ok("sourceFingerprint" in documentTranslations);
  assert.ok("targetLanguage" in documentTranslations);
  assert.ok("shortlisted" in opportunityApplications);
  assert.ok("revision" in opportunityApplications);
  assert.ok("applicationId" in opportunityApplicationComments);
  assert.ok("goalMinorUnits" in patronageProposals);
  assert.ok("providerReference" in patronageContributions);
  assert.ok("revision" in noteBlocks);
  assert.ok("revision" in workspaceNotebooks);
  assert.ok("parentId" in workspaceNoteComments);
  assert.ok("action" in workspaceNoteCommentActions);
  assert.ok("revision" in workspaceNoteRevisions);
  assert.ok("role" in workspaceNotebookGrants);
  assert.ok("role" in workspaceNoteGrants);
  assert.ok("revision" in workspaceNotebookGrants);
  assert.ok("revision" in workspaceNoteGrants);
  assert.ok("objectKey" in storageDeletionJobs);
  assert.ok("leaseExpiresAt" in storageDeletionJobs);

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
          "Clerk provider mode visibility",
          "event audience schema placement",
          "authoritative entity revision schema",
          "note and note-block revision schema",
          "canonical Opportunity and private application schema",
          "durable storage-deletion queue schema",
          "durable storage-deletion worker readiness",
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
