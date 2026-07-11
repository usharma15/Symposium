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
