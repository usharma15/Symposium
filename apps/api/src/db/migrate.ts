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
        edited_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ,
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

      CREATE TABLE IF NOT EXISTS content_views (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        actor_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        bucket_start TIMESTAMPTZ NOT NULL,
        trigger TEXT,
        surface TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (target_type, target_id, actor_handle, bucket_start)
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
      CREATE INDEX IF NOT EXISTS content_views_target_idx ON content_views (target_type, target_id);
      CREATE INDEX IF NOT EXISTS content_views_actor_idx ON content_views (actor_handle);
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
  },
  {
    id: "0003_canonicalize_udayan_handle",
    sql: `
      DO $$
      DECLARE
        legacy_handle CONSTANT TEXT := '@usharma';
        canonical_handle CONSTANT TEXT := '@udayan';
      BEGIN
        IF EXISTS (SELECT 1 FROM profiles WHERE handle = legacy_handle)
           AND NOT EXISTS (SELECT 1 FROM profiles WHERE handle = canonical_handle) THEN
          INSERT INTO profiles (
            handle, user_id, email, name, avatar_url, likes_public, reshares_public,
            role, location, bio, fields, preferences, created_at, updated_at
          )
          SELECT
            canonical_handle, user_id, email, name, avatar_url, likes_public, reshares_public,
            role, location, bio, fields, preferences, created_at, now()
          FROM profiles
          WHERE handle = legacy_handle;
        END IF;

        IF EXISTS (SELECT 1 FROM profiles WHERE handle = canonical_handle) THEN
          IF EXISTS (SELECT 1 FROM users WHERE handle = canonical_handle) THEN
            UPDATE users SET handle = NULL, updated_at = now() WHERE handle = legacy_handle;
          ELSE
            UPDATE users SET handle = canonical_handle, updated_at = now() WHERE handle = legacy_handle;
          END IF;

          DELETE FROM profile_follows
          WHERE (follower_handle = legacy_handle AND following_handle = canonical_handle)
             OR (follower_handle = canonical_handle AND following_handle = legacy_handle)
             OR (follower_handle = legacy_handle AND following_handle = legacy_handle);

          WITH normalized AS (
            SELECT
              CASE WHEN follower_handle = legacy_handle THEN canonical_handle ELSE follower_handle END AS follower_handle,
              CASE WHEN following_handle = legacy_handle THEN canonical_handle ELSE following_handle END AS following_handle,
              status,
              created_at,
              updated_at
            FROM profile_follows
            WHERE follower_handle = legacy_handle OR following_handle = legacy_handle
          )
          INSERT INTO profile_follows (follower_handle, following_handle, status, created_at, updated_at)
          SELECT follower_handle, following_handle, status, created_at, updated_at
          FROM normalized
          WHERE follower_handle <> following_handle
          ON CONFLICT (follower_handle, following_handle) DO NOTHING;

          DELETE FROM profile_follows
          WHERE follower_handle = legacy_handle OR following_handle = legacy_handle;

          INSERT INTO community_memberships (community_id, profile_handle, role, status, created_at)
          SELECT community_id, canonical_handle, role, status, created_at
          FROM community_memberships
          WHERE profile_handle = legacy_handle
          ON CONFLICT (community_id, profile_handle) DO NOTHING;
          DELETE FROM community_memberships WHERE profile_handle = legacy_handle;

          INSERT INTO call_participants (call_id, profile_handle, role, joined_at, left_at)
          SELECT call_id, canonical_handle, role, joined_at, left_at
          FROM call_participants
          WHERE profile_handle = legacy_handle
          ON CONFLICT (call_id, profile_handle) DO NOTHING;
          DELETE FROM call_participants WHERE profile_handle = legacy_handle;

          INSERT INTO conversation_participants (conversation_id, profile_handle, role, last_read_at, created_at)
          SELECT conversation_id, canonical_handle, role, last_read_at, created_at
          FROM conversation_participants
          WHERE profile_handle = legacy_handle
          ON CONFLICT (conversation_id, profile_handle) DO NOTHING;
          DELETE FROM conversation_participants WHERE profile_handle = legacy_handle;

          INSERT INTO message_reads (message_id, profile_handle, read_at)
          SELECT message_id, canonical_handle, read_at
          FROM message_reads
          WHERE profile_handle = legacy_handle
          ON CONFLICT (message_id, profile_handle) DO NOTHING;
          DELETE FROM message_reads WHERE profile_handle = legacy_handle;

          INSERT INTO post_actions (post_id, actor_handle, action, count, created_at, updated_at)
          SELECT post_id, canonical_handle, action, count, created_at, updated_at
          FROM post_actions
          WHERE actor_handle = legacy_handle
          ON CONFLICT (post_id, actor_handle, action) DO UPDATE SET
            count = GREATEST(post_actions.count, EXCLUDED.count),
            updated_at = now();
          DELETE FROM post_actions WHERE actor_handle = legacy_handle;

          UPDATE posts SET author_handle = canonical_handle, updated_at = now() WHERE author_handle = legacy_handle;
          UPDATE comments SET author_handle = canonical_handle, updated_at = now() WHERE author_handle = legacy_handle;
          UPDATE attachments SET uploader_handle = canonical_handle, updated_at = now() WHERE uploader_handle = legacy_handle;
          UPDATE attachments SET owner_id = canonical_handle, updated_at = now()
            WHERE owner_type = 'profile' AND owner_id = legacy_handle;
          UPDATE community_calls SET host_handle = canonical_handle, updated_at = now() WHERE host_handle = legacy_handle;
          UPDATE opportunity_posts SET creator_handle = canonical_handle, updated_at = now() WHERE creator_handle = legacy_handle;
          UPDATE note_publications SET publisher_handle = canonical_handle WHERE publisher_handle = legacy_handle;
          UPDATE ai_conversations SET owner_handle = canonical_handle, updated_at = now() WHERE owner_handle = legacy_handle;
          UPDATE messages SET sender_handle = canonical_handle, updated_at = now() WHERE sender_handle = legacy_handle;
          UPDATE notifications SET profile_handle = canonical_handle WHERE profile_handle = legacy_handle;
          UPDATE moderation_reports SET reporter_handle = canonical_handle, updated_at = now() WHERE reporter_handle = legacy_handle;
          UPDATE credit_ledger_entries SET actor_handle = canonical_handle WHERE actor_handle = legacy_handle;
          UPDATE bounties SET creator_handle = canonical_handle, updated_at = now() WHERE creator_handle = legacy_handle;
          UPDATE pledges SET pledger_handle = canonical_handle, updated_at = now() WHERE pledger_handle = legacy_handle;
          UPDATE events SET actor_handle = canonical_handle WHERE actor_handle = legacy_handle;
          UPDATE audit_logs SET actor_handle = canonical_handle WHERE actor_handle = legacy_handle;
          UPDATE external_links SET owner_id = canonical_handle WHERE owner_type = 'profile' AND owner_id = legacy_handle;

          UPDATE workspaces AS workspace
          SET owner_handle = canonical_handle, updated_at = now()
          WHERE owner_handle = legacy_handle
            AND NOT EXISTS (
              SELECT 1
              FROM workspaces AS existing
              WHERE existing.owner_handle = canonical_handle
                AND existing.name = workspace.name
            );
          UPDATE workspaces SET owner_handle = NULL, updated_at = now() WHERE owner_handle = legacy_handle;

          UPDATE credit_accounts AS account
          SET owner_id = canonical_handle, updated_at = now()
          WHERE owner_type = 'profile'
            AND owner_id = legacy_handle
            AND NOT EXISTS (
              SELECT 1
              FROM credit_accounts AS existing
              WHERE existing.owner_type = account.owner_type
                AND existing.owner_id = canonical_handle
                AND existing.currency = account.currency
            );
          UPDATE credit_accounts
          SET owner_type = 'merged_profile', owner_id = canonical_handle, updated_at = now()
          WHERE owner_type = 'profile' AND owner_id = legacy_handle;

          UPDATE posts
          SET saved_by = (
                SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN item.value = legacy_handle THEN canonical_handle ELSE item.value END), '[]'::jsonb)
                FROM jsonb_array_elements_text(saved_by) AS item(value)
              ),
              updated_at = now()
          WHERE saved_by ? legacy_handle;

          UPDATE posts
          SET signaled_by = (
                SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN item.value = legacy_handle THEN canonical_handle ELSE item.value END), '[]'::jsonb)
                FROM jsonb_array_elements_text(signaled_by) AS item(value)
              ),
              updated_at = now()
          WHERE signaled_by ? legacy_handle;

          UPDATE posts
          SET forked_by = (
                SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN item.value = legacy_handle THEN canonical_handle ELSE item.value END), '[]'::jsonb)
                FROM jsonb_array_elements_text(forked_by) AS item(value)
              ),
              updated_at = now()
          WHERE forked_by ? legacy_handle;

          UPDATE communities
          SET member_handles = (
                SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN item.value = legacy_handle THEN canonical_handle ELSE item.value END), '[]'::jsonb)
                FROM jsonb_array_elements_text(member_handles) AS item(value)
              ),
              updated_at = now()
          WHERE member_handles ? legacy_handle;

          DELETE FROM profiles WHERE handle = legacy_handle;
        END IF;
      END $$;
    `
  },
  {
    id: "0004_seed_post_timeline",
    sql: `
      WITH ranked_seed_posts AS (
        SELECT
          id,
          row_number() OVER (
            ORDER BY
              CASE id
                WHEN 'cheap-exploration' THEN 1
                WHEN 'dialogue-object' THEN 2
                WHEN 'prepared-minds' THEN 3
                WHEN 'scientific-will' THEN 4
                WHEN 'hidden-law-runner' THEN 5
                WHEN 'youth-labs' THEN 6
                ELSE 1000
              END,
              id
          ) AS seed_rank
        FROM posts
        WHERE id LIKE 'live-%'
           OR id IN (
             'cheap-exploration',
             'dialogue-object',
             'prepared-minds',
             'scientific-will',
             'hidden-law-runner',
             'youth-labs'
           )
      )
      UPDATE posts AS post
      SET created_at = now() - ((ranked_seed_posts.seed_rank * 3 + 1440) * interval '1 minute'),
          updated_at = now()
      FROM ranked_seed_posts
      WHERE post.id = ranked_seed_posts.id;
    `
  },
  {
    id: "0005_comment_actions_and_post_edits",
    sql: `
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

      ALTER TABLE comments
        ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{"signal":"0","forks":"0","saves":"0","reads":"0"}'::jsonb,
        ADD COLUMN IF NOT EXISTS saved_by JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS signaled_by JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS forked_by JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    `
  },
  {
    id: "0006_post_tombstones",
    sql: `
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    `
  },
  {
    id: "0007_comment_edit_delete",
    sql: `
      ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
      ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    `
  },
  {
    id: "0008_content_view_dedupe",
    sql: `
      CREATE TABLE IF NOT EXISTS content_views (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        actor_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        bucket_start TIMESTAMPTZ NOT NULL,
        trigger TEXT,
        surface TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (target_type, target_id, actor_handle, bucket_start)
      );

      CREATE INDEX IF NOT EXISTS content_views_target_idx ON content_views (target_type, target_id);
      CREATE INDEX IF NOT EXISTS content_views_actor_idx ON content_views (actor_handle);
    `
  },
  {
    id: "0009_canonical_action_ledger",
    sql: `
      ALTER TABLE post_actions
        ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE IF NOT EXISTS comment_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        actor_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        action TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        count INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (comment_id, actor_handle, action)
      );

      CREATE INDEX IF NOT EXISTS post_actions_activity_idx
        ON post_actions (actor_handle, updated_at DESC, action, active);
      CREATE INDEX IF NOT EXISTS comment_actions_actor_idx ON comment_actions (actor_handle);
      CREATE INDEX IF NOT EXISTS comment_actions_post_idx ON comment_actions (post_id);
      CREATE INDEX IF NOT EXISTS comment_actions_activity_idx
        ON comment_actions (actor_handle, updated_at DESC, action, active);

      DO $$ BEGIN
        ALTER TABLE post_actions
          ADD CONSTRAINT post_actions_action_check CHECK (action IN ('save', 'signal', 'fork', 'read')),
          ADD CONSTRAINT post_actions_count_check CHECK (count >= 0),
          ADD CONSTRAINT post_actions_revision_check CHECK (revision >= 1);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$ BEGIN
        ALTER TABLE comment_actions
          ADD CONSTRAINT comment_actions_action_check CHECK (action IN ('save', 'signal', 'fork')),
          ADD CONSTRAINT comment_actions_count_check CHECK (count >= 0),
          ADD CONSTRAINT comment_actions_revision_check CHECK (revision >= 1);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      INSERT INTO post_actions (post_id, actor_handle, action, active, count, revision, created_at, updated_at)
      SELECT DISTINCT post.id, actor.handle, source.action, true, 1, 1, post.created_at, post.updated_at
      FROM posts AS post
      CROSS JOIN LATERAL (
        SELECT 'save'::text AS action, value AS handle FROM jsonb_array_elements_text(post.saved_by)
        UNION ALL
        SELECT 'signal'::text AS action, value AS handle FROM jsonb_array_elements_text(post.signaled_by)
        UNION ALL
        SELECT 'fork'::text AS action, value AS handle FROM jsonb_array_elements_text(post.forked_by)
      ) AS source
      JOIN profiles AS actor ON actor.handle = source.handle
      ON CONFLICT (post_id, actor_handle, action) DO UPDATE SET
        active = true,
        updated_at = GREATEST(post_actions.updated_at, EXCLUDED.updated_at);

      INSERT INTO comment_actions (
        comment_id, post_id, actor_handle, action, active, count, revision, created_at, updated_at
      )
      SELECT DISTINCT comment.id, comment.post_id, actor.handle, source.action, true, 1, 1,
        comment.created_at, comment.updated_at
      FROM comments AS comment
      CROSS JOIN LATERAL (
        SELECT 'save'::text AS action, value AS handle FROM jsonb_array_elements_text(comment.saved_by)
        UNION ALL
        SELECT 'signal'::text AS action, value AS handle FROM jsonb_array_elements_text(comment.signaled_by)
        UNION ALL
        SELECT 'fork'::text AS action, value AS handle FROM jsonb_array_elements_text(comment.forked_by)
      ) AS source
      JOIN profiles AS actor ON actor.handle = source.handle
      ON CONFLICT (comment_id, actor_handle, action) DO UPDATE SET
        active = true,
        updated_at = GREATEST(comment_actions.updated_at, EXCLUDED.updated_at);
    `
  },
  {
    id: "0010_transactional_mutation_envelope",
    sql: `
      CREATE TABLE IF NOT EXISTS mutation_receipts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        response JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (actor_handle, scope, idempotency_key),
        CHECK (status IN ('pending', 'completed')),
        CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
        CHECK (char_length(request_hash) = 64)
      );

      CREATE INDEX IF NOT EXISTS mutation_receipts_actor_idx
        ON mutation_receipts (actor_handle, created_at DESC);
      CREATE INDEX IF NOT EXISTS mutation_receipts_created_idx
        ON mutation_receipts (created_at);
      CREATE INDEX IF NOT EXISTS events_delivery_idx
        ON events (visibility, created_at, id);
      CREATE INDEX IF NOT EXISTS audit_logs_actor_idx
        ON audit_logs (actor_handle, created_at DESC);
    `
  },
  {
    id: "0011_verified_attachment_staging",
    sql: `
      ALTER TABLE attachments ADD COLUMN IF NOT EXISTS upload_object_key TEXT;
      ALTER TABLE attachments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

      UPDATE attachments
      SET upload_object_key = object_key
      WHERE upload_object_key IS NULL;

      UPDATE attachments
      SET verified_at = updated_at
      WHERE verified_at IS NULL AND status IN ('uploaded', 'previewed');

      ALTER TABLE attachments ALTER COLUMN upload_object_key SET NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS attachments_upload_object_key_idx
        ON attachments (upload_object_key);
      CREATE INDEX IF NOT EXISTS attachments_uploader_status_idx
        ON attachments (uploader_handle, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS attachments_status_updated_idx
        ON attachments (status, updated_at);
      CREATE INDEX IF NOT EXISTS content_views_created_idx
        ON content_views (created_at);
      CREATE INDEX IF NOT EXISTS events_created_idx
        ON events (created_at);

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'attachments_status_check'
        ) THEN
          ALTER TABLE attachments
            ADD CONSTRAINT attachments_status_check
            CHECK (status IN ('pending', 'verifying', 'uploaded', 'previewed', 'failed'));
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'attachments_byte_size_check'
        ) THEN
          ALTER TABLE attachments
            ADD CONSTRAINT attachments_byte_size_check
            CHECK (byte_size > 0 AND byte_size <= 52428800);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'attachments_owner_type_check'
        ) THEN
          ALTER TABLE attachments
            ADD CONSTRAINT attachments_owner_type_check
            CHECK (owner_type IN ('post', 'message', 'note', 'profile'));
        END IF;
      END
      $$;
    `
  },
  {
    id: "0012_operational_integrity",
    sql: `
      ALTER TABLE events ADD COLUMN IF NOT EXISTS audience_handles JSONB NOT NULL DEFAULT '[]'::jsonb;
      UPDATE events
      SET audience_handles = jsonb_build_array(actor_handle)
      WHERE visibility = 'private'
        AND actor_handle IS NOT NULL
        AND audience_handles = '[]'::jsonb;

      UPDATE profile_follows SET status = 'blocked'
        WHERE status NOT IN ('active', 'muted', 'blocked');
      UPDATE community_memberships SET status = 'removed'
        WHERE status NOT IN ('active', 'requested', 'invited', 'rejected', 'blocked', 'removed');
      UPDATE community_calls SET kind = 'voice' WHERE kind NOT IN ('voice', 'video');
      UPDATE community_calls SET status = 'ended'
        WHERE status NOT IN ('scheduled', 'live', 'ended', 'cancelled');
      UPDATE conversations SET kind = 'direct' WHERE kind NOT IN ('direct', 'group');
      UPDATE workspaces SET visibility = 'private'
        WHERE visibility NOT IN ('private', 'community', 'public');
      UPDATE notes SET visibility = 'private'
        WHERE visibility NOT IN ('private', 'community', 'public');
      UPDATE note_publications SET visibility = 'private'
        WHERE visibility NOT IN ('private', 'community', 'public');
      UPDATE events SET visibility = 'private'
        WHERE visibility NOT IN ('public', 'private', 'community');
      UPDATE events
      SET audience_handles = jsonb_build_array(actor_handle)
      WHERE visibility = 'private'
        AND actor_handle IS NOT NULL
        AND audience_handles = '[]'::jsonb;
      UPDATE ai_messages SET role = 'assistant'
        WHERE role NOT IN ('user', 'assistant', 'system');

      DELETE FROM profile_follows WHERE follower_handle = following_handle;

      WITH duplicate_publications AS (
        SELECT id, row_number() OVER (PARTITION BY post_id ORDER BY created_at ASC, id ASC) AS duplicate_rank
        FROM note_publications
        WHERE post_id IS NOT NULL
      )
      DELETE FROM note_publications publication
      USING duplicate_publications duplicate
      WHERE publication.id = duplicate.id AND duplicate.duplicate_rank > 1;

      CREATE UNIQUE INDEX IF NOT EXISTS note_publications_post_unique_idx
        ON note_publications (post_id) WHERE post_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
        ON messages (conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS notifications_profile_created_idx
        ON notifications (profile_handle, created_at DESC);
      CREATE INDEX IF NOT EXISTS notes_workspace_updated_idx
        ON notes (workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS note_blocks_note_updated_idx
        ON note_blocks (note_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx
        ON ai_messages (conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS events_audience_handles_idx
        ON events USING GIN (audience_handles);

      DROP INDEX IF EXISTS messages_conversation_idx;
      DROP INDEX IF EXISTS notifications_profile_idx;
      DROP INDEX IF EXISTS notes_workspace_idx;
      DROP INDEX IF EXISTS note_blocks_note_idx;
      DROP INDEX IF EXISTS note_publications_post_idx;
      DROP INDEX IF EXISTS ai_messages_conversation_idx;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_follows_no_self_check') THEN
          ALTER TABLE profile_follows
            ADD CONSTRAINT profile_follows_no_self_check CHECK (follower_handle <> following_handle);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_follows_status_check') THEN
          ALTER TABLE profile_follows
            ADD CONSTRAINT profile_follows_status_check CHECK (status IN ('active', 'muted', 'blocked'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_memberships_status_check') THEN
          ALTER TABLE community_memberships
            ADD CONSTRAINT community_memberships_status_check
            CHECK (status IN ('active', 'requested', 'invited', 'rejected', 'blocked', 'removed'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_calls_kind_check') THEN
          ALTER TABLE community_calls
            ADD CONSTRAINT community_calls_kind_check CHECK (kind IN ('voice', 'video'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_calls_status_check') THEN
          ALTER TABLE community_calls
            ADD CONSTRAINT community_calls_status_check
            CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_kind_check') THEN
          ALTER TABLE conversations
            ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('direct', 'group'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_visibility_check') THEN
          ALTER TABLE workspaces
            ADD CONSTRAINT workspaces_visibility_check CHECK (visibility IN ('private', 'community', 'public'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_visibility_check') THEN
          ALTER TABLE notes
            ADD CONSTRAINT notes_visibility_check CHECK (visibility IN ('private', 'community', 'public'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_publications_visibility_check') THEN
          ALTER TABLE note_publications
            ADD CONSTRAINT note_publications_visibility_check CHECK (visibility IN ('private', 'community', 'public'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_visibility_check') THEN
          ALTER TABLE events
            ADD CONSTRAINT events_visibility_check CHECK (visibility IN ('public', 'private', 'community'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_role_check') THEN
          ALTER TABLE ai_messages
            ADD CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant', 'system'));
        END IF;
      END
      $$;
    `
  },
  {
    id: "0013_authoritative_entity_revisions",
    sql: `
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE comments ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE profile_follows ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

      ALTER TABLE profile_follows DROP CONSTRAINT IF EXISTS profile_follows_status_check;
      ALTER TABLE profile_follows
        ADD CONSTRAINT profile_follows_status_check
        CHECK (status IN ('active', 'muted', 'blocked', 'none'));

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_revision_check') THEN
          ALTER TABLE posts ADD CONSTRAINT posts_revision_check CHECK (revision >= 1);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_revision_check') THEN
          ALTER TABLE comments ADD CONSTRAINT comments_revision_check CHECK (revision >= 1);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_revision_check') THEN
          ALTER TABLE profiles ADD CONSTRAINT profiles_revision_check CHECK (revision >= 1);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_follows_revision_check') THEN
          ALTER TABLE profile_follows ADD CONSTRAINT profile_follows_revision_check CHECK (revision >= 1);
        END IF;
      END
      $$;
    `
  },
  {
    id: "0014_note_revision_guards",
    sql: `
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE note_blocks ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_revision_check') THEN
          ALTER TABLE notes ADD CONSTRAINT notes_revision_check CHECK (revision >= 1);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_blocks_revision_check') THEN
          ALTER TABLE note_blocks ADD CONSTRAINT note_blocks_revision_check CHECK (revision >= 1);
        END IF;
      END
      $$;
    `
  },
  {
    id: "0015_durable_r2_deletion",
    sql: `
      CREATE TABLE IF NOT EXISTS storage_deletion_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL,
        bucket TEXT NOT NULL,
        object_key TEXT NOT NULL,
        reason TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        lease_expires_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (attempts >= 0)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS storage_deletion_jobs_object_idx
        ON storage_deletion_jobs (bucket, object_key);
      CREATE INDEX IF NOT EXISTS storage_deletion_jobs_due_idx
        ON storage_deletion_jobs (next_attempt_at, lease_expires_at);
      CREATE INDEX IF NOT EXISTS storage_deletion_jobs_attachment_idx
        ON storage_deletion_jobs (attachment_id);

      INSERT INTO storage_deletion_jobs (attachment_id, bucket, object_key, reason)
      SELECT attachment_id, bucket, object_key, 'deleted_post_backfill'
      FROM (
        SELECT a.id AS attachment_id, a.bucket, a.object_key
        FROM attachments a
        INNER JOIN posts p ON a.owner_type = 'post' AND a.owner_id = p.id
        WHERE p.deleted_at IS NOT NULL
        UNION
        SELECT a.id AS attachment_id, a.bucket, a.upload_object_key AS object_key
        FROM attachments a
        INNER JOIN posts p ON a.owner_type = 'post' AND a.owner_id = p.id
        WHERE p.deleted_at IS NOT NULL
      ) deleted_post_objects
      ON CONFLICT (bucket, object_key) DO NOTHING;

      UPDATE attachments attachment
      SET status = 'failed',
          metadata = attachment.metadata || jsonb_build_object(
            'storageState', 'deletion_pending',
            'storageDeletionReason', 'deleted_post_backfill',
            'storageDeleteRequestedAt', now()
          ),
          updated_at = now()
      FROM posts post
      WHERE attachment.owner_type = 'post'
        AND attachment.owner_id = post.id
        AND post.deleted_at IS NOT NULL;
    `
  },
  {
    id: "0016_comment_attachment_ownership",
    sql: `
      ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_owner_type_check;
      ALTER TABLE attachments
        ADD CONSTRAINT attachments_owner_type_check
        CHECK (owner_type IN ('post', 'comment', 'message', 'note', 'profile'));
    `
  },
  {
    id: "0017_content_quotes",
    sql: `
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS quote JSONB;
      ALTER TABLE comments ADD COLUMN IF NOT EXISTS quote JSONB;

      ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_quote_shape_check;
      ALTER TABLE posts
        ADD CONSTRAINT posts_quote_shape_check
        CHECK (
          quote IS NULL OR (
            jsonb_typeof(quote) = 'object'
            AND quote->>'sourceType' IN ('post', 'comment')
            AND COALESCE(quote->>'sourceId', '') <> ''
            AND COALESCE(quote->>'sourcePostId', '') <> ''
          )
        );

      ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_quote_shape_check;
      ALTER TABLE comments
        ADD CONSTRAINT comments_quote_shape_check
        CHECK (
          quote IS NULL OR (
            jsonb_typeof(quote) = 'object'
            AND quote->>'sourceType' IN ('post', 'comment')
            AND COALESCE(quote->>'sourceId', '') <> ''
            AND COALESCE(quote->>'sourcePostId', '') <> ''
          )
        );

      CREATE INDEX IF NOT EXISTS posts_quote_source_post_idx
        ON posts ((quote->>'sourcePostId'))
        WHERE quote IS NOT NULL;
      CREATE INDEX IF NOT EXISTS comments_quote_source_post_idx
        ON comments ((quote->>'sourcePostId'))
        WHERE quote IS NOT NULL;
      CREATE INDEX IF NOT EXISTS posts_quote_comment_source_idx
        ON posts ((quote->>'sourceId'))
        WHERE quote->>'sourceType' = 'comment';
      CREATE INDEX IF NOT EXISTS comments_quote_comment_source_idx
        ON comments ((quote->>'sourceId'))
        WHERE quote->>'sourceType' = 'comment';
    `
  },
  {
    id: "0018_comment_quote_kind",
    sql: `
      UPDATE posts owner
      SET quote = jsonb_set(owner.quote, '{kind}', to_jsonb(source.kind), true),
          revision = owner.revision + 1,
          updated_at = now()
      FROM posts source
      WHERE owner.quote->>'sourceType' = 'comment'
        AND owner.quote->>'available' = 'true'
        AND owner.quote->>'sourcePostId' = source.id
        AND owner.quote->>'kind' IS NULL;

      WITH updated_comment_quotes AS (
        UPDATE comments owner
        SET quote = jsonb_set(owner.quote, '{kind}', to_jsonb(source.kind), true),
            revision = owner.revision + 1,
            updated_at = now()
        FROM posts source
        WHERE owner.quote->>'sourceType' = 'comment'
          AND owner.quote->>'available' = 'true'
          AND owner.quote->>'sourcePostId' = source.id
          AND owner.quote->>'kind' IS NULL
        RETURNING owner.post_id
      )
      UPDATE posts
      SET revision = posts.revision + 1,
          updated_at = now()
      WHERE posts.id IN (SELECT DISTINCT post_id FROM updated_comment_quotes);
    `
  },
  {
    id: "0019_structured_content_documents",
    sql: `
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_document JSONB;
      ALTER TABLE comments ADD COLUMN IF NOT EXISTS content_document JSONB;

      ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_content_document_shape_check;
      ALTER TABLE posts
        ADD CONSTRAINT posts_content_document_shape_check
        CHECK (
          content_document IS NULL OR (
            jsonb_typeof(content_document) = 'object'
            AND content_document->>'version' = '1'
            AND jsonb_typeof(content_document->'nodes') = 'array'
            AND jsonb_array_length(content_document->'nodes') > 0
          )
        );

      ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_content_document_shape_check;
      ALTER TABLE comments
        ADD CONSTRAINT comments_content_document_shape_check
        CHECK (
          content_document IS NULL OR (
            jsonb_typeof(content_document) = 'object'
            AND content_document->>'version' = '1'
            AND jsonb_typeof(content_document->'nodes') = 'array'
            AND jsonb_array_length(content_document->'nodes') > 0
          )
      );
    `
  },
  {
    id: "0020_workspace_documents",
    sql: `
      UPDATE workspaces SET visibility = 'private' WHERE visibility <> 'private';
      ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_visibility_check;
      ALTER TABLE workspaces
        ADD CONSTRAINT workspaces_visibility_check CHECK (visibility = 'private');

      CREATE TABLE IF NOT EXISTS workspace_notebooks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        owner_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        name TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX IF NOT EXISTS workspace_notebooks_workspace_name_unique_idx
        ON workspace_notebooks (workspace_id, lower(name)) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS workspace_notebooks_workspace_updated_idx
        ON workspace_notebooks (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

      ALTER TABLE notes ADD COLUMN IF NOT EXISTS owner_handle TEXT REFERENCES profiles(handle) ON DELETE CASCADE;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS notebook_id UUID REFERENCES workspace_notebooks(id) ON DELETE SET NULL;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'note';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS publication_target TEXT NOT NULL DEFAULT 'undecided';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS target_id TEXT;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT '';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_document JSONB;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'draft';
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS published_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

      UPDATE notes note
      SET owner_handle = workspace.owner_handle
      FROM workspaces workspace
      WHERE workspace.id = note.workspace_id AND note.owner_handle IS NULL;
      ALTER TABLE notes ALTER COLUMN owner_handle SET NOT NULL;

      UPDATE notes SET visibility = 'private' WHERE visibility <> 'private';
      ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_visibility_check;
      ALTER TABLE notes ADD CONSTRAINT notes_visibility_check CHECK (visibility = 'private');

      ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_kind_check;
      ALTER TABLE notes ADD CONSTRAINT notes_kind_check
        CHECK (kind IN ('note', 'paper', 'thought', 'comment', 'reply', 'quick'));
      ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_publication_target_check;
      ALTER TABLE notes ADD CONSTRAINT notes_publication_target_check
        CHECK (publication_target IN ('undecided', 'paper', 'thought', 'comment', 'reply'));
      ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_lifecycle_check;
      ALTER TABLE notes ADD CONSTRAINT notes_lifecycle_check
        CHECK (lifecycle IN ('draft', 'published', 'archived'));
      ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_content_document_shape_check;
      ALTER TABLE notes ADD CONSTRAINT notes_content_document_shape_check
        CHECK (
          content_document IS NULL OR (
            jsonb_typeof(content_document) = 'object'
            AND content_document->>'version' = '1'
            AND jsonb_typeof(content_document->'nodes') = 'array'
            AND jsonb_array_length(content_document->'nodes') > 0
          )
        );
      CREATE INDEX IF NOT EXISTS notes_owner_updated_idx
        ON notes (owner_handle, updated_at DESC) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS notes_notebook_updated_idx
        ON notes (notebook_id, updated_at DESC) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS notes_workspace_search_idx
        ON notes USING GIN (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, '')))
        WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS workspace_note_revisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        editor_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        content_document JSONB NOT NULL,
        kind TEXT NOT NULL,
        publication_target TEXT NOT NULL,
        target_id TEXT,
        notebook_id UUID REFERENCES workspace_notebooks(id) ON DELETE SET NULL,
        attachment_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
        reason TEXT NOT NULL DEFAULT 'checkpoint',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (note_id, revision)
      );
      CREATE INDEX IF NOT EXISTS workspace_note_revisions_note_created_idx
        ON workspace_note_revisions (note_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS workspace_notebook_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        notebook_id UUID NOT NULL REFERENCES workspace_notebooks(id) ON DELETE CASCADE,
        grantee_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'publisher')),
        granted_by_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (notebook_id, grantee_handle)
      );
      CREATE INDEX IF NOT EXISTS workspace_notebook_grants_grantee_idx
        ON workspace_notebook_grants (grantee_handle, notebook_id);

      CREATE TABLE IF NOT EXISTS workspace_note_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        grantee_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'publisher')),
        granted_by_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (note_id, grantee_handle)
      );
      CREATE INDEX IF NOT EXISTS workspace_note_grants_grantee_idx
        ON workspace_note_grants (grantee_handle, note_id);

      CREATE TABLE IF NOT EXISTS workspace_note_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        author_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        body TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        archived_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS workspace_note_comments_note_created_idx
        ON workspace_note_comments (note_id, created_at ASC) WHERE deleted_at IS NULL;

      ALTER TABLE note_publications ADD COLUMN IF NOT EXISTS note_revision INTEGER;
      ALTER TABLE note_publications ADD COLUMN IF NOT EXISTS checkpoint_id UUID REFERENCES workspace_note_revisions(id) ON DELETE SET NULL;
      ALTER TABLE note_publications ADD COLUMN IF NOT EXISTS published_comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS note_publications_comment_unique_idx
        ON note_publications (published_comment_id) WHERE published_comment_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS note_publications_revision_unique_idx
        ON note_publications (note_id, note_revision) WHERE note_id IS NOT NULL AND note_revision IS NOT NULL;
    `
  },
  {
    id: "0021_workspace_draft_discussion",
    sql: `
      ALTER TABLE workspace_note_comments ADD COLUMN IF NOT EXISTS parent_id UUID;
      ALTER TABLE workspace_note_comments ADD COLUMN IF NOT EXISTS author_name TEXT;
      ALTER TABLE workspace_note_comments ADD COLUMN IF NOT EXISTS stance TEXT NOT NULL DEFAULT 'Comment';
      ALTER TABLE workspace_note_comments ADD COLUMN IF NOT EXISTS content_document JSONB;
      ALTER TABLE workspace_note_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

      UPDATE workspace_note_comments comment
      SET author_name = COALESCE(profile.name, comment.author_handle, 'Former participant')
      FROM profiles profile
      WHERE profile.handle = comment.author_handle AND comment.author_name IS NULL;
      UPDATE workspace_note_comments
      SET author_name = COALESCE(author_handle, 'Former participant')
      WHERE author_name IS NULL;
      ALTER TABLE workspace_note_comments ALTER COLUMN author_name SET NOT NULL;

      ALTER TABLE workspace_note_comments DROP CONSTRAINT IF EXISTS workspace_note_comments_parent_id_fkey;
      ALTER TABLE workspace_note_comments
        ADD CONSTRAINT workspace_note_comments_parent_id_fkey
        FOREIGN KEY (parent_id) REFERENCES workspace_note_comments(id) ON DELETE SET NULL;
      ALTER TABLE workspace_note_comments DROP CONSTRAINT IF EXISTS workspace_note_comments_content_document_shape_check;
      ALTER TABLE workspace_note_comments
        ADD CONSTRAINT workspace_note_comments_content_document_shape_check
        CHECK (
          content_document IS NULL OR (
            jsonb_typeof(content_document) = 'object'
            AND content_document->>'version' = '1'
            AND jsonb_typeof(content_document->'nodes') = 'array'
            AND jsonb_array_length(content_document->'nodes') > 0
          )
        );
      CREATE INDEX IF NOT EXISTS workspace_note_comments_parent_idx
        ON workspace_note_comments (parent_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS workspace_note_comment_actions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        comment_id UUID NOT NULL REFERENCES workspace_note_comments(id) ON DELETE CASCADE,
        note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        actor_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('save', 'signal')),
        active BOOLEAN NOT NULL DEFAULT true,
        count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 0),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (comment_id, actor_handle, action)
      );
      CREATE INDEX IF NOT EXISTS workspace_note_comment_actions_note_idx
        ON workspace_note_comment_actions (note_id);
      CREATE INDEX IF NOT EXISTS workspace_note_comment_actions_actor_idx
        ON workspace_note_comment_actions (actor_handle);

      ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_owner_type_check;
      ALTER TABLE attachments ADD CONSTRAINT attachments_owner_type_check
        CHECK (owner_type IN ('post', 'comment', 'message', 'note', 'note_comment', 'profile'));
    `
  },
  {
    id: "0022_workspace_collaboration",
    sql: `
      ALTER TABLE workspace_notebook_grants ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE workspace_note_grants ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

      ALTER TABLE workspace_notebook_grants DROP CONSTRAINT IF EXISTS workspace_notebook_grants_revision_check;
      ALTER TABLE workspace_notebook_grants ADD CONSTRAINT workspace_notebook_grants_revision_check CHECK (revision >= 1);
      ALTER TABLE workspace_note_grants DROP CONSTRAINT IF EXISTS workspace_note_grants_revision_check;
      ALTER TABLE workspace_note_grants ADD CONSTRAINT workspace_note_grants_revision_check CHECK (revision >= 1);
    `
  },
  {
    id: "0023_workspace_publication_promotion",
    sql: `
      UPDATE notes
      SET deleted_at = COALESCE(deleted_at, published_at, updated_at, now()),
          updated_at = now()
      WHERE lifecycle = 'published' AND deleted_at IS NULL;
    `
  },
  {
    id: "0024_workspace_scribbles",
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_scribbles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        owner_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        body TEXT NOT NULL DEFAULT '',
        content_document JSONB NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (owner_handle),
        CHECK (
          jsonb_typeof(content_document) = 'object'
          AND content_document->>'version' = '1'
          AND jsonb_typeof(content_document->'nodes') = 'array'
          AND jsonb_array_length(content_document->'nodes') > 0
        )
      );
      CREATE INDEX IF NOT EXISTS workspace_scribbles_workspace_idx
        ON workspace_scribbles (workspace_id);

      CREATE TABLE IF NOT EXISTS workspace_scribble_revisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scribble_id UUID NOT NULL REFERENCES workspace_scribbles(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        editor_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        body TEXT NOT NULL,
        content_document JSONB NOT NULL,
        reason TEXT NOT NULL DEFAULT 'autosave'
          CHECK (reason IN ('created', 'autosave', 'filed', 'discarded', 'restored')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (scribble_id, revision)
      );
      CREATE INDEX IF NOT EXISTS workspace_scribble_revisions_scribble_created_idx
        ON workspace_scribble_revisions (scribble_id, created_at DESC);
    `
  },
  {
    id: "0025_patronage_foundation",
    sql: `
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS patronage JSONB;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS proposal JSONB;
      ALTER TABLE workspace_note_revisions ADD COLUMN IF NOT EXISTS proposal JSONB;

      ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_publication_target_check;
      ALTER TABLE notes ADD CONSTRAINT notes_publication_target_check
        CHECK (publication_target IN ('undecided', 'paper', 'thought', 'proposal', 'comment', 'reply'));

      CREATE TABLE IF NOT EXISTS patronage_proposals (
        post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'funded', 'closed')),
        currency TEXT NOT NULL DEFAULT 'USD'
          CHECK (currency IN ('USD', 'EUR', 'GBP', 'CAD', 'AUD')),
        goal_minor_units BIGINT NOT NULL CHECK (goal_minor_units > 0),
        deadline DATE,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS patronage_proposals_status_updated_idx
        ON patronage_proposals (status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS patronage_contributions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        contributor_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        display_name TEXT NOT NULL,
        amount_minor_units BIGINT NOT NULL CHECK (amount_minor_units > 0),
        currency TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP', 'CAD', 'AUD')),
        anonymous BOOLEAN NOT NULL DEFAULT false,
        provider TEXT NOT NULL,
        provider_reference TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'confirmed', 'refunded', 'failed')),
        confirmed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_reference)
      );
      CREATE INDEX IF NOT EXISTS patronage_contributions_post_status_idx
        ON patronage_contributions (post_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS patronage_contributions_contributor_idx
        ON patronage_contributions (contributor_handle, created_at DESC);

      UPDATE posts
      SET kind = 'paper',
          status = CASE WHEN deleted_at IS NULL THEN 'Open' ELSE status END,
          patronage = CASE WHEN deleted_at IS NULL THEN jsonb_build_object(
            'status', 'open',
            'currency', 'USD',
            'goalMinorUnits', 2500000,
            'deadline', NULL,
            'raisedMinorUnits', 0,
            'supporterCount', 0,
            'topSupporters', '[]'::jsonb
          ) ELSE patronage END
      WHERE room = 'funding' AND patronage IS NULL;

      INSERT INTO patronage_proposals (post_id, status, currency, goal_minor_units, deadline)
      SELECT
        id,
        patronage->>'status',
        patronage->>'currency',
        (patronage->>'goalMinorUnits')::BIGINT,
        NULLIF(patronage->>'deadline', '')::DATE
      FROM posts
      WHERE patronage IS NOT NULL
      ON CONFLICT (post_id) DO NOTHING;
    `
  },
  {
    id: "0026_opportunities_foundation",
    sql: `
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS opportunity JSONB;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS opportunity JSONB;
      ALTER TABLE workspace_note_revisions ADD COLUMN IF NOT EXISTS opportunity JSONB;

      ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_publication_target_check;
      ALTER TABLE notes ADD CONSTRAINT notes_publication_target_check
        CHECK (publication_target IN ('undecided', 'paper', 'thought', 'proposal', 'opportunity', 'comment', 'reply'));

      ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_owner_type_check;
      ALTER TABLE attachments ADD CONSTRAINT attachments_owner_type_check
        CHECK (owner_type IN ('post', 'comment', 'message', 'note', 'note_comment', 'opportunity_application', 'profile'));

      CREATE TABLE IF NOT EXISTS opportunity_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        applicant_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        statement TEXT NOT NULL,
        shortlisted BOOLEAN NOT NULL DEFAULT false,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (post_id, applicant_handle)
      );
      CREATE INDEX IF NOT EXISTS opportunity_applications_post_shortlisted_idx
        ON opportunity_applications (post_id, shortlisted, created_at DESC);
      CREATE INDEX IF NOT EXISTS opportunity_applications_applicant_idx
        ON opportunity_applications (applicant_handle, created_at DESC);

      CREATE TABLE IF NOT EXISTS opportunity_application_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        application_id UUID NOT NULL REFERENCES opportunity_applications(id) ON DELETE CASCADE,
        author_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS opportunity_application_comments_application_idx
        ON opportunity_application_comments (application_id, created_at ASC);

      UPDATE posts
      SET kind = 'thought',
          status = CASE WHEN deleted_at IS NULL THEN 'Open' ELSE status END,
          opportunity = CASE WHEN deleted_at IS NULL THEN jsonb_build_object(
            'kind', CASE
              WHEN tags ? 'grant' THEN 'grant'
              WHEN tags ? 'internship' THEN 'internship'
              WHEN tags ? 'fellowship' THEN 'fellowship'
              WHEN tags ? 'event' THEN 'event'
              WHEN tags ? 'problem' THEN 'open_problem'
              ELSE 'collaboration'
            END,
            'status', 'open',
            'location', NULL,
            'compensation', NULL,
            'deadline', NULL
          ) ELSE opportunity END
      WHERE room = 'opportunities' AND opportunity IS NULL;
    `
  },
  {
    id: "0027_semantic_post_types",
    sql: `
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_type TEXT;

      UPDATE posts
      SET post_type = CASE
        WHEN room = 'office' THEN NULL
        WHEN patronage IS NOT NULL OR room = 'funding' THEN 'proposal'
        WHEN opportunity IS NOT NULL OR room = 'opportunities' THEN 'opportunity'
        WHEN kind = 'paper' THEN 'paper'
        WHEN kind IN ('thought', 'note') THEN 'thought'
        ELSE NULL
      END
      WHERE post_type IS NULL OR room = 'office';

      ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_post_type_check;
      ALTER TABLE posts ADD CONSTRAINT posts_post_type_check
        CHECK (post_type IN ('paper', 'thought', 'proposal', 'opportunity'));
      ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_semantic_destination_check;
      ALTER TABLE posts ADD CONSTRAINT posts_semantic_destination_check CHECK (
        post_type IS NULL
        OR (post_type = 'proposal' AND room = 'funding')
        OR (post_type = 'opportunity' AND room = 'opportunities')
        OR (post_type IN ('paper', 'thought') AND room NOT IN ('office', 'funding', 'opportunities'))
      );

      CREATE INDEX IF NOT EXISTS posts_post_type_created_at_idx
        ON posts (post_type, created_at DESC);
    `
  },
  {
    id: "0028_communities_foundation",
    sql: `
      ALTER TABLE communities ADD COLUMN IF NOT EXISTS moderator_handles JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE communities ADD COLUMN IF NOT EXISTS guidelines TEXT NOT NULL DEFAULT '';
      ALTER TABLE communities ADD COLUMN IF NOT EXISTS announcements JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE communities ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE community_memberships ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
      ALTER TABLE community_memberships ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

      UPDATE communities
      SET moderator_handles = CASE
        WHEN moderator_handles = '[]'::jsonb THEN COALESCE((
          SELECT jsonb_agg(membership.profile_handle ORDER BY membership.profile_handle)
          FROM community_memberships membership
          WHERE membership.community_id = communities.id
            AND membership.role IN ('owner', 'moderator')
            AND membership.status = 'active'
        ), '[]'::jsonb)
        ELSE moderator_handles
      END;

      CREATE INDEX IF NOT EXISTS community_memberships_recent_idx
        ON community_memberships (profile_handle, last_accessed_at DESC);
      CREATE INDEX IF NOT EXISTS community_memberships_community_status_idx
        ON community_memberships (community_id, status);

      UPDATE posts SET community_id = 'frontier-physics-bench'
        WHERE title = 'Frontier Physics Bench field map' AND community_id IS NULL;
      UPDATE posts SET community_id = 'source-packet-workshop'
        WHERE title = 'Source Packet Workshop review scaffold' AND community_id IS NULL;
      UPDATE posts SET community_id = 'replication-commons'
        WHERE title = 'Replication Commons needs a failure etiquette' AND community_id IS NULL;
      UPDATE posts SET community_id = 'rogue-youth-labs'
        WHERE title = 'Rogue Youth Labs seeks summer cell advisors' AND community_id IS NULL;
      UPDATE posts SET community_id = 'open-problems-garden'
        WHERE title = 'Open Problems Garden bounty board' AND community_id IS NULL;
      UPDATE posts SET community_id = 'patronage-design-desk'
        WHERE title = 'Patronage Design Desk call memo' AND community_id IS NULL;
      UPDATE posts AS post
      SET community_id = seed.community_id
      FROM (VALUES
        ('live-1-library-paper', 'frontier-physics-bench'),
        ('live-2-symposium-thought', 'ai-metascience-lab'),
        ('live-3-amphitheater-thought', 'replication-commons'),
        ('live-4-library-paper', 'rogue-youth-labs'),
        ('live-5-symposium-paper', 'history-of-discovery-circle'),
        ('live-6-office-draft', 'tools-instruments-guild'),
        ('live-7-library-paper', 'patronage-design-desk'),
        ('live-8-amphitheater-note', 'open-problems-garden'),
        ('live-9-symposium-thought', 'field-methods-exchange'),
        ('live-10-office-code', 'source-packet-workshop'),
        ('live-11-library-paper', 'toy-world-agents'),
        ('live-12-amphitheater-thought', 'campus-events-board'),
        ('live-13-funding-paper', 'anomaly-archive-room'),
        ('live-14-funding-paper', 'mentor-critique-table'),
        ('live-15-communities-thought', 'civic-bounty-commons'),
        ('live-16-communities-note', 'private-grant-circle'),
        ('live-17-library-paper', 'frontier-physics-bench'),
        ('live-18-library-paper', 'source-packet-workshop'),
        ('live-19-amphitheater-thought', 'replication-commons'),
        ('live-20-opportunities-note', 'rogue-youth-labs'),
        ('live-21-opportunities-draft', 'open-problems-garden'),
        ('live-22-communities-note', 'patronage-design-desk'),
        ('live-23-opportunities-note', 'institution-design-forum'),
        ('live-24-opportunities-draft', 'conference-signals-forum')
      ) AS seed(post_id, community_id)
      WHERE post.id = seed.post_id AND post.community_id IS NULL;
      UPDATE posts SET visibility = CASE WHEN post_type = 'paper' THEN 'public' ELSE 'community' END
        WHERE community_id IS NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communities_revision_check') THEN
          ALTER TABLE communities ADD CONSTRAINT communities_revision_check CHECK (revision >= 1);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communities_visibility_check') THEN
          ALTER TABLE communities ADD CONSTRAINT communities_visibility_check CHECK (visibility IN ('public', 'private'));
        END IF;
      END
      $$;
    `
  },
  {
    id: "0029_community_activity_delivery",
    sql: `
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      CREATE TABLE IF NOT EXISTS fixture_revisions (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS community_memberships_listing_idx
        ON community_memberships (community_id, status, created_at DESC, profile_handle DESC);
      CREATE INDEX IF NOT EXISTS profiles_name_search_idx
        ON profiles USING gin (name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS profiles_handle_search_idx
        ON profiles USING gin (handle gin_trgm_ops);
    `
  },
  {
    id: "0030_bounded_read_models",
    sql: `
      CREATE INDEX IF NOT EXISTS posts_created_id_idx
        ON posts (created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS posts_type_created_id_idx
        ON posts (post_type, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS posts_room_created_id_idx
        ON posts (room, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS posts_community_created_id_idx
        ON posts (community_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS posts_author_created_id_idx
        ON posts (author_handle, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS comments_post_created_id_idx
        ON comments (post_id, created_at ASC, id ASC);
      CREATE INDEX IF NOT EXISTS comments_search_body_idx
        ON comments USING gin (to_tsvector('english', body));
      CREATE INDEX IF NOT EXISTS post_actions_viewer_active_idx
        ON post_actions (actor_handle, action, active, post_id);
      CREATE INDEX IF NOT EXISTS comment_actions_viewer_active_idx
        ON comment_actions (actor_handle, action, active, comment_id);
      CREATE INDEX IF NOT EXISTS profiles_search_document_idx
        ON profiles USING gin (
          to_tsvector('english',
            coalesce(name, '') || ' ' || coalesce(handle, '') || ' ' || coalesce(role, '') || ' ' ||
            coalesce(location, '') || ' ' || coalesce(bio, '') || ' ' || coalesce(fields::text, '')
          )
        );
      CREATE INDEX IF NOT EXISTS communities_search_document_idx
        ON communities USING gin (
          to_tsvector('english',
            coalesce(name, '') || ' ' || coalesce(field, '') || ' ' || coalesce(summary, '') || ' ' ||
            coalesce(keywords::text, '')
          )
        );
    `
  },
  {
    id: "0031_prefix_search",
    sql: `
      CREATE INDEX IF NOT EXISTS posts_search_prefix_idx
        ON posts USING gin (to_tsvector('simple', search_text));
      CREATE INDEX IF NOT EXISTS comments_search_prefix_idx
        ON comments USING gin (to_tsvector('simple', body));
      CREATE INDEX IF NOT EXISTS profiles_search_prefix_idx
        ON profiles USING gin (
          to_tsvector('simple',
            coalesce(name, '') || ' ' || coalesce(handle, '') || ' ' || coalesce(role, '') || ' ' ||
            coalesce(location, '') || ' ' || coalesce(bio, '') || ' ' || coalesce(fields::text, '')
          )
        );
      CREATE INDEX IF NOT EXISTS communities_search_prefix_idx
        ON communities USING gin (
          to_tsvector('simple',
            coalesce(name, '') || ' ' || coalesce(field, '') || ' ' || coalesce(summary, '') || ' ' ||
            coalesce(keywords::text, '')
          )
      );
    `
  },
  {
    id: "0032_maintenance_cost_boundaries",
    sql: `
      CREATE TABLE IF NOT EXISTS maintenance_leases (
        key TEXT PRIMARY KEY,
        last_completed_at TIMESTAMPTZ,
        lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS audit_logs_created_idx
        ON audit_logs (created_at);
      CREATE INDEX IF NOT EXISTS notifications_retention_idx
        ON notifications (created_at)
        WHERE read_at IS NOT NULL;
    `
  },
  {
    id: "0033_profile_activity_timelines",
    sql: `
      CREATE INDEX IF NOT EXISTS comments_profile_activity_idx
        ON comments (author_handle, created_at DESC, id DESC)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS post_actions_profile_timeline_idx
        ON post_actions (actor_handle, action, updated_at DESC, post_id DESC);
      CREATE INDEX IF NOT EXISTS comment_actions_profile_timeline_idx
        ON comment_actions (actor_handle, action, updated_at DESC, comment_id DESC);
    `
  },
  {
    id: "0034_messaging_foundation",
    sql: `
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS next_message_sequence BIGINT NOT NULL DEFAULT 0;

      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS last_read_sequence BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS cleared_through_sequence BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS removed_through_sequence BIGINT;
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS draft_body TEXT NOT NULL DEFAULT '';
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ;
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
      ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

      ALTER TABLE messages ADD COLUMN IF NOT EXISTS sequence BIGINT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by TEXT REFERENCES profiles(handle) ON DELETE SET NULL;

      WITH ranked AS (
        SELECT id, row_number() OVER (PARTITION BY conversation_id ORDER BY created_at ASC, id ASC) AS sequence
        FROM messages
        WHERE sequence IS NULL
      )
      UPDATE messages message
      SET sequence = ranked.sequence
      FROM ranked
      WHERE message.id = ranked.id;

      ALTER TABLE messages ALTER COLUMN sequence SET NOT NULL;

      UPDATE conversations conversation
      SET next_message_sequence = GREATEST(
        conversation.next_message_sequence,
        COALESCE((SELECT max(message.sequence) FROM messages message WHERE message.conversation_id = conversation.id), 0)
      );

      CREATE TABLE IF NOT EXISTS message_stars (
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        profile_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (message_id, profile_handle)
      );

      CREATE TABLE IF NOT EXISTS message_hidden_for (
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        profile_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (message_id, profile_handle)
      );

      CREATE TABLE IF NOT EXISTS profile_blocks (
        blocker_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        blocked_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (blocker_handle, blocked_handle),
        CONSTRAINT profile_blocks_not_self_check CHECK (blocker_handle <> blocked_handle)
      );

      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

      CREATE INDEX IF NOT EXISTS conversations_updated_idx ON conversations (updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS conversation_participants_profile_status_idx
        ON conversation_participants (profile_handle, status, hidden_at);
      CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_sequence_idx
        ON messages (conversation_id, sequence);
      CREATE INDEX IF NOT EXISTS messages_search_body_idx
        ON messages USING gin (to_tsvector('english', body));
      CREATE INDEX IF NOT EXISTS message_stars_profile_created_idx
        ON message_stars (profile_handle, created_at DESC);
      CREATE INDEX IF NOT EXISTS profile_blocks_blocked_idx ON profile_blocks (blocked_handle);
      CREATE UNIQUE INDEX IF NOT EXISTS notifications_profile_dedupe_idx
        ON notifications (profile_handle, dedupe_key) WHERE dedupe_key IS NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_revision_check') THEN
          ALTER TABLE conversations ADD CONSTRAINT conversations_revision_check CHECK (revision >= 1);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_sequence_check') THEN
          ALTER TABLE conversations ADD CONSTRAINT conversations_sequence_check CHECK (next_message_sequence >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_kind_check') THEN
          ALTER TABLE conversations ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('direct', 'group'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_role_check') THEN
          ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_role_check CHECK (role IN ('owner', 'admin', 'member'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_status_check') THEN
          ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_status_check CHECK (status IN ('invited', 'active', 'removed'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_read_sequence_check') THEN
          ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_read_sequence_check CHECK (last_read_sequence >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participants_cleared_sequence_check') THEN
          ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_cleared_sequence_check CHECK (cleared_through_sequence >= 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_sequence_check') THEN
          ALTER TABLE messages ADD CONSTRAINT messages_sequence_check CHECK (sequence > 0);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_revision_check') THEN
          ALTER TABLE messages ADD CONSTRAINT messages_revision_check CHECK (revision >= 1);
        END IF;
      END
      $$;
    `
  },
  {
    id: "0035_message_notification_boundary",
    sql: `
      DELETE FROM notifications WHERE kind = 'message';
    `
  },
  {
    id: "0036_immediate_group_membership",
    sql: `
      UPDATE conversation_participants
      SET status = 'active',
          accepted_at = COALESCE(accepted_at, now()),
          hidden_at = NULL,
          removed_at = NULL,
          removed_through_sequence = NULL
      WHERE status = 'invited';

      DELETE FROM notifications WHERE kind = 'group_invite';
    `
  },
  {
    id: "0037_ai_usage_budget_ledger",
    sql: `
      CREATE TABLE IF NOT EXISTS ai_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
        owner_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved',
        reserved_cost_micros BIGINT NOT NULL,
        actual_cost_micros BIGINT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        provider_response_id TEXT,
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT ai_usage_status_check CHECK (status IN ('reserved', 'completed', 'failed')),
        CONSTRAINT ai_usage_cost_check CHECK (reserved_cost_micros >= 0 AND (actual_cost_micros IS NULL OR actual_cost_micros >= 0)),
        CONSTRAINT ai_usage_token_check CHECK (input_tokens >= 0 AND cached_input_tokens >= 0 AND cache_write_tokens >= 0 AND output_tokens >= 0)
      );

      CREATE INDEX IF NOT EXISTS ai_usage_owner_created_idx ON ai_usage (owner_handle, created_at DESC);
      CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at DESC);
      CREATE INDEX IF NOT EXISTS ai_usage_status_created_idx ON ai_usage (status, created_at DESC);
    `
  },
  {
    id: "0038_document_translation_cache",
    sql: `
      CREATE TABLE IF NOT EXISTS document_translations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        attachment_id TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        source_title TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_complete BOOLEAN NOT NULL,
        target_language TEXT NOT NULL,
        target_language_label TEXT NOT NULL,
        translated_title TEXT NOT NULL,
        pages JSONB NOT NULL,
        model TEXT NOT NULL,
        creator_handle TEXT REFERENCES profiles(handle) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT document_translations_source_kind_check CHECK (source_kind IN ('docx', 'pdf')),
        CONSTRAINT document_translations_language_check CHECK (target_language IN ('english', 'french', 'german', 'spanish')),
        CONSTRAINT document_translations_fingerprint_check CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
        CONSTRAINT document_translations_pages_check CHECK (jsonb_typeof(pages) = 'array' AND jsonb_array_length(pages) BETWEEN 1 AND 40)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS document_translations_source_language_unique_idx
        ON document_translations (attachment_id, source_fingerprint, target_language);
      CREATE INDEX IF NOT EXISTS document_translations_created_idx
        ON document_translations (created_at DESC);
    `
  },
  {
    id: "0039_historical_world_profiles",
    sql: `
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS actor_kind TEXT NOT NULL DEFAULT 'person';
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS era TEXT;
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS life_dates TEXT;
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disclosure TEXT;
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS source_url TEXT;

      UPDATE profiles SET actor_kind = 'person'
      WHERE actor_kind NOT IN ('person', 'historical_simulation', 'editorial');

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'profiles_actor_kind_check'
        ) THEN
          ALTER TABLE profiles
            ADD CONSTRAINT profiles_actor_kind_check
            CHECK (actor_kind IN ('person', 'historical_simulation', 'editorial'));
        END IF;
      END
      $$;

      CREATE INDEX IF NOT EXISTS profiles_actor_kind_idx ON profiles (actor_kind, handle);

      CREATE TABLE IF NOT EXISTS historical_world_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixture_revision TEXT NOT NULL UNIQUE,
        manifest JSONB NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `
  },
  {
    id: "0040_owner_daily_ai_quota_reset",
    sql: `
      CREATE TABLE IF NOT EXISTS ai_daily_quota_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_handle TEXT NOT NULL REFERENCES profiles(handle) ON DELETE CASCADE,
        usage_day DATE NOT NULL,
        reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS ai_daily_quota_resets_owner_day_unique_idx
        ON ai_daily_quota_resets (owner_handle, usage_day);
      CREATE INDEX IF NOT EXISTS ai_daily_quota_resets_day_idx
        ON ai_daily_quota_resets (usage_day);

      INSERT INTO ai_daily_quota_resets (owner_handle, usage_day, reset_at)
      SELECT 'udayan', current_date, now()
      WHERE EXISTS (SELECT 1 FROM profiles WHERE handle = 'udayan')
      ON CONFLICT (owner_handle, usage_day)
      DO UPDATE SET reset_at = EXCLUDED.reset_at;
    `
  }
];

export const migrationIds = migrations.map((migration) => migration.id);
export const latestMigrationId = migrationIds.at(-1) ?? null;

export type MigrationStatus = {
  appliedCount: number;
  currentMigrationId: string | null;
  latestMigrationId: string | null;
  pendingMigrationIds: string[];
};

export const getMigrationStatus = async (): Promise<MigrationStatus> => {
  if (!hasDatabase()) {
    return {
      appliedCount: 0,
      currentMigrationId: null,
      latestMigrationId,
      pendingMigrationIds: migrationIds
    };
  }

  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM symposium_migrations WHERE id = ANY($1::text[]) ORDER BY applied_at ASC`,
    [migrationIds]
  );
  const applied = new Set(result.rows.map((row) => row.id));
  const appliedIds = migrationIds.filter((id) => applied.has(id));
  return {
    appliedCount: appliedIds.length,
    currentMigrationId: appliedIds.at(-1) ?? null,
    latestMigrationId,
    pendingMigrationIds: migrationIds.filter((id) => !applied.has(id))
  };
};

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
