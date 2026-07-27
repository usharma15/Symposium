import { TRPCError } from "@trpc/server";
import {
  createAssistantProjectInputSchema,
  deleteAssistantProjectInputSchema,
  updateAssistantProjectInputSchema,
  type AssistantProjectContract,
  type AssistantProjectDeleteResultContract,
  type AssistantProjectListResultContract,
  type AssistantProjectMutationResultContract
} from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import type { Actor } from "../services/auth";
import { stageEvent } from "../services/events";
import {
  claimMutation,
  completeMutation,
  type MutationContext
} from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";

type AssistantProjectRow = {
  id: string;
  name: string;
  revision: number;
  activeThreadCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const iso = (value: Date | string) => new Date(value).toISOString();

const projectContract = (
  row: AssistantProjectRow
): AssistantProjectContract => ({
  id: row.id,
  name: row.name,
  revision: Number(row.revision),
  activeThreadCount: Number(row.activeThreadCount),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const projectSelect = `
  project.id::text,
  project.name,
  project.revision,
  project.created_at AS "createdAt",
  project.updated_at AS "updatedAt",
  count(conversation.id) FILTER (
    WHERE conversation.deleted_at IS NULL
      AND conversation.archived_at IS NULL
  )::int AS "activeThreadCount"
`;

export const listAssistantProjects = async (
  actor: Actor
): Promise<AssistantProjectListResultContract> => {
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Assistant Projects require the live database."
    });
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  const result = await getPool().query<AssistantProjectRow>(
    `SELECT ${projectSelect}
     FROM ai_projects project
     LEFT JOIN ai_conversations conversation
       ON conversation.project_id = project.id
      AND conversation.owner_handle = project.owner_handle
      AND conversation.kind = 'research_thread'
     WHERE project.owner_handle = $1
       AND project.deleted_at IS NULL
     GROUP BY project.id
     ORDER BY project.updated_at DESC, lower(project.name), project.id
     LIMIT 100`,
    [owner]
  );
  return { projects: result.rows.map(projectContract) };
};

export const createAssistantProject = async (
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantProjectMutationResultContract> => {
  const input = createAssistantProjectInputSchema.parse(rawInput);
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Assistant Projects require the live database."
    });
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<AssistantProjectMutationResultContract>(
      client,
      owner,
      mutation
    );
    if (claim.replayed) return { value: claim.response };
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('symposium:assistant-projects:' || $1, 0))",
      [owner]
    );
    const current = await client.query<{ count: number }>(
      `SELECT count(*)::int
       FROM ai_projects
       WHERE owner_handle = $1 AND deleted_at IS NULL`,
      [owner]
    );
    if (Number(current.rows[0]?.count ?? 0) >= 100) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Assistant Projects are limited to 100 per account."
      });
    }
    let inserted;
    try {
      inserted = await client.query<AssistantProjectRow>(
        `INSERT INTO ai_projects (owner_handle, name)
         VALUES ($1, $2)
         RETURNING
           id::text,
           name,
           revision,
           0::int AS "activeThreadCount",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [owner, input.name]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A Project with that name already exists."
        });
      }
      throw error;
    }
    const project = projectContract(inserted.rows[0]!);
    const response = { project };
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "assistant.project.create",
      subjectType: "ai_project",
      subjectId: project.id,
      metadata: mutationAuditMetadata(mutation, {
        name: project.name,
        contextBehavior: "organization_only"
      })
    });
    await completeMutation(client, owner, mutation, response);
    const event = await stageEvent(client, {
      kind: "assistant.project.created",
      actorHandle: owner,
      subjectType: "ai_project",
      subjectId: project.id,
      visibility: "private",
      payload: {
        revision: project.revision,
        contextBehavior: "organization_only"
      }
    });
    return { value: response, events: [event] };
  });
};

export const updateAssistantProject = async (
  projectId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantProjectMutationResultContract> => {
  const input = updateAssistantProjectInputSchema.parse(rawInput);
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Assistant Projects require the live database."
    });
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<AssistantProjectMutationResultContract>(
      client,
      owner,
      mutation
    );
    if (claim.replayed) return { value: claim.response };
    let updated;
    try {
      updated = await client.query<AssistantProjectRow>(
        `UPDATE ai_projects project
         SET name = $3,
             revision = revision + 1,
             updated_at = now()
         WHERE project.id = $1
           AND project.owner_handle = $2
           AND project.revision = $4
           AND project.deleted_at IS NULL
         RETURNING
           project.id::text,
           project.name,
           project.revision,
           0::int AS "activeThreadCount",
           project.created_at AS "createdAt",
           project.updated_at AS "updatedAt"`,
        [projectId, owner, input.name, input.expectedRevision]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A Project with that name already exists."
        });
      }
      throw error;
    }
    if (!updated.rowCount) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This Project changed elsewhere or is no longer available."
      });
    }
    const activeThreads = await client.query<{ count: number }>(
      `SELECT count(*)::int
       FROM ai_conversations
       WHERE project_id = $1
         AND owner_handle = $2
         AND kind = 'research_thread'
         AND deleted_at IS NULL
         AND archived_at IS NULL`,
      [projectId, owner]
    );
    updated.rows[0]!.activeThreadCount = Number(
      activeThreads.rows[0]?.count ?? 0
    );
    const project = projectContract(updated.rows[0]!);
    const response = { project };
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "assistant.project.update",
      subjectType: "ai_project",
      subjectId: project.id,
      metadata: mutationAuditMetadata(mutation, {
        name: project.name,
        revision: project.revision
      })
    });
    await completeMutation(client, owner, mutation, response);
    const event = await stageEvent(client, {
      kind: "assistant.project.updated",
      actorHandle: owner,
      subjectType: "ai_project",
      subjectId: project.id,
      visibility: "private",
      payload: { revision: project.revision }
    });
    return { value: response, events: [event] };
  });
};

export const deleteAssistantProject = async (
  projectId: string,
  rawInput: unknown,
  actor: Actor,
  mutation?: MutationContext
): Promise<AssistantProjectDeleteResultContract> => {
  const input = deleteAssistantProjectInputSchema.parse(rawInput);
  if (!hasDatabase()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Assistant Projects require the live database."
    });
  }
  const owner = await ensureProfileHandle(actorHandle(actor));
  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<AssistantProjectDeleteResultContract>(
      client,
      owner,
      mutation
    );
    if (claim.replayed) return { value: claim.response };
    const project = await client.query<{ name: string }>(
      `SELECT name
       FROM ai_projects
       WHERE id = $1
         AND owner_handle = $2
         AND revision = $3
         AND deleted_at IS NULL
       FOR UPDATE`,
      [projectId, owner, input.expectedRevision]
    );
    if (!project.rowCount) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This Project changed elsewhere or is no longer available."
      });
    }
    const unfiled = await client.query<{ count: number }>(
      `WITH unfiled AS (
         UPDATE ai_conversations
         SET project_id = NULL,
             metadata_revision = metadata_revision + 1,
             updated_at = now()
         WHERE project_id = $1
           AND owner_handle = $2
           AND kind = 'research_thread'
           AND deleted_at IS NULL
         RETURNING 1
       )
       SELECT count(*)::int AS count
       FROM unfiled`,
      [projectId, owner]
    );
    const unfiledConversationCount = Number(unfiled.rows[0]?.count ?? 0);
    await client.query(
      `UPDATE ai_projects
       SET deleted_at = now(),
           revision = revision + 1,
           updated_at = now()
       WHERE id = $1 AND owner_handle = $2`,
      [projectId, owner]
    );
    const response: AssistantProjectDeleteResultContract = {
      projectId,
      deleted: true,
      unfiledConversationCount
    };
    await stageAuditLog(client, {
      actorHandle: owner,
      action: "assistant.project.delete",
      subjectType: "ai_project",
      subjectId: projectId,
      metadata: mutationAuditMetadata(mutation, {
        name: project.rows[0]!.name,
        unfiledConversationCount,
        deletedChats: false
      })
    });
    await completeMutation(client, owner, mutation, response);
    const event = await stageEvent(client, {
      kind: "assistant.project.deleted",
      actorHandle: owner,
      subjectType: "ai_project",
      subjectId: projectId,
      visibility: "private",
      payload: {
        unfiledConversationCount,
        deletedChats: false
      }
    });
    return { value: response, events: [event] };
  });
};
