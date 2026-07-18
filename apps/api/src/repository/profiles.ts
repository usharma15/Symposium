import { TRPCError } from "@trpc/server";
import {
  followProfileInputSchema,
  profileActivityQuerySchema,
  unfollowProfileInputSchema,
  type ProfileActivityResponseContract,
  type ToggleActionContract
} from "../../../../packages/contracts/src";
import { buildLegacyProfileActivity, buildLegacyProfileAuthoredComments, emptyProfileActivityCounts, hiddenCommunityActivityCounts, profileActivityCounts, profileCommentsArePubliclyListable, profileItemIsInActivityScope, profileItemIsPubliclyListable, universalProfileActivityActions } from "@/lib/profileActivity";
import { researchCommunities } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { runAtomic } from "../services/transactions";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { decodeActivityCursor, decodeProfileCommentCursor, encodeActivityCursor, encodeProfileCommentCursor, listCanonicalProfileActivity } from "./actions";
import { actorHandle, ensureLiveData, ensureProfileHandle, getInitialState } from "./foundation";
import { listProfileActivitySubjects } from "./inquiryReads";

export const listProfileActivity = async (
  rawHandle: string,
  rawQuery: unknown,
  actor: Actor
): Promise<ProfileActivityResponseContract> => {
  const handle = cleanHandle(rawHandle);
  const query = profileActivityQuerySchema.parse(rawQuery ?? {});
  if (query.cursor && !decodeActivityCursor(query.cursor)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid profile activity cursor." });
  }
  if (query.commentsCursor && !decodeProfileCommentCursor(query.commentsCursor)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid profile comment cursor." });
  }

  const requesterHandle = actor.handle ? cleanHandle(actor.handle) : null;

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const person = snapshot.profiles[handle];
    if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found." });
    const ownProfile = requesterHandle === handle;
    const allowedActions: ToggleActionContract[] = [
      ...(ownProfile ? (["save"] as const) : []),
      ...(ownProfile || person.likesPublic !== false ? (["signal"] as const) : []),
      ...(ownProfile || person.resharesPublic !== false ? (["fork"] as const) : [])
    ];
    const requestedActions = new Set(query.actions ?? allowedActions);
    const activityActions = allowedActions.filter((action) => requestedActions.has(action));
    const activityCursor = decodeActivityCursor(query.cursor);
    const profileItems = snapshot.items.filter(profileItemIsInActivityScope);
    const allEntries = buildLegacyProfileActivity(
        profileItems.filter((item) => ownProfile || profileItemIsPubliclyListable(item, researchCommunities)),
        handle,
        activityActions
      ).filter((activity) => !activityCursor || (
        activity.occurredAt < activityCursor.occurredAt ||
        (activity.occurredAt === activityCursor.occurredAt &&
          `${activity.subjectType}:${activity.subjectId}:${activity.action}` <
          `${activityCursor.subjectType}:${activityCursor.subjectId}:${activityCursor.action}`)
      ));
    const entries = allEntries.slice(0, query.limit);
    const commentCursor = decodeProfileCommentCursor(query.commentsCursor);
    const allAuthoredComments = query.includeComments
      ? buildLegacyProfileAuthoredComments(
          profileItems.filter((item) => ownProfile || profileCommentsArePubliclyListable(item, researchCommunities)),
          handle
        ).filter((activity) => !commentCursor || (
          activity.occurredAt < commentCursor.occurredAt ||
          (activity.occurredAt === commentCursor.occurredAt && activity.commentId < commentCursor.commentId)
        ))
      : [];
    const authoredComments = allAuthoredComments.slice(0, query.limit);
    return {
      entries,
      nextCursor: allEntries.length > entries.length && entries.length
        ? encodeActivityCursor(entries[entries.length - 1])
        : null,
      authoredComments,
      commentsNextCursor: allAuthoredComments.length > authoredComments.length && authoredComments.length
        ? encodeProfileCommentCursor(authoredComments[authoredComments.length - 1])
        : null,
      ...(query.includeSummary ? {
        hiddenCommunityCounts: ownProfile
          ? emptyProfileActivityCounts()
          : hiddenCommunityActivityCounts(snapshot.items, researchCommunities, handle, universalProfileActivityActions),
        totals: profileActivityCounts(snapshot.items, handle, universalProfileActivityActions)
      } : {})
    };
  }

  await ensureLiveData();
  const profileResult = await getPool().query<{ likesPublic: boolean; resharesPublic: boolean }>(
    `SELECT likes_public AS "likesPublic", reshares_public AS "resharesPublic"
     FROM profiles
     WHERE handle = $1
     LIMIT 1`,
    [handle]
  );
  const person = profileResult.rows[0];
  if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found." });

  const ownProfile = requesterHandle === handle;
  const allowedActions: ToggleActionContract[] = [
    ...(ownProfile ? (["save"] as const) : []),
    ...(ownProfile || person.likesPublic ? (["signal"] as const) : []),
    ...(ownProfile || person.resharesPublic ? (["fork"] as const) : [])
  ];
  const client = await getPool().connect();
  let activity: ProfileActivityResponseContract;
  try {
    activity = await listCanonicalProfileActivity(client, handle, allowedActions, query, ownProfile);
  } finally {
    client.release();
  }
  const hydration = await listProfileActivitySubjects(
    [
      ...activity.entries.map((entry) => entry.postId),
      ...(activity.authoredComments ?? []).map((entry) => entry.postId)
    ],
    [
      ...activity.entries.filter((entry) => entry.subjectType === "comment").map((entry) => entry.subjectId),
      ...(activity.authoredComments ?? []).map((entry) => entry.commentId)
    ],
    requesterHandle
  );
  return { ...activity, ...hydration };
};

export const followProfile = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = followProfileInputSchema.parse(rawInput);
  const follower = await ensureProfileHandle(actorHandle(actor));
  const following = await ensureProfileHandle(input.targetHandle);

  if (follower === following) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot follow yourself." });
  }

  if (!hasDatabase()) {
    return { followerHandle: follower, followingHandle: following, status: input.status, revision: 1 };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<{
      followerHandle: string;
      followingHandle: string;
      status: string;
      revision: number;
      updatedAt: string;
    }>(client, follower, mutation);
    if (claim.replayed) return { value: claim.response };
    const result = await client.query<{ revision: number; updatedAt: Date | string }>(
      `INSERT INTO profile_follows (follower_handle, following_handle, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (follower_handle, following_handle)
       DO UPDATE SET
         status = EXCLUDED.status,
         revision = CASE
           WHEN profile_follows.status IS DISTINCT FROM EXCLUDED.status
             THEN profile_follows.revision + 1
           ELSE profile_follows.revision
         END,
         updated_at = CASE
           WHEN profile_follows.status IS DISTINCT FROM EXCLUDED.status THEN now()
           ELSE profile_follows.updated_at
         END
       RETURNING revision, updated_at AS "updatedAt"`,
      [follower, following, input.status]
    );
    const value = {
      followerHandle: follower,
      followingHandle: following,
      status: input.status,
      revision: result.rows[0].revision,
      updatedAt: new Date(result.rows[0].updatedAt).toISOString()
    };
    await completeMutation(client, follower, mutation, value);
    await stageAuditLog(client, {
      actorHandle: follower,
      action: "profile.follow",
      subjectType: "profile",
      subjectId: following,
      metadata: mutationAuditMetadata(mutation, { status: input.status })
    });
    const event = await stageEvent(client, {
      kind: "profile.followed",
      actorHandle: follower,
      subjectType: "profile",
      subjectId: following,
      visibility: input.status === "active" ? "public" : "private",
      payload: { follow: value }
    });
    return { value, events: [event] };
  });
};

export const unfollowProfile = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = unfollowProfileInputSchema.parse(rawInput);
  const follower = await ensureProfileHandle(actorHandle(actor, input.actorHandle));
  const following = cleanHandle(input.targetHandle);

  if (hasDatabase()) {
    await ensureLiveData();
    return runAtomic(async (client) => {
      const claim = await claimMutation<{
        followerHandle: string;
        followingHandle: string;
        status: "none";
        revision: number;
        updatedAt: string;
      }>(client, follower, mutation);
      if (claim.replayed) return { value: claim.response };
      const result = await client.query<{ previousStatus: string; revision: number; updatedAt: Date | string }>(
        `WITH previous AS (
           SELECT status FROM profile_follows WHERE follower_handle = $1 AND following_handle = $2
         ), changed AS (
           INSERT INTO profile_follows (follower_handle, following_handle, status)
           VALUES ($1, $2, 'none')
           ON CONFLICT (follower_handle, following_handle)
           DO UPDATE SET
             status = 'none',
             revision = CASE
               WHEN profile_follows.status IS DISTINCT FROM 'none'
                 THEN profile_follows.revision + 1
               ELSE profile_follows.revision
             END,
             updated_at = CASE
               WHEN profile_follows.status IS DISTINCT FROM 'none' THEN now()
               ELSE profile_follows.updated_at
             END
           RETURNING revision, updated_at
         )
         SELECT previous.status AS "previousStatus", changed.revision, changed.updated_at AS "updatedAt"
         FROM changed LEFT JOIN previous ON true`,
        [follower, following]
      );
      const value = {
        followerHandle: follower,
        followingHandle: following,
        status: "none" as const,
        revision: result.rows[0].revision,
        updatedAt: new Date(result.rows[0].updatedAt).toISOString()
      };
      await completeMutation(client, follower, mutation, value);
      await stageAuditLog(client, {
        actorHandle: follower,
        action: "profile.unfollow",
        subjectType: "profile",
        subjectId: following,
        metadata: mutationAuditMetadata(mutation)
      });
      const event = await stageEvent(client, {
        kind: "profile.unfollowed",
        actorHandle: follower,
        subjectType: "profile",
        subjectId: following,
        visibility: result.rows[0]?.previousStatus === "active" ? "public" : "private",
        payload: { follow: value }
      });
      return { value, events: [event] };
    });
  }

  return { followerHandle: follower, followingHandle: following, status: "none", revision: 1 };
};

export const listFollowing = async (actor: Actor) => {
  const handle = await ensureProfileHandle(actorHandle(actor));
  return listProfileFollows(handle, true);
};

export const listProfileFollows = async (profileHandle: string, includePrivateStatuses = false) => {
  const handle = await ensureProfileHandle(profileHandle);
  if (!hasDatabase()) return { following: [], followers: [] };
  await ensureLiveData();

  const [following, followers] = await Promise.all([
    getPool().query(
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, revision,
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM profile_follows
       WHERE follower_handle = $1 AND ($2::boolean OR status = 'active')
       ORDER BY created_at DESC`,
      [handle, includePrivateStatuses]
    ),
    getPool().query(
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, revision,
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM profile_follows
       WHERE following_handle = $1 AND ($2::boolean OR status = 'active')
       ORDER BY created_at DESC`,
      [handle, includePrivateStatuses]
    )
  ]);

  return { following: following.rows, followers: followers.rows };
};
