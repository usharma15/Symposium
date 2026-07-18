import type { PoolClient } from "pg";
import type {
  CanonicalActionActivityContract,
  ProfileAuthoredCommentActivityContract,
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

type ProfileCommentCursor = {
  occurredAt: string;
  commentId: string;
};

export const encodeActivityCursor = (activity: CanonicalActionActivityContract) =>
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

export const encodeProfileCommentCursor = (activity: ProfileAuthoredCommentActivityContract) =>
  Buffer.from(
    JSON.stringify({
      occurredAt: activity.occurredAt,
      commentId: activity.commentId
    } satisfies ProfileCommentCursor)
  ).toString("base64url");

export const decodeProfileCommentCursor = (cursor?: string) => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<ProfileCommentCursor>;
    if (
      typeof parsed.occurredAt !== "string" ||
      Number.isNaN(Date.parse(parsed.occurredAt)) ||
      typeof parsed.commentId !== "string" ||
      !parsed.commentId ||
      parsed.commentId.length > 240
    ) {
      return null;
    }
    return parsed as ProfileCommentCursor;
  } catch {
    return null;
  }
};

type ProfileActivityRow = ActionLedgerRow & {
  subjectType: CanonicalActionActivityContract["subjectType"];
  subjectId: string;
  postId: string;
};

type ProfileAuthoredCommentRow = {
  commentId: string;
  postId: string;
  occurredAt: Date | string;
};

export const PROFILE_AUTHORED_COMMENTS_SQL = `SELECT
       comment.id AS "commentId",
       comment.post_id AS "postId",
       comment.created_at AS "occurredAt"
     FROM comments comment
     INNER JOIN posts post ON post.id = comment.post_id
     LEFT JOIN communities community ON community.id = post.community_id
     WHERE comment.author_handle = $1
       AND comment.deleted_at IS NULL
       AND post.deleted_at IS NULL
       AND ($5::boolean OR (post.room <> 'office' AND post.kind <> 'draft'))
       AND ($5::boolean OR post.community_id IS NULL OR post.post_type = 'paper' OR community.visibility = 'public')
       AND (
         $2::timestamptz IS NULL OR
         (comment.created_at, comment.id) < ($2::timestamptz, $3::text)
       )
     ORDER BY comment.created_at DESC, comment.id DESC
     LIMIT $4`;

export const PROFILE_ACTIVITY_COUNTS_SQL = `WITH scoped_posts AS (
       SELECT
         post.id,
         post.post_type,
         post.author_handle,
         COALESCE(community.visibility = 'private' AND post.post_type IS DISTINCT FROM 'paper', false) AS hidden
       FROM posts post
       LEFT JOIN communities community ON community.id = post.community_id
       WHERE post.deleted_at IS NULL
         AND ($2::boolean OR (post.room <> 'office' AND post.kind <> 'draft'))
     ),
     authored_posts AS (
       SELECT ('post:' || post.id) AS key, post.post_type, post.hidden
       FROM scoped_posts post
       WHERE post.author_handle = $1
     ),
     scoped_comments AS (
       SELECT comment.id, comment.author_handle, post.hidden
       FROM comments comment
       INNER JOIN scoped_posts post ON post.id = comment.post_id
       WHERE comment.deleted_at IS NULL
     ),
     authored_comments AS (
       SELECT ('comment:' || comment.id) AS key, comment.hidden
       FROM scoped_comments comment
       WHERE comment.author_handle = $1
     ),
     fork_subjects AS (
       SELECT ('post:' || action.post_id) AS key, post.hidden
       FROM post_actions action
       INNER JOIN scoped_posts post ON post.id = action.post_id
       WHERE action.actor_handle = $1 AND action.action = 'fork' AND action.active = true
       UNION
       SELECT ('comment:' || action.comment_id) AS key, comment.hidden
       FROM comment_actions action
       INNER JOIN scoped_comments comment ON comment.id = action.comment_id
       WHERE action.actor_handle = $1 AND action.action = 'fork' AND action.active = true
     ),
     like_subjects AS (
       SELECT ('post:' || action.post_id) AS key, post.hidden
       FROM post_actions action
       INNER JOIN scoped_posts post ON post.id = action.post_id
       WHERE action.actor_handle = $1 AND action.action = 'signal' AND action.active = true
       UNION
       SELECT ('comment:' || action.comment_id) AS key, comment.hidden
       FROM comment_actions action
       INNER JOIN scoped_comments comment ON comment.id = action.comment_id
       WHERE action.actor_handle = $1 AND action.action = 'signal' AND action.active = true
     ),
     saved_subjects AS (
       SELECT ('post:' || action.post_id) AS key, post.hidden
       FROM post_actions action
       INNER JOIN scoped_posts post ON post.id = action.post_id
       WHERE action.actor_handle = $1 AND action.action = 'save' AND action.active = true
       UNION
       SELECT ('comment:' || action.comment_id) AS key, comment.hidden
       FROM comment_actions action
       INNER JOIN scoped_comments comment ON comment.id = action.comment_id
       WHERE action.actor_handle = $1 AND action.action = 'save' AND action.active = true
     ),
     base_all AS (
       SELECT key, hidden FROM authored_posts
       UNION SELECT key, hidden FROM authored_comments
     ),
     complete_all AS (
       SELECT key, hidden FROM base_all
       UNION SELECT key, hidden FROM fork_subjects
     )
     SELECT
       (SELECT count(*)::int FROM complete_all) AS "totalAll",
       (SELECT count(*)::int FROM base_all) AS "totalAllWithoutReshares",
       (SELECT count(*)::int FROM authored_posts WHERE post_type = 'paper') AS "totalPapers",
       (SELECT count(*)::int FROM authored_posts WHERE post_type = 'thought') AS "totalThoughts",
       (SELECT count(*)::int FROM authored_posts WHERE post_type = 'proposal') AS "totalProposals",
       (SELECT count(*)::int FROM authored_posts WHERE post_type = 'opportunity') AS "totalOpportunities",
       (SELECT count(*)::int FROM authored_comments) AS "totalComments",
       (SELECT count(*)::int FROM fork_subjects) AS "totalReshares",
       (SELECT count(*)::int FROM like_subjects) AS "totalLikes",
       (SELECT count(*)::int FROM saved_subjects) AS "totalSaved",
       (SELECT count(*)::int FROM complete_all WHERE hidden) AS "hiddenAll",
       (SELECT count(*)::int FROM base_all WHERE hidden) AS "hiddenAllWithoutReshares",
       (SELECT count(*)::int FROM authored_posts WHERE hidden AND post_type = 'paper') AS "hiddenPapers",
       (SELECT count(*)::int FROM authored_posts WHERE hidden AND post_type = 'thought') AS "hiddenThoughts",
       (SELECT count(*)::int FROM authored_posts WHERE hidden AND post_type = 'proposal') AS "hiddenProposals",
       (SELECT count(*)::int FROM authored_posts WHERE hidden AND post_type = 'opportunity') AS "hiddenOpportunities",
       (SELECT count(*)::int FROM authored_comments WHERE hidden) AS "hiddenComments",
       (SELECT count(*)::int FROM fork_subjects WHERE hidden) AS "hiddenReshares",
       (SELECT count(*)::int FROM like_subjects WHERE hidden) AS "hiddenLikes",
       (SELECT count(*)::int FROM saved_subjects WHERE hidden) AS "hiddenSaved"`;

const activityCountsFromRow = (
  row: Record<string, unknown>,
  prefix: "total" | "hidden",
  allowedActions: ToggleActionContract[]
): ProfileActivityCountsContract => ({
  all: Number(row[allowedActions.includes("fork") ? `${prefix}All` : `${prefix}AllWithoutReshares`] ?? 0),
  papers: Number(row[`${prefix}Papers`] ?? 0),
  thoughts: Number(row[`${prefix}Thoughts`] ?? 0),
  proposals: Number(row[`${prefix}Proposals`] ?? 0),
  opportunities: Number(row[`${prefix}Opportunities`] ?? 0),
  comments: Number(row[`${prefix}Comments`] ?? 0),
  reshares: allowedActions.includes("fork") ? Number(row[`${prefix}Reshares`] ?? 0) : 0,
  likes: allowedActions.includes("signal") ? Number(row[`${prefix}Likes`] ?? 0) : 0,
  saved: allowedActions.includes("save") ? Number(row[`${prefix}Saved`] ?? 0) : 0
});

const profileActivityCountSummary = async (
  client: PoolClient,
  actorHandle: string,
  allowedActions: ToggleActionContract[],
  includePrivateWorkspace: boolean
) => {
  const result = await client.query<Record<string, unknown>>(
    PROFILE_ACTIVITY_COUNTS_SQL,
    [actorHandle, includePrivateWorkspace]
  );
  const row = result.rows[0] ?? {};
  return {
    totals: activityCountsFromRow(row, "total", allowedActions),
    hiddenCommunityCounts: includePrivateWorkspace
      ? { all: 0, papers: 0, thoughts: 0, proposals: 0, opportunities: 0, comments: 0, reshares: 0, likes: 0, saved: 0 }
      : activityCountsFromRow(row, "hidden", allowedActions)
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

const listAuthoredProfileComments = async (
  client: PoolClient,
  actorHandle: string,
  query: ProfileActivityQueryContract,
  includePrivateWorkspace: boolean
) => {
  if (!query.includeComments) {
    return { authoredComments: [], commentsNextCursor: null };
  }
  const cursor = decodeProfileCommentCursor(query.commentsCursor);
  const result = await client.query<ProfileAuthoredCommentRow>(
    PROFILE_AUTHORED_COMMENTS_SQL,
    [
      actorHandle,
      cursor?.occurredAt ?? null,
      cursor?.commentId ?? "",
      query.limit + 1,
      includePrivateWorkspace
    ]
  );
  const activities = result.rows.map((row): ProfileAuthoredCommentActivityContract => ({
    commentId: row.commentId,
    postId: row.postId,
    occurredAt: new Date(row.occurredAt).toISOString()
  }));
  const hasNextPage = activities.length > query.limit;
  const authoredComments = hasNextPage ? activities.slice(0, query.limit) : activities;
  return {
    authoredComments,
    commentsNextCursor: hasNextPage && authoredComments.length
      ? encodeProfileCommentCursor(authoredComments[authoredComments.length - 1])
      : null
  };
};

export const listCanonicalProfileActivity = async (
  client: PoolClient,
  actorHandle: string,
  allowedActions: ToggleActionContract[],
  query: ProfileActivityQueryContract,
  includeInactive: boolean
): Promise<ProfileActivityResponseContract> => {
  const countSummary = query.includeSummary
    ? await profileActivityCountSummary(client, actorHandle, allowedActions, includeInactive)
    : {};
  const requestedActions = new Set(query.actions ?? allowedActions);
  const activityActions = allowedActions.filter((action) => requestedActions.has(action));
  const commentSummary = await listAuthoredProfileComments(client, actorHandle, query, includeInactive);
  if (!activityActions.length) {
    return { entries: [], nextCursor: null, ...commentSummary, ...countSummary };
  }
  const cursor = decodeActivityCursor(query.cursor);
  const result = await client.query<ProfileActivityRow>(
    PROFILE_ACTIVITY_SQL,
    [
      actorHandle,
      activityActions,
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
    ...commentSummary,
    ...countSummary
  };
};
