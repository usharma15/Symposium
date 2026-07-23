import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  createOpportunityApplicationCommentInputSchema,
  createOpportunityApplicationInputSchema,
  updateOpportunityApplicationInputSchema,
  type InquiryAttachmentContract,
  type OpportunityApplicationCommentContract,
  type OpportunityApplicationContract
} from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { stageAuditLog } from "../services/audit";
import { publishStoredEvent, stageEvent, type StoredLiveEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { replaceOwnerAttachments } from "../services/attachmentOwnership";
import { queueAttachmentsForOwnerStorageDeletion, triggerStorageDeletion } from "../services/storageDeletion";
import { createNotifications, resolveNotifications } from "../services/notificationDelivery";
import { actorHandle, ensureLiveData, rowToAttachment, type AttachmentRow } from "./foundation";

type ApplicationRow = {
  id: string;
  revision: number;
  postId: string;
  applicantHandle: string;
  applicantName: string;
  applicantAvatarUrl: string | null;
  applicantAffiliation: string;
  applicantEmail: string | null;
  statement: string;
  shortlisted: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type CommentRow = {
  id: string;
  applicationId: string;
  authorHandle: string;
  authorName: string;
  body: string;
  createdAt: Date | string;
};

const iso = (value: Date | string) => new Date(value).toISOString();
const applicationSelect = `SELECT
  application.id::text,
  application.revision,
  application.post_id AS "postId",
  application.applicant_handle AS "applicantHandle",
  profile.name AS "applicantName",
  profile.avatar_url AS "applicantAvatarUrl",
  profile.location AS "applicantAffiliation",
  profile.email AS "applicantEmail",
  application.statement,
  application.shortlisted,
  application.created_at AS "createdAt",
  application.updated_at AS "updatedAt"
 FROM opportunity_applications application
 JOIN profiles profile ON profile.handle = application.applicant_handle`;

const requireDatabase = async () => {
  if (!hasDatabase()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Live opportunity applications require the persistent database." });
  await ensureLiveData();
};

const postAccess = async (client: PoolClient, postId: string, lock = false) => {
  const result = await client.query<{
    authorHandle: string | null;
    title: string;
    deletedAt: Date | null;
    opportunity: { status?: string; deadline?: string | null } | null;
  }>(
    `SELECT author_handle AS "authorHandle", title, deleted_at AS "deletedAt", opportunity
     FROM posts WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [postId]
  );
  const post = result.rows[0];
  if (!post || post.deletedAt || !post.opportunity) throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found." });
  return post;
};

const commentsFor = async (client: PoolClient, applicationIds: string[]) => {
  if (!applicationIds.length) return new Map<string, OpportunityApplicationCommentContract[]>();
  const rows = await client.query<CommentRow>(
    `SELECT comment.id::text, comment.application_id::text AS "applicationId",
            comment.author_handle AS "authorHandle", profile.name AS "authorName",
            comment.body, comment.created_at AS "createdAt"
     FROM opportunity_application_comments comment
     JOIN profiles profile ON profile.handle = comment.author_handle
     WHERE comment.application_id = ANY($1::uuid[])
     ORDER BY comment.created_at ASC`,
    [applicationIds]
  );
  const grouped = new Map<string, OpportunityApplicationCommentContract[]>();
  for (const row of rows.rows) {
    const comment = { ...row, createdAt: iso(row.createdAt) };
    grouped.set(row.applicationId, [...(grouped.get(row.applicationId) ?? []), comment]);
  }
  return grouped;
};

const attachmentsFor = async (client: PoolClient, applicationIds: string[], actor: string) => {
  if (!applicationIds.length) return new Map<string, InquiryAttachmentContract[]>();
  const rows = await client.query<AttachmentRow>(
    `SELECT id::text, owner_id AS "ownerId", file_name AS "fileName", content_type AS "contentType",
            byte_size AS "byteSize", status, metadata, object_key AS "objectKey", created_at AS "createdAt"
     FROM attachments
     WHERE owner_type = 'opportunity_application'
       AND owner_id = ANY($1::text[])
       AND status IN ('uploaded', 'previewed')
     ORDER BY created_at ASC`,
    [applicationIds]
  );
  const grouped = new Map<string, InquiryAttachmentContract[]>();
  for (const row of rows.rows) {
    if (!row.ownerId) continue;
    const attachment = {
      ...rowToAttachment(row),
      url: `/api/opportunity-attachments/${encodeURIComponent(row.id)}?actorHandle=${encodeURIComponent(actor)}`
    };
    grouped.set(row.ownerId, [...(grouped.get(row.ownerId) ?? []), attachment]);
  }
  return grouped;
};

const hydrate = async (client: PoolClient, rows: ApplicationRow[], actor: string) => {
  const ids = rows.map((row) => row.id);
  const [comments, attachments] = await Promise.all([commentsFor(client, ids), attachmentsFor(client, ids, actor)]);
  return rows.map((row): OpportunityApplicationContract => ({
    ...row,
    applicantAvatarUrl: row.applicantAvatarUrl || undefined,
    applicantEmail: row.applicantEmail || undefined,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    comments: comments.get(row.id) ?? [],
    attachments: attachments.get(row.id) ?? []
  }));
};

const publish = async (events: StoredLiveEvent[]) => {
  for (const event of events) await publishStoredEvent(event);
};

export const listOpportunityApplications = async (postId: string, actor: Actor) => {
  await requireDatabase();
  const handle = actorHandle(actor);
  const client = await getPool().connect();
  try {
    const post = await postAccess(client, postId);
    if (post.authorHandle !== handle) throw new TRPCError({ code: "FORBIDDEN", message: "Only the opportunity poster can review applications." });
    const rows = await client.query<ApplicationRow>(`${applicationSelect} WHERE application.post_id = $1 ORDER BY application.created_at DESC`, [postId]);
    return hydrate(client, rows.rows, handle);
  } finally {
    client.release();
  }
};

export const getOwnOpportunityApplication = async (postId: string, actor: Actor) => {
  await requireDatabase();
  const handle = actorHandle(actor);
  const client = await getPool().connect();
  try {
    await postAccess(client, postId);
    const rows = await client.query<ApplicationRow>(`${applicationSelect} WHERE application.post_id = $1 AND application.applicant_handle = $2`, [postId, handle]);
    const application = (await hydrate(client, rows.rows, handle))[0] ?? null;
    return application ? { ...application, shortlisted: false, comments: [] } : null;
  } finally {
    client.release();
  }
};

export const createOpportunityApplication = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createOpportunityApplicationInputSchema.parse(rawInput);
  await requireDatabase();
  const handle = actorHandle(actor, input.actorHandle);
  const client = await getPool().connect();
  let application: OpportunityApplicationContract;
  const events: StoredLiveEvent[] = [];
  try {
    await client.query("BEGIN");
    const claim = await claimMutation<OpportunityApplicationContract>(client, handle, mutation);
    if (claim.replayed) {
      await client.query("COMMIT");
      return claim.response;
    }
    const post = await postAccess(client, input.postId, true);
    if (post.authorHandle === handle) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot apply to your own opportunity." });
    if (post.opportunity?.status !== "open") throw new TRPCError({ code: "BAD_REQUEST", message: "This opportunity is closed." });
    if (post.opportunity.deadline && post.opportunity.deadline < new Date().toISOString().slice(0, 10)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The application deadline has passed." });
    }
    const id = randomUUID();
    const inserted = await client.query<ApplicationRow>(
      `INSERT INTO opportunity_applications (id, post_id, applicant_handle, statement)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (post_id, applicant_handle) DO NOTHING
       RETURNING id::text, revision, post_id AS "postId", applicant_handle AS "applicantHandle",
         (SELECT name FROM profiles WHERE handle = applicant_handle) AS "applicantName",
         (SELECT avatar_url FROM profiles WHERE handle = applicant_handle) AS "applicantAvatarUrl",
         (SELECT location FROM profiles WHERE handle = applicant_handle) AS "applicantAffiliation",
         (SELECT email FROM profiles WHERE handle = applicant_handle) AS "applicantEmail",
         statement, shortlisted, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, input.postId, handle, input.statement]
    );
    if (!inserted.rows[0]) throw new TRPCError({ code: "CONFLICT", message: "You have already applied to this opportunity." });
    const attachmentChange = await replaceOwnerAttachments(client, {
      attachmentIds: input.attachmentIds,
      ownerId: id,
      ownerType: "opportunity_application",
      uploaderHandle: handle
    });
    if (attachmentChange.attachments.some((attachment) => attachment.contentType.startsWith("image/") || attachment.contentType.startsWith("video/"))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Opportunity applications accept document attachments only." });
    }
    application = (await hydrate(client, inserted.rows, handle))[0]!;
    await stageAuditLog(client, { actorHandle: handle, action: "opportunity.application.create", subjectType: "opportunity_application", subjectId: id, metadata: { postId: input.postId, attachmentCount: application.attachments.length } });
    await completeMutation(client, handle, mutation, application);
    const createdNotifications = await createNotifications(client, [{
      profileHandle: post.authorHandle!,
      kind: "opportunity_application_received",
      title: `${application.applicantName} applied to your opportunity`,
      body: post.title,
      href: `/posts/${encodeURIComponent(input.postId)}/applications?application=${encodeURIComponent(id)}`,
      dedupeKey: `opportunity-application-received:${id}`,
      metadata: { postId: input.postId, applicationId: id, applicantHandle: handle }
    }]);
    events.push(...createdNotifications.events);
    events.push(await stageEvent(client, {
      kind: "opportunity.application.created", actorHandle: handle, audienceHandles: [handle, post.authorHandle!],
      subjectType: "opportunity_application", subjectId: id, visibility: "private", payload: { postId: input.postId, applicationId: id }
    }));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await publish(events);
  return application;
};

export const updateOpportunityApplication = async (postId: string, applicationId: string, rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = updateOpportunityApplicationInputSchema.parse(rawInput);
  await requireDatabase();
  const handle = actorHandle(actor, input.actorHandle);
  const client = await getPool().connect();
  let application: OpportunityApplicationContract;
  const events: StoredLiveEvent[] = [];
  try {
    await client.query("BEGIN");
    const claim = await claimMutation<OpportunityApplicationContract>(client, handle, mutation);
    if (claim.replayed) { await client.query("COMMIT"); return claim.response; }
    const post = await postAccess(client, postId);
    if (post.authorHandle !== handle) throw new TRPCError({ code: "FORBIDDEN", message: "Only the opportunity poster can review applications." });
    const updated = await client.query<ApplicationRow>(
      `${applicationSelect.replace(" FROM opportunity_applications application", " FROM opportunity_applications application")}
       WHERE application.id = $1 AND application.post_id = $2 AND application.revision = $3 FOR UPDATE`,
      [applicationId, postId, input.expectedRevision]
    );
    const current = updated.rows[0];
    if (!current) throw new TRPCError({ code: "CONFLICT", message: "This application changed or no longer exists." });
    const revision = await client.query<{ revision: number; updatedAt: Date }>(
      `UPDATE opportunity_applications SET shortlisted = $2, revision = revision + 1, updated_at = now()
       WHERE id = $1 RETURNING revision, updated_at AS "updatedAt"`, [applicationId, input.shortlisted]
    );
    application = (await hydrate(client, [{ ...current, shortlisted: input.shortlisted, ...revision.rows[0] }], handle))[0]!;
    await completeMutation(client, handle, mutation, application);
    const resolvedNotifications = await resolveNotifications(client, {
      kinds: ["opportunity_application_received"],
      metadataMatches: [{ postId, applicationId }],
      profileHandles: [handle],
      reason: "opportunity_application_reviewed"
    });
    events.push(...resolvedNotifications.events);
    if (current.shortlisted !== input.shortlisted) {
      const createdNotifications = await createNotifications(client, [{
        profileHandle: current.applicantHandle,
        kind: input.shortlisted ? "opportunity_application_shortlisted" : "opportunity_application_status",
        title: input.shortlisted ? "Your application was shortlisted" : "Your application status changed",
        body: post.title,
        href: `/posts/${encodeURIComponent(postId)}`,
        dedupeKey: `opportunity-application-status:${applicationId}:${application.revision}`,
        metadata: { postId, applicationId, shortlisted: input.shortlisted }
      }]);
      events.push(...createdNotifications.events);
    }
    events.push(await stageEvent(client, { kind: "opportunity.application.updated", actorHandle: handle, audienceHandles: [handle], subjectType: "opportunity_application", subjectId: applicationId, visibility: "private", payload: { postId, applicationId } }));
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  await publish(events);
  return application;
};

export const addOpportunityApplicationComment = async (postId: string, applicationId: string, rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input = createOpportunityApplicationCommentInputSchema.parse(rawInput);
  await requireDatabase();
  const handle = actorHandle(actor, input.actorHandle);
  const client = await getPool().connect();
  let application: OpportunityApplicationContract;
  const events: StoredLiveEvent[] = [];
  try {
    await client.query("BEGIN");
    const claim = await claimMutation<OpportunityApplicationContract>(client, handle, mutation);
    if (claim.replayed) { await client.query("COMMIT"); return claim.response; }
    const post = await postAccess(client, postId);
    if (post.authorHandle !== handle) throw new TRPCError({ code: "FORBIDDEN", message: "Only the opportunity poster can add private review notes." });
    const rows = await client.query<ApplicationRow>(`${applicationSelect} WHERE application.id = $1 AND application.post_id = $2 FOR UPDATE`, [applicationId, postId]);
    if (!rows.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
    await client.query(`INSERT INTO opportunity_application_comments (application_id, author_handle, body) VALUES ($1, $2, $3)`, [applicationId, handle, input.body]);
    application = (await hydrate(client, rows.rows, handle))[0]!;
    await completeMutation(client, handle, mutation, application);
    events.push(await stageEvent(client, { kind: "opportunity.application.comment.created", actorHandle: handle, audienceHandles: [handle], subjectType: "opportunity_application", subjectId: applicationId, visibility: "private", payload: { postId, applicationId } }));
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  await publish(events);
  return application;
};

export const deleteOpportunityApplication = async (postId: string, applicationId: string, actor: Actor, mutation?: MutationContext) => {
  await requireDatabase();
  const handle = actorHandle(actor);
  const client = await getPool().connect();
  const events: StoredLiveEvent[] = [];
  let attachmentIds: string[] = [];
  try {
    await client.query("BEGIN");
    const claim = await claimMutation<{ id: string; postId: string }>(client, handle, mutation);
    if (claim.replayed) { await client.query("COMMIT"); return claim.response; }
    const post = await postAccess(client, postId);
    if (post.authorHandle !== handle) throw new TRPCError({ code: "FORBIDDEN", message: "Only the opportunity poster can delete applications." });
    const existing = await client.query<{ applicantHandle: string }>(`SELECT applicant_handle AS "applicantHandle" FROM opportunity_applications WHERE id = $1 AND post_id = $2 FOR UPDATE`, [applicationId, postId]);
    if (!existing.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
    attachmentIds = await queueAttachmentsForOwnerStorageDeletion(client, "opportunity_application", applicationId, "deleted_opportunity_application");
    await client.query(`DELETE FROM opportunity_applications WHERE id = $1`, [applicationId]);
    const response = { id: applicationId, postId };
    await stageAuditLog(client, { actorHandle: handle, action: "opportunity.application.delete", subjectType: "opportunity_application", subjectId: applicationId, metadata: { postId, attachmentCount: attachmentIds.length } });
    await completeMutation(client, handle, mutation, response);
    const resolvedNotifications = await resolveNotifications(client, {
      kinds: ["opportunity_application_received"],
      metadataMatches: [{ postId, applicationId }],
      profileHandles: [handle],
      reason: "opportunity_application_closed"
    });
    events.push(...resolvedNotifications.events);
    const createdNotifications = await createNotifications(client, [{
      profileHandle: existing.rows[0].applicantHandle,
      kind: "opportunity_application_closed",
      title: "Your opportunity application was closed",
      body: post.title,
      href: `/posts/${encodeURIComponent(postId)}`,
      dedupeKey: `opportunity-application-closed:${applicationId}`,
      metadata: { postId, applicationId }
    }]);
    events.push(...createdNotifications.events);
    events.push(await stageEvent(client, { kind: "opportunity.application.deleted", actorHandle: handle, audienceHandles: [handle, existing.rows[0].applicantHandle], subjectType: "opportunity_application", subjectId: applicationId, visibility: "private", payload: { postId, applicationId } }));
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  await publish(events);
  if (attachmentIds.length) await triggerStorageDeletion(attachmentIds);
  return { id: applicationId, postId };
};

export const assertOpportunityAttachmentAccess = async (attachmentId: string, actor: Actor) => {
  await requireDatabase();
  const handle = actorHandle(actor);
  const result = await getPool().query<{ objectKey: string }>(
    `SELECT attachment.object_key AS "objectKey"
     FROM attachments attachment
     JOIN opportunity_applications application ON application.id::text = attachment.owner_id
     JOIN posts post ON post.id = application.post_id
     WHERE attachment.id = $1 AND attachment.owner_type = 'opportunity_application'
       AND attachment.status IN ('uploaded', 'previewed') AND post.deleted_at IS NULL
       AND (application.applicant_handle = $2 OR post.author_handle = $2)`,
    [attachmentId, handle]
  );
  if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found." });
  return result.rows[0];
};
