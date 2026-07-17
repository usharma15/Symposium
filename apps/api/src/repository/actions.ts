import type { PoolClient } from "pg";
import type {
  CanonicalActionActivityContract,
  ProfileActivityCountsContract,
  ProfileActivityQueryContract,
  ProfileActivityResponseContract,
  ToggleActionContract
} from "../../../../packages/contracts/src";

type ActionLedgerRow = {
  actorHandle: string;
  action: ToggleActionContract;
  active: boolean;
  count: number;
  revision: number;
  updatedAt: Date | string;
};

type LedgerTransition = {
  activity: CanonicalActionActivityContract;
  changed: boolean;
  previousActive: boolean;
};

const toActivity = (
  row: ActionLedgerRow,
  subjectType: CanonicalActionActivityContract["subjectType"],
  subjectId: string,
  postId: string
): CanonicalActionActivityContract => ({
  subjectType,
  subjectId,
  postId,
  actorHandle: row.actorHandle,
  action: row.action,
  active: row.active,
  count: row.count,
  revision: row.revision,
  occurredAt: new Date(row.updatedAt).toISOString()
});

export const resolveActionTransition = (existingActive: boolean | undefined, requestedActive?: boolean) => {
  const previousActive = existingActive ?? false;
  const nextActive = requestedActive ?? !previousActive;
  return { previousActive, nextActive, changed: previousActive !== nextActive };
};

const transitionLedger = async ({
  client,
  table,
  subjectColumn,
  subjectType,
  subjectId,
  postId,
  actorHandle,
  action,
  active
}: {
  client: PoolClient;
  table: "post_actions" | "comment_actions";
  subjectColumn: "post_id" | "comment_id";
  subjectType: CanonicalActionActivityContract["subjectType"];
  subjectId: string;
  postId: string;
  actorHandle: string;
  action: ToggleActionContract;
  active?: boolean;
}): Promise<LedgerTransition> => {
  const existingResult = await client.query<ActionLedgerRow>(
    `SELECT actor_handle AS "actorHandle", action, active, count, revision, updated_at AS "updatedAt"
     FROM ${table}
     WHERE ${subjectColumn} = $1 AND actor_handle = $2 AND action = $3
     FOR UPDATE`,
    [subjectId, actorHandle, action]
  );
  const existing = existingResult.rows[0];
  const { previousActive, nextActive, changed } = resolveActionTransition(existing?.active, active);

  let row: ActionLedgerRow;
  if (!existing) {
    const columns = table === "comment_actions"
      ? "comment_id, post_id, actor_handle, action, active, count"
      : "post_id, actor_handle, action, active, count";
    const values = table === "comment_actions" ? "($1, $4, $2, $3, $5, $6)" : "($1, $2, $3, $4, $5)";
    const parameters = table === "comment_actions"
      ? [subjectId, actorHandle, action, postId, nextActive, nextActive ? 1 : 0]
      : [subjectId, actorHandle, action, nextActive, nextActive ? 1 : 0];
    const inserted = await client.query<ActionLedgerRow>(
      `INSERT INTO ${table} (${columns})
       VALUES ${values}
       RETURNING actor_handle AS "actorHandle", action, active, count, revision, updated_at AS "updatedAt"`,
      parameters
    );
    row = inserted.rows[0];
  } else if (previousActive !== nextActive) {
    const updated = await client.query<ActionLedgerRow>(
      `UPDATE ${table}
       SET active = $4,
           count = CASE WHEN $4 THEN 1 ELSE 0 END,
           revision = revision + 1,
           updated_at = now()
       WHERE ${subjectColumn} = $1 AND actor_handle = $2 AND action = $3
       RETURNING actor_handle AS "actorHandle", action, active, count, revision, updated_at AS "updatedAt"`,
      [subjectId, actorHandle, action, nextActive]
    );
    row = updated.rows[0];
  } else {
    row = existing;
  }

  return {
    activity: toActivity(row, subjectType, subjectId, postId),
    changed,
    previousActive
  };
};

export const transitionPostAction = (
  client: PoolClient,
  postId: string,
  actorHandle: string,
  action: ToggleActionContract,
  active?: boolean
) =>
  transitionLedger({
    client,
    table: "post_actions",
    subjectColumn: "post_id",
    subjectType: "post",
    subjectId: postId,
    postId,
    actorHandle,
    action,
    active
  });

export const transitionCommentAction = (
  client: PoolClient,
  postId: string,
  commentId: string,
  actorHandle: string,
  action: ToggleActionContract,
  active?: boolean
) =>
  transitionLedger({
    client,
    table: "comment_actions",
    subjectColumn: "comment_id",
    subjectType: "comment",
    subjectId: commentId,
    postId,
    actorHandle,
    action,
    active
  });

type ActivityCursor = {
  occurredAt: string;
  subjectType: CanonicalActionActivityContract["subjectType"];
  subjectId: string;
  action: ToggleActionContract;
};

const encodeActivityCursor = (activity: CanonicalActionActivityContract) =>
  Buffer.from(
    JSON.stringify({
      occurredAt: activity.occurredAt,
      subjectType: activity.subjectType,
      subjectId: activity.subjectId,
      action: activity.action
    } satisfies ActivityCursor)
  ).toString("base64url");

export const decodeActivityCursor = (cursor?: string) => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<ActivityCursor>;
    if (
      typeof parsed.occurredAt !== "string" ||
      Number.isNaN(Date.parse(parsed.occurredAt)) ||
      (parsed.subjectType !== "post" && parsed.subjectType !== "comment") ||
      typeof parsed.subjectId !== "string" ||
      (parsed.action !== "save" && parsed.action !== "signal" && parsed.action !== "fork")
    ) {
      return null;
    }
    return parsed as ActivityCursor;
  } catch {
    return null;
  }
};

type ProfileActivityRow = ActionLedgerRow & {
  subjectType: CanonicalActionActivityContract["subjectType"];
  subjectId: string;
  postId: string;
};

type HiddenCommunityActivityRow = ProfileActivityCountsContract & { allWithoutReshares: number };

const hiddenCommunityActivityCounts = async (
  client: PoolClient,
  actorHandle: string,
  allowedActions: ToggleActionContract[]
): Promise<ProfileActivityCountsContract> => {
  const result = await client.query<HiddenCommunityActivityRow>(
    `WITH private_community_posts AS (
       SELECT post.id, post.post_type, post.author_handle, post.quote
       FROM posts post
       INNER JOIN communities community ON community.id = post.community_id
       WHERE community.visibility = 'private'
         AND post.deleted_at IS NULL
         AND post.room <> 'office'
         AND post.kind <> 'draft'
     ),
     hidden_posts AS (
       SELECT * FROM private_community_posts WHERE post_type IS DISTINCT FROM 'paper'
     ),
     authored_posts AS (
       SELECT ('post:' || post.id) AS key, post.post_type, post.quote
       FROM hidden_posts post
       WHERE post.author_handle = $1
     ),
     hidden_comments AS (
       SELECT comment.id, comment.author_handle, comment.quote
       FROM comments comment
       INNER JOIN hidden_posts post ON post.id = comment.post_id
       WHERE comment.deleted_at IS NULL
     ),
     authored_comments AS (
       SELECT ('comment:' || comment.id) AS key, comment.quote
       FROM hidden_comments comment
       WHERE comment.author_handle = $1
     ),
     fork_subjects AS (
       SELECT ('post:' || action.post_id) AS key
       FROM post_actions action
       INNER JOIN hidden_posts post ON post.id = action.post_id
       WHERE action.actor_handle = $1 AND action.action = 'fork' AND action.active = true
       UNION
       SELECT ('comment:' || action.comment_id) AS key
       FROM comment_actions action
       INNER JOIN hidden_comments comment ON comment.id = action.comment_id
       WHERE action.actor_handle = $1 AND action.action = 'fork' AND action.active = true
       UNION
       SELECT key FROM authored_posts WHERE quote IS NOT NULL
       UNION
       SELECT key FROM authored_comments WHERE quote IS NOT NULL
     ),
     like_subjects AS (
       SELECT ('post:' || action.post_id) AS key
       FROM post_actions action
       INNER JOIN hidden_posts post ON post.id = action.post_id
       WHERE action.actor_handle = $1 AND action.action = 'signal' AND action.active = true
       UNION
       SELECT ('comment:' || action.comment_id) AS key
       FROM comment_actions action
       INNER JOIN hidden_comments comment ON comment.id = action.comment_id
       WHERE action.actor_handle = $1 AND action.action = 'signal' AND action.active = true
     ),
     saved_subjects AS (
       SELECT ('post:' || action.post_id) AS key
       FROM post_actions action
       INNER JOIN hidden_posts post ON post.id = action.post_id
       WHERE action.actor_handle = $1 AND action.action = 'save' AND action.active = true
       UNION
       SELECT ('comment:' || action.comment_id) AS key
       FROM comment_actions action
       INNER JOIN hidden_comments comment ON comment.id = action.comment_id
       WHERE action.actor_handle = $1 AND action.action = 'save' AND action.active = true
     ),
     base_all AS (
       SELECT key FROM authored_posts
       UNION SELECT key FROM authored_comments
     ),
     complete_all AS (
       SELECT key FROM base_all
       UNION SELECT key FROM fork_subjects
     )
     SELECT
       (SELECT count(*)::int FROM complete_all) AS "all",
       (SELECT count(*)::int FROM base_all) AS "allWithoutReshares",
       0::int AS papers,
       (SELECT count(*)::int FROM authored_posts WHERE post_type = 'thought') AS thoughts,
       (SELECT count(*)::int FROM authored_posts WHERE post_type = 'proposal') AS proposals,
       (SELECT count(*)::int FROM authored_posts WHERE post_type = 'opportunity') AS opportunities,
       (SELECT count(*)::int FROM authored_comments) AS comments,
       (SELECT count(*)::int FROM fork_subjects) AS reshares,
       (SELECT count(*)::int FROM like_subjects) AS likes,
       (SELECT count(*)::int FROM saved_subjects) AS saved`,
    [actorHandle]
  );
  const counts = result.rows[0] ?? {
    all: 0,
    allWithoutReshares: 0,
    papers: 0,
    thoughts: 0,
    proposals: 0,
    opportunities: 0,
    comments: 0,
    reshares: 0,
    likes: 0,
    saved: 0
  };
  return {
    all: allowedActions.includes("fork") ? Number(counts.all) : Number(counts.allWithoutReshares),
    papers: 0,
    thoughts: Number(counts.thoughts),
    proposals: Number(counts.proposals),
    opportunities: Number(counts.opportunities),
    comments: Number(counts.comments),
    reshares: allowedActions.includes("fork") ? Number(counts.reshares) : 0,
    likes: allowedActions.includes("signal") ? Number(counts.likes) : 0,
    saved: allowedActions.includes("save") ? Number(counts.saved) : 0
  };
};

export const PROFILE_ACTIVITY_SQL = `WITH profile_activity AS (
       SELECT
         'post'::text AS "subjectType",
         post_action.post_id AS "subjectId",
         post_action.post_id AS "postId",
         post_action.actor_handle AS "actorHandle",
         post_action.action,
         post_action.active,
         post_action.count,
         post_action.revision,
         post_action.updated_at AS "updatedAt"
       FROM post_actions AS post_action
       JOIN posts AS post ON post.id = post_action.post_id
       LEFT JOIN communities AS community ON community.id = post.community_id
       WHERE post_action.actor_handle = $1
         AND post_action.action = ANY($2::text[])
         AND ($8::boolean OR post_action.active = true)
         AND post.deleted_at IS NULL
         AND ($8::boolean OR (post.room <> 'office' AND post.kind <> 'draft'))
         AND ($8::boolean OR post.community_id IS NULL OR post.post_type = 'paper' OR community.visibility = 'public')
       UNION ALL
       SELECT
         'comment'::text AS "subjectType",
         comment_action.comment_id AS "subjectId",
         comment_action.post_id AS "postId",
         comment_action.actor_handle AS "actorHandle",
         comment_action.action,
         comment_action.active,
         comment_action.count,
         comment_action.revision,
         comment_action.updated_at AS "updatedAt"
       FROM comment_actions AS comment_action
       JOIN posts AS post ON post.id = comment_action.post_id
       LEFT JOIN communities AS community ON community.id = post.community_id
       WHERE comment_action.actor_handle = $1
         AND comment_action.action = ANY($2::text[])
         AND ($8::boolean OR comment_action.active = true)
         AND post.deleted_at IS NULL
         AND ($8::boolean OR (post.room <> 'office' AND post.kind <> 'draft'))
         AND ($8::boolean OR post.community_id IS NULL OR post.post_type = 'paper' OR community.visibility = 'public')
     )
     SELECT *
     FROM profile_activity
     WHERE (
       $3::timestamptz IS NULL OR
       ("updatedAt", "subjectType", "subjectId", action) < ($3::timestamptz, $4::text, $5::text, $6::text)
     )
     ORDER BY "updatedAt" DESC, "subjectType" DESC, "subjectId" DESC, action DESC
     LIMIT $7`;

export const listCanonicalProfileActivity = async (
  client: PoolClient,
  actorHandle: string,
  allowedActions: ToggleActionContract[],
  query: ProfileActivityQueryContract,
  includeInactive: boolean
): Promise<ProfileActivityResponseContract> => {
  const hiddenCommunityCounts = includeInactive
    ? { all: 0, papers: 0, thoughts: 0, proposals: 0, opportunities: 0, comments: 0, reshares: 0, likes: 0, saved: 0 }
    : await hiddenCommunityActivityCounts(client, actorHandle, allowedActions);
  if (!allowedActions.length) return { entries: [], nextCursor: null, hiddenCommunityCounts };
  const cursor = decodeActivityCursor(query.cursor);
  const result = await client.query<ProfileActivityRow>(
    PROFILE_ACTIVITY_SQL,
    [
      actorHandle,
      allowedActions,
      cursor?.occurredAt ?? null,
      cursor?.subjectType ?? "post",
      cursor?.subjectId ?? "",
      cursor?.action ?? "save",
      query.limit + 1,
      includeInactive
    ]
  );

  const activities = result.rows.map((row) =>
    toActivity(row, row.subjectType, row.subjectId, row.postId)
  );
  const hasNextPage = activities.length > query.limit;
  const entries = hasNextPage ? activities.slice(0, query.limit) : activities;
  return {
    entries,
    nextCursor: hasNextPage && entries.length ? encodeActivityCursor(entries[entries.length - 1]) : null,
    hiddenCommunityCounts
  };
};
