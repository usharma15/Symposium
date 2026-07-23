import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  createWorkspaceGrantInputSchema,
  deleteWorkspaceGrantInputSchema,
  updateWorkspaceGrantInputSchema,
  workspaceAccessRoleRank,
  workspaceCollaboratorSearchInputSchema,
  workspaceGrantCeiling,
  workspaceRoleWithinCeiling,
  type WorkspaceAccessResourceContract,
  type WorkspaceAccessRoleContract,
  type WorkspaceDocumentKindContract,
  type WorkspaceGrantRoleContract
} from "../../../../packages/contracts/src";
import { hasDatabase } from "../db/client";
import type { WorkspaceAccessCollaborator } from "@/lib/workspaceTypes";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { createNotifications, resolveNotifications } from "../services/notificationDelivery";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

type ResourceAccess = {
  type: WorkspaceAccessResourceContract;
  id: string;
  name: string;
  ownerHandle: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
  actorRole: WorkspaceAccessRoleContract;
  kind?: WorkspaceDocumentKindContract;
  notebookId?: string | null;
  notebookName?: string | null;
};

type DirectGrantRow = {
  id: string;
  granteeHandle: string;
  granteeName: string;
  granteeAvatarUrl: string | null;
  role: WorkspaceGrantRoleContract;
  revision: number;
  grantedByHandle: string;
  grantedByName: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type InheritedGrantRow = {
  granteeHandle: string;
  granteeName: string;
  granteeAvatarUrl: string | null;
  role: WorkspaceGrantRoleContract;
  notebookId: string;
  notebookName: string;
  grantedByHandle: string;
};

const iso = (value: Date | string) => new Date(value).toISOString();
const grantTable = (type: WorkspaceAccessResourceContract) =>
  type === "document" ? "workspace_note_grants" : "workspace_notebook_grants";
const resourceColumn = (type: WorkspaceAccessResourceContract) =>
  type === "document" ? "note_id" : "notebook_id";
const subjectType = (type: WorkspaceAccessResourceContract) =>
  type === "document" ? "note" : "notebook";

const documentRoleSql = `
  CASE GREATEST(
    CASE WHEN note.owner_handle = $2 THEN 5 ELSE 0 END,
    CASE direct.role WHEN 'publisher' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END,
    CASE inherited.role WHEN 'publisher' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END
  )
    WHEN 5 THEN 'owner'
    WHEN 4 THEN 'publisher'
    WHEN 3 THEN 'editor'
    WHEN 2 THEN 'commenter'
    ELSE 'viewer'
  END`;

const loadResourceAccess = async (
  client: PoolClient,
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  handle: string,
  lock = false
): Promise<ResourceAccess> => {
  if (type === "document") {
    const result = await client.query<Record<string, unknown>>(
      `SELECT
         note.id::text,
         note.title AS name,
         note.owner_handle AS "ownerHandle",
         owner.name AS "ownerName",
         owner.avatar_url AS "ownerAvatarUrl",
         note.kind,
         note.notebook_id::text AS "notebookId",
         notebook.name AS "notebookName",
         ${documentRoleSql} AS "actorRole"
       FROM notes note
       JOIN profiles owner ON owner.handle = note.owner_handle
       LEFT JOIN workspace_notebooks notebook ON notebook.id = note.notebook_id AND notebook.deleted_at IS NULL
       LEFT JOIN workspace_note_grants direct ON direct.note_id = note.id AND direct.grantee_handle = $2
       LEFT JOIN workspace_notebook_grants inherited ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $2
       WHERE note.id = $1 AND note.deleted_at IS NULL
         AND (note.owner_handle = $2 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)
       ${lock ? "FOR UPDATE OF note" : ""}`,
      [resourceId, handle]
    );
    const row = result.rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Draft not found." });
    return {
      type,
      id: String(row.id),
      name: String(row.name),
      ownerHandle: String(row.ownerHandle),
      ownerName: String(row.ownerName),
      ownerAvatarUrl: row.ownerAvatarUrl ? String(row.ownerAvatarUrl) : null,
      actorRole: (() => {
        const actorRole = String(row.actorRole) as WorkspaceAccessRoleContract;
        const kind = String(row.kind) as WorkspaceDocumentKindContract;
        return actorRole !== "owner" && !["note", "paper"].includes(kind)
          && workspaceAccessRoleRank[actorRole] > workspaceAccessRoleRank.commenter
          ? "commenter"
          : actorRole;
      })(),
      kind: String(row.kind) as WorkspaceDocumentKindContract,
      notebookId: row.notebookId ? String(row.notebookId) : null,
      notebookName: row.notebookName ? String(row.notebookName) : null
    };
  }

  const result = await client.query<Record<string, unknown>>(
    `SELECT
       notebook.id::text,
       notebook.name,
       notebook.owner_handle AS "ownerHandle",
       owner.name AS "ownerName",
       owner.avatar_url AS "ownerAvatarUrl",
       CASE WHEN notebook.owner_handle = $2 THEN 'owner' ELSE direct.role END AS "actorRole"
     FROM workspace_notebooks notebook
     JOIN profiles owner ON owner.handle = notebook.owner_handle
     LEFT JOIN workspace_notebook_grants direct
       ON direct.notebook_id = notebook.id AND direct.grantee_handle = $2
     WHERE notebook.id = $1 AND notebook.deleted_at IS NULL
       AND (notebook.owner_handle = $2 OR direct.id IS NOT NULL)
     ${lock ? "FOR UPDATE OF notebook" : ""}`,
    [resourceId, handle]
  );
  const row = result.rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Notebook not found." });
  return {
    type,
    id: String(row.id),
    name: String(row.name),
    ownerHandle: String(row.ownerHandle),
    ownerName: String(row.ownerName),
    ownerAvatarUrl: row.ownerAvatarUrl ? String(row.ownerAvatarUrl) : null,
    actorRole: String(row.actorRole) as WorkspaceAccessRoleContract
  };
};

const directGrants = async (client: PoolClient, resource: ResourceAccess) => {
  const table = grantTable(resource.type);
  const column = resourceColumn(resource.type);
  const result = await client.query<DirectGrantRow>(
    `SELECT
       grant_row.id::text,
       grant_row.grantee_handle AS "granteeHandle",
       grantee.name AS "granteeName",
       grantee.avatar_url AS "granteeAvatarUrl",
       grant_row.role,
       grant_row.revision,
       grant_row.granted_by_handle AS "grantedByHandle",
       grantor.name AS "grantedByName",
       grant_row.created_at AS "createdAt",
       grant_row.updated_at AS "updatedAt"
     FROM ${table} grant_row
     JOIN profiles grantee ON grantee.handle = grant_row.grantee_handle
     JOIN profiles grantor ON grantor.handle = grant_row.granted_by_handle
     WHERE grant_row.${column} = $1
     ORDER BY lower(grantee.name), grantee.handle`,
    [resource.id]
  );
  return result.rows;
};

const inheritedGrants = async (client: PoolClient, resource: ResourceAccess) => {
  if (resource.type !== "document" || !resource.notebookId) return [];
  const result = await client.query<InheritedGrantRow>(
    `SELECT
       grant_row.grantee_handle AS "granteeHandle",
       grantee.name AS "granteeName",
       grantee.avatar_url AS "granteeAvatarUrl",
       grant_row.role,
       notebook.id::text AS "notebookId",
       notebook.name AS "notebookName",
       grant_row.granted_by_handle AS "grantedByHandle"
     FROM workspace_notebook_grants grant_row
     JOIN workspace_notebooks notebook ON notebook.id = grant_row.notebook_id AND notebook.deleted_at IS NULL
     JOIN profiles grantee ON grantee.handle = grant_row.grantee_handle
     WHERE grant_row.notebook_id = $1
     ORDER BY lower(grantee.name), grantee.handle`,
    [resource.notebookId]
  );
  return result.rows;
};

const accessOverview = async (client: PoolClient, resource: ResourceAccess, actorHandle: string) => {
  const [direct, inherited] = await Promise.all([
    directGrants(client, resource),
    inheritedGrants(client, resource)
  ]);
  const people = new Map<string, WorkspaceAccessCollaborator>();

  const mapPerson = (row: DirectGrantRow | InheritedGrantRow): WorkspaceAccessCollaborator => ({
    handle: row.granteeHandle,
    name: row.granteeName,
    ...(row.granteeAvatarUrl ? { avatarUrl: row.granteeAvatarUrl } : {}),
    effectiveRole: row.role,
    directGrant: null,
    inheritedGrant: null
  });
  function mapDirectGrant(row: DirectGrantRow) {
    const canManage = resource.actorRole === "owner" || row.grantedByHandle === actorHandle;
    return {
      id: row.id,
      role: row.role,
      revision: row.revision,
      grantedByHandle: row.grantedByHandle,
      grantedByName: row.grantedByName,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      canManage,
      canRemove: canManage || row.granteeHandle === actorHandle
    };
  }
  function mapInheritedGrant(row: InheritedGrantRow) {
    return {
      role: row.role,
      notebookId: row.notebookId,
      notebookName: row.notebookName,
      grantedByHandle: row.grantedByHandle
    };
  }

  for (const row of inherited) {
    const person = mapPerson(row);
    person.inheritedGrant = mapInheritedGrant(row);
    people.set(row.granteeHandle, person);
  }
  for (const row of direct) {
    const person = people.get(row.granteeHandle) ?? mapPerson(row);
    person.directGrant = mapDirectGrant(row);
    if (workspaceAccessRoleRank[row.role] > workspaceAccessRoleRank[person.effectiveRole]) {
      person.effectiveRole = row.role;
    }
    people.set(row.granteeHandle, person);
  }
  if (resource.kind && !["note", "paper"].includes(resource.kind)) {
    for (const person of people.values()) {
      if (workspaceAccessRoleRank[person.effectiveRole] > workspaceAccessRoleRank.commenter) {
        person.effectiveRole = "commenter";
      }
    }
  }

  const maxGrantRole = workspaceGrantCeiling(resource.actorRole, resource.kind);
  return {
    resource: {
      type: resource.type,
      id: resource.id,
      name: resource.name,
      ...(resource.kind ? { kind: resource.kind } : {}),
      ...(resource.type === "document"
        ? { notebookId: resource.notebookId ?? null, notebookName: resource.notebookName ?? null }
        : {})
    },
    owner: {
      handle: resource.ownerHandle,
      name: resource.ownerName,
      ...(resource.ownerAvatarUrl ? { avatarUrl: resource.ownerAvatarUrl } : {})
    },
    actor: {
      role: resource.actorRole,
      canInvite: Boolean(maxGrantRole),
      maxGrantRole
    },
    collaborators: [...people.values()].sort((left, right) => left.name.localeCompare(right.name))
  };
};

const audienceHandles = async (client: PoolClient, resource: ResourceAccess) => {
  if (resource.type === "document") {
    const result = await client.query<{ handle: string }>(
      `SELECT owner_handle AS handle FROM notes WHERE id = $1
       UNION SELECT grantee_handle AS handle FROM workspace_note_grants WHERE note_id = $1
       UNION
       SELECT grant_row.grantee_handle AS handle
       FROM notes note
       JOIN workspace_notebook_grants grant_row ON grant_row.notebook_id = note.notebook_id
       WHERE note.id = $1`,
      [resource.id]
    );
    return result.rows.map((row) => row.handle);
  }
  const result = await client.query<{ handle: string }>(
    `SELECT owner_handle AS handle FROM workspace_notebooks WHERE id = $1
     UNION SELECT grantee_handle AS handle FROM workspace_notebook_grants WHERE notebook_id = $1
     UNION
     SELECT direct.grantee_handle AS handle
     FROM notes note JOIN workspace_note_grants direct ON direct.note_id = note.id
     WHERE note.notebook_id = $1`,
    [resource.id]
  );
  return result.rows.map((row) => row.handle);
};

const assertGrantAllowed = (resource: ResourceAccess, role: WorkspaceGrantRoleContract) => {
  const ceiling = workspaceGrantCeiling(resource.actorRole, resource.kind);
  if (!workspaceRoleWithinCeiling(role, ceiling)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: resource.kind && !["note", "paper"].includes(resource.kind)
        ? "This draft can only be shared for viewing or commenting by its owner."
        : "You cannot grant access above your current sharing role."
    });
  }
};

const notificationCopy = (resource: ResourceAccess, role: WorkspaceGrantRoleContract, grantorName: string) => ({
  title: `${grantorName} shared ${resource.type === "document" ? "a draft" : "a notebook"} with you`,
  body: `${resource.name} · ${role} access`,
  href: resource.type === "document"
    ? `/workspace?view=notes&note=${encodeURIComponent(resource.id)}`
    : "/workspace?view=notes"
});

const stageAccessEvent = async (
  client: PoolClient,
  resource: ResourceAccess,
  handle: string,
  granteeHandle: string,
  role: WorkspaceGrantRoleContract | null,
  action: "granted" | "updated" | "revoked",
  extraAudience: string[] = []
) => stageEvent(client, {
  kind: `note.access.${action}`,
  actorHandle: handle,
  audienceHandles: Array.from(new Set([...(await audienceHandles(client, resource)), ...extraAudience])),
  subjectType: subjectType(resource.type),
  subjectId: resource.id,
  visibility: "private",
  payload: { resourceType: resource.type, resourceId: resource.id, granteeHandle, role, action }
});

export const getWorkspaceAccess = async (
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  actor: Actor
) => {
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace access is unavailable." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const resource = await loadResourceAccess(client, type, resourceId, handle);
    return { value: await accessOverview(client, resource, handle) };
  });
};

export const createWorkspaceGrant = async (
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = createWorkspaceGrantInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const granteeHandle = await ensureProfileHandle(input.granteeHandle);
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace access is unavailable." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const resource = await loadResourceAccess(client, type, resourceId, handle, true);
    if (granteeHandle === resource.ownerHandle || granteeHandle === handle) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choose another Symposium participant." });
    }
    assertGrantAllowed(resource, input.role);
    const table = grantTable(type);
    const column = resourceColumn(type);
    let inserted: DirectGrantRow;
    try {
      const result = await client.query<DirectGrantRow>(
        `INSERT INTO ${table} (${column}, grantee_handle, role, granted_by_handle)
         VALUES ($1, $2, $3, $4)
         RETURNING id::text, grantee_handle AS "granteeHandle", role, revision,
           granted_by_handle AS "grantedByHandle", created_at AS "createdAt", updated_at AS "updatedAt",
           ''::text AS "granteeName", NULL::text AS "granteeAvatarUrl", ''::text AS "grantedByName"`,
        [resource.id, granteeHandle, input.role, handle]
      );
      inserted = result.rows[0]!;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new TRPCError({ code: "CONFLICT", message: "This participant already has direct access." });
      }
      throw error;
    }
    const grantor = await client.query<{ name: string }>("SELECT name FROM profiles WHERE handle = $1", [handle]);
    const copy = notificationCopy(resource, input.role, grantor.rows[0]?.name ?? handle);
    const createdNotifications = await createNotifications(client, [{
      profileHandle: granteeHandle,
      kind: "workspace_access_granted",
      title: copy.title,
      body: copy.body,
      href: copy.href,
      dedupeKey: `workspace-access-granted:${inserted.id}:${inserted.revision}`,
      metadata: { resourceType: type, resourceId, role: input.role, grantedByHandle: handle }
    }]);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.access.grant",
      subjectType: subjectType(type),
      subjectId: resource.id,
      metadata: mutationAuditMetadata(mutation, { granteeHandle, role: input.role, resourceType: type })
    });
    const event = await stageAccessEvent(client, resource, handle, granteeHandle, input.role, "granted", [granteeHandle]);
    const value = {
      grant: { id: inserted.id, granteeHandle, role: inserted.role, revision: inserted.revision },
      access: await accessOverview(client, resource, handle)
    };
    await completeMutation(client, handle, mutation, value);
    return { value, events: [...createdNotifications.events, event] };
  });
};

export const updateWorkspaceGrant = async (
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  rawGranteeHandle: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = updateWorkspaceGrantInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const granteeHandle = await ensureProfileHandle(rawGranteeHandle);
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace access is unavailable." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const resource = await loadResourceAccess(client, type, resourceId, handle, true);
    assertGrantAllowed(resource, input.role);
    const table = grantTable(type);
    const column = resourceColumn(type);
    const existing = await client.query<{ revision: number; grantedByHandle: string }>(
      `SELECT revision, granted_by_handle AS "grantedByHandle" FROM ${table}
       WHERE ${column} = $1 AND grantee_handle = $2 FOR UPDATE`,
      [resource.id, granteeHandle]
    );
    const grant = existing.rows[0];
    if (!grant) throw new TRPCError({ code: "NOT_FOUND", message: "Direct access grant not found." });
    if (resource.actorRole !== "owner" && grant.grantedByHandle !== handle) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or the collaborator who granted this access can change it." });
    }
    if (grant.revision !== input.expectedRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "This access setting changed before your update." });
    }
    const updated = await client.query<{ revision: number }>(
      `UPDATE ${table} SET role = $3, revision = revision + 1, updated_at = now()
       WHERE ${column} = $1 AND grantee_handle = $2 AND revision = $4
       RETURNING revision`,
      [resource.id, granteeHandle, input.role, input.expectedRevision]
    );
    if (!updated.rowCount) throw new TRPCError({ code: "CONFLICT", message: "This access setting changed before your update." });
    const createdNotifications = await createNotifications(client, [{
      profileHandle: granteeHandle,
      kind: "workspace_access_updated",
      title: `Access updated for ${resource.name}`,
      body: `${resource.type === "document" ? "Draft" : "Notebook"} · ${input.role} access`,
      href: resource.type === "document"
        ? `/workspace?view=notes&note=${encodeURIComponent(resource.id)}`
        : "/workspace?view=notes",
      dedupeKey: `workspace-access-updated:${type}:${resource.id}:${granteeHandle}:${updated.rows[0]!.revision}`,
      metadata: { resourceType: type, resourceId, role: input.role, updatedByHandle: handle }
    }]);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.access.update",
      subjectType: subjectType(type),
      subjectId: resource.id,
      metadata: mutationAuditMetadata(mutation, { granteeHandle, role: input.role, previousRevision: input.expectedRevision, resourceType: type })
    });
    const event = await stageAccessEvent(client, resource, handle, granteeHandle, input.role, "updated", [granteeHandle]);
    const value = { access: await accessOverview(client, resource, handle) };
    await completeMutation(client, handle, mutation, value);
    return { value, events: [...createdNotifications.events, event] };
  });
};

export const deleteWorkspaceGrant = async (
  type: WorkspaceAccessResourceContract,
  resourceId: string,
  rawGranteeHandle: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
) => {
  const input = deleteWorkspaceGrantInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  const granteeHandle = await ensureProfileHandle(rawGranteeHandle);
  if (!hasDatabase()) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace access is unavailable." });
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<Record<string, unknown>>(client, handle, mutation);
    if (claim.replayed) return { value: claim.response };
    const resource = await loadResourceAccess(client, type, resourceId, handle, true);
    const table = grantTable(type);
    const column = resourceColumn(type);
    const existing = await client.query<{ revision: number; role: WorkspaceGrantRoleContract; grantedByHandle: string }>(
      `SELECT revision, role, granted_by_handle AS "grantedByHandle" FROM ${table}
       WHERE ${column} = $1 AND grantee_handle = $2 FOR UPDATE`,
      [resource.id, granteeHandle]
    );
    const grant = existing.rows[0];
    if (!grant) throw new TRPCError({ code: "NOT_FOUND", message: "Direct access grant not found." });
    const canRemove = resource.actorRole === "owner" || grant.grantedByHandle === handle || granteeHandle === handle;
    if (!canRemove) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner, grant creator, or recipient can remove this access." });
    }
    if (grant.revision !== input.expectedRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "This access setting changed before removal." });
    }
    const audienceBeforeRemoval = await audienceHandles(client, resource);
    const removed = await client.query(
      `DELETE FROM ${table} WHERE ${column} = $1 AND grantee_handle = $2 AND revision = $3 RETURNING id`,
      [resource.id, granteeHandle, input.expectedRevision]
    );
    if (!removed.rowCount) throw new TRPCError({ code: "CONFLICT", message: "This access setting changed before removal." });
    const createdNotifications = granteeHandle === handle
      ? { notifications: [], events: [] }
      : await createNotifications(client, [{
          profileHandle: granteeHandle,
          kind: "workspace_access_revoked",
          title: `Access removed from ${resource.name}`,
          body: `${resource.type === "document" ? "Draft" : "Notebook"} access was removed.`,
          href: "/workspace?view=notes",
          dedupeKey: `workspace-access-revoked:${type}:${resource.id}:${granteeHandle}:${input.expectedRevision}`,
          metadata: { resourceType: type, resourceId, removedByHandle: handle }
        }]);
    const inaccessibleNotes = await client.query<{ noteId: string }>(
      `SELECT note.id::text AS "noteId"
       FROM notes note
       WHERE (
           ($1::text = 'document' AND note.id::text = $2)
           OR ($1::text = 'notebook' AND note.notebook_id::text = $2)
         )
         AND note.owner_handle <> $3
         AND NOT EXISTS (
           SELECT 1
           FROM workspace_note_grants direct
           WHERE direct.note_id = note.id
             AND direct.grantee_handle = $3
         )
         AND NOT EXISTS (
           SELECT 1
           FROM workspace_notebook_grants inherited
           WHERE inherited.notebook_id = note.notebook_id
             AND inherited.grantee_handle = $3
         )`,
      [type, resource.id, granteeHandle]
    );
    const resolvedMentions = inaccessibleNotes.rows.length
      ? await resolveNotifications(client, {
          kinds: ["workspace_mention"],
          metadataMatches: inaccessibleNotes.rows.map((row) => ({ noteId: row.noteId })),
          profileHandles: [granteeHandle],
          reason: "workspace_access_revoked"
        })
      : { notifications: [], events: [] };
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "workspace.access.revoke",
      subjectType: subjectType(type),
      subjectId: resource.id,
      metadata: mutationAuditMetadata(mutation, { granteeHandle, role: grant.role, resourceType: type })
    });
    const event = await stageAccessEvent(
      client,
      resource,
      handle,
      granteeHandle,
      null,
      "revoked",
      [...audienceBeforeRemoval, granteeHandle]
    );
    let access = null;
    try {
      const remainingResource = await loadResourceAccess(client, type, resourceId, handle);
      access = await accessOverview(client, remainingResource, handle);
    } catch (error) {
      if (!(error instanceof TRPCError) || error.code !== "NOT_FOUND") throw error;
    }
    const value = { removed: true, resourceId: resource.id, granteeHandle, access };
    await completeMutation(client, handle, mutation, value);
    return {
      value,
      events: [...createdNotifications.events, ...resolvedMentions.events, event]
    };
  });
};

export const searchWorkspaceCollaborators = async (rawInput: unknown, actor: Actor) => {
  const input = workspaceCollaboratorSearchInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  if (!hasDatabase()) return { query: input.query, people: [] };
  await ensureLiveData();
  const pattern = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
  return runAtomic(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT handle, name, avatar_url AS "avatarUrl", role
       FROM profiles
       WHERE handle <> $1 AND (handle ILIKE $2 ESCAPE '\\' OR name ILIKE $2 ESCAPE '\\')
       ORDER BY CASE WHEN handle = $3 THEN 0 WHEN handle ILIKE $4 ESCAPE '\\' THEN 1 ELSE 2 END,
         lower(name), handle
       LIMIT $5`,
      [handle, pattern, input.query.startsWith("@") ? input.query : `@${input.query}`, `${input.query}%`, input.limit]
    );
    return { value: { query: input.query, people: result.rows } };
  });
};
