import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type {
  PatronageProposalContract,
  PatronageProposalInputContract
} from "../../../../packages/contracts/src";

export const createPatronageProjection = (
  input: PatronageProposalInputContract | undefined
): PatronageProposalContract | undefined => input ? {
  ...input,
  raisedMinorUnits: 0,
  supporterCount: 0,
  topSupporters: []
} : undefined;

export const updatePatronageProjection = (
  input: PatronageProposalInputContract | undefined,
  current: PatronageProposalContract | undefined
) => {
  if (input && !current) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only Patronage proposals can receive funding details." });
  }
  return input ? {
    ...input,
    raisedMinorUnits: current?.raisedMinorUnits ?? 0,
    supporterCount: current?.supporterCount ?? 0,
    topSupporters: current?.topSupporters ?? []
  } : current;
};

export const patronagePostStatus = (proposal: PatronageProposalContract | undefined, fallback: string) =>
  proposal ? proposal.status[0].toUpperCase() + proposal.status.slice(1) : fallback;

export const insertPatronageProposal = async (
  client: PoolClient,
  postId: string,
  proposal: PatronageProposalContract | undefined
) => {
  if (!proposal) return;
  await client.query(
    `INSERT INTO patronage_proposals (post_id, status, currency, goal_minor_units, deadline)
     VALUES ($1, $2, $3, $4, $5)`,
    [postId, proposal.status, proposal.currency, proposal.goalMinorUnits, proposal.deadline]
  );
};

export const updatePatronageProposal = async (
  client: PoolClient,
  postId: string,
  proposal: PatronageProposalInputContract | undefined
) => {
  if (!proposal) return;
  const result = await client.query(
    `UPDATE patronage_proposals
     SET status = $2, currency = $3, goal_minor_units = $4, deadline = $5,
         revision = revision + 1, updated_at = now()
     WHERE post_id = $1
     RETURNING post_id`,
    [postId, proposal.status, proposal.currency, proposal.goalMinorUnits, proposal.deadline]
  );
  if (!result.rowCount) {
    throw new TRPCError({ code: "CONFLICT", message: "The canonical Patronage proposal record is missing." });
  }
};
