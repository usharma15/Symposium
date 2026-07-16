import { TRPCError } from "@trpc/server";
import type { OpportunityPostInputContract } from "../../../../packages/contracts/src";

export type OpportunityPostProjection = OpportunityPostInputContract & { applicationCount: number };

export const createOpportunityProjection = (input?: OpportunityPostInputContract) =>
  input ? { ...input, applicationCount: 0 } satisfies OpportunityPostProjection : undefined;

export const updateOpportunityProjection = (
  input: OpportunityPostInputContract | undefined,
  current: OpportunityPostProjection | undefined
) => input ? { ...input, applicationCount: current?.applicationCount ?? 0 } : current;

export const opportunityPostStatus = (opportunity: OpportunityPostProjection | undefined, fallback: string) =>
  opportunity ? (opportunity.status === "open" ? "Open" : "Closed") : fallback;

export const assertCanonicalOpportunityUpdate = (
  input: OpportunityPostInputContract | undefined,
  post: { opportunity?: unknown; kind: string; room: string }
) => {
  if (input && (!post.opportunity || post.kind !== "thought" || post.room !== "opportunities")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only canonical Opportunity posts can receive opportunity metadata." });
  }
};
