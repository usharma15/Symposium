import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { reportCheck } from "@/scripts/checkReport";
import { buildApp } from "@/apps/api/src/server";
import {
  latestMigrationId,
  migrationIds,
  migrations
} from "@/apps/api/src/db/migrate";
import { parseEventCursor } from "@/apps/api/src/services/events";
import { clerkSecretMode } from "@/apps/api/src/config/preflight";

const main = async () => {
  const renderBlueprint = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  const packageManifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  assert.equal(existsSync(new URL("../apps/api/src/db/schema.ts", import.meta.url)), false);
  assert.equal(packageManifest.scripts?.["db:generate"], undefined);
  assert.equal(packageManifest.scripts?.["db:push"], undefined);
  assert.equal(packageManifest.dependencies?.["drizzle-orm"], undefined);
  assert.equal(packageManifest.devDependencies?.["drizzle-kit"], undefined);
  assert.match(renderBlueprint, /autoDeployTrigger: commit/);
  assert.doesNotMatch(renderBlueprint, /autoDeployTrigger: checksPass/);
  assert.equal(latestMigrationId, "0066_assistant_context_configuration");
  assert.equal(migrationIds.length, 66);
  const migrationSql = migrations.map((migration) => migration.sql).join("\n");
  const commentDeletionMigration = migrations.find(
    ({ id }) => id === "0065_comment_deletion_reconciliation"
  );
  assert.ok(commentDeletionMigration);
  assert.match(commentDeletionMigration.sql, /WHERE deleted IS TRUE[\s\S]*deleted_at IS NULL/);
  assert.match(commentDeletionMigration.sql, /DROP COLUMN IF EXISTS deleted/);
  const assistantContextConfigurationMigration = migrations.find(
    ({ id }) => id === "0066_assistant_context_configuration"
  );
  assert.ok(assistantContextConfigurationMigration);
  assert.match(assistantContextConfigurationMigration.sql, /context_configuration JSONB NOT NULL DEFAULT/);
  assert.match(assistantContextConfigurationMigration.sql, /ai_conversations_context_configuration_check/);
  assert.equal(clerkSecretMode("sk_test_example"), "development");
  assert.equal(clerkSecretMode("sk_live_example"), "production");
  assert.equal(clerkSecretMode(undefined), "missing");
  assert.equal(migrationIds.at(-1), latestMigrationId);
  for (const invariant of [
    /ALTER TABLE events ADD COLUMN IF NOT EXISTS audience_handles/,
    /CREATE TABLE IF NOT EXISTS maintenance_leases[\s\S]*lease_expires_at/,
    /ALTER TABLE posts ADD COLUMN IF NOT EXISTS revision/,
    /ALTER TABLE comments ADD COLUMN IF NOT EXISTS revision/,
    /ALTER TABLE profiles ADD COLUMN IF NOT EXISTS revision/,
    /ALTER TABLE profile_follows ADD COLUMN IF NOT EXISTS revision/,
    /ALTER TABLE notes ADD COLUMN IF NOT EXISTS revision/,
    /ALTER TABLE posts ADD COLUMN IF NOT EXISTS patronage/,
    /ALTER TABLE posts ADD COLUMN IF NOT EXISTS opportunity/,
    /community_id TEXT REFERENCES communities/,
    /ALTER TABLE communities ADD COLUMN IF NOT EXISTS moderator_handles/,
    /ALTER TABLE community_memberships ADD COLUMN IF NOT EXISTS last_accessed_at/,
    /ALTER TABLE conversations ADD COLUMN IF NOT EXISTS revision/,
    /next_message_sequence BIGINT/,
    /ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS status/,
    /cleared_through_sequence BIGINT/,
    /sequence BIGINT/,
    /ALTER TABLE messages ADD COLUMN IF NOT EXISTS revision/,
    /CREATE TABLE IF NOT EXISTS message_stars[\s\S]*profile_handle/,
    /ALTER TABLE notifications\s+ADD COLUMN IF NOT EXISTS resolved_at/,
    /CREATE TABLE IF NOT EXISTS notification_preferences[\s\S]*activity_enabled BOOLEAN/,
    /notification_preferences[\s\S]*revision INTEGER NOT NULL DEFAULT 1/,
    /reserved_cost_micros BIGINT/,
    /actual_cost_micros BIGINT/,
    /vision_input_count INTEGER/,
    /ALTER TABLE ai_conversations\s+ADD COLUMN IF NOT EXISTS last_message_at/,
    /CREATE TABLE IF NOT EXISTS document_translations[\s\S]*source_fingerprint/,
    /CREATE TABLE IF NOT EXISTS content_translations[\s\S]*source_fingerprint/,
    /CREATE TABLE IF NOT EXISTS content_translations[\s\S]*source_revision INTEGER/,
    /ALTER TABLE content_translations\s+ADD COLUMN IF NOT EXISTS translated_document/,
    /target_language TEXT/,
    /CREATE TABLE IF NOT EXISTS opportunity_applications[\s\S]*shortlisted BOOLEAN/,
    /CREATE TABLE IF NOT EXISTS opportunity_applications[\s\S]*revision INTEGER/,
    /CREATE TABLE IF NOT EXISTS opportunity_application_comments[\s\S]*application_id/,
    /CREATE TABLE IF NOT EXISTS patronage_proposals[\s\S]*goal_minor_units/,
    /CREATE TABLE IF NOT EXISTS patronage_contributions[\s\S]*provider_reference/,
    /ALTER TABLE note_blocks\s+ADD COLUMN IF NOT EXISTS revision/,
    /CREATE TABLE IF NOT EXISTS workspace_note_comments[\s\S]*parent_id/,
    /CREATE TABLE IF NOT EXISTS workspace_note_comment_actions[\s\S]*action/,
    /CREATE TABLE IF NOT EXISTS workspace_note_revisions[\s\S]*revision/,
    /CREATE TABLE IF NOT EXISTS workspace_notebook_grants[\s\S]*role/,
    /CREATE TABLE IF NOT EXISTS workspace_note_grants[\s\S]*role/,
    /workspace_notebook_grants ADD COLUMN IF NOT EXISTS revision/,
    /workspace_note_grants ADD COLUMN IF NOT EXISTS revision/,
    /CREATE TABLE IF NOT EXISTS storage_deletion_jobs[\s\S]*object_key/,
    /CREATE TABLE IF NOT EXISTS storage_deletion_jobs[\s\S]*lease_expires_at/
  ]) assert.match(migrationSql, invariant);
  assert.doesNotMatch(migrationSql, /ALTER TABLE posts ADD COLUMN IF NOT EXISTS audience_handles/);

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

  reportCheck([
    "single executable migration authority",
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
  ]);
};

void main();

export {};
