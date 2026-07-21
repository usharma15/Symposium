import type { PoolClient } from "pg";
import type { InquiryCommentContract, InquiryItemContract } from "@/packages/contracts/src";
import { historicalProfiles } from "@/lib/historicalWorld/characters";
import { historicalCommunities } from "@/lib/historicalWorld/communities";
import { historicalInquiryItems, historicalWorldCounts } from "@/lib/historicalWorld/content";
import type { HistoricalAsset } from "@/lib/historicalWorld/assets";

export const historicalWorldFixtureRevision = "historical-world-v1";

type FlatComment = InquiryCommentContract & { postId: string; parentId: string | null };

const flattenComments = (
  postId: string,
  values: InquiryCommentContract[],
  parentId: string | null = null
): FlatComment[] => values.flatMap((value) => {
  if (!value.id) throw new Error(`Historical fixture comment on ${postId} is missing an id.`);
  return [
    { ...value, postId, parentId },
    ...flattenComments(postId, value.replies ?? [], value.id)
  ];
});

const allComments = historicalInquiryItems.flatMap((entry) => flattenComments(entry.id, entry.comments));

const postType = (entry: InquiryItemContract) => entry.postType
  ?? (entry.room === "funding" ? "proposal" : entry.room === "opportunities" ? "opportunity" : entry.kind === "paper" ? "paper" : "thought");

const searchableText = (entry: InquiryItemContract) => [
  entry.title,
  entry.body,
  entry.excerpt,
  entry.author,
  ...entry.tags,
  ...entry.claims,
  ...entry.evidence
].filter(Boolean).join(" ");

const snapshotTables = [
  "users",
  "profiles",
  "communities",
  "community_memberships",
  "community_calls",
  "call_participants",
  "posts",
  "comments",
  "post_actions",
  "comment_actions",
  "content_views",
  "profile_follows",
  "attachments",
  "patronage_proposals",
  "patronage_contributions"
] as const;

const takeSnapshot = async (client: PoolClient, protectedHandles: string[]) => {
  const payload: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const table of snapshotTables) {
    const result = await client.query(`SELECT * FROM ${table}`);
    payload[table] = result.rows;
    counts[table] = result.rowCount ?? result.rows.length;
  }
  const manifest = {
    fixtureRevision: historicalWorldFixtureRevision,
    protectedClerkHandles: protectedHandles,
    preReplacementCounts: counts,
    replacementCounts: historicalWorldCounts,
    strategy2032Included: false,
    createdAt: new Date().toISOString()
  };
  await client.query(
    `INSERT INTO historical_world_snapshots (fixture_revision, manifest, payload)
     VALUES ($1, $2::jsonb, $3::jsonb)
     ON CONFLICT (fixture_revision) DO NOTHING`,
    [historicalWorldFixtureRevision, JSON.stringify(manifest), JSON.stringify(payload)]
  );
  return manifest;
};

const stageLegacyRemoval = async (client: PoolClient) => {
  await client.query(`
    CREATE TEMP TABLE historical_protected_handles (handle text PRIMARY KEY) ON COMMIT DROP;
    INSERT INTO historical_protected_handles (handle)
    SELECT DISTINCT profile.handle
    FROM profiles profile
    INNER JOIN users account ON account.id = profile.user_id OR account.handle = profile.handle
    WHERE account.clerk_user_id IS NOT NULL;

    CREATE TEMP TABLE historical_doomed_posts (id text PRIMARY KEY) ON COMMIT DROP;
    INSERT INTO historical_doomed_posts (id)
    SELECT post.id
    FROM posts post
    LEFT JOIN historical_protected_handles protected ON protected.handle = post.author_handle
    WHERE protected.handle IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM comments comment
        INNER JOIN historical_protected_handles comment_author ON comment_author.handle = comment.author_handle
        WHERE comment.post_id = post.id
      );

    CREATE TEMP TABLE historical_redacted_posts (id text PRIMARY KEY) ON COMMIT DROP;
    INSERT INTO historical_redacted_posts (id)
    SELECT post.id
    FROM posts post
    LEFT JOIN historical_protected_handles protected ON protected.handle = post.author_handle
    WHERE protected.handle IS NULL
      AND EXISTS (
        SELECT 1
        FROM comments comment
        INNER JOIN historical_protected_handles comment_author ON comment_author.handle = comment.author_handle
        WHERE comment.post_id = post.id
      );

    CREATE TEMP TABLE historical_doomed_comments (id text PRIMARY KEY) ON COMMIT DROP;
    INSERT INTO historical_doomed_comments (id)
    WITH RECURSIVE doomed AS (
      SELECT comment.id
      FROM comments comment
      INNER JOIN historical_doomed_posts post ON post.id = comment.post_id
      UNION
      SELECT comment.id
      FROM comments comment
      LEFT JOIN historical_protected_handles protected ON protected.handle = comment.author_handle
      LEFT JOIN historical_doomed_posts post ON post.id = comment.post_id
      WHERE post.id IS NULL AND protected.handle IS NULL
    )
    SELECT DISTINCT id FROM doomed;
  `);

  await client.query(`
    INSERT INTO storage_deletion_jobs (attachment_id, bucket, object_key, reason)
    SELECT source.attachment_id, source.bucket, source.object_key, 'historical_world_legacy_fixture_removal'
    FROM (
      SELECT attachment.id AS attachment_id, attachment.bucket, attachment.object_key
      FROM attachments attachment
      WHERE (
          attachment.owner_type = 'post' AND attachment.owner_id IN (SELECT id FROM historical_doomed_posts UNION SELECT id FROM historical_redacted_posts)
        ) OR (
          attachment.owner_type = 'comment' AND attachment.owner_id IN (SELECT id FROM historical_doomed_comments)
        ) OR (
          attachment.owner_type = 'profile' AND attachment.owner_id NOT IN (SELECT handle FROM historical_protected_handles)
        )
      UNION
      SELECT attachment.id, attachment.bucket, attachment.upload_object_key
      FROM attachments attachment
      WHERE attachment.upload_object_key <> attachment.object_key
        AND ((
          attachment.owner_type = 'post' AND attachment.owner_id IN (SELECT id FROM historical_doomed_posts UNION SELECT id FROM historical_redacted_posts)
        ) OR (
          attachment.owner_type = 'comment' AND attachment.owner_id IN (SELECT id FROM historical_doomed_comments)
        ) OR (
          attachment.owner_type = 'profile' AND attachment.owner_id NOT IN (SELECT handle FROM historical_protected_handles)
        ))
    ) source
    WHERE source.object_key NOT LIKE 'historical-world/%'
    ON CONFLICT (bucket, object_key) DO NOTHING;

    DELETE FROM attachments attachment
    WHERE (attachment.owner_type = 'post' AND attachment.owner_id IN (SELECT id FROM historical_doomed_posts UNION SELECT id FROM historical_redacted_posts))
       OR (attachment.owner_type = 'comment' AND attachment.owner_id IN (SELECT id FROM historical_doomed_comments))
       OR (attachment.owner_type = 'profile' AND attachment.owner_id NOT IN (SELECT handle FROM historical_protected_handles));

    UPDATE comments
    SET parent_id = NULL, updated_at = now()
    WHERE author_handle IN (SELECT handle FROM historical_protected_handles)
      AND parent_id IN (SELECT id FROM historical_doomed_comments);
    DELETE FROM comments WHERE id IN (SELECT id FROM historical_doomed_comments);
    DELETE FROM posts WHERE id IN (SELECT id FROM historical_doomed_posts);
    UPDATE posts SET
      kind = 'thought',
      post_type = 'thought',
      room = 'symposium',
      community_id = NULL,
      title = 'Retired simulated post — real discussion preserved',
      author_handle = NULL,
      author_name = 'Symposium archive',
      affiliation = 'Science Rebirth',
      status = 'Retired fixture',
      metrics = '{"signal":"0","critiques":"0","forks":"0","saves":"0","reads":"0"}'::jsonb,
      gathering_reason = 'The synthetic source was removed; Clerk-authored comments remain available.',
      excerpt = 'The original simulated fixture was retired. The real-user discussion below is preserved.',
      body = 'The original simulated fixture was retired. The real-user discussion below is preserved.',
      content_document = jsonb_build_object(
        'version', 1,
        'nodes', jsonb_build_array(jsonb_build_object(
          'id', 'retired-fixture-note', 'type', 'paragraph', 'align', 'left', 'indent', 0,
          'content', jsonb_build_array(jsonb_build_object('text', 'The original simulated fixture was retired. The real-user discussion below is preserved.'))
        ))
      ),
      tags = '["archive","retired fixture"]'::jsonb,
      signals = '[]'::jsonb,
      claims = '[]'::jsonb,
      objections = '[]'::jsonb,
      evidence = '[]'::jsonb,
      tests = '[]'::jsonb,
      forks = '[]'::jsonb,
      quote = NULL,
      patronage = NULL,
      opportunity = NULL,
      search_text = 'Retired simulated post real discussion preserved',
      visibility = 'public',
      updated_at = now()
    WHERE id IN (SELECT id FROM historical_redacted_posts);
  `);

  await client.query(`
    DELETE FROM post_actions WHERE actor_handle NOT IN (SELECT handle FROM historical_protected_handles);
    DELETE FROM comment_actions WHERE actor_handle NOT IN (SELECT handle FROM historical_protected_handles);
    DELETE FROM content_views WHERE actor_handle NOT IN (SELECT handle FROM historical_protected_handles);
    DELETE FROM profile_follows
    WHERE follower_handle NOT IN (SELECT handle FROM historical_protected_handles)
       OR following_handle NOT IN (SELECT handle FROM historical_protected_handles);
    DELETE FROM community_memberships WHERE profile_handle NOT IN (SELECT handle FROM historical_protected_handles);
    DELETE FROM call_participants WHERE profile_handle NOT IN (SELECT handle FROM historical_protected_handles);

    UPDATE posts post SET
      saved_by = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(post.saved_by) value WHERE value IN (SELECT handle FROM historical_protected_handles)), '[]'::jsonb),
      signaled_by = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(post.signaled_by) value WHERE value IN (SELECT handle FROM historical_protected_handles)), '[]'::jsonb),
      forked_by = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(post.forked_by) value WHERE value IN (SELECT handle FROM historical_protected_handles)), '[]'::jsonb);
    UPDATE comments comment SET
      saved_by = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(comment.saved_by) value WHERE value IN (SELECT handle FROM historical_protected_handles)), '[]'::jsonb),
      signaled_by = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(comment.signaled_by) value WHERE value IN (SELECT handle FROM historical_protected_handles)), '[]'::jsonb),
      forked_by = COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(comment.forked_by) value WHERE value IN (SELECT handle FROM historical_protected_handles)), '[]'::jsonb);
    UPDATE communities community SET member_handles = COALESCE((
      SELECT jsonb_agg(value) FROM jsonb_array_elements_text(community.member_handles) value
      WHERE value IN (SELECT handle FROM historical_protected_handles)
    ), '[]'::jsonb);

    DELETE FROM profiles WHERE handle NOT IN (SELECT handle FROM historical_protected_handles);
    DELETE FROM users WHERE clerk_user_id IS NULL;
  `);

  await client.query(`
    DELETE FROM communities community
    WHERE NOT EXISTS (SELECT 1 FROM posts post WHERE post.community_id = community.id)
      AND community.id <> ALL($1::text[]);
  `, [historicalCommunities.map((community) => community.id)]);
};

const insertProfiles = async (client: PoolClient) => {
  await client.query(
    `INSERT INTO profiles (
       handle, name, avatar_url, likes_public, reshares_public, role, location, bio, fields,
       actor_kind, era, life_dates, disclosure, source_url
     )
     SELECT row.handle, row.name, row.avatar_url, row.likes_public, row.reshares_public,
       row.role, row.location, row.bio, row.fields, row.actor_kind, row.era, row.life_dates,
       row.disclosure, row.source_url
     FROM jsonb_to_recordset($1::jsonb) AS row(
       handle text, name text, avatar_url text, likes_public boolean, reshares_public boolean,
       role text, location text, bio text, fields jsonb, actor_kind text, era text,
       life_dates text, disclosure text, source_url text
     )
     ON CONFLICT (handle) DO UPDATE SET
       name = EXCLUDED.name,
       avatar_url = EXCLUDED.avatar_url,
       likes_public = EXCLUDED.likes_public,
       reshares_public = EXCLUDED.reshares_public,
       role = EXCLUDED.role,
       location = EXCLUDED.location,
       bio = EXCLUDED.bio,
       fields = EXCLUDED.fields,
       actor_kind = EXCLUDED.actor_kind,
       era = EXCLUDED.era,
       life_dates = EXCLUDED.life_dates,
       disclosure = EXCLUDED.disclosure,
       source_url = EXCLUDED.source_url,
       updated_at = now()`,
    [JSON.stringify(historicalProfiles.map((person) => ({
      handle: person.handle,
      name: person.name,
      avatar_url: person.avatarUrl ?? null,
      likes_public: person.likesPublic ?? true,
      reshares_public: person.resharesPublic ?? true,
      role: person.role,
      location: person.location,
      bio: person.bio,
      fields: person.fields,
      actor_kind: person.actorKind,
      era: person.era ?? null,
      life_dates: person.lifeDates ?? null,
      disclosure: person.disclosure ?? null,
      source_url: person.sourceUrl ?? null
    })))]
  );
};

const insertCommunities = async (client: PoolClient) => {
  await client.query(
    `INSERT INTO communities (
       id, name, field, summary, visibility, online, member_handles, keywords, seed_counts,
       call_status, moderator_handles, guidelines, announcements
     )
     SELECT row.id, row.name, row.field, row.summary, row.visibility, row.online,
       row.member_handles, row.keywords, row.seed_counts, row.call_status,
       row.moderator_handles, row.guidelines, row.announcements
     FROM jsonb_to_recordset($1::jsonb) AS row(
       id text, name text, field text, summary text, visibility text, online integer,
       member_handles jsonb, keywords jsonb, seed_counts jsonb, call_status text,
       moderator_handles jsonb, guidelines text, announcements jsonb
     )
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, field = EXCLUDED.field, summary = EXCLUDED.summary,
       visibility = EXCLUDED.visibility, online = EXCLUDED.online,
       member_handles = EXCLUDED.member_handles, keywords = EXCLUDED.keywords,
       seed_counts = EXCLUDED.seed_counts, call_status = EXCLUDED.call_status,
       moderator_handles = EXCLUDED.moderator_handles,
       guidelines = EXCLUDED.guidelines, announcements = EXCLUDED.announcements,
       updated_at = now()`,
    [JSON.stringify(historicalCommunities.map((community) => ({
      id: community.id,
      name: community.name,
      field: community.field,
      summary: community.summary,
      visibility: community.visibility,
      online: community.online,
      member_handles: community.memberHandles,
      keywords: community.keywords,
      seed_counts: community.seedCounts,
      call_status: community.callStatus,
      moderator_handles: community.moderatorHandles ?? [],
      guidelines: community.guidelines ?? "",
      announcements: community.announcements ?? []
    })))]
  );

  const memberships = historicalCommunities.flatMap((community) => {
    const moderators = new Set(community.moderatorHandles ?? []);
    return community.memberHandles.map((handle) => ({
      community_id: community.id,
      profile_handle: handle,
      role: handle === community.ownerHandle ? "owner" : moderators.has(handle) ? "moderator" : "member"
    }));
  });
  await client.query(
    `INSERT INTO community_memberships (community_id, profile_handle, role, status)
     SELECT row.community_id, row.profile_handle, row.role, 'active'
     FROM jsonb_to_recordset($1::jsonb) AS row(community_id text, profile_handle text, role text)
     ON CONFLICT (community_id, profile_handle) DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
    [JSON.stringify(memberships)]
  );

  const channels = historicalCommunities.flatMap((community) =>
    ["feed", "papers", "calls", "bounties", "notes", "members"].map((name) => ({ community_id: community.id, kind: name, name }))
  );
  await client.query(
    `INSERT INTO community_channels (community_id, kind, name)
     SELECT row.community_id, row.kind, row.name
     FROM jsonb_to_recordset($1::jsonb) AS row(community_id text, kind text, name text)
     ON CONFLICT (community_id, kind, name) DO NOTHING`,
    [JSON.stringify(channels)]
  );

  const calls = historicalCommunities.map((community, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    community_id: community.id,
    host_handle: community.ownerHandle,
    title: community.callStatus === "quiet" ? `${community.name} weekly table` : `${community.name} live table`,
    kind: community.callStatus === "video live" ? "video" : "voice",
    status: community.callStatus === "quiet" ? "scheduled" : "live",
    starts_at: new Date(Date.parse("2026-07-20T16:00:00.000Z") + index * 45 * 60_000).toISOString()
  }));
  await client.query(
    `INSERT INTO community_calls (id, community_id, host_handle, title, kind, status, starts_at, provider, provider_room_id, metadata)
     SELECT row.id::uuid, row.community_id, row.host_handle, row.title, row.kind, row.status,
       row.starts_at::timestamptz, 'historical-fixture', row.id, '{"simulated":true}'::jsonb
     FROM jsonb_to_recordset($1::jsonb) AS row(
       id text, community_id text, host_handle text, title text, kind text, status text, starts_at text
     )
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, starts_at = EXCLUDED.starts_at, updated_at = now()`,
    [JSON.stringify(calls)]
  );
  const participants = calls.flatMap((call) => {
    const community = historicalCommunities.find((entry) => entry.id === call.community_id)!;
    return community.memberHandles.slice(0, Math.min(5, community.memberHandles.length)).map((handle, index) => ({
      call_id: call.id,
      profile_handle: handle,
      role: index === 0 ? "host" : "participant"
    }));
  });
  await client.query(
    `INSERT INTO call_participants (call_id, profile_handle, role)
     SELECT row.call_id::uuid, row.profile_handle, row.role
     FROM jsonb_to_recordset($1::jsonb) AS row(call_id text, profile_handle text, role text)
     ON CONFLICT (call_id, profile_handle) DO UPDATE SET role = EXCLUDED.role, left_at = NULL`,
    [JSON.stringify(participants)]
  );
};

const insertPosts = async (client: PoolClient) => {
  const rows = historicalInquiryItems.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    post_type: postType(entry),
    room: entry.room,
    community_id: entry.communityId ?? null,
    title: entry.title,
    author_handle: entry.authorHandle,
    author_name: entry.author,
    affiliation: entry.affiliation,
    date_label: entry.date,
    created_at: entry.createdAt,
    status: entry.status,
    metrics: entry.metrics,
    gathering_reason: entry.gatheringReason,
    excerpt: entry.excerpt,
    body: entry.body,
    content_document: entry.document,
    tags: entry.tags,
    signals: entry.signals,
    claims: entry.claims,
    objections: entry.objections,
    evidence: entry.evidence,
    tests: entry.tests,
    forks: entry.forks,
    saved_by: entry.savedBy ?? [],
    signaled_by: entry.signaledBy ?? [],
    forked_by: entry.forkedBy ?? [],
    quote: entry.quote ?? null,
    patronage: entry.patronage ?? null,
    opportunity: entry.opportunity ?? null,
    search_text: searchableText(entry),
    visibility: entry.communityId && postType(entry) !== "paper" ? "community" : "public"
  }));
  await client.query(
    `INSERT INTO posts (
       id, kind, post_type, room, community_id, title, author_handle, author_name, affiliation,
       date_label, created_at, status, metrics, gathering_reason, excerpt, body, content_document,
       tags, signals, claims, objections, evidence, tests, forks, saved_by, signaled_by, forked_by,
       quote, patronage, opportunity, search_text, visibility
     )
     SELECT row.id, row.kind, row.post_type, row.room, row.community_id, row.title,
       row.author_handle, row.author_name, row.affiliation, row.date_label, row.created_at::timestamptz,
       row.status, row.metrics, row.gathering_reason, row.excerpt, row.body, row.content_document,
       row.tags, row.signals, row.claims, row.objections, row.evidence, row.tests, row.forks,
       row.saved_by, row.signaled_by, row.forked_by, row.quote, row.patronage, row.opportunity,
       row.search_text, row.visibility
     FROM jsonb_to_recordset($1::jsonb) AS row(
       id text, kind text, post_type text, room text, community_id text, title text,
       author_handle text, author_name text, affiliation text, date_label text, created_at text,
       status text, metrics jsonb, gathering_reason text, excerpt text, body text,
       content_document jsonb, tags jsonb, signals jsonb, claims jsonb, objections jsonb,
       evidence jsonb, tests jsonb, forks jsonb, saved_by jsonb, signaled_by jsonb,
       forked_by jsonb, quote jsonb, patronage jsonb, opportunity jsonb, search_text text, visibility text
     )
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(rows)]
  );

  await client.query(
    `INSERT INTO comments (
       id, post_id, parent_id, author_handle, author_name, stance, body, content_document,
       metrics, saved_by, signaled_by, forked_by, quote, created_at
     )
     SELECT row.id, row.post_id, row.parent_id, row.author_handle, row.author_name, row.stance,
       row.body, row.content_document, row.metrics, row.saved_by, row.signaled_by, row.forked_by,
       row.quote, row.created_at::timestamptz
     FROM jsonb_to_recordset($1::jsonb) AS row(
       id text, post_id text, parent_id text, author_handle text, author_name text, stance text,
       body text, content_document jsonb, metrics jsonb, saved_by jsonb, signaled_by jsonb,
       forked_by jsonb, quote jsonb, created_at text
     )
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(allComments.map((entry) => ({
      id: entry.id,
      post_id: entry.postId,
      parent_id: entry.parentId,
      author_handle: entry.authorHandle,
      author_name: entry.author,
      stance: entry.stance,
      body: entry.body,
      content_document: entry.document ?? null,
      metrics: entry.metrics ?? { signal: "0", forks: "0", saves: "0", reads: "0" },
      saved_by: entry.savedBy ?? [],
      signaled_by: entry.signaledBy ?? [],
      forked_by: entry.forkedBy ?? [],
      quote: entry.quote ?? null,
      created_at: entry.createdAt
    })))]
  );
};

const insertAttachmentsAndActions = async (client: PoolClient) => {
  const attachmentRows: Array<{ asset: HistoricalAsset; ownerType: "post" | "comment"; ownerId: string; uploaderHandle: string }> = [];
  for (const entry of historicalInquiryItems) {
    for (const asset of entry.attachments ?? []) attachmentRows.push({ asset: asset as HistoricalAsset, ownerType: "post", ownerId: entry.id, uploaderHandle: entry.authorHandle! });
  }
  for (const entry of allComments) {
    for (const asset of entry.attachments ?? []) attachmentRows.push({ asset: asset as HistoricalAsset, ownerType: "comment", ownerId: entry.id!, uploaderHandle: entry.authorHandle! });
  }
  await client.query(
    `INSERT INTO attachments (
       id, owner_type, owner_id, uploader_handle, bucket, object_key, upload_object_key,
       file_name, content_type, byte_size, status, metadata, verified_at
     )
     SELECT row.id::uuid, row.owner_type, row.owner_id, row.uploader_handle, 'static',
       row.object_key, row.object_key, row.file_name, row.content_type, row.byte_size,
       'previewed', row.metadata, row.created_at::timestamptz
     FROM jsonb_to_recordset($1::jsonb) AS row(
       id text, owner_type text, owner_id text, uploader_handle text, object_key text,
       file_name text, content_type text, byte_size integer, metadata jsonb, created_at text
     )
     ON CONFLICT (id) DO UPDATE SET owner_type = EXCLUDED.owner_type, owner_id = EXCLUDED.owner_id,
       uploader_handle = EXCLUDED.uploader_handle, metadata = EXCLUDED.metadata, status = 'previewed', updated_at = now()`,
    [JSON.stringify(attachmentRows.map(({ asset, ownerType, ownerId, uploaderHandle }) => ({
      id: asset.id,
      owner_type: ownerType,
      owner_id: ownerId,
      uploader_handle: uploaderHandle,
      object_key: asset.staticPublicPath.replace(/^\//, ""),
      file_name: asset.fileName,
      content_type: asset.contentType,
      byte_size: asset.byteSize,
      metadata: asset.metadata,
      created_at: asset.createdAt
    })))]
  );

  const actionRows = historicalInquiryItems.flatMap((entry) => ([
    ["save", entry.savedBy ?? []],
    ["signal", entry.signaledBy ?? []],
    ["fork", entry.forkedBy ?? []]
  ] as const).flatMap(([action, handles]) => handles.map((handle) => ({ post_id: entry.id, actor_handle: handle, action, created_at: entry.createdAt }))));
  if (actionRows.length) await client.query(
    `INSERT INTO post_actions (post_id, actor_handle, action, active, count, revision, created_at, updated_at)
     SELECT row.post_id, row.actor_handle, row.action, true, 1, 1,
       row.created_at::timestamptz, row.created_at::timestamptz
     FROM jsonb_to_recordset($1::jsonb) AS row(post_id text, actor_handle text, action text, created_at text)
     ON CONFLICT (post_id, actor_handle, action) DO NOTHING`,
    [JSON.stringify(actionRows)]
  );

  const followRows = historicalCommunities.flatMap((community) =>
    community.memberHandles.flatMap((handle, index) => {
      const next = community.memberHandles[(index + 1) % community.memberHandles.length];
      return handle === next ? [] : [{ follower_handle: handle, following_handle: next }];
    })
  );
  await client.query(
    `INSERT INTO profile_follows (follower_handle, following_handle, status)
     SELECT DISTINCT row.follower_handle, row.following_handle, 'active'
     FROM jsonb_to_recordset($1::jsonb) AS row(follower_handle text, following_handle text)
     ON CONFLICT (follower_handle, following_handle) DO NOTHING`,
    [JSON.stringify(followRows)]
  );
};

const insertPatronage = async (client: PoolClient) => {
  const proposals = historicalInquiryItems.filter((entry) => entry.patronage).map((entry) => ({ id: entry.id, ...entry.patronage! }));
  if (!proposals.length) return;
  await client.query(
    `INSERT INTO patronage_proposals (post_id, status, currency, goal_minor_units, deadline)
     SELECT row.id, row.status, row.currency, row.goal_minor_units, row.deadline::date
     FROM jsonb_to_recordset($1::jsonb) AS row(id text, status text, currency text, goal_minor_units bigint, deadline text)
     ON CONFLICT (post_id) DO NOTHING`,
    [JSON.stringify(proposals.map((entry) => ({ id: entry.id, status: entry.status, currency: entry.currency, goal_minor_units: entry.goalMinorUnits, deadline: entry.deadline })))]
  );
  const handleByName = new Map(historicalProfiles.map((person) => [person.name, person.handle]));
  const contributions = proposals.flatMap((proposal) => proposal.topSupporters.map((supporter, index) => ({
    id: `40000000-0000-4000-8000-${String(contributionsSequence(proposal.id, index)).padStart(12, "0")}`,
    post_id: proposal.id,
    contributor_handle: supporter.anonymous ? null : handleByName.get(supporter.displayName) ?? null,
    display_name: supporter.displayName,
    amount_minor_units: supporter.amountMinorUnits,
    currency: proposal.currency,
    anonymous: supporter.anonymous,
    provider_reference: `historical:${proposal.id}:${index}`
  })));
  await client.query(
    `INSERT INTO patronage_contributions (
       id, post_id, contributor_handle, display_name, amount_minor_units, currency,
       anonymous, provider, provider_reference, status, confirmed_at
     )
     SELECT row.id::uuid, row.post_id, row.contributor_handle, row.display_name,
       row.amount_minor_units, row.currency, row.anonymous, 'historical-fixture',
       row.provider_reference, 'confirmed', now()
     FROM jsonb_to_recordset($1::jsonb) AS row(
       id text, post_id text, contributor_handle text, display_name text,
       amount_minor_units bigint, currency text, anonymous boolean, provider_reference text
     )
     ON CONFLICT (provider, provider_reference) DO NOTHING`,
    [JSON.stringify(contributions)]
  );
};

const contributionsSequence = (postId: string, index: number) => {
  const proposalIndex = historicalInquiryItems.filter((entry) => entry.patronage).findIndex((entry) => entry.id === postId);
  return proposalIndex * 10 + index + 1;
};

export const syncHistoricalWorldFixtures = async (client: PoolClient) => {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [historicalWorldFixtureRevision]);
  const applied = await client.query("SELECT 1 FROM fixture_revisions WHERE id = $1", [historicalWorldFixtureRevision]);
  if (applied.rowCount) return { applied: false as const, revision: historicalWorldFixtureRevision };

  const protectedResult = await client.query<{ handle: string }>(
    `SELECT DISTINCT profile.handle
     FROM profiles profile
    INNER JOIN users account ON account.id = profile.user_id OR account.handle = profile.handle
     WHERE account.clerk_user_id IS NOT NULL
     ORDER BY profile.handle`
  );
  const protectedHandles = protectedResult.rows.map((row) => row.handle);
  const collision = protectedHandles.filter((handle) => historicalProfiles.some((person) => person.handle === handle));
  if (collision.length) {
    throw new Error(`Historical fixture handles collide with protected Clerk profiles: ${collision.join(", ")}`);
  }

  const manifest = await takeSnapshot(client, protectedHandles);
  await stageLegacyRemoval(client);
  await insertProfiles(client);
  await insertCommunities(client);
  await insertPosts(client);
  await insertAttachmentsAndActions(client);
  await insertPatronage(client);
  await client.query("INSERT INTO fixture_revisions (id) VALUES ($1)", [historicalWorldFixtureRevision]);

  return { applied: true as const, revision: historicalWorldFixtureRevision, manifest };
};
