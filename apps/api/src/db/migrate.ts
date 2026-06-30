import { getPool, hasDatabase } from "./client";
import { fileURLToPath } from "node:url";

type Migration = {
  id: string;
  sql: string;
};

const migrations: Migration[] = [
  {
    id: "0001_live_foundation",
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clerk_user_id TEXT UNIQUE,
        primary_email TEXT,
        handle TEXT UNIQUE,
        display_name TEXT NOT NULL,
        image_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS profiles (
        handle TEXT PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        email TEXT,
        name TEXT NOT NULL,
        avatar_url TEXT,
        likes_public BOOLEAN NOT NULL DEFAULT true,
        reshares_public BOOLEAN NOT NULL DEFAULT true,
        role TEXT NOT NULL,
        location TEXT NOT NULL,
        bio TEXT NOT NULL,
        fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS communities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        field TEXT NOT NULL,
        summary TEXT NOT NULL,
        visibility TEXT NOT NULL,
        online INTEGER NOT NULL DEFAULT 0,
        member_handles JSONB NOT NULL DEFAULT '[]'::jsonb,
        keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
        seed_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
        call_status TEXT NOT NULL DEFAULT 'quiet',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS community_memberships (
        community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        profile_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (community_id, profile_handle)
      );

      CREATE TABLE IF NOT EXISTS community_channels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (community_id, kind, name)
      );

      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        room TEXT NOT NULL,
        community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        author_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        author_name TEXT NOT NULL,
        affiliation TEXT NOT NULL,
        date_label TEXT NOT NULL,
        status TEXT NOT NULL,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        gathering_reason TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        body TEXT NOT NULL,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        signals JSONB NOT NULL DEFAULT '[]'::jsonb,
        claims JSONB NOT NULL DEFAULT '[]'::jsonb,
        objections JSONB NOT NULL DEFAULT '[]'::jsonb,
        evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
        tests JSONB NOT NULL DEFAULT '[]'::jsonb,
        forks JSONB NOT NULL DEFAULT '[]'::jsonb,
        saved BOOLEAN NOT NULL DEFAULT false,
        saved_by JSONB NOT NULL DEFAULT '[]'::jsonb,
        signaled_by JSONB NOT NULL DEFAULT '[]'::jsonb,
        forked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
        visibility TEXT NOT NULL DEFAULT 'public',
        search_text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        parent_id TEXT,
        author_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        author_name TEXT NOT NULL,
        stance TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS post_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        actor_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        action TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (post_id, actor_handle, action)
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_type TEXT NOT NULL,
        owner_id TEXT,
        uploader_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        bucket TEXT NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS previews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        attachment_id UUID REFERENCES attachments(id) ON DELETE CASCADE,
        url TEXT,
        title TEXT,
        description TEXT,
        image_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS external_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        description TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind TEXT NOT NULL DEFAULT 'direct',
        title TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS conversation_participants (
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        profile_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        last_read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (conversation_id, profile_handle)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        body TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS message_reads (
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        profile_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (message_id, profile_handle)
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_handle TEXT REFERENCES profiles(handle) ON DELETE CASCADE,
        name TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (owner_handle, name)
      );

      CREATE TABLE IF NOT EXISTS notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS note_blocks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'text',
        body TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_handle TEXT REFERENCES profiles(handle) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        href TEXT,
        read_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind TEXT NOT NULL,
        actor_handle TEXT,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'public',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_handle TEXT,
        action TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        ip_hash TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS moderation_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS credit_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'symposium_credit',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (owner_type, owner_id, currency)
      );

      CREATE TABLE IF NOT EXISTS credit_ledger_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id UUID NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL UNIQUE,
        amount NUMERIC(20, 6) NOT NULL,
        reason TEXT NOT NULL,
        actor_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS bounties (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'civic',
        status TEXT NOT NULL DEFAULT 'open',
        community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,
        creator_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        amount_target NUMERIC(20, 6),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS pledges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bounty_id UUID REFERENCES bounties(id) ON DELETE CASCADE,
        pledger_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        amount NUMERIC(20, 6) NOT NULL,
        status TEXT NOT NULL DEFAULT 'pledged',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS users_clerk_user_id_idx ON users (clerk_user_id);
      CREATE INDEX IF NOT EXISTS users_handle_idx ON users (handle);
      CREATE INDEX IF NOT EXISTS profiles_user_id_idx ON profiles (user_id);
      CREATE INDEX IF NOT EXISTS profiles_name_idx ON profiles (name);
      CREATE INDEX IF NOT EXISTS communities_visibility_idx ON communities (visibility);
      CREATE INDEX IF NOT EXISTS communities_name_idx ON communities (name);
      CREATE INDEX IF NOT EXISTS community_memberships_profile_idx ON community_memberships (profile_handle);
      CREATE INDEX IF NOT EXISTS posts_room_idx ON posts (room);
      CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_handle);
      CREATE INDEX IF NOT EXISTS posts_community_idx ON posts (community_id);
      CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at DESC);
      CREATE INDEX IF NOT EXISTS posts_search_text_idx ON posts USING gin (to_tsvector('english', search_text));
      CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id);
      CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_id);
      CREATE INDEX IF NOT EXISTS comments_author_idx ON comments (author_handle);
      CREATE INDEX IF NOT EXISTS post_actions_actor_idx ON post_actions (actor_handle);
      CREATE INDEX IF NOT EXISTS attachments_owner_idx ON attachments (owner_type, owner_id);
      CREATE INDEX IF NOT EXISTS previews_attachment_idx ON previews (attachment_id);
      CREATE INDEX IF NOT EXISTS external_links_owner_idx ON external_links (owner_type, owner_id);
      CREATE INDEX IF NOT EXISTS conversation_participants_profile_idx ON conversation_participants (profile_handle);
      CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id);
      CREATE INDEX IF NOT EXISTS messages_sender_idx ON messages (sender_handle);
      CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON workspaces (owner_handle);
      CREATE INDEX IF NOT EXISTS notes_workspace_idx ON notes (workspace_id);
      CREATE INDEX IF NOT EXISTS note_blocks_note_idx ON note_blocks (note_id);
      CREATE INDEX IF NOT EXISTS notifications_profile_idx ON notifications (profile_handle);
      CREATE INDEX IF NOT EXISTS notifications_read_idx ON notifications (read_at);
      CREATE INDEX IF NOT EXISTS events_kind_idx ON events (kind);
      CREATE INDEX IF NOT EXISTS events_subject_idx ON events (subject_type, subject_id);
      CREATE INDEX IF NOT EXISTS events_actor_idx ON events (actor_handle);
      CREATE INDEX IF NOT EXISTS audit_logs_subject_idx ON audit_logs (subject_type, subject_id);
      CREATE INDEX IF NOT EXISTS moderation_reports_status_idx ON moderation_reports (status);
      CREATE INDEX IF NOT EXISTS credit_ledger_account_idx ON credit_ledger_entries (account_id);
      CREATE INDEX IF NOT EXISTS bounties_community_idx ON bounties (community_id);
      CREATE INDEX IF NOT EXISTS pledges_bounty_idx ON pledges (bounty_id);
    `
  },
  {
    id: "0002_product_loops",
    sql: `
      CREATE TABLE IF NOT EXISTS profile_follows (
        follower_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        following_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (follower_handle, following_handle),
        CHECK (follower_handle <> following_handle)
      );

      CREATE TABLE IF NOT EXISTS community_calls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        host_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'voice',
        status TEXT NOT NULL DEFAULT 'scheduled',
        starts_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        provider TEXT,
        provider_room_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS call_participants (
        call_id UUID NOT NULL REFERENCES community_calls(id) ON DELETE CASCADE,
        profile_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'participant',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        left_at TIMESTAMPTZ,
        PRIMARY KEY (call_id, profile_handle)
      );

      CREATE TABLE IF NOT EXISTS opportunity_posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'job',
        status TEXT NOT NULL DEFAULT 'open',
        creator_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,
        location TEXT,
        compensation TEXT,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS note_publications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id UUID REFERENCES notes(id) ON DELETE SET NULL,
        post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
        publisher_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'published',
        visibility TEXT NOT NULL DEFAULT 'public',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS ai_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_handle TEXT REFERENCES profiles(handle) ON DELETE CASCADE,
        title TEXT NOT NULL,
        context_type TEXT NOT NULL DEFAULT 'general',
        context_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS ai_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        body TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS profile_follows_following_idx ON profile_follows (following_handle);
      CREATE INDEX IF NOT EXISTS profile_follows_follower_idx ON profile_follows (follower_handle);
      CREATE INDEX IF NOT EXISTS community_calls_community_idx ON community_calls (community_id);
      CREATE INDEX IF NOT EXISTS community_calls_status_idx ON community_calls (status);
      CREATE INDEX IF NOT EXISTS community_calls_host_idx ON community_calls (host_handle);
      CREATE INDEX IF NOT EXISTS call_participants_profile_idx ON call_participants (profile_handle);
      CREATE INDEX IF NOT EXISTS opportunity_posts_status_idx ON opportunity_posts (status);
      CREATE INDEX IF NOT EXISTS opportunity_posts_creator_idx ON opportunity_posts (creator_handle);
      CREATE INDEX IF NOT EXISTS opportunity_posts_community_idx ON opportunity_posts (community_id);
      CREATE INDEX IF NOT EXISTS note_publications_note_idx ON note_publications (note_id);
      CREATE INDEX IF NOT EXISTS note_publications_post_idx ON note_publications (post_id);
      CREATE INDEX IF NOT EXISTS note_publications_publisher_idx ON note_publications (publisher_handle);
      CREATE INDEX IF NOT EXISTS ai_conversations_owner_idx ON ai_conversations (owner_handle);
      CREATE INDEX IF NOT EXISTS ai_conversations_context_idx ON ai_conversations (context_type, context_id);
      CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages (conversation_id);
    `
  }
];

let migrationReady: Promise<void> | null = null;

export const runMigrations = async () => {
  if (!hasDatabase()) return;

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS symposium_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const migration of migrations) {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM symposium_migrations WHERE id = $1",
        [migration.id]
      );

      if (existing.rowCount) continue;
      await client.query(migration.sql);
      await client.query("INSERT INTO symposium_migrations (id) VALUES ($1)", [migration.id]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const ensureDatabase = async () => {
  if (!migrationReady) migrationReady = runMigrations();
  await migrationReady;
};

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!hasDatabase()) {
    console.error("DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL is required to run migrations.");
    process.exit(1);
  }

  runMigrations()
    .then(() => {
      console.log("SYMPOSIUM database migrations complete.");
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
