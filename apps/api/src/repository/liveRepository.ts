import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  authSyncInputSchema,
  callIdInputSchema,
  commentActionInputSchema,
  createCommentInputSchema,
  createCommunityCallInputSchema,
  createPostInputSchema,
  createProfileInputSchema,
  followProfileInputSchema,
  joinCommunityInputSchema,
  markNotificationInputSchema,
  postActionInputSchema,
  profileActivityQuerySchema,
  publishNoteInputSchema,
  saveNoteBlockInputSchema,
  searchInputSchema,
  sendMessageInputSchema,
  unfollowProfileInputSchema,
  updateCommentInputSchema,
  updatePostInputSchema,
  type CanonicalActionActivityContract,
  type CommunityCallContract,
  type InquiryCommentContract,
  type InquiryItemContract,
  type PostActionInputContract,
  type ProfileActivityResponseContract,
  type PublishNoteInputContract,
  type ResearchCommunityContract,
  type ResearchProfileContract,
  type ToggleActionContract
} from "../../../../packages/contracts/src";
import {
  appendCommentToTree,
  canManageComment,
  cleanHandle,
  commentMetricsFallback,
  findCommentInTree,
  incrementMetric,
  isDeletedComment,
  isDeletedPost,
  mapCommentTree,
  mutateCommentForActor,
  mutateItemForActor,
  setCommentActionMembership,
  setItemActionMembership,
  tombstoneComment,
  tombstonePost,
  updateSignalValue
} from "@/lib/symposiumCore";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import {
  publishStoredEvent,
  stageEvent,
  type StoredLiveEvent
} from "../services/events";
import {
  claimMutation,
  completeMutation,
  type MutationContext
} from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { buildLegacyProfileActivity } from "@/lib/profileActivity";
import {
  decodeActivityCursor,
  listCanonicalProfileActivity,
  transitionCommentAction,
  transitionPostAction
} from "./actions";
import {
  actorHandle,
  callRowToContract,
  commentTreesFromRows,
  defaultProfile,
  ensureLiveData,
  ensureProfileHandle,
  getCommunity,
  getPublicCommunity,
  getPublicInitialState,
  getInitialState,
  insertProfile,
  json,
  newId,
  normalizeProfile,
  publicCommunity,
  publicProfile,
  rowToAttachment,
  rowToItem,
  searchablePostText,
  seedSnapshot,
  type AttachmentRow,
  type CommentRow,
  type SnapshotRow
} from "./foundation";

export {
  getCommunity,
  getInitialState,
  getPublicCommunity,
  getPublicInitialState,
  listCommunities,
  listPublicCommunities
} from "./foundation";
export { confirmAttachment, createAttachmentUpload } from "./attachments";
export { askAssistant } from "./assistant";
export { createOpportunity, listOpportunities } from "./opportunities";

type ActionMutationResult = {
  item: InquiryItemContract;
  activity?: CanonicalActionActivityContract;
};

const suffixedHandle = (baseHandle: string, index: number) =>
  index === 0 ? baseHandle : cleanHandle(`${baseHandle}_${index + 1}`);

const resolveSyncedHandle = async (client: PoolClient, desiredHandle: string, clerkSubject: string) => {
  const existingUser = await client.query<{ handle: string | null }>(
    "SELECT handle FROM users WHERE clerk_user_id = $1 AND handle IS NOT NULL LIMIT 1",
    [clerkSubject]
  );

  if (existingUser.rows[0]?.handle) return existingUser.rows[0].handle;

  const ownerHandle = cleanHandle(env.SYMPOSIUM_OWNER_HANDLE);
  const canClaimOwnerHandle =
    desiredHandle === ownerHandle && env.SYMPOSIUM_OWNER_CLERK_USER_ID === clerkSubject;

  for (let index = 0; index < 50; index += 1) {
    const candidate = suffixedHandle(desiredHandle, index);
    const userConflict = await client.query<{ clerkUserId: string | null }>(
      `SELECT clerk_user_id AS "clerkUserId"
       FROM users
       WHERE handle = $1 AND clerk_user_id IS DISTINCT FROM $2
       LIMIT 1`,
      [candidate, clerkSubject]
    );
    if (userConflict.rowCount) continue;

    const profileConflict = await client.query<{ userId: string | null; clerkUserId: string | null }>(
      `SELECT p.user_id AS "userId", u.clerk_user_id AS "clerkUserId"
       FROM profiles p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.handle = $1
       LIMIT 1`,
      [candidate]
    );

    const profile = profileConflict.rows[0];
    if (!profile) return candidate;
    if (profile.clerkUserId === clerkSubject) return candidate;
    if (!profile.userId && candidate === ownerHandle && canClaimOwnerHandle) return candidate;
  }

  throw new TRPCError({
    code: "CONFLICT",
    message: "Could not allocate a unique Symposium handle for this account."
  });
};

export const upsertProfile = async (rawInput: unknown, actor: Actor) => {
  const input = createProfileInputSchema.parse(rawInput);
  const person = normalizeProfile(input);
  const writerHandle = actorHandle(actor, person.handle);
  if (cleanHandle(person.handle) !== cleanHandle(writerHandle)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Profiles can only be updated by their owner." });
  }

  if (!hasDatabase()) return person;
  await ensureLiveData();

  const client = await getPool().connect();
  let stagedEvent: StoredLiveEvent | undefined;
  try {
    await client.query("BEGIN");
    await insertProfile(client, person);
    await client.query(
      "UPDATE posts SET author_name = $2, updated_at = now() WHERE author_handle = $1",
      [person.handle, person.name]
    );
    await client.query(
      "UPDATE comments SET author_name = $2, updated_at = now() WHERE author_handle = $1",
      [person.handle, person.name]
    );
    await stageAuditLog(client, {
      actorHandle: writerHandle,
      action: "profile.upsert",
      subjectType: "profile",
      subjectId: person.handle,
      metadata: { source: actor.source }
    });
    stagedEvent = await stageEvent(client, {
      kind: "profile.updated",
      actorHandle: writerHandle,
      subjectType: "profile",
      subjectId: person.handle,
      payload: { profile: publicProfile(person) }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);

  return person;
};

export const syncUser = async (rawInput: unknown, actor: Actor) => {
  const input = authSyncInputSchema.parse(rawInput ?? {});
  const clerkUserId = actor.clerkUserId ?? input.clerkUserId;
  const requestedHandle = cleanHandle(actor.handle ?? input.handle ?? input.email?.split("@")[0] ?? "symposium_member");
  const clerkSubject = clerkUserId ?? (actor.source === "dev" ? `dev:${requestedHandle}` : undefined);
  const name = actor.name ?? input.name ?? requestedHandle.replace(/^@/, "");
  const email = actor.email ?? input.email;

  if (!clerkSubject) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "No Clerk subject was found for this user." });
  }

  if (!hasDatabase()) {
    return normalizeProfile({
      name,
      handle: requestedHandle,
      email,
      role: "Symposium participant",
      location: "Public rooms",
      bio: "A participant in the current inquiry thread.",
      fields: ["Inquiry"]
    });
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let syncedProfile: ResearchProfileContract | undefined;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const handle = await resolveSyncedHandle(client, requestedHandle, clerkSubject);
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (clerk_user_id, primary_email, handle, display_name, image_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         primary_email = EXCLUDED.primary_email,
         handle = EXCLUDED.handle,
         display_name = EXCLUDED.display_name,
         image_url = EXCLUDED.image_url,
         updated_at = now()
       RETURNING id`,
      [clerkSubject, email ?? null, handle, name, actor.imageUrl ?? input.imageUrl ?? null]
    );

    const existingProfile = await client.query<ResearchProfileContract & { avatarUrl: string | null }>(
      `SELECT
        handle,
        email,
        name,
        avatar_url AS "avatarUrl",
        likes_public AS "likesPublic",
        reshares_public AS "resharesPublic",
        role,
        location,
        bio,
        fields
       FROM profiles
       WHERE handle = $1
       LIMIT 1`,
      [handle]
    );
    const existing = existingProfile.rows[0];
    const person = normalizeProfile({
      name: existing?.name ?? name,
      handle,
      email: existing?.email ?? email,
      avatarUrl: existing?.avatarUrl ?? actor.imageUrl ?? input.imageUrl,
      likesPublic: existing?.likesPublic ?? true,
      resharesPublic: existing?.resharesPublic ?? true,
      role: existing?.role ?? "Symposium participant",
      location: existing?.location ?? "Public rooms",
      bio: existing?.bio ?? "A participant in the current inquiry thread.",
      fields: existing?.fields ?? ["Inquiry"]
    });
    await insertProfile(client, person, user.rows[0]?.id);
    await client.query(
      `INSERT INTO workspaces (owner_handle, name)
       VALUES ($1, 'Notebook')
       ON CONFLICT (owner_handle, name) DO NOTHING`,
      [handle]
    );
    syncedProfile = person;
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "auth.sync",
      subjectType: "profile",
      subjectId: handle,
      metadata: { source: actor.source }
    });
    stagedEvent = await stageEvent(client, {
      kind: "profile.updated",
      actorHandle: handle,
      subjectType: "profile",
      subjectId: handle,
      payload: { profile: publicProfile(person) }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);
  if (!syncedProfile) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The synchronized profile was not returned." });
  }
  return syncedProfile;
};

export const createPost = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createPostInputSchema.parse(rawInput);
  const snapshot = await getInitialState();
  const handle = actorHandle(actor, input.authorHandle);
  const author = snapshot.profiles[handle];
  if (!author) throw new TRPCError({ code: "NOT_FOUND", message: "Author profile not found." });
  const isPaper = input.kind === "paper";
  const requestedAttachments = (input.attachments ?? []).map((attachment) => ({
    ...attachment,
    status: "uploaded" as const
  }));
  const requestedAttachmentIds = requestedAttachments.map((attachment) => attachment.id);
  if (new Set(requestedAttachmentIds).size !== requestedAttachmentIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Each post attachment can only be attached once." });
  }
  const item: InquiryItemContract = {
    id: newId("post"),
    kind: input.kind,
    room: input.room,
    title: input.title,
    author: author.name,
    authorHandle: author.handle,
    affiliation: author.location,
    date: "Just now",
    createdAt: new Date().toISOString(),
    status: isPaper ? "Draft" : "New",
    metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
    gatheringReason: "A new working post added to the live beta.",
    excerpt: input.body,
    body: input.body,
    tags: [input.room, input.kind, ...author.fields.slice(0, 2).map((field) => field.toLowerCase())],
    signals: [
      { label: "Status", value: isPaper ? "Draft" : "New" },
      { label: "Critiques", value: "0" },
      { label: "Forks", value: "0" },
      { label: "Next action", value: "Invite critique" }
    ],
    claims: [input.body],
    objections: [],
    evidence: [],
    tests: [],
    forks: [],
    comments: [],
    attachments: requestedAttachments,
    saved: input.room === "office",
    savedBy: input.room === "office" ? [author.handle] : [],
    signaledBy: [],
    forkedBy: []
  };

  if (!hasDatabase()) return item;
  await ensureLiveData();

  const client = await getPool().connect();
  let attachedRows: AttachmentRow[] = [];
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<InquiryItemContract>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    await client.query(
      `INSERT INTO posts (
        id, kind, room, title, author_handle, author_name, affiliation, date_label, created_at, status,
        metrics, gathering_reason, excerpt, body, tags, signals, claims, objections, evidence,
        tests, forks, saved, saved_by, signaled_by, forked_by, search_text
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26
      )`,
      [
        item.id,
        item.kind,
        item.room,
        item.title,
        item.authorHandle,
        item.author,
        item.affiliation,
        item.date,
        item.createdAt,
        item.status,
        JSON.stringify(item.metrics),
        item.gatheringReason,
        item.excerpt,
        item.body,
        JSON.stringify(item.tags),
        JSON.stringify(item.signals),
        JSON.stringify(item.claims),
        JSON.stringify(item.objections),
        JSON.stringify(item.evidence),
        JSON.stringify(item.tests),
        JSON.stringify(item.forks),
        item.saved,
        JSON.stringify(item.savedBy ?? []),
        JSON.stringify(item.signaledBy ?? []),
        JSON.stringify(item.forkedBy ?? []),
        searchablePostText({ ...item, authorName: item.author })
      ]
    );

    if (item.authorHandle && item.savedBy?.includes(item.authorHandle)) {
      await client.query(
        `INSERT INTO post_actions (post_id, actor_handle, action, active, count, revision, created_at, updated_at)
         VALUES ($1, $2, 'save', true, 1, 1, $3, $3)
         ON CONFLICT (post_id, actor_handle, action) DO NOTHING`,
        [item.id, item.authorHandle, item.createdAt]
      );
    }

    if (requestedAttachmentIds.length) {
      const result = await client.query<AttachmentRow>(
        `UPDATE attachments
         SET owner_id = $1,
             updated_at = now()
         WHERE id = ANY($2::uuid[])
           AND owner_type = 'post'
           AND uploader_handle = $3
           AND status IN ('uploaded', 'previewed')
           AND (owner_id IS NULL OR owner_id = $1)
         RETURNING
           id::text,
           owner_id AS "ownerId",
           file_name AS "fileName",
           content_type AS "contentType",
           byte_size AS "byteSize",
           status,
           metadata,
           object_key AS "objectKey",
           created_at AS "createdAt"`,
        [item.id, requestedAttachmentIds, item.authorHandle]
      );

      if ((result.rowCount ?? 0) !== requestedAttachmentIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "One or more attachments could not be attached to this post." });
      }

      const rowById = new Map(result.rows.map((row) => [row.id, row]));
      attachedRows = requestedAttachmentIds.map((id) => rowById.get(id)).filter((row): row is AttachmentRow => Boolean(row));
    }

    item.attachments = attachedRows.map(rowToAttachment);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "post.create",
      subjectType: "post",
      subjectId: item.id,
      metadata: mutationAuditMetadata(mutation, {
        attachmentCount: item.attachments.length,
        kind: item.kind,
        room: item.room
      })
    });
    await completeMutation(client, handle, mutation, item);
    stagedEvent = await stageEvent(client, {
      kind: "post.created",
      actorHandle: item.authorHandle,
      subjectType: "post",
      subjectId: item.id,
      visibility: item.room === "office" || item.kind === "draft" ? "private" : "public",
      payload: { item, room: item.room, kind: item.kind, title: item.title }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);

  return item;
};

const viewDedupeWindowMs = 60 * 60 * 1000;
type ViewTargetType = "post" | "comment";
const memoryContentViews = new Map<string, number>();

const normalizeViewActorHandle = (handle: string) => {
  const normalized = cleanHandle(handle || defaultProfile.handle);
  return normalized === "@" ? defaultProfile.handle : normalized;
};

const contentViewKey = (targetType: ViewTargetType, targetId: string, actorHandle: string) =>
  `${targetType}:${targetId}:${normalizeViewActorHandle(actorHandle)}`;

const pruneMemoryContentViews = (now = Date.now()) => {
  for (const [key, timestamp] of memoryContentViews.entries()) {
    if (now - timestamp >= viewDedupeWindowMs) memoryContentViews.delete(key);
  }
};

const recordMemoryContentView = (targetType: ViewTargetType, targetId: string, actorHandle: string) => {
  const now = Date.now();
  pruneMemoryContentViews(now);
  const key = contentViewKey(targetType, targetId, actorHandle);
  const lastViewedAt = memoryContentViews.get(key);
  if (lastViewedAt && now - lastViewedAt < viewDedupeWindowMs) return false;

  memoryContentViews.set(key, now);
  return true;
};

const recordContentView = async (
  client: PoolClient,
  targetType: ViewTargetType,
  targetId: string,
  actorHandle: string,
  trigger?: string,
  surface?: string
) => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO content_views (target_type, target_id, actor_handle, bucket_start, trigger, surface)
     VALUES ($1, $2, $3, date_trunc('hour', now()), $4, $5)
     ON CONFLICT (target_type, target_id, actor_handle, bucket_start) DO NOTHING
     RETURNING id`,
    [targetType, targetId, normalizeViewActorHandle(actorHandle), trigger ?? null, surface ?? null]
  );
  return (result.rowCount ?? 0) > 0;
};

export const addComment = async (
  postId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = createCommentInputSchema.parse(rawInput);
  const snapshot = await getInitialState();
  const existing = snapshot.items.find((item) => item.id === postId);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
  if (isDeletedPost(existing)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be commented on." });
  }
  if (input.parentId && !findCommentInTree(existing.comments, input.parentId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
  }

  const handle = actorHandle(actor, input.authorHandle);
  if (
    (existing.room === "office" || existing.kind === "draft") &&
    (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
  }
  const author = snapshot.profiles[handle];
  if (!author) throw new TRPCError({ code: "NOT_FOUND", message: "Author profile not found." });
  const comment: InquiryCommentContract = {
    id: newId("comment"),
    parentId: input.parentId ?? null,
    author: author.name,
    authorHandle: author.handle,
    stance: input.stance || "Comment",
    body: input.body,
    createdAt: new Date().toISOString(),
    metrics: { ...commentMetricsFallback },
    savedBy: [],
    signaledBy: [],
    forkedBy: [],
    replies: []
  };
  const nextCritiques = incrementMetric(existing.metrics.critiques, 1);
  const nextMetrics = { ...existing.metrics, critiques: nextCritiques };
  const nextSignals = updateSignalValue(existing.signals, "Critiques", nextCritiques);
  const memoryAppend = appendCommentToTree(existing.comments, comment);

  if (!memoryAppend.inserted) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
  }

  if (!hasDatabase()) {
    return {
      comment,
      item: {
        ...existing,
        metrics: nextMetrics,
        signals: nextSignals,
        comments: memoryAppend.comments
      }
    };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract | null = null;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<{
      comment: InquiryCommentContract;
      item: InquiryItemContract;
    }>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id,
        kind,
        room,
        title,
        author_handle AS "authorHandle",
        author_name AS "authorName",
        affiliation,
        date_label AS "dateLabel",
        created_at AS "createdAt",
        edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status,
        metrics,
        gathering_reason AS "gatheringReason",
        excerpt,
        body,
        tags,
        signals,
        claims,
        objections,
        evidence,
        tests,
        forks,
        saved,
        saved_by AS "savedBy",
        signaled_by AS "signaledBy",
        forked_by AS "forkedBy"
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );

    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

    const commentsResult = await client.query<CommentRow>(
      `SELECT
        id,
        post_id AS "postId",
        parent_id AS "parentId",
        author_handle AS "authorHandle",
        author_name AS "authorName",
        stance,
        body,
        metrics,
        saved_by AS "savedBy",
        signaled_by AS "signaledBy",
        forked_by AS "forkedBy",
        edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existingComments = commentsByPost.get(postId) ?? [];
    const lockedItem = rowToItem(row, existingComments);
    if (isDeletedPost(lockedItem)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be commented on." });
    }
    if (comment.parentId && !findCommentInTree(existingComments, comment.parentId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
    }
    const lockedNextCritiques = incrementMetric(lockedItem.metrics.critiques, 1);
    const lockedNextMetrics = { ...lockedItem.metrics, critiques: lockedNextCritiques };
    const lockedNextSignals = updateSignalValue(lockedItem.signals, "Critiques", lockedNextCritiques);
    const appended = appendCommentToTree(existingComments, comment);
    if (!appended.inserted) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Parent comment was not found on this post." });
    }

    await client.query(
      `INSERT INTO comments (
        id, post_id, parent_id, author_handle, author_name, stance, body,
        metrics, saved_by, signaled_by, forked_by, created_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        comment.id,
        postId,
        comment.parentId,
        comment.authorHandle,
        comment.author,
        comment.stance,
        comment.body,
        JSON.stringify(comment.metrics),
        JSON.stringify(comment.savedBy),
        JSON.stringify(comment.signaledBy),
        JSON.stringify(comment.forkedBy),
        comment.createdAt
      ]
    );
    await client.query(
      `UPDATE posts
       SET metrics = $2,
           signals = $3,
           updated_at = now()
       WHERE id = $1`,
      [postId, JSON.stringify(lockedNextMetrics), JSON.stringify(lockedNextSignals)]
    );

    updatedItem = rowToItem(
      { ...row, metrics: lockedNextMetrics, signals: lockedNextSignals },
      appended.comments
    );

    await stageAuditLog(client, {
      actorHandle: handle,
      action: "comment.create",
      subjectType: "comment",
      subjectId: comment.id as string,
      metadata: mutationAuditMetadata(mutation, {
        parentId: comment.parentId,
        postId
      })
    });
    await completeMutation(client, handle, mutation, { comment, item: updatedItem });
    stagedEvent = await stageEvent(client, {
      kind: "comment.created",
      actorHandle: comment.authorHandle,
      subjectType: "post",
      subjectId: postId,
      visibility: existing.room === "office" || existing.kind === "draft" ? "private" : "public",
      payload:
        existing.room === "office" || existing.kind === "draft"
          ? { comment, item: updatedItem, commentId: comment.id, parentId: comment.parentId }
          : { commentId: comment.id, itemId: postId, parentId: comment.parentId }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);

  return { comment, item: updatedItem };
};

export const applyPostAction = async (
  postId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<ActionMutationResult> => {
  const input: PostActionInputContract = postActionInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.actorHandle);

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    if (isDeletedPost(existing)) return { item: existing };
    if (input.action === "read" && !recordMemoryContentView("post", postId, handle)) {
      return { item: existing };
    }
    return {
      item: mutateItemForActor(existing, input.action, handle, defaultProfile.handle, input.active)
    };
  }

  await ensureLiveData();

  const client = await getPool().connect();
  let updated: InquiryItemContract;
  const stagedEvents: StoredLiveEvent[] = [];
  let activity: CanonicalActionActivityContract | undefined;

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<ActionMutationResult>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id,
        kind,
        room,
        title,
        author_handle AS "authorHandle",
        author_name AS "authorName",
        affiliation,
        date_label AS "dateLabel",
        created_at AS "createdAt",
        edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status,
        metrics,
        gathering_reason AS "gatheringReason",
        excerpt,
        body,
        tags,
        signals,
        claims,
        objections,
        evidence,
        tests,
        forks,
        saved,
        saved_by AS "savedBy",
        signaled_by AS "signaledBy",
        forked_by AS "forkedBy"
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );

    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

    const commentsResult = await client.query<CommentRow>(
      `SELECT
        id,
        post_id AS "postId",
        parent_id AS "parentId",
        author_handle AS "authorHandle",
        author_name AS "authorName",
        stance,
        body,
        metrics,
        saved_by AS "savedBy",
        signaled_by AS "signaledBy",
        forked_by AS "forkedBy",
        edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existing = rowToItem(row, commentsByPost.get(postId) ?? []);
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    if (isDeletedPost(existing)) {
      updated = existing;
      await completeMutation(client, handle, mutation, { item: updated });
      await client.query("COMMIT");
      return { item: updated };
    }

    if (
      input.action === "read" &&
      !(await recordContentView(client, "post", postId, handle, input.trigger, input.surface))
    ) {
      updated = existing;
      await completeMutation(client, handle, mutation, { item: updated });
      await client.query("COMMIT");
      return { item: updated };
    }

    if (input.action === "read") {
      updated = mutateItemForActor(existing, input.action, handle, defaultProfile.handle, input.active);
      await client.query(
        `INSERT INTO post_actions (post_id, actor_handle, action, active, count, revision)
         VALUES ($1, $2, $3, true, 1, 1)
         ON CONFLICT (post_id, actor_handle, action)
         DO UPDATE SET
           active = true,
           count = post_actions.count + 1,
           revision = post_actions.revision + 1,
           updated_at = now()`,
        [postId, handle, input.action]
      );
    } else {
      const transition = await transitionPostAction(
        client,
        postId,
        handle,
        input.action as ToggleActionContract,
        input.active
      );
      activity = transition.activity;
      const reconciled = setItemActionMembership(
        existing,
        input.action,
        handle,
        transition.previousActive,
        defaultProfile.handle
      );
      updated = mutateItemForActor(
        reconciled,
        input.action,
        handle,
        defaultProfile.handle,
        transition.activity.active
      );
    }

    await client.query(
      `UPDATE posts
       SET metrics = $2,
           saved = $3,
           saved_by = $4,
           signaled_by = $5,
           forked_by = $6,
           signals = $7,
           updated_at = now()
       WHERE id = $1`,
      [
        postId,
        JSON.stringify(updated.metrics),
        Boolean(updated.saved),
        JSON.stringify(updated.savedBy ?? []),
        JSON.stringify(updated.signaledBy ?? []),
        JSON.stringify(updated.forkedBy ?? []),
        JSON.stringify(updated.signals)
      ]
    );

    if (input.action !== "read") {
      await stageAuditLog(client, {
        actorHandle: handle,
        action: `post.${input.action}`,
        subjectType: "post",
        subjectId: postId,
        metadata: mutationAuditMetadata(mutation, { active: activity?.active })
      });
    }
    await completeMutation(client, handle, mutation, { item: updated, activity });
    const privatePost = updated.room === "office" || updated.kind === "draft";
    if (!privatePost) {
      stagedEvents.push(
        await stageEvent(client, {
          kind: `post.${input.action}`,
          subjectType: "post",
          subjectId: postId,
          payload: { action: input.action, itemId: postId }
        })
      );
    }
    stagedEvents.push(
      await stageEvent(client, {
        kind: `post.${input.action}`,
        actorHandle: handle,
        subjectType: "post",
        subjectId: postId,
        visibility: "private",
        payload: { action: input.action, active: activity?.active, activity, item: updated }
      })
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const event of stagedEvents) await publishStoredEvent(event);

  return { item: updated, activity };
};

export const updatePost = async (postId: string, rawInput: unknown, actor: Actor) => {
  const input = updatePostInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.actorHandle);
  const editedAt = new Date().toISOString();

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    if (isDeletedPost(existing)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be edited." });
    }
    if (existing.authorHandle && cleanHandle(existing.authorHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this post." });
    }
    return { ...existing, title: input.title, body: input.body, excerpt: input.body, claims: [input.body], editedAt };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updated: InquiryItemContract;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy"
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    if (row.deletedAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted posts cannot be edited." });
    }
    if (row.authorHandle && cleanHandle(row.authorHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this post." });
    }

    await client.query(
      `UPDATE posts
       SET title = $2,
           body = $3,
           excerpt = $3,
           claims = $4,
           search_text = $5,
           edited_at = $6,
           updated_at = now()
       WHERE id = $1`,
      [
        postId,
        input.title,
        input.body,
        JSON.stringify([input.body]),
        searchablePostText({ title: input.title, body: input.body, excerpt: input.body, authorName: row.authorName }),
        editedAt
      ]
    );

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    updated = rowToItem(
      { ...row, title: input.title, body: input.body, excerpt: input.body, claims: [input.body], editedAt },
      commentsByPost.get(postId) ?? []
    );

    await stageAuditLog(client, {
      actorHandle: handle,
      action: "post.update",
      subjectType: "post",
      subjectId: postId,
      metadata: { editedAt }
    });
    stagedEvent = await stageEvent(client, {
      kind: "post.updated",
      actorHandle: handle,
      subjectType: "post",
      subjectId: postId,
      visibility: updated.room === "office" || updated.kind === "draft" ? "private" : "public",
      payload:
        updated.room === "office" || updated.kind === "draft"
          ? { item: updated }
          : { itemId: postId }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);

  return updated;
};

export const deletePost = async (postId: string, actor: Actor) => {
  const handle = actorHandle(actor);

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (isDeletedPost(existing)) return existing;
    if (existing.authorHandle && cleanHandle(existing.authorHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this post." });
    }
    return tombstonePost(existing);
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let deleted: InquiryItemContract | null = null;
  let didDelete = false;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy"
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existing = rowToItem(row, commentsByPost.get(postId) ?? []);

    if (isDeletedPost(existing)) {
      deleted = existing;
      await client.query("COMMIT");
    } else {
      if (row.authorHandle && cleanHandle(row.authorHandle) !== handle) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this post." });
      }
      const deletedPost = {
        ...tombstonePost(existing),
        saved: false,
        savedBy: [],
        signaledBy: [],
        forkedBy: []
      };
      deleted = deletedPost;
      await client.query(
        `UPDATE posts
         SET title = $2,
             author_handle = NULL,
             author_name = $3,
             affiliation = $4,
             status = $5,
             gathering_reason = $6,
             excerpt = $7,
             body = $8,
             tags = $9,
             signals = $10,
             claims = $11,
             objections = $12,
             evidence = $13,
             tests = $14,
             forks = $15,
             saved = false,
             saved_by = '[]'::jsonb,
             signaled_by = '[]'::jsonb,
             forked_by = '[]'::jsonb,
             search_text = $16,
             edited_at = NULL,
             deleted_at = $17,
             updated_at = now()
         WHERE id = $1`,
        [
          postId,
          deletedPost.title,
          deletedPost.author,
          deletedPost.affiliation,
          deletedPost.status,
          deletedPost.gatheringReason,
          deletedPost.excerpt,
          deletedPost.body,
          JSON.stringify(deletedPost.tags),
          JSON.stringify(deletedPost.signals),
          JSON.stringify(deletedPost.claims),
          JSON.stringify(deletedPost.objections),
          JSON.stringify(deletedPost.evidence),
          JSON.stringify(deletedPost.tests),
          JSON.stringify(deletedPost.forks),
          searchablePostText({
            title: deletedPost.title,
            body: deletedPost.body,
            excerpt: deletedPost.excerpt,
            authorName: deletedPost.author
          }),
          deletedPost.deletedAt
        ]
      );
      await client.query(
        `UPDATE post_actions
         SET active = false, count = 0, revision = revision + 1, updated_at = now()
         WHERE post_id = $1 AND action IN ('save', 'signal', 'fork') AND active = true`,
        [postId]
      );
      await client.query(
        `UPDATE comment_actions
         SET active = false, count = 0, revision = revision + 1, updated_at = now()
         WHERE post_id = $1 AND active = true`,
        [postId]
      );
      didDelete = true;
      await stageAuditLog(client, {
        actorHandle: handle,
        action: "post.delete",
        subjectType: "post",
        subjectId: postId,
        metadata: { deletedAt: deletedPost.deletedAt }
      });
      stagedEvent = await stageEvent(client, {
        kind: "post.deleted",
        actorHandle: handle,
        subjectType: "post",
        subjectId: postId,
        visibility: deleted.room === "office" || deleted.kind === "draft" ? "private" : "public",
        payload:
          deleted.room === "office" || deleted.kind === "draft"
            ? { itemId: postId, item: deleted }
            : { itemId: postId }
      });
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

  if (didDelete && stagedEvent) await publishStoredEvent(stagedEvent);

  return deleted;
};

export const updateComment = async (postId: string, commentId: string, rawInput: unknown, actor: Actor) => {
  const input = updateCommentInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.actorHandle);
  const editedAt = new Date().toISOString();

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    const original = findCommentInTree(existing.comments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted comments cannot be edited." });
    }
    if (!canManageComment(original, handle)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this comment." });
    }
    const mapped = mapCommentTree(existing.comments, commentId, (comment) => ({
      ...comment,
      body: input.body,
      editedAt
    }));
    return { ...existing, comments: mapped.comments };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy"
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existingComments = commentsByPost.get(postId) ?? [];
    const original = findCommentInTree(existingComments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Deleted comments cannot be edited." });
    }
    if (!canManageComment(original, handle)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit this comment." });
    }

    const mapped = mapCommentTree(existingComments, commentId, (comment) => ({
      ...comment,
      body: input.body,
      editedAt
    }));
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });

    await client.query(
      `UPDATE comments
       SET body = $3,
           edited_at = $4,
           updated_at = now()
       WHERE post_id = $1 AND id = $2`,
      [postId, commentId, input.body, editedAt]
    );

    updatedItem = rowToItem(row, mapped.comments);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "comment.update",
      subjectType: "comment",
      subjectId: commentId,
      metadata: { editedAt, postId }
    });
    stagedEvent = await stageEvent(client, {
      kind: "comment.updated",
      actorHandle: handle,
      subjectType: "comment",
      subjectId: commentId,
      visibility: updatedItem.room === "office" || updatedItem.kind === "draft" ? "private" : "public",
      payload:
        updatedItem.room === "office" || updatedItem.kind === "draft"
          ? { item: updatedItem, commentId }
          : { itemId: postId, commentId }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (stagedEvent) await publishStoredEvent(stagedEvent);

  return updatedItem;
};

export const deleteComment = async (postId: string, commentId: string, rawInput: unknown, actor: Actor) => {
  const input = rawInput && typeof rawInput === "object" ? (rawInput as { actorHandle?: unknown }) : {};
  const handle = actorHandle(actor, typeof input.actorHandle === "string" ? input.actorHandle : undefined);
  const deletedAt = new Date().toISOString();

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    const original = findCommentInTree(existing.comments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) return existing;
    if (!canManageComment(original, handle)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this comment." });
    }
    const mapped = mapCommentTree(existing.comments, commentId, (comment) => tombstoneComment(comment, deletedAt));
    return { ...existing, comments: mapped.comments };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let didDelete = false;
  let stagedEvent: StoredLiveEvent | undefined;

  try {
    await client.query("BEGIN");
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy"
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existingComments = commentsByPost.get(postId) ?? [];
    const original = findCommentInTree(existingComments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      updatedItem = rowToItem(row, existingComments);
      await client.query("COMMIT");
    } else {
      if (!canManageComment(original, handle)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this comment." });
      }
      const mapped = mapCommentTree(existingComments, commentId, (comment) => tombstoneComment(comment, deletedAt));
      if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });

      await client.query(
        `UPDATE comments
         SET author_handle = NULL,
             author_name = $3,
             stance = $4,
             body = $5,
             saved_by = $6,
             signaled_by = $7,
             forked_by = $8,
             edited_at = NULL,
             deleted_at = $9,
             updated_at = now()
         WHERE post_id = $1 AND id = $2`,
        [
          postId,
          commentId,
          mapped.updated.author,
          mapped.updated.stance,
          mapped.updated.body,
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          mapped.updated.deletedAt
        ]
      );
      await client.query(
        `UPDATE comment_actions
         SET active = false, count = 0, revision = revision + 1, updated_at = now()
         WHERE comment_id = $1 AND active = true`,
        [commentId]
      );

      updatedItem = rowToItem(row, mapped.comments);
      didDelete = true;
      await stageAuditLog(client, {
        actorHandle: handle,
        action: "comment.delete",
        subjectType: "comment",
        subjectId: commentId,
        metadata: { deletedAt, postId }
      });
      stagedEvent = await stageEvent(client, {
        kind: "comment.deleted",
        actorHandle: handle,
        subjectType: "comment",
        subjectId: commentId,
        visibility: updatedItem.room === "office" || updatedItem.kind === "draft" ? "private" : "public",
        payload:
          updatedItem.room === "office" || updatedItem.kind === "draft"
            ? { item: updatedItem, commentId }
            : { itemId: postId, commentId }
      });
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (didDelete && stagedEvent) await publishStoredEvent(stagedEvent);

  return updatedItem;
};

export const applyCommentAction = async (
  postId: string,
  commentId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<ActionMutationResult> => {
  const input: PostActionInputContract = commentActionInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.actorHandle);

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (existing.room === "office" || existing.kind === "draft") &&
      (!existing.authorHandle || cleanHandle(existing.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }
    const original = findCommentInTree(existing.comments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) return { item: existing };
    if (input.action === "read" && !recordMemoryContentView("comment", commentId, handle)) {
      return { item: existing };
    }
    const mapped = mapCommentTree(existing.comments, commentId, (comment) =>
      mutateCommentForActor(comment, input.action, handle, input.active)
    );
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    return { item: { ...existing, comments: mapped.comments } };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let updatedComment: InquiryCommentContract | undefined;
  let activity: CanonicalActionActivityContract | undefined;
  const stagedEvents: StoredLiveEvent[] = [];

  try {
    await client.query("BEGIN");
    const claim = await claimMutation<ActionMutationResult>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const postResult = await client.query<SnapshotRow>(
      `SELECT
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", created_at AS "createdAt", edited_at AS "editedAt",
        deleted_at AS "deletedAt",
        status, metrics, gathering_reason AS "gatheringReason", excerpt, body, tags, signals,
        claims, objections, evidence, tests, forks, saved, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy"
       FROM posts
       WHERE id = $1
       FOR UPDATE`,
      [postId]
    );
    const row = postResult.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (
      (row.room === "office" || row.kind === "draft") &&
      (!row.authorHandle || cleanHandle(row.authorHandle) !== handle)
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    }

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", edited_at AS "editedAt",
        deleted_at AS "deletedAt", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existingComments = commentsByPost.get(postId) ?? [];
    const original = findCommentInTree(existingComments, commentId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    if (isDeletedComment(original)) {
      updatedItem = rowToItem(row, existingComments);
      await completeMutation(client, handle, mutation, { item: updatedItem });
      await client.query("COMMIT");
      return { item: updatedItem };
    }

    if (
      input.action === "read" &&
      !(await recordContentView(client, "comment", commentId, handle, input.trigger, input.surface))
    ) {
      updatedItem = rowToItem(row, existingComments);
      await completeMutation(client, handle, mutation, { item: updatedItem });
      await client.query("COMMIT");
      return { item: updatedItem };
    }

    let canonicalOriginal = original;
    let canonicalActive = input.active;
    if (input.action !== "read") {
      const transition = await transitionCommentAction(
        client,
        postId,
        commentId,
        handle,
        input.action as ToggleActionContract,
        input.active
      );
      activity = transition.activity;
      canonicalActive = transition.activity.active;
      canonicalOriginal = setCommentActionMembership(
        original,
        input.action,
        handle,
        transition.previousActive
      );
    }

    const mapped = mapCommentTree(existingComments, commentId, () =>
      mutateCommentForActor(canonicalOriginal, input.action, handle, canonicalActive)
    );
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    updatedComment = mapped.updated;

    await client.query(
      `UPDATE comments
       SET metrics = $3,
           saved_by = $4,
           signaled_by = $5,
           forked_by = $6,
           updated_at = now()
       WHERE post_id = $1 AND id = $2`,
      [
        postId,
        commentId,
        JSON.stringify(updatedComment.metrics ?? commentMetricsFallback),
        JSON.stringify(updatedComment.savedBy ?? []),
        JSON.stringify(updatedComment.signaledBy ?? []),
        JSON.stringify(updatedComment.forkedBy ?? [])
      ]
    );

    updatedItem = rowToItem(row, mapped.comments);
    if (input.action !== "read") {
      await stageAuditLog(client, {
        actorHandle: handle,
        action: `comment.${input.action}`,
        subjectType: "comment",
        subjectId: commentId,
        metadata: mutationAuditMetadata(mutation, { active: activity?.active, postId })
      });
    }
    await completeMutation(client, handle, mutation, { item: updatedItem, activity });
    const privatePost = updatedItem.room === "office" || updatedItem.kind === "draft";
    if (!privatePost) {
      stagedEvents.push(
        await stageEvent(client, {
          kind: `comment.${input.action}`,
          subjectType: "comment",
          subjectId: commentId,
          payload: { action: input.action, commentId, itemId: postId }
        })
      );
    }
    stagedEvents.push(
      await stageEvent(client, {
        kind: `comment.${input.action}`,
        actorHandle: handle,
        subjectType: "comment",
        subjectId: commentId,
        visibility: "private",
        payload: { action: input.action, active: activity?.active, activity, item: updatedItem, commentId }
      })
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const event of stagedEvents) await publishStoredEvent(event);

  return { item: updatedItem, activity };
};

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
    return {
      entries: buildLegacyProfileActivity(snapshot.items, handle, allowedActions).slice(0, query.limit),
      nextCursor: null
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
  try {
    return await listCanonicalProfileActivity(client, handle, allowedActions, query, ownProfile);
  } finally {
    client.release();
  }
};

export const followProfile = async (rawInput: unknown, actor: Actor) => {
  const input = followProfileInputSchema.parse(rawInput);
  const follower = await ensureProfileHandle(actorHandle(actor));
  const following = await ensureProfileHandle(input.targetHandle);

  if (follower === following) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot follow yourself." });
  }

  if (!hasDatabase()) {
    return { followerHandle: follower, followingHandle: following, status: input.status };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const result = await client.query(
      `INSERT INTO profile_follows (follower_handle, following_handle, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (follower_handle, following_handle)
       DO UPDATE SET status = EXCLUDED.status, updated_at = now()
       WHERE profile_follows.status IS DISTINCT FROM EXCLUDED.status
       RETURNING follower_handle`,
      [follower, following, input.status]
    );
    const value = { followerHandle: follower, followingHandle: following, status: input.status };
    if (!result.rowCount) return { value };
    await stageAuditLog(client, {
      actorHandle: follower,
      action: "profile.follow",
      subjectType: "profile",
      subjectId: following,
      metadata: { status: input.status }
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

export const unfollowProfile = async (rawInput: unknown, actor: Actor) => {
  const input = unfollowProfileInputSchema.parse(rawInput);
  const follower = await ensureProfileHandle(actorHandle(actor, input.actorHandle));
  const following = cleanHandle(input.targetHandle);

  if (hasDatabase()) {
    await ensureLiveData();
    return runAtomic(async (client) => {
      const result = await client.query<{ status: string }>(
        "DELETE FROM profile_follows WHERE follower_handle = $1 AND following_handle = $2 RETURNING status",
        [follower, following]
      );
      const value = { followerHandle: follower, followingHandle: following, status: "none" as const };
      if (!result.rowCount) return { value };
      await stageAuditLog(client, {
        actorHandle: follower,
        action: "profile.unfollow",
        subjectType: "profile",
        subjectId: following
      });
      const event = await stageEvent(client, {
        kind: "profile.unfollowed",
        actorHandle: follower,
        subjectType: "profile",
        subjectId: following,
        visibility: result.rows[0]?.status === "active" ? "public" : "private",
        payload: { follow: value }
      });
      return { value, events: [event] };
    });
  }

  return { followerHandle: follower, followingHandle: following, status: "none" };
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
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, created_at AS "createdAt"
       FROM profile_follows
       WHERE follower_handle = $1 AND ($2::boolean OR status = 'active')
       ORDER BY created_at DESC`,
      [handle, includePrivateStatuses]
    ),
    getPool().query(
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, created_at AS "createdAt"
       FROM profile_follows
       WHERE following_handle = $1 AND ($2::boolean OR status = 'active')
       ORDER BY created_at DESC`,
      [handle, includePrivateStatuses]
    )
  ]);

  return { following: following.rows, followers: followers.rows };
};

export const joinOrRequestCommunity = async (rawInput: unknown, actor: Actor) => {
  const input = joinCommunityInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) {
    return {
      community: community.visibility === "private" ? publicCommunity(community) : community,
      status: community.visibility === "private" ? ("requested" as const) : ("joined" as const)
    };
  }
  await ensureLiveData();
  return runAtomic(async (client) => {
    const requestedStatus = community.visibility === "private" ? "requested" : "active";
    const existingMembership = await client.query<{ status: string }>(
      `SELECT status FROM community_memberships
       WHERE community_id = $1 AND profile_handle = $2
       FOR UPDATE`,
      [community.id, handle]
    );
    if (existingMembership.rows[0]?.status === "blocked") {
      throw new TRPCError({ code: "FORBIDDEN", message: "This community membership is unavailable." });
    }
    const membership = await client.query<{ status: string }>(
      `INSERT INTO community_memberships (community_id, profile_handle, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (community_id, profile_handle) DO UPDATE SET status = EXCLUDED.status
       WHERE community_memberships.status IS DISTINCT FROM EXCLUDED.status
         AND community_memberships.status <> 'active'
       RETURNING status`,
      [community.id, handle, requestedStatus]
    );
    const membershipStatus =
      membership.rows[0]?.status ??
      existingMembership.rows[0]?.status ??
      requestedStatus;
    let updatedCommunity = membershipStatus === "active" ? community : publicCommunity(community);
    if (membershipStatus === "active") {
      await client.query(
        `UPDATE communities
         SET member_handles = CASE
               WHEN member_handles ? $2 THEN member_handles
               ELSE member_handles || to_jsonb($2::text)
             END,
             updated_at = now()
         WHERE id = $1`,
        [community.id, handle]
      );
      updatedCommunity = {
        ...community,
        memberHandles: [...new Set([...community.memberHandles, handle])]
      };
    }
    const value = {
      community: updatedCommunity,
      status: membershipStatus === "active" ? ("joined" as const) : ("requested" as const)
    };
    if (!membership.rowCount) return { value };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: value.status === "requested" ? "community.request" : "community.join",
      subjectType: "community",
      subjectId: community.id,
      metadata: { status: membershipStatus }
    });
    const event = await stageEvent(client, {
      kind: value.status === "requested" ? "community.requested" : "community.joined",
      actorHandle: handle,
      subjectType: "community",
      subjectId: community.id,
      visibility: value.status === "requested" ? "private" : "public",
      payload: { community: updatedCommunity, status: value.status }
    });
    return { value, events: [event] };
  });
};

export const listCommunityCalls = async (communityId: string, actor?: Actor) => {
  const community = await getCommunity(communityId);
  if (!hasDatabase()) return { community, calls: [] as CommunityCallContract[] };
  await ensureLiveData();

  if (community.visibility === "private") {
    const requester = actor?.handle ? cleanHandle(actor.handle) : null;
    if (!requester) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Private community calls require membership." });
    }
    const membership = await getPool().query(
      `SELECT 1 FROM community_memberships
       WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
      [community.id, requester]
    );
    if (!membership.rowCount) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Private community calls require membership." });
    }
  }

  const result = await getPool().query(
    `SELECT
       c.id,
       c.community_id AS "communityId",
       c.host_handle AS "hostHandle",
       c.title,
       c.kind,
       c.status,
       c.starts_at AS "startsAt",
       c.ended_at AS "endedAt",
       c.provider,
       c.provider_room_id AS "providerRoomId",
       COALESCE(json_agg(cp.profile_handle) FILTER (WHERE cp.profile_handle IS NOT NULL), '[]') AS "participantHandles"
     FROM community_calls c
     LEFT JOIN call_participants cp ON cp.call_id = c.id AND cp.left_at IS NULL
     WHERE c.community_id = $1
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT 25`,
    [community.id]
  );

  return { community, calls: result.rows.map(callRowToContract) };
};

const communityAudienceHandles = async (client: PoolClient, communityId: string) => {
  const result = await client.query<{ profileHandle: string }>(
    `SELECT profile_handle AS "profileHandle"
     FROM community_memberships
     WHERE community_id = $1 AND status = 'active'`,
    [communityId]
  );
  return result.rows.map((row) => row.profileHandle);
};

export const createCommunityCall = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createCommunityCallInputSchema.parse(rawInput);
  const host = await ensureProfileHandle(actorHandle(actor));
  const community = await getCommunity(input.communityId);

  if (!hasDatabase()) {
    return {
      id: randomUUID(),
      communityId: input.communityId,
      hostHandle: host,
      title: input.title,
      kind: input.kind,
      status: "live",
      startsAt: input.startsAt ?? new Date().toISOString(),
      provider: input.provider,
      providerRoomId: input.providerRoomId,
      participantHandles: [host]
    } satisfies CommunityCallContract;
  }

  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<CommunityCallContract>(client, host, mutation);
    if (claim.replayed) return { value: claim.response };
    if (community.visibility === "private") {
      const membership = await client.query(
        `SELECT 1 FROM community_memberships
         WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
        [community.id, host]
      );
      if (!membership.rowCount) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Join this private community before hosting a call." });
      }
    }
    const call = await client.query(
      `INSERT INTO community_calls (
         community_id, host_handle, title, kind, status, starts_at, provider, provider_room_id
       )
       VALUES ($1, $2, $3, $4, 'live', COALESCE($5::timestamptz, now()), $6, $7)
       RETURNING
         id,
         community_id AS "communityId",
         host_handle AS "hostHandle",
         title,
         kind,
         status,
         starts_at AS "startsAt",
         ended_at AS "endedAt",
         provider,
         provider_room_id AS "providerRoomId"`,
      [
        input.communityId,
        host,
        input.title,
        input.kind,
        input.startsAt ?? null,
        input.provider ?? null,
        input.providerRoomId ?? null
      ]
    );
    await client.query(
      `INSERT INTO call_participants (call_id, profile_handle, role)
       VALUES ($1, $2, 'host')
       ON CONFLICT (call_id, profile_handle)
       DO UPDATE SET left_at = NULL, role = 'host'`,
      [call.rows[0]!.id, host]
    );
    await client.query(
      `UPDATE communities
       SET call_status = $2, updated_at = now()
       WHERE id = $1`,
      [input.communityId, input.kind === "video" ? "video live" : "voice live"]
    );
    const created = callRowToContract({ ...call.rows[0]!, participantHandles: [host] });
    await stageAuditLog(client, {
      actorHandle: host,
      action: "community.call.create",
      subjectType: "community_call",
      subjectId: created.id,
      metadata: mutationAuditMetadata(mutation, { communityId: input.communityId, kind: input.kind })
    });
    await completeMutation(client, host, mutation, created);
    const event = await stageEvent(client, {
      kind: "community.call.created",
      actorHandle: host,
      subjectType: "community_call",
      subjectId: created.id,
      visibility: community.visibility === "private" ? "community" : "public",
      audienceHandles:
        community.visibility === "private"
          ? await communityAudienceHandles(client, community.id)
          : undefined,
      payload: { communityId: input.communityId, title: input.title, kind: input.kind }
    });
    return { value: created, events: [event] };
  });
};

export const joinCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = callIdInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));

  if (!hasDatabase()) return { callId: input.callId, profileHandle: handle, status: "joined" };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const call = await client.query<{ communityId: string; status: string; visibility: string }>(
      `SELECT c.community_id AS "communityId", c.status, community.visibility
       FROM community_calls c
       JOIN communities community ON community.id = c.community_id
       WHERE c.id = $1
       FOR UPDATE OF c`,
      [input.callId]
    );
    const callRow = call.rows[0];
    if (!callRow) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
    if (callRow.status === "ended" || callRow.status === "cancelled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This call has already ended." });
    }
    if (callRow.visibility === "private") {
      const membership = await client.query(
        `SELECT 1 FROM community_memberships
         WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
        [callRow.communityId, handle]
      );
      if (!membership.rowCount) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This call belongs to a private community." });
      }
    }
    const joined = await client.query(
      `INSERT INTO call_participants (call_id, profile_handle)
       VALUES ($1, $2)
       ON CONFLICT (call_id, profile_handle)
       DO UPDATE SET left_at = NULL, joined_at = now()
       WHERE call_participants.left_at IS NOT NULL
       RETURNING call_id`,
      [input.callId, handle]
    );
    const value = { callId: input.callId, profileHandle: handle, status: "joined" as const };
    if (!joined.rowCount) return { value };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "community.call.join",
      subjectType: "community_call",
      subjectId: input.callId,
      metadata: { communityId: callRow.communityId }
    });
    const event = await stageEvent(client, {
      kind: "community.call.joined",
      actorHandle: handle,
      subjectType: "community_call",
      subjectId: input.callId,
      visibility: callRow.visibility === "private" ? "community" : "public",
      audienceHandles:
        callRow.visibility === "private"
          ? await communityAudienceHandles(client, callRow.communityId)
          : undefined,
      payload: { communityId: callRow.communityId }
    });
    return { value, events: [event] };
  });
};

export const endCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = callIdInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));

  if (!hasDatabase()) return { callId: input.callId, status: "ended" };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const call = await client.query<{
      communityId: string;
      hostHandle: string | null;
      status: string;
      visibility: string;
    }>(
      `SELECT call.community_id AS "communityId", call.host_handle AS "hostHandle",
         call.status, community.visibility
       FROM community_calls call
       JOIN communities community ON community.id = call.community_id
       WHERE call.id = $1
       FOR UPDATE OF call`,
      [input.callId]
    );
    const callRow = call.rows[0];
    if (!callRow) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
    if (!callRow.hostHandle || cleanHandle(callRow.hostHandle) !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the call host can end this call." });
    }
    const value = { callId: input.callId, status: "ended" as const };
    if (callRow.status === "ended") return { value };

    await client.query(
      `UPDATE community_calls
       SET status = 'ended', ended_at = now(), updated_at = now()
       WHERE id = $1`,
      [input.callId]
    );
    await client.query("UPDATE call_participants SET left_at = now() WHERE call_id = $1 AND left_at IS NULL", [input.callId]);
    await client.query(
      `UPDATE communities
       SET call_status = 'quiet', updated_at = now()
       WHERE id = $1
         AND NOT EXISTS (
           SELECT 1 FROM community_calls
           WHERE community_id = $1 AND status = 'live' AND id <> $2
         )`,
      [callRow.communityId, input.callId]
    );
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "community.call.end",
      subjectType: "community_call",
      subjectId: input.callId,
      metadata: { communityId: callRow.communityId }
    });
    const event = await stageEvent(client, {
      kind: "community.call.ended",
      actorHandle: handle,
      subjectType: "community_call",
      subjectId: input.callId,
      visibility: callRow.visibility === "private" ? "community" : "public",
      audienceHandles:
        callRow.visibility === "private"
          ? await communityAudienceHandles(client, callRow.communityId)
          : undefined,
      payload: { communityId: callRow.communityId }
    });
    return { value, events: [event] };
  });
};

export const search = async (rawInput: unknown) => {
  const input = searchInputSchema.parse(rawInput);
  const term = input.query.toLowerCase();

  if (!hasDatabase()) {
    const snapshot = seedSnapshot();
    return {
      posts: snapshot.items
        .filter((item) => !isDeletedPost(item))
        .filter((item) => item.room !== "office" && item.kind !== "draft")
        .filter((item) => searchablePostText({ ...item, authorName: item.author }).toLowerCase().includes(term))
        .map((item) => ({
          ...item,
          saved: false,
          savedBy: [],
          signaledBy: [],
          forkedBy: [],
          comments: []
        }))
        .slice(0, input.limit),
      profiles: Object.values(snapshot.profiles)
        .filter((person) => [person.name, person.handle, person.role, person.location, person.bio, ...person.fields].join(" ").toLowerCase().includes(term))
        .map(publicProfile)
        .slice(0, input.limit),
      communities: (snapshot.communities ?? [])
        .filter((community) => [community.name, community.field, community.summary, ...community.keywords].join(" ").toLowerCase().includes(term))
        .map(publicCommunity)
        .slice(0, input.limit)
    };
  }

  await ensureLiveData();
  const like = `%${input.query}%`;
  const [postsResult, profilesResult, communitiesResult] = await Promise.all([
    getPool().query<SnapshotRow>(
      `SELECT
        id, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", status, metrics, gathering_reason AS "gatheringReason",
        created_at AS "createdAt", edited_at AS "editedAt", deleted_at AS "deletedAt",
        excerpt, body, tags, signals, claims, objections, evidence, tests, forks, saved,
        saved_by AS "savedBy", signaled_by AS "signaledBy", forked_by AS "forkedBy"
       FROM posts
       WHERE search_text ILIKE $1
         AND deleted_at IS NULL
         AND room <> 'office'
         AND kind <> 'draft'
       ORDER BY created_at DESC
       LIMIT $2`,
      [like, input.limit]
    ),
    getPool().query<ResearchProfileContract>(
      `SELECT handle, name, avatar_url AS "avatarUrl", likes_public AS "likesPublic",
        reshares_public AS "resharesPublic", role, location, bio, fields
       FROM profiles
       WHERE name ILIKE $1 OR handle ILIKE $1 OR role ILIKE $1 OR location ILIKE $1 OR bio ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [like, input.limit]
    ),
    getPool().query<ResearchCommunityContract>(
      `SELECT id, name, field, summary, visibility, online, member_handles AS "memberHandles",
        keywords, seed_counts AS "seedCounts", call_status AS "callStatus"
       FROM communities
       WHERE name ILIKE $1 OR field ILIKE $1 OR summary ILIKE $1
       ORDER BY name ASC
       LIMIT $2`,
      [like, input.limit]
    )
  ]);

  return {
    posts: postsResult.rows.map((row) => ({
      ...rowToItem(row, []),
      saved: false,
      savedBy: [],
      signaledBy: [],
      forkedBy: []
    })),
    profiles: profilesResult.rows.map((person) => publicProfile({ ...person, fields: json(person.fields, []) })),
    communities: communitiesResult.rows.map((community) =>
      publicCommunity({
        ...community,
        memberHandles: json(community.memberHandles, []),
        keywords: json(community.keywords, []),
        seedCounts: json(community.seedCounts, { papers: 0, thoughts: 0, opportunities: 0 })
      })
    )
  };
};

export const listNotifications = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return [];
  await ensureLiveData();
  const result = await getPool().query(
    `SELECT id, kind, title, body, href, read_at AS "readAt", metadata, created_at AS "createdAt"
     FROM notifications
     WHERE profile_handle = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [handle]
  );
  return result.rows;
};

export const markNotificationRead = async (rawInput: unknown, actor: Actor) => {
  const input = markNotificationInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { notificationId: input.notificationId, read: true };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const notification = await client.query<{ readAt: Date | null }>(
      `SELECT read_at AS "readAt" FROM notifications
       WHERE id = $1 AND profile_handle = $2
       FOR UPDATE`,
      [input.notificationId, handle]
    );
    const existing = notification.rows[0];
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found." });
    const value = { notificationId: input.notificationId, read: true };
    if (existing.readAt) return { value };
    await client.query("UPDATE notifications SET read_at = now() WHERE id = $1", [input.notificationId]);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "notification.read",
      subjectType: "notification",
      subjectId: input.notificationId
    });
    const event = await stageEvent(client, {
      kind: "notification.read",
      actorHandle: handle,
      subjectType: "notification",
      subjectId: input.notificationId,
      visibility: "private"
    });
    return { value, events: [event] };
  });
};

export const listConversations = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return [];
  await ensureLiveData();
  const result = await getPool().query(
    `SELECT c.id, c.kind, c.title, c.updated_at AS "updatedAt",
      COALESCE(json_agg(cp.profile_handle) FILTER (WHERE cp.profile_handle IS NOT NULL), '[]') AS participants
     FROM conversations c
     JOIN conversation_participants me ON me.conversation_id = c.id AND me.profile_handle = $1
     LEFT JOIN conversation_participants cp ON cp.conversation_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC
     LIMIT 50`,
    [handle]
  );
  return result.rows;
};

type OwnedWorkspaceRow = { id: string; name: string; visibility: string };
type OwnedNoteRow = { id: string; workspaceId: string };
type OwnedBlockRow = { id: string; noteId: string; workspaceId: string };

const ensureOwnedWorkspace = async (client: PoolClient, handle: string, workspaceId?: string) => {
  if (workspaceId) {
    const owned = await client.query<OwnedWorkspaceRow>(
      `SELECT id, name, visibility FROM workspaces
       WHERE id = $1 AND owner_handle = $2
       FOR SHARE`,
      [workspaceId, handle]
    );
    if (!owned.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found." });
    return owned.rows[0];
  }

  const workspace = await client.query<OwnedWorkspaceRow>(
    `INSERT INTO workspaces (owner_handle, name)
     VALUES ($1, 'Notebook')
     ON CONFLICT (owner_handle, name) DO UPDATE SET updated_at = workspaces.updated_at
     RETURNING id, name, visibility`,
    [handle]
  );
  return workspace.rows[0]!;
};

const findOwnedNote = async (client: PoolClient, handle: string, noteId: string) => {
  const result = await client.query<OwnedNoteRow>(
    `SELECT note.id, note.workspace_id AS "workspaceId"
     FROM notes note
     JOIN workspaces workspace ON workspace.id = note.workspace_id
     WHERE note.id = $1 AND workspace.owner_handle = $2
     FOR SHARE OF note`,
    [noteId, handle]
  );
  return result.rows[0];
};

const findOwnedBlock = async (client: PoolClient, handle: string, blockId: string) => {
  const result = await client.query<OwnedBlockRow>(
    `SELECT block.id, block.note_id AS "noteId", note.workspace_id AS "workspaceId"
     FROM note_blocks block
     JOIN notes note ON note.id = block.note_id
     JOIN workspaces workspace ON workspace.id = note.workspace_id
     WHERE block.id = $1 AND workspace.owner_handle = $2
     FOR UPDATE OF block`,
    [blockId, handle]
  );
  return result.rows[0];
};

export const sendMessage = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = sendMessageInputSchema.parse(rawInput);
  const sender = actorHandle(actor);
  if (!hasDatabase()) {
    return { id: randomUUID(), conversationId: input.conversationId ?? randomUUID(), senderHandle: sender, body: input.body };
  }
  await ensureLiveData();
  const requestedRecipient = input.recipientHandle
    ? await ensureProfileHandle(input.recipientHandle)
    : undefined;
  if (!input.conversationId && !requestedRecipient) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "recipientHandle or conversationId is required." });
  }
  if (requestedRecipient === sender) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Direct messages require another recipient." });
  }

  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, sender, mutation);
    if (claim.replayed) return { value: claim.response };
    let conversationId = input.conversationId;

    if (!conversationId) {
      const recipient = requestedRecipient!;
      const directKey = [sender, recipient].sort().join(":");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [directKey]);
      const existing = await client.query<{ conversationId: string }>(
        `SELECT cp1.conversation_id AS "conversationId"
         FROM conversation_participants cp1
         JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
         JOIN conversations c ON c.id = cp1.conversation_id AND c.kind = 'direct'
         WHERE cp1.profile_handle = $1
           AND cp2.profile_handle = $2
           AND NOT EXISTS (
             SELECT 1 FROM conversation_participants other
             WHERE other.conversation_id = cp1.conversation_id
               AND other.profile_handle NOT IN ($1, $2)
           )
         LIMIT 1`,
        [sender, recipient]
      );
      conversationId = existing.rows[0]?.conversationId;

      if (!conversationId) {
        const created = await client.query<{ id: string }>(
          "INSERT INTO conversations (kind) VALUES ('direct') RETURNING id"
        );
        conversationId = created.rows[0]!.id;
        await client.query(
          `INSERT INTO conversation_participants (conversation_id, profile_handle)
           VALUES ($1, $2), ($1, $3)
           ON CONFLICT DO NOTHING`,
          [conversationId, sender, recipient]
        );
      }
    } else {
      const membership = await client.query(
        `SELECT c.id
         FROM conversations c
         JOIN conversation_participants participant
           ON participant.conversation_id = c.id AND participant.profile_handle = $2
         WHERE c.id = $1
         FOR SHARE OF c`,
        [conversationId, sender]
      );
      if (!membership.rowCount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
      }
    }

    const message = await client.query(
      `INSERT INTO messages (conversation_id, sender_handle, body)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id AS "conversationId", sender_handle AS "senderHandle", body, created_at AS "createdAt"`,
      [conversationId, sender, input.body]
    );
    await client.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [conversationId]);
    const participants = await client.query<{ profileHandle: string }>(
      `SELECT profile_handle AS "profileHandle"
       FROM conversation_participants WHERE conversation_id = $1`,
      [conversationId]
    );
    const value = message.rows[0] as Record<string, unknown>;
    await stageAuditLog(client, {
      actorHandle: sender,
      action: "message.send",
      subjectType: "conversation",
      subjectId: conversationId,
      metadata: mutationAuditMetadata(mutation, { messageId: value.id })
    });
    await completeMutation(client, sender, mutation, value);
    const event = await stageEvent(client, {
      kind: "message.sent",
      actorHandle: sender,
      subjectType: "conversation",
      subjectId: conversationId,
      visibility: "private",
      audienceHandles: participants.rows.map((participant) => participant.profileHandle),
      payload: { messageId: value.id }
    });
    return { value, events: [event] };
  });
};

export const getWorkspace = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { workspace: null, notes: [], blocks: [] };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const workspaceRow = await ensureOwnedWorkspace(client, handle);
    const notes = await client.query(
      "SELECT id, title, visibility, created_at AS \"createdAt\", updated_at AS \"updatedAt\" FROM notes WHERE workspace_id = $1 ORDER BY created_at ASC",
      [workspaceRow.id]
    );
    const blocks = await client.query(
      `SELECT nb.id, nb.note_id AS "noteId", nb.kind, nb.body, nb.sort_order AS "sortOrder", nb.updated_at AS "updatedAt"
       FROM note_blocks nb
       JOIN notes n ON n.id = nb.note_id
       WHERE n.workspace_id = $1
       ORDER BY nb.sort_order ASC, nb.created_at ASC`,
      [workspaceRow.id]
    );
    return { value: { workspace: workspaceRow, notes: notes.rows, blocks: blocks.rows } };
  });
};

export const saveNoteBlock = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = saveNoteBlockInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { id: input.blockId ?? randomUUID(), body: input.body };
  await ensureLiveData();

  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };

    let workspace = input.workspaceId
      ? await ensureOwnedWorkspace(client, handle, input.workspaceId)
      : undefined;
    let noteId = input.noteId;
    if (noteId) {
      const ownedNote = await findOwnedNote(client, handle, noteId);
      if (!ownedNote) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
      if (workspace && workspace.id !== ownedNote.workspaceId) {
        throw new TRPCError({ code: "CONFLICT", message: "The note does not belong to this workspace." });
      }
      workspace ??= await ensureOwnedWorkspace(client, handle, ownedNote.workspaceId);
    }

    const existingBlock = input.blockId
      ? await findOwnedBlock(client, handle, input.blockId)
      : undefined;
    if (input.blockId && !existingBlock) {
      const foreignBlock = await client.query("SELECT 1 FROM note_blocks WHERE id = $1", [input.blockId]);
      if (foreignBlock.rowCount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note block not found." });
      }
    }
    if (existingBlock) {
      if (noteId && noteId !== existingBlock.noteId) {
        throw new TRPCError({ code: "CONFLICT", message: "The block already belongs to another note." });
      }
      if (workspace && workspace.id !== existingBlock.workspaceId) {
        throw new TRPCError({ code: "CONFLICT", message: "The block does not belong to this workspace." });
      }
      noteId = existingBlock.noteId;
      workspace ??= await ensureOwnedWorkspace(client, handle, existingBlock.workspaceId);
    }

    workspace ??= await ensureOwnedWorkspace(client, handle);
    if (!noteId) {
      const note = await client.query<{ id: string }>(
        `INSERT INTO notes (workspace_id, title, visibility)
         VALUES ($1, 'Notebook', $2)
         RETURNING id`,
        [workspace.id, input.visibility]
      );
      noteId = note.rows[0]!.id;
    }

    const block = existingBlock
      ? await client.query(
          `UPDATE note_blocks SET body = $2, updated_at = now()
           WHERE id = $1
           RETURNING id, note_id AS "noteId", body, updated_at AS "updatedAt"`,
          [existingBlock.id, input.body]
        )
      : await client.query(
          `INSERT INTO note_blocks (id, note_id, body)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3)
           RETURNING id, note_id AS "noteId", body, updated_at AS "updatedAt"`,
          [input.blockId ?? null, noteId, input.body]
        );
    await client.query("UPDATE workspaces SET updated_at = now() WHERE id = $1 AND owner_handle = $2", [workspace.id, handle]);
    const value = block.rows[0] as Record<string, unknown>;
    await stageAuditLog(client, {
      actorHandle: handle,
      action: existingBlock ? "note.block.update" : "note.block.create",
      subjectType: "note_block",
      subjectId: String(value.id),
      metadata: mutationAuditMetadata(mutation, { noteId, workspaceId: workspace.id })
    });
    await completeMutation(client, handle, mutation, value);
    const event = await stageEvent(client, {
      kind: existingBlock ? "note.block.updated" : "note.block.created",
      actorHandle: handle,
      subjectType: "note_block",
      subjectId: String(value.id),
      visibility: "private",
      payload: { noteId, workspaceId: workspace.id }
    });
    return { value, events: [event] };
  });
};

export const publishNote = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input: PublishNoteInputContract = publishNoteInputSchema.parse(rawInput);
  const publisher = await ensureProfileHandle(actorHandle(actor));

  if (input.visibility !== "public") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Private and community note publishing require protected post delivery and are not enabled yet."
    });
  }

  let title = input.title;
  let body = input.body;

  if (hasDatabase() && input.noteId) {
    await ensureLiveData();
    const note = await getPool().query<{ title: string; body: string }>(
      `SELECT
         n.title,
         COALESCE(string_agg(nb.body, E'\n\n' ORDER BY nb.sort_order ASC, nb.created_at ASC), '') AS body
       FROM notes n
       JOIN workspaces w ON w.id = n.workspace_id
       LEFT JOIN note_blocks nb ON nb.note_id = n.id
       WHERE n.id = $1 AND w.owner_handle = $2
       GROUP BY n.id`,
      [input.noteId, publisher]
    );

    if (!note.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
    title = title ?? note.rows[0]!.title;
    body = body ?? note.rows[0]!.body;
  }

  if (!title || !body) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Publishing requires a noteId or explicit title and body."
    });
  }

  const item = await createPost(
    {
      title,
      body,
      kind: "paper",
      room: "library",
      authorHandle: publisher
    },
    actor,
    mutation ? { ...mutation, scope: "note.publish.post" } : undefined
  );

  const value = {
    item,
    publication: { noteId: input.noteId ?? null, postId: item.id, visibility: input.visibility }
  };
  if (!hasDatabase()) return value;

  return runAtomic(async (client) => {
    const claim = await claimMutation<typeof value>(client, publisher, mutation);
    if (claim.replayed) return { value: claim.response };
    await client.query(
      `INSERT INTO note_publications (note_id, post_id, publisher_handle, visibility, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (post_id) WHERE post_id IS NOT NULL
       DO UPDATE SET
         note_id = EXCLUDED.note_id,
         publisher_handle = EXCLUDED.publisher_handle,
         visibility = EXCLUDED.visibility,
         metadata = EXCLUDED.metadata`,
      [
        input.noteId ?? null,
        item.id,
        publisher,
        input.visibility,
        JSON.stringify({ source: input.noteId ? "note" : "direct" })
      ]
    );
    await stageAuditLog(client, {
      actorHandle: publisher,
      action: "note.publish",
      subjectType: "post",
      subjectId: item.id,
      metadata: mutationAuditMetadata(mutation, { noteId: input.noteId, visibility: input.visibility })
    });
    await completeMutation(client, publisher, mutation, value);
    const event = await stageEvent(client, {
      kind: "note.published",
      actorHandle: publisher,
      subjectType: "post",
      subjectId: item.id,
      payload: { noteId: input.noteId ?? null, visibility: input.visibility }
    });
    return { value, events: [event] };
  });
};
