import type { PoolClient } from "pg";
import type { NotificationContract } from "../../../../packages/contracts/src";

type NotificationGroupRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date | string;
  readAt: Date | string | null;
  groupCount: number;
  actorCount: number;
};

export type NotificationPriority = NotificationContract["priority"];

const metadataString = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export const notificationActorHandle = (metadata: Record<string, unknown> | undefined) =>
  metadataString(metadata, "actorHandle")
  ?? metadataString(metadata, "followerHandle")
  ?? metadataString(metadata, "requesterHandle")
  ?? metadataString(metadata, "applicantHandle");

export const actionRequiredNotificationKinds = [
  "community_join_request",
  "opportunity_application_received"
] as const;

export const importantNotificationKinds = [
  "community_member_removed",
  "community_request_approved",
  "community_request_declined",
  "community_role_updated",
  "group_added",
  "group_removed",
  "group_role_updated",
  "opportunity_application_closed",
  "opportunity_application_shortlisted",
  "opportunity_application_status",
  "workspace_access_granted",
  "workspace_access_revoked",
  "workspace_access_updated"
] as const;

export const attentionNotificationKinds = [
  ...actionRequiredNotificationKinds,
  ...importantNotificationKinds
] as const;

const actionRequiredKinds = new Set<string>(actionRequiredNotificationKinds);
const importantKinds = new Set<string>(importantNotificationKinds);

export const notificationPriority = (kind: string): NotificationPriority => {
  if (actionRequiredKinds.has(kind)) return "action";
  if (importantKinds.has(kind)) return "important";
  return "activity";
};

export const notificationActionLabel = (kind: string, href: string | null) => {
  if (!href) return null;
  if (kind === "community_join_request") return "Review requests";
  if (kind === "opportunity_application_received") return "Review applications";
  if (kind === "post_signal" || kind === "comment_signal") return "View likes";
  if (kind === "post_reshare" || kind === "comment_reshare") return "View reshares";
  if (kind === "post_comment") return "View comments";
  if (kind === "comment_reply") return "View reply";
  if (kind === "profile_followed") return "View profile";
  if (kind === "workspace_comment") return "Open comment";
  if (kind === "workspace_comment_reply") return "View reply";
  if (kind === "workspace_comment_signal") return "View likes";
  if (kind.startsWith("workspace_access_")) return "Open workspace";
  if (kind.startsWith("community_")) return "Open community";
  if (kind.startsWith("opportunity_application_")) return "View opportunity";
  if (kind.startsWith("group_")) return "Open messages";
  return "Open";
};

export const inferNotificationAggregationKey = (
  kind: string,
  metadata: Record<string, unknown> | undefined
) => {
  const postId = metadataString(metadata, "postId");
  const commentId = metadataString(metadata, "commentId");
  const parentCommentId = metadataString(metadata, "parentCommentId");
  const communityId = metadataString(metadata, "communityId");
  const noteId = metadataString(metadata, "noteId");
  if (["post_signal", "post_reshare", "post_comment"].includes(kind) && postId) {
    return `${kind}:post:${postId}`;
  }
  if (["comment_signal", "comment_reshare"].includes(kind) && commentId) {
    return `${kind}:comment:${commentId}`;
  }
  if (kind === "comment_reply" && parentCommentId) {
    return `${kind}:comment:${parentCommentId}`;
  }
  if (kind === "profile_followed") return kind;
  if (kind === "community_join_request" && communityId) {
    return `${kind}:community:${communityId}`;
  }
  if (kind === "opportunity_application_received" && postId) {
    return `${kind}:post:${postId}`;
  }
  if (["workspace_comment", "workspace_comment_reply"].includes(kind) && noteId) {
    return `${kind}:note:${noteId}`;
  }
  if (kind === "workspace_comment_signal" && commentId) {
    return `${kind}:comment:${commentId}`;
  }
  return null;
};

const actorSummary = (names: string[], actorCount: number) => {
  const first = names[0] ?? "Someone";
  if (actorCount <= 1) return first;
  const second = names[1];
  if (actorCount === 2 && second) return `${first} and ${second}`;
  if (!second) return `${first} and ${actorCount - 1} others`;
  return `${first}, ${second}, and ${actorCount - 2} others`;
};

export const groupedNotificationTitle = (
  row: Pick<NotificationGroupRow, "kind" | "title" | "metadata" | "groupCount">,
  actorNames: string[],
  actorCount: number
) => {
  const titleSubject = row.kind === "community_join_request"
    ? row.title.split(" requested to join ").at(-1)
    : row.title.match(/\byour (.+)$/i)?.[1];
  const subjectLabel = metadataString(row.metadata ?? undefined, "subjectLabel")
    ?? titleSubject
    ?? (row.kind === "community_join_request" ? "community" : "post");
  const actors = actorSummary(actorNames, actorCount);
  let title = row.title;
  if (row.kind === "post_signal") title = `${actors} liked your ${subjectLabel}`;
  else if (row.kind === "post_reshare") title = `${actors} reshared your ${subjectLabel}`;
  else if (row.kind === "comment_signal") title = `${actors} liked your comment`;
  else if (row.kind === "comment_reshare") title = `${actors} reshared your comment`;
  if (row.kind === "post_comment") {
    title = actorCount === 1 && row.groupCount > 1
      ? `${actors} added ${row.groupCount} comments to your ${subjectLabel}`
      : `${actors} commented on your ${subjectLabel}`;
  } else if (row.kind === "comment_reply") {
    title = actorCount === 1 && row.groupCount > 1
      ? `${actors} added ${row.groupCount} replies to your comment`
      : `${actors} replied to your comment`;
  } else if (row.kind === "profile_followed") title = `${actors} followed you`;
  else if (row.kind === "community_join_request") {
    title = actorCount === 1 && row.groupCount > 1
      ? `${actors} sent ${row.groupCount} requests to join ${subjectLabel}`
      : `${actors} requested to join ${subjectLabel}`;
  } else if (row.kind === "opportunity_application_received") {
    title = actorCount === 1 && row.groupCount > 1
      ? `${actors} sent ${row.groupCount} applications to your opportunity`
      : `${actors} applied to your opportunity`;
  } else if (row.kind === "workspace_comment") {
    title = actorCount === 1 && row.groupCount > 1
      ? `${actors} added ${row.groupCount} comments to your draft`
      : `${actors} commented on your draft`;
  } else if (row.kind === "workspace_comment_reply") {
    title = actorCount === 1 && row.groupCount > 1
      ? `${actors} added ${row.groupCount} replies to your draft comment`
      : `${actors} replied to your draft comment`;
  } else if (row.kind === "workspace_comment_signal") title = `${actors} liked your draft comment`;
  return Array.from(title).slice(0, 200).join("");
};

export const projectNotificationGroup = async (
  client: PoolClient,
  profileHandle: string,
  groupKey: string
): Promise<NotificationContract | null> => {
  const result = await client.query<NotificationGroupRow>(
     `WITH summary AS (
       SELECT
         CASE
           WHEN bool_or(read_at IS NULL)
             THEN (count(*) FILTER (WHERE read_at IS NULL))::int
           ELSE count(*)::int
         END AS "groupCount",
         CASE
           WHEN bool_or(read_at IS NULL) THEN count(DISTINCT CASE
             WHEN read_at IS NULL THEN COALESCE(
               metadata ->> 'actorHandle',
               metadata ->> 'followerHandle',
               metadata ->> 'requesterHandle',
               metadata ->> 'applicantHandle'
             )
           END)::int
           ELSE count(DISTINCT COALESCE(
             metadata ->> 'actorHandle',
             metadata ->> 'followerHandle',
             metadata ->> 'requesterHandle',
             metadata ->> 'applicantHandle'
           ))::int
         END AS "actorCount",
         CASE
           WHEN bool_or(read_at IS NULL) THEN NULL
           ELSE max(read_at)
         END AS "readAt"
       FROM notifications
       WHERE profile_handle = $1
         AND kind <> 'message'
         AND COALESCE(aggregation_key, 'notification:' || id::text) = $2
     )
     SELECT latest.id::text, latest.kind, latest.title, latest.body, latest.href,
       latest.metadata, latest.created_at AS "createdAt", summary."readAt",
       summary."groupCount", summary."actorCount"
     FROM summary
     CROSS JOIN LATERAL (
       SELECT id, kind, title, body, href, metadata, created_at
       FROM notifications
       WHERE profile_handle = $1
         AND kind <> 'message'
         AND COALESCE(aggregation_key, 'notification:' || id::text) = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 1
     ) latest`,
    [profileHandle, groupKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  const actorRows = await client.query<{ metadata: Record<string, unknown> | null }>(
    `SELECT metadata
     FROM notifications
     WHERE profile_handle = $1
       AND kind <> 'message'
       AND COALESCE(aggregation_key, 'notification:' || id::text) = $2
       AND (
         read_at IS NULL
         OR NOT EXISTS (
           SELECT 1
           FROM notifications unread
           WHERE unread.profile_handle = $1
             AND unread.kind <> 'message'
             AND COALESCE(unread.aggregation_key, 'notification:' || unread.id::text) = $2
             AND unread.read_at IS NULL
         )
       )
     ORDER BY created_at DESC, id DESC
     LIMIT 80`,
    [profileHandle, groupKey]
  );
  const actorHandles: string[] = [];
  const actorNames: string[] = [];
  for (const actorRow of actorRows.rows) {
    const metadata = actorRow.metadata ?? {};
    const handle = notificationActorHandle(metadata);
    if (!handle || actorHandles.includes(handle)) continue;
    actorHandles.push(handle);
    actorNames.push(metadataString(metadata, "actorName") ?? handle);
    if (actorHandles.length >= 24) break;
  }
  return {
    id: row.id,
    groupKey,
    groupCount: row.groupCount,
    actorHandles,
    priority: notificationPriority(row.kind),
    actionLabel: notificationActionLabel(row.kind, row.href ?? null),
    kind: row.kind,
    title: groupedNotificationTitle(row, actorNames, row.actorCount),
    body: row.body,
    href: row.href ?? null,
    readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
    metadata: { ...(row.metadata ?? {}), groupKey },
    createdAt: new Date(row.createdAt).toISOString()
  };
};
