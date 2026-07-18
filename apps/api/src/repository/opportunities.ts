import { TRPCError } from "@trpc/server";
import {
  createOpportunityInputSchema,
  type CreateOpportunityInputContract,
  type OpportunityContract
} from "../../../../packages/contracts/src";
import type { Actor } from "../services/auth";
import type { MutationContext } from "../services/mutations";
import { listPostPage } from "./inquiryReads";
import { createPost } from "./posts";

// Compatibility facade for early API clients. Canonical persistence and live events
// now run through posts; the legacy opportunity_posts table receives no new writes.
export const listOpportunities = async (rawInput?: unknown) => {
  const input = rawInput ? createOpportunityInputSchema.partial().parse(rawInput) : {};
  const page = await listPostPage({ postType: "opportunity", room: "opportunities", limit: 50 });
  return page.items
    .filter((item) => item.opportunity)
    .filter((item) => !input.kind || item.opportunity?.kind === input.kind)
    .filter((item) => !input.status || input.status === item.opportunity?.status)
    .map((item): OpportunityContract => ({
      id: item.id,
      title: item.title,
      body: item.body,
      kind: item.opportunity!.kind,
      status: item.opportunity!.status,
      creatorHandle: item.authorHandle,
      location: item.opportunity!.location ?? undefined,
      compensation: item.opportunity!.compensation ?? undefined,
      tags: item.tags,
      createdAt: item.createdAt
    }));
};

export const createOpportunity = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input: CreateOpportunityInputContract = createOpportunityInputSchema.parse(rawInput);
  if (input.status === "draft") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Save Opportunity drafts in the Office before publishing them." });
  }
  const item = await createPost({
    title: input.title,
    body: input.body,
    kind: "thought",
    postType: "opportunity",
    room: "opportunities",
    authorHandle: actor.handle,
    opportunity: {
      kind: input.kind,
      status: input.status,
      location: input.location ?? null,
      compensation: input.compensation ?? null,
      deadline: null
    }
  }, actor, mutation ? { ...mutation, scope: "post.create" } : undefined);
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    kind: item.opportunity!.kind,
    status: item.opportunity!.status,
    creatorHandle: item.authorHandle,
    communityId: input.communityId,
    location: item.opportunity!.location ?? undefined,
    compensation: item.opportunity!.compensation ?? undefined,
    tags: [...item.tags, ...input.tags],
    createdAt: item.createdAt
  } satisfies OpportunityContract;
};
