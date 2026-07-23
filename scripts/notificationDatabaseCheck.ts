import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const databaseUrl =
  process.env.DATABASE_URL
  ?? process.env.POSTGRES_URL
  ?? process.env.POSTGRES_PRISMA_URL;

if (!databaseUrl) {
  throw new Error("A database URL is required for the isolated notification database check.");
}

const migrationSource = readFileSync("apps/api/src/db/migrate.ts", "utf8");
const migrationSql = migrationSource.match(
  /id: "0045_notification_resolution",\s+sql: `([\s\S]*?)`\s+\}/
)?.[1];
if (!migrationSql) throw new Error("Notification resolution migration not found.");

const client = new Client({
  connectionString: databaseUrl,
  application_name: "symposium-notification-isolated-check",
  ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")
    ? undefined
    : { rejectUnauthorized: false }
});

const uuid = (index: number) =>
  `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const main = async () => {
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = pg_temp");
    await client.query(`
      CREATE TEMP TABLE notifications (
        id UUID PRIMARY KEY,
        profile_handle TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Notification',
        body TEXT NOT NULL DEFAULT '',
        href TEXT,
        read_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TEMP TABLE community_memberships (
        community_id TEXT NOT NULL,
        profile_handle TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TEMP TABLE opportunity_applications (
        id UUID PRIMARY KEY,
        post_id TEXT NOT NULL,
        revision INTEGER NOT NULL
      );
      CREATE TEMP TABLE post_actions (
        post_id TEXT NOT NULL,
        actor_handle TEXT NOT NULL,
        action TEXT NOT NULL,
        active BOOLEAN NOT NULL
      );
      CREATE TEMP TABLE comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        deleted_at TIMESTAMPTZ
      );
      CREATE TEMP TABLE comment_actions (
        comment_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        actor_handle TEXT NOT NULL,
        action TEXT NOT NULL,
        active BOOLEAN NOT NULL
      );
      CREATE TEMP TABLE profile_follows (
        follower_handle TEXT NOT NULL,
        following_handle TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TEMP TABLE workspace_note_comments (
        id UUID PRIMARY KEY,
        note_id UUID NOT NULL,
        deleted_at TIMESTAMPTZ
      );
      CREATE TEMP TABLE workspace_note_comment_actions (
        comment_id UUID NOT NULL,
        note_id UUID NOT NULL,
        actor_handle TEXT NOT NULL,
        action TEXT NOT NULL,
        active BOOLEAN NOT NULL
      );
      CREATE TEMP TABLE profile_blocks (
        blocker_handle TEXT NOT NULL,
        blocked_handle TEXT NOT NULL
      );
    `);

    await client.query(`
      INSERT INTO community_memberships VALUES
        ('community-open', '@requester-open', 'requested'),
        ('community-done', '@requester-done', 'active');
      INSERT INTO opportunity_applications VALUES
        ('${uuid(101)}', 'post-opportunity-open', 1),
        ('${uuid(102)}', 'post-opportunity-done', 2);
      INSERT INTO post_actions VALUES
        ('post-live', '@actor-live', 'signal', true),
        ('post-stale', '@actor-stale', 'signal', false),
        ('post-blocked', '@actor-blocked', 'signal', true);
      INSERT INTO comments VALUES
        ('comment-live', 'post-comment', NULL),
        ('comment-deleted', 'post-comment', now());
      INSERT INTO comment_actions VALUES
        ('comment-live', 'post-comment', '@actor-live', 'signal', true),
        ('comment-deleted', 'post-comment', '@actor-stale', 'signal', false);
      INSERT INTO profile_follows VALUES
        ('@follower-live', '@owner', 'active'),
        ('@follower-stale', '@owner', 'none');
      INSERT INTO workspace_note_comments VALUES
        ('${uuid(201)}', '${uuid(301)}', NULL),
        ('${uuid(202)}', '${uuid(301)}', now());
      INSERT INTO workspace_note_comment_actions VALUES
        ('${uuid(201)}', '${uuid(301)}', '@actor-live', 'signal', true),
        ('${uuid(202)}', '${uuid(301)}', '@actor-stale', 'signal', false);
      INSERT INTO profile_blocks VALUES ('@owner', '@actor-blocked');
    `);

    const fixtures = [
      ["community-open", "community_join_request", { communityId: "community-open", requesterHandle: "@requester-open" }, false],
      ["community-done", "community_join_request", { communityId: "community-done", requesterHandle: "@requester-done" }, true],
      ["application-open", "opportunity_application_received", { postId: "post-opportunity-open", applicationId: uuid(101) }, false],
      ["application-done", "opportunity_application_received", { postId: "post-opportunity-done", applicationId: uuid(102) }, true],
      ["post-live", "post_signal", { postId: "post-live", actorHandle: "@actor-live" }, false],
      ["post-stale", "post_signal", { postId: "post-stale", actorHandle: "@actor-stale" }, true],
      ["post-blocked", "post_signal", { postId: "post-blocked", actorHandle: "@actor-blocked" }, true],
      ["comment-live", "comment_signal", { postId: "post-comment", commentId: "comment-live", actorHandle: "@actor-live" }, false],
      ["comment-stale", "comment_signal", { postId: "post-comment", commentId: "comment-deleted", actorHandle: "@actor-stale" }, true],
      ["comment-created", "post_comment", { postId: "post-comment", commentId: "comment-live", actorHandle: "@actor-live" }, false],
      ["comment-deleted", "post_comment", { postId: "post-comment", commentId: "comment-deleted", actorHandle: "@actor-stale" }, true],
      ["follow-live", "profile_followed", { followerHandle: "@follower-live" }, false],
      ["follow-stale", "profile_followed", { followerHandle: "@follower-stale" }, true],
      ["workspace-live", "workspace_comment_signal", { noteId: uuid(301), commentId: uuid(201), actorHandle: "@actor-live" }, false],
      ["workspace-stale", "workspace_comment_signal", { noteId: uuid(301), commentId: uuid(202), actorHandle: "@actor-stale" }, true],
      ["workspace-comment-live", "workspace_comment", { noteId: uuid(301), commentId: uuid(201), actorHandle: "@actor-live" }, false],
      ["workspace-comment-stale", "workspace_comment", { noteId: uuid(301), commentId: uuid(202), actorHandle: "@actor-stale" }, true]
    ] as const;

    for (const [label, kind, metadata] of fixtures) {
      await client.query(
        `INSERT INTO notifications (id, profile_handle, kind, href, metadata)
         VALUES ($1, '@owner', $2, '/old-destination', $3::jsonb)`,
        [uuid(fixtures.findIndex((fixture) => fixture[0] === label) + 1), kind, JSON.stringify({ ...metadata, fixture: label })]
      );
    }

    await client.query(migrationSql);
    await client.query(migrationSql);

    const rows = await client.query<{
      fixture: string;
      resolved: boolean;
      read: boolean;
      resolution: string | null;
      href: string | null;
    }>(`
      SELECT
        metadata ->> 'fixture' AS fixture,
        resolved_at IS NOT NULL AS resolved,
        read_at IS NOT NULL AS read,
        metadata ->> 'resolution' AS resolution,
        href
      FROM notifications
      ORDER BY metadata ->> 'fixture'
    `);
    const byFixture = new Map(rows.rows.map((row) => [row.fixture, row]));
    for (const [label, , , shouldResolve] of fixtures) {
      const row = byFixture.get(label);
      assert.ok(row, `${label} result`);
      assert.equal(row.resolved, shouldResolve, `${label} resolution`);
      assert.equal(row.read, shouldResolve, `${label} read state`);
      assert.equal(
        row.resolution,
        shouldResolve ? "migrated_source_inactive" : null,
        `${label} resolution reason`
      );
    }
    assert.equal(byFixture.get("follow-live")?.href, "/profiles/owner/followers");
    assert.equal(byFixture.get("follow-stale")?.href, "/profiles/owner/followers");

    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname LIKE 'pg_temp_%'
        AND indexname = 'notifications_profile_open_action_idx'
    `);
    assert.equal(indexes.rowCount, 1);
    console.log(`SYMPOSIUM isolated notification database checks passed (${fixtures.length} fixtures, migration rerun).`);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
};

void main();
