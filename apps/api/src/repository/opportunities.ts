import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  createOpportunityInputSchema,
  type CreateOpportunityInputContract,
  type OpportunityContract
} from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import type { Actor } from "../services/auth";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import {
  actorHandle,
  ensureLiveData,
  ensureProfileHandle,
  getCommunity,
  opportunityRowToContract
} from "./foundation";

export const listOpportunities = async (rawInput?: unknown) => {
  const input = rawInput ? createOpportunityInputSchema.partial().parse(rawInput) : {};

  if (!hasDatabase()) return [] as OpportunityContract[];
  await ensureLiveData();

  const conditions: string[] = [];
  const params: unknown[] = [];
  conditions.push("status <> 'draft'");
  conditions.push(
    "(community_id IS NULL OR EXISTS (SELECT 1 FROM communities community WHERE community.id = opportunity_posts.community_id AND community.visibility = 'public'))"
  );

  if (input.communityId) {
    params.push(input.communityId);
    conditions.push(`community_id = $${params.length}`);
  }

  if (input.status) {
    params.push(input.status);
    conditions.push(`status = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await getPool().query(
    `SELECT
       id,
       title,
       body,
       kind,
       status,
       creator_handle AS "creatorHandle",
       community_id AS "communityId",
       location,
       compensation,
       tags,
       created_at AS "createdAt"
     FROM opportunity_posts
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT 100`,
    params
  );

  return result.rows.map(opportunityRowToContract);
};

export const createOpportunity = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input: CreateOpportunityInputContract = createOpportunityInputSchema.parse(rawInput);
  const creator = await ensureProfileHandle(actorHandle(actor));
  const community = input.communityId ? await getCommunity(input.communityId) : undefined;

  if (!hasDatabase()) {
    return {
      id: randomUUID(),
      title: input.title,
      body: input.body,
      kind: input.kind,
      status: input.status,
      creatorHandle: creator,
      communityId: input.communityId,
      location: input.location,
      compensation: input.compensation,
      tags: input.tags,
      createdAt: new Date().toISOString()
    } satisfies OpportunityContract;
  }

  await ensureLiveData();
  return runAtomic(async (client) => {
    const claim = await claimMutation<OpportunityContract>(client, creator, mutation);
    if (claim.replayed) return { value: claim.response };
    if (community?.visibility === "private") {
      const membership = await client.query(
        `SELECT 1 FROM community_memberships
         WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
        [community.id, creator]
      );
      if (!membership.rowCount) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Join this private community before creating an opportunity."
        });
      }
    }

    const result = await client.query(
      `INSERT INTO opportunity_posts (
         title, body, kind, status, creator_handle, community_id, location, compensation, tags
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING
         id,
         title,
         body,
         kind,
         status,
         creator_handle AS "creatorHandle",
         community_id AS "communityId",
         location,
         compensation,
         tags,
         created_at AS "createdAt"`,
      [
        input.title,
        input.body,
        input.kind,
        input.status,
        creator,
        input.communityId ?? null,
        input.location ?? null,
        input.compensation ?? null,
        JSON.stringify(input.tags)
      ]
    );

    const opportunity = opportunityRowToContract(result.rows[0]!);
    await stageAuditLog(client, {
      actorHandle: creator,
      action: "opportunity.create",
      subjectType: "opportunity",
      subjectId: opportunity.id,
      metadata: mutationAuditMetadata(mutation, {
        communityId: opportunity.communityId,
        kind: opportunity.kind
      })
    });
    await completeMutation(client, creator, mutation, opportunity);
    const audienceHandles = community?.visibility === "private"
      ? (
          await client.query<{ profileHandle: string }>(
            `SELECT profile_handle AS "profileHandle" FROM community_memberships
             WHERE community_id = $1 AND status = 'active'`,
            [community.id]
          )
        ).rows.map((row) => row.profileHandle)
      : undefined;
    const event = await stageEvent(client, {
      kind: "opportunity.created",
      actorHandle: creator,
      subjectType: "opportunity",
      subjectId: opportunity.id,
      visibility:
        opportunity.status === "draft"
          ? "private"
          : community?.visibility === "private"
            ? "community"
            : "public",
      audienceHandles,
      payload: { kind: opportunity.kind, communityId: opportunity.communityId, title: opportunity.title }
    });
    return { value: opportunity, events: [event] };
  });
};
