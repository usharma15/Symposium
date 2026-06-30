import { randomUUID } from "node:crypto";
import {
  createOpportunityInputSchema,
  type CreateOpportunityInputContract,
  type OpportunityContract
} from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { emitEvent } from "../services/events";
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

export const createOpportunity = async (rawInput: unknown, actor: Actor) => {
  const input: CreateOpportunityInputContract = createOpportunityInputSchema.parse(rawInput);
  const creator = await ensureProfileHandle(actorHandle(actor));
  if (input.communityId) await getCommunity(input.communityId);

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
  const result = await getPool().query(
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
  await emitEvent({
    kind: "opportunity.created",
    actorHandle: creator,
    subjectType: "opportunity",
    subjectId: opportunity.id,
    payload: { kind: opportunity.kind, communityId: opportunity.communityId, title: opportunity.title }
  });

  return opportunity;
};
