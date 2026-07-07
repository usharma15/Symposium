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
  publishNoteInputSchema,
  saveNoteBlockInputSchema,
  searchInputSchema,
  sendMessageInputSchema,
  unfollowProfileInputSchema,
  updatePostInputSchema,
  type CommunityCallContract,
  type InquiryCommentContract,
  type InquiryItemContract,
  type PostActionInputContract,
  type PublishNoteInputContract,
  type ResearchCommunityContract,
  type ResearchProfileContract
} from "../../../../packages/contracts/src";
import {
  cleanHandle,
  incrementMetric,
  isDeletedPost,
  mutateItemForActor,
  tombstonePost,
  toggleHandle,
  updateSignalValue
} from "@/lib/symposiumCore";
import { env } from "../config/env";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { emitEvent } from "../services/events";
import {
  actorHandle,
  callRowToContract,
  commentTreesFromRows,
  defaultProfile,
  ensureLiveData,
  ensureProfileHandle,
  getCommunity,
  getInitialState,
  insertProfile,
  json,
  newId,
  normalizeProfile,
  rowToItem,
  searchablePostText,
  seedSnapshot,
  type CommentRow,
  type SnapshotRow
} from "./foundation";

export { getCommunity, getInitialState, listCommunities } from "./foundation";
export { confirmAttachment, createAttachmentUpload } from "./attachments";
export { askAssistant } from "./assistant";
export { createOpportunity, listOpportunities } from "./opportunities";

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

export const upsertProfile = async (rawInput: unknown, actor?: Actor) => {
  const input = createProfileInputSchema.parse(rawInput);
  const person = normalizeProfile(input);

  if (!hasDatabase()) return person;
  await ensureLiveData();

  const client = await getPool().connect();
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
    await client.query(
      `INSERT INTO audit_logs (actor_handle, action, subject_type, subject_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [actor?.handle ?? person.handle, "profile.upsert", "profile", person.handle, JSON.stringify({ source: actor?.source ?? "api" })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await emitEvent({
    kind: "profile.updated",
    actorHandle: actor?.handle ?? person.handle,
    subjectType: "profile",
    subjectId: person.handle,
    payload: { profile: person }
  });

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
    await client.query("COMMIT");
    return person;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const createPost = async (rawInput: unknown, actor: Actor) => {
  const input = createPostInputSchema.parse(rawInput);
  const snapshot = await getInitialState();
  const handle = actorHandle(actor, input.authorHandle);
  const author = snapshot.profiles[handle] ?? defaultProfile;
  const isPaper = input.kind === "paper";
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
    saved: input.room === "office",
    savedBy: input.room === "office" ? [author.handle] : [],
    signaledBy: [],
    forkedBy: []
  };

  if (!hasDatabase()) return item;
  await ensureLiveData();

  await getPool().query(
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

  await emitEvent({
    kind: "post.created",
    actorHandle: item.authorHandle,
    subjectType: "post",
    subjectId: item.id,
    payload: { item, room: item.room, kind: item.kind, title: item.title }
  });

  return item;
};

const commentMetricsFallback = { signal: "0", forks: "0", saves: "0", reads: "0" };

const mutateCommentForActor = (
  comment: InquiryCommentContract,
  action: PostActionInputContract["action"],
  handle: string,
  active?: boolean
): InquiryCommentContract => {
  const metrics = { ...commentMetricsFallback, ...(comment.metrics ?? {}) };

  if (action === "save") {
    const next = toggleHandle(comment.savedBy, handle, active);
    return {
      ...comment,
      savedBy: next.handles,
      metrics: { ...metrics, saves: incrementMetric(metrics.saves, next.delta) }
    };
  }

  if (action === "signal") {
    const next = toggleHandle(comment.signaledBy, handle, active);
    return {
      ...comment,
      signaledBy: next.handles,
      metrics: { ...metrics, signal: incrementMetric(metrics.signal, next.delta) }
    };
  }

  if (action === "fork") {
    const next = toggleHandle(comment.forkedBy, handle, active);
    return {
      ...comment,
      forkedBy: next.handles,
      metrics: { ...metrics, forks: incrementMetric(metrics.forks, next.delta) }
    };
  }

  return {
    ...comment,
    metrics: { ...metrics, reads: incrementMetric(metrics.reads, 1) }
  };
};

const mapCommentTree = (
  comments: InquiryCommentContract[],
  commentId: string,
  mutate: (comment: InquiryCommentContract) => InquiryCommentContract
): { comments: InquiryCommentContract[]; updated?: InquiryCommentContract } => {
  let updated: InquiryCommentContract | undefined;
  const nextComments = comments.map((comment) => {
    if (comment.id === commentId) {
      updated = mutate(comment);
      return updated;
    }

    const child = mapCommentTree(comment.replies ?? [], commentId, mutate);
    if (child.updated) {
      updated = child.updated;
      return { ...comment, replies: child.comments };
    }

    return comment;
  });

  return { comments: nextComments, updated };
};

export const addComment = async (postId: string, rawInput: unknown, actor: Actor) => {
  const input = createCommentInputSchema.parse(rawInput);
  const snapshot = await getInitialState();
  const existing = snapshot.items.find((item) => item.id === postId);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

  const handle = actorHandle(actor, input.authorHandle);
  const author = snapshot.profiles[handle] ?? defaultProfile;
  const comment: InquiryCommentContract = {
    id: newId("comment"),
    parentId: input.parentId ?? null,
    author: author.name,
    authorHandle: author.handle,
    stance: input.stance || "Comment",
    body: input.body,
    createdAt: new Date().toISOString(),
    replies: []
  };

  if (!hasDatabase()) return comment;

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract | null = null;

  try {
    await client.query("BEGIN");
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

    const lockedItem = rowToItem(row, []);
    const nextCritiques = incrementMetric(lockedItem.metrics.critiques, 1);
    const nextMetrics = { ...lockedItem.metrics, critiques: nextCritiques };
    const nextSignals = updateSignalValue(lockedItem.signals, "Critiques", nextCritiques);

    await client.query(
      `INSERT INTO comments (id, post_id, parent_id, author_handle, author_name, stance, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [comment.id, postId, comment.parentId, comment.authorHandle, comment.author, comment.stance, comment.body]
    );
    await client.query(
      `UPDATE posts
       SET metrics = $2,
           signals = $3,
           updated_at = now()
       WHERE id = $1`,
      [postId, JSON.stringify(nextMetrics), JSON.stringify(nextSignals)]
    );

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
        created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    updatedItem = rowToItem(
      { ...row, metrics: nextMetrics, signals: nextSignals },
      commentsByPost.get(postId) ?? []
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await emitEvent({
    kind: "comment.created",
    actorHandle: comment.authorHandle,
    subjectType: "post",
    subjectId: postId,
    payload: { comment, item: updatedItem, commentId: comment.id, parentId: comment.parentId }
  });

  return comment;
};

export const applyPostAction = async (postId: string, rawInput: unknown, actor: Actor) => {
  const input: PostActionInputContract = postActionInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.actorHandle);

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    if (isDeletedPost(existing)) return existing;
    return mutateItemForActor(existing, input.action, handle, defaultProfile.handle, input.active);
  }

  await ensureLiveData();

  const client = await getPool().connect();
  let updated: InquiryItemContract;

  try {
    await client.query("BEGIN");
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
        created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const existing = rowToItem(row, commentsByPost.get(postId) ?? []);
    if (isDeletedPost(existing)) {
      updated = existing;
      await client.query("COMMIT");
      return updated;
    }
    updated = mutateItemForActor(existing, input.action, handle, defaultProfile.handle, input.active);

    if (input.action === "read") {
      await client.query(
        `INSERT INTO post_actions (post_id, actor_handle, action, count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (post_id, actor_handle, action)
         DO UPDATE SET count = post_actions.count + 1, updated_at = now()`,
        [postId, handle, input.action]
      );
    } else {
      const listKey =
        input.action === "save" ? "savedBy" : input.action === "signal" ? "signaledBy" : "forkedBy";
      const list = updated[listKey] ?? [];
      if (list.includes(handle)) {
        await client.query(
          `INSERT INTO post_actions (post_id, actor_handle, action)
           VALUES ($1, $2, $3)
           ON CONFLICT (post_id, actor_handle, action) DO NOTHING`,
          [postId, handle, input.action]
        );
      } else {
        await client.query(
          "DELETE FROM post_actions WHERE post_id = $1 AND actor_handle = $2 AND action = $3",
          [postId, handle, input.action]
        );
      }
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

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await emitEvent({
    kind: `post.${input.action}`,
    actorHandle: handle,
    subjectType: "post",
    subjectId: postId,
    payload: { action: input.action, active: input.active, item: updated }
  });

  return updated;
};

export const updatePost = async (postId: string, rawInput: unknown, actor: Actor) => {
  const input = updatePostInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.actorHandle);
  const editedAt = new Date().toISOString();

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
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
        signaled_by AS "signaledBy", forked_by AS "forkedBy", created_at AS "createdAt"
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

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await emitEvent({
    kind: "post.updated",
    actorHandle: handle,
    subjectType: "post",
    subjectId: postId,
    payload: { item: updated }
  });

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

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", created_at AS "createdAt"
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
      deleted = tombstonePost(existing);
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
             search_text = $16,
             edited_at = NULL,
             deleted_at = $17,
             updated_at = now()
         WHERE id = $1`,
        [
          postId,
          deleted.title,
          deleted.author,
          deleted.affiliation,
          deleted.status,
          deleted.gatheringReason,
          deleted.excerpt,
          deleted.body,
          JSON.stringify(deleted.tags),
          JSON.stringify(deleted.signals),
          JSON.stringify(deleted.claims),
          JSON.stringify(deleted.objections),
          JSON.stringify(deleted.evidence),
          JSON.stringify(deleted.tests),
          JSON.stringify(deleted.forks),
          searchablePostText({
            title: deleted.title,
            body: deleted.body,
            excerpt: deleted.excerpt,
            authorName: deleted.author
          }),
          deleted.deletedAt
        ]
      );
      didDelete = true;
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });

  if (didDelete) {
    await emitEvent({
      kind: "post.deleted",
      actorHandle: handle,
      subjectType: "post",
      subjectId: postId,
      payload: { itemId: postId, item: deleted }
    });
  }

  return deleted;
};

export const applyCommentAction = async (postId: string, commentId: string, rawInput: unknown, actor: Actor) => {
  const input: PostActionInputContract = commentActionInputSchema.parse(rawInput);
  const handle = actorHandle(actor, input.actorHandle);

  if (!hasDatabase()) {
    const snapshot = await getInitialState();
    const existing = snapshot.items.find((item) => item.id === postId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Post not found." });
    const mapped = mapCommentTree(existing.comments, commentId, (comment) =>
      mutateCommentForActor(comment, input.action, handle, input.active)
    );
    if (!mapped.updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found." });
    return { ...existing, comments: mapped.comments };
  }

  await ensureLiveData();
  const client = await getPool().connect();
  let updatedItem: InquiryItemContract;
  let updatedComment: InquiryCommentContract | undefined;

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

    const commentsResult = await client.query<CommentRow>(
      `SELECT id, post_id AS "postId", parent_id AS "parentId", author_handle AS "authorHandle",
        author_name AS "authorName", stance, body, metrics, saved_by AS "savedBy",
        signaled_by AS "signaledBy", forked_by AS "forkedBy", created_at AS "createdAt"
       FROM comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );
    const commentsByPost = commentTreesFromRows(commentsResult.rows);
    const mapped = mapCommentTree(commentsByPost.get(postId) ?? [], commentId, (comment) =>
      mutateCommentForActor(comment, input.action, handle, input.active)
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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await emitEvent({
    kind: `comment.${input.action}`,
    actorHandle: handle,
    subjectType: "comment",
    subjectId: commentId,
    payload: { action: input.action, item: updatedItem, commentId }
  });

  return updatedItem;
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

  await getPool().query(
    `INSERT INTO profile_follows (follower_handle, following_handle, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (follower_handle, following_handle)
     DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [follower, following, input.status]
  );

  await emitEvent({
    kind: "profile.followed",
    actorHandle: follower,
    subjectType: "profile",
    subjectId: following,
    payload: { follow: { followerHandle: follower, followingHandle: following, status: input.status } }
  });

  return { followerHandle: follower, followingHandle: following, status: input.status };
};

export const unfollowProfile = async (rawInput: unknown, actor: Actor) => {
  const input = unfollowProfileInputSchema.parse(rawInput);
  const follower = await ensureProfileHandle(actorHandle(actor, input.actorHandle));
  const following = cleanHandle(input.targetHandle);

  if (hasDatabase()) {
    await ensureLiveData();
    await getPool().query(
      "DELETE FROM profile_follows WHERE follower_handle = $1 AND following_handle = $2",
      [follower, following]
    );
  }

  await emitEvent({
    kind: "profile.unfollowed",
    actorHandle: follower,
    subjectType: "profile",
    subjectId: following,
    payload: { follow: { followerHandle: follower, followingHandle: following, status: "none" } }
  });

  return { followerHandle: follower, followingHandle: following, status: "none" };
};

export const listFollowing = async (actor: Actor) => {
  const handle = await ensureProfileHandle(actorHandle(actor));
  return listProfileFollows(handle);
};

export const listProfileFollows = async (profileHandle: string) => {
  const handle = await ensureProfileHandle(profileHandle);
  if (!hasDatabase()) return { following: [], followers: [] };
  await ensureLiveData();

  const [following, followers] = await Promise.all([
    getPool().query(
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, created_at AS "createdAt"
       FROM profile_follows
       WHERE follower_handle = $1
       ORDER BY created_at DESC`,
      [handle]
    ),
    getPool().query(
      `SELECT follower_handle AS "followerHandle", following_handle AS "followingHandle", status, created_at AS "createdAt"
       FROM profile_follows
       WHERE following_handle = $1
       ORDER BY created_at DESC`,
      [handle]
    )
  ]);

  return { following: following.rows, followers: followers.rows };
};

export const joinOrRequestCommunity = async (rawInput: unknown, actor: Actor) => {
  const input = joinCommunityInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  const community = await getCommunity(input.communityId);
  if (!hasDatabase()) return { community, status: community.visibility === "private" ? "requested" : "joined" };

  await getPool().query(
    `INSERT INTO community_memberships (community_id, profile_handle, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (community_id, profile_handle) DO UPDATE SET status = EXCLUDED.status`,
    [community.id, handle, community.visibility === "private" ? "requested" : "active"]
  );

  await emitEvent({
    kind: community.visibility === "private" ? "community.requested" : "community.joined",
    actorHandle: handle,
    subjectType: "community",
    subjectId: community.id
  });

  return { community, status: community.visibility === "private" ? "requested" : "joined" };
};

export const listCommunityCalls = async (communityId: string) => {
  const community = await getCommunity(communityId);
  if (!hasDatabase()) return { community, calls: [] as CommunityCallContract[] };
  await ensureLiveData();

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

export const createCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = createCommunityCallInputSchema.parse(rawInput);
  const host = await ensureProfileHandle(actorHandle(actor));
  await getCommunity(input.communityId);

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
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
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
    await client.query("COMMIT");

    const created = callRowToContract({ ...call.rows[0]!, participantHandles: [host] });
    await emitEvent({
      kind: "community.call.created",
      actorHandle: host,
      subjectType: "community_call",
      subjectId: created.id,
      payload: { communityId: input.communityId, title: input.title, kind: input.kind }
    });
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const joinCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = callIdInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));

  if (!hasDatabase()) return { callId: input.callId, profileHandle: handle, status: "joined" };
  await ensureLiveData();

  const call = await getPool().query<{ id: string; status: string }>(
    "SELECT id, status FROM community_calls WHERE id = $1 LIMIT 1",
    [input.callId]
  );
  if (!call.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
  if (call.rows[0]!.status === "ended") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This call has already ended." });
  }

  await getPool().query(
    `INSERT INTO call_participants (call_id, profile_handle)
     VALUES ($1, $2)
     ON CONFLICT (call_id, profile_handle)
     DO UPDATE SET left_at = NULL`,
    [input.callId, handle]
  );

  await emitEvent({
    kind: "community.call.joined",
    actorHandle: handle,
    subjectType: "community_call",
    subjectId: input.callId
  });

  return { callId: input.callId, profileHandle: handle, status: "joined" };
};

export const endCommunityCall = async (rawInput: unknown, actor: Actor) => {
  const input = callIdInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));

  if (!hasDatabase()) return { callId: input.callId, status: "ended" };
  await ensureLiveData();

  const result = await getPool().query<{ communityId: string }>(
    `UPDATE community_calls
     SET status = 'ended', ended_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING community_id AS "communityId"`,
    [input.callId]
  );
  if (!result.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });

  await getPool().query("UPDATE call_participants SET left_at = now() WHERE call_id = $1", [input.callId]);
  await getPool().query(
    `UPDATE communities
     SET call_status = 'quiet', updated_at = now()
     WHERE id = $1
       AND NOT EXISTS (
         SELECT 1 FROM community_calls
         WHERE community_id = $1 AND status = 'live' AND id <> $2
       )`,
    [result.rows[0]!.communityId, input.callId]
  );

  await emitEvent({
    kind: "community.call.ended",
    actorHandle: handle,
    subjectType: "community_call",
    subjectId: input.callId
  });

  return { callId: input.callId, status: "ended" };
};

export const search = async (rawInput: unknown) => {
  const input = searchInputSchema.parse(rawInput);
  const term = input.query.toLowerCase();

  if (!hasDatabase()) {
    const snapshot = seedSnapshot();
    return {
      posts: snapshot.items
        .filter((item) => searchablePostText({ ...item, authorName: item.author }).toLowerCase().includes(term))
        .slice(0, input.limit),
      profiles: Object.values(snapshot.profiles)
        .filter((person) => [person.name, person.handle, person.role, person.location, person.bio, ...person.fields].join(" ").toLowerCase().includes(term))
        .slice(0, input.limit),
      communities: (snapshot.communities ?? []).filter((community) => [community.name, community.field, community.summary, ...community.keywords].join(" ").toLowerCase().includes(term)).slice(0, input.limit)
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
       ORDER BY created_at DESC
       LIMIT $2`,
      [like, input.limit]
    ),
    getPool().query<ResearchProfileContract>(
      `SELECT handle, email, name, avatar_url AS "avatarUrl", likes_public AS "likesPublic",
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
    posts: postsResult.rows.map((row) => rowToItem(row, [])),
    profiles: profilesResult.rows.map((person) => ({ ...person, fields: json(person.fields, []) })),
    communities: communitiesResult.rows.map((community) => ({
      ...community,
      memberHandles: json(community.memberHandles, []),
      keywords: json(community.keywords, []),
      seedCounts: json(community.seedCounts, { papers: 0, thoughts: 0, opportunities: 0 })
    }))
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
  await getPool().query(
    "UPDATE notifications SET read_at = now() WHERE id = $1 AND profile_handle = $2",
    [input.notificationId, handle]
  );
  return { notificationId: input.notificationId, read: true };
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

export const sendMessage = async (rawInput: unknown, actor: Actor) => {
  const input = sendMessageInputSchema.parse(rawInput);
  const sender = actorHandle(actor);
  if (!hasDatabase()) {
    return { id: randomUUID(), conversationId: input.conversationId ?? randomUUID(), senderHandle: sender, body: input.body };
  }
  await ensureLiveData();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let conversationId = input.conversationId;

    if (!conversationId) {
      if (!input.recipientHandle) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "recipientHandle or conversationId is required." });
      }
      const recipient = cleanHandle(input.recipientHandle);
      const existing = await client.query<{ conversationId: string }>(
        `SELECT cp1.conversation_id AS "conversationId"
         FROM conversation_participants cp1
         JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
         WHERE cp1.profile_handle = $1 AND cp2.profile_handle = $2
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
    }

    const message = await client.query(
      `INSERT INTO messages (conversation_id, sender_handle, body)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id AS "conversationId", sender_handle AS "senderHandle", body, created_at AS "createdAt"`,
      [conversationId, sender, input.body]
    );
    await client.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [conversationId]);
    await client.query("COMMIT");

    await emitEvent({
      kind: "message.sent",
      actorHandle: sender,
      subjectType: "conversation",
      subjectId: conversationId!,
      visibility: "private"
    });

    return message.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const getWorkspace = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { workspace: null, notes: [], blocks: [] };
  await ensureLiveData();

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const workspace = await client.query<{ id: string; name: string; visibility: string }>(
      `INSERT INTO workspaces (owner_handle, name)
       VALUES ($1, 'Notebook')
       ON CONFLICT (owner_handle, name) DO UPDATE SET updated_at = workspaces.updated_at
       RETURNING id, name, visibility`,
      [handle]
    );

    let workspaceRow = workspace.rows[0];
    if (!workspaceRow) {
      const existing = await client.query<{ id: string; name: string; visibility: string }>(
        "SELECT id, name, visibility FROM workspaces WHERE owner_handle = $1 ORDER BY created_at ASC LIMIT 1",
        [handle]
      );
      workspaceRow = existing.rows[0]!;
    }

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
    await client.query("COMMIT");
    return { workspace: workspaceRow, notes: notes.rows, blocks: blocks.rows };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const saveNoteBlock = async (rawInput: unknown, actor: Actor) => {
  const input = saveNoteBlockInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { id: input.blockId ?? randomUUID(), body: input.body };
  await ensureLiveData();

  const workspaceState = await getWorkspace(actor);
  const workspaceId = input.workspaceId ?? workspaceState.workspace?.id;
  if (!workspaceId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Workspace could not be created." });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let noteId = input.noteId;
    if (!noteId) {
      const note = await client.query<{ id: string }>(
        `INSERT INTO notes (workspace_id, title, visibility)
         VALUES ($1, 'Notebook', $2)
         RETURNING id`,
        [workspaceId, input.visibility]
      );
      noteId = note.rows[0]!.id;
    }

    const block = await client.query(
      `INSERT INTO note_blocks (id, note_id, body)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3)
       ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
       RETURNING id, note_id AS "noteId", body, updated_at AS "updatedAt"`,
      [input.blockId ?? null, noteId, input.body]
    );
    await client.query("UPDATE workspaces SET updated_at = now() WHERE id = $1 AND owner_handle = $2", [workspaceId, handle]);
    await client.query("COMMIT");
    return block.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const publishNote = async (rawInput: unknown, actor: Actor) => {
  const input: PublishNoteInputContract = publishNoteInputSchema.parse(rawInput);
  const publisher = await ensureProfileHandle(actorHandle(actor));

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
    actor
  );

  if (hasDatabase()) {
    await getPool().query(
      `INSERT INTO note_publications (note_id, post_id, publisher_handle, visibility, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.noteId ?? null,
        item.id,
        publisher,
        input.visibility,
        JSON.stringify({ source: input.noteId ? "note" : "direct" })
      ]
    );
  }

  await emitEvent({
    kind: "note.published",
    actorHandle: publisher,
    subjectType: "post",
    subjectId: item.id,
    payload: { noteId: input.noteId ?? null, visibility: input.visibility }
  });

  return { item, publication: { noteId: input.noteId ?? null, postId: item.id, visibility: input.visibility } };
};
