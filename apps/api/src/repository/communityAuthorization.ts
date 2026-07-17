import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import type { ResearchCommunityContract } from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import { getCommunity } from "./foundation";

export const assertCommunityManager = async (
  communityId: string,
  rawHandle: string,
  client?: PoolClient
): Promise<{ community: ResearchCommunityContract; role: "owner" | "moderator" }> => {
  const community = await getCommunity(communityId);
  const handle = cleanHandle(rawHandle);
  if (!hasDatabase()) {
    const owner = cleanHandle(community.ownerHandle ?? community.memberHandles[0] ?? "");
    const managers = new Set((community.moderatorHandles ?? []).map(cleanHandle));
    if (owner === handle || managers.has(handle)) return { community, role: owner === handle ? "owner" : "moderator" };
    throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can manage this community." });
  }
  const result = await (client ?? getPool()).query<{ role: string }>(
    `SELECT role FROM community_memberships
     WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
    [communityId, handle]
  );
  const role = result.rows[0]?.role;
  if (role !== "owner" && role !== "moderator") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only community owners and moderators can manage this community." });
  }
  return { community, role };
};

export const assertCommunityPostDeletion = async (
  item: { communityId?: string | null; postType?: string | null },
  actorHandle: string,
  client?: PoolClient
) => {
  if (!item.communityId || item.postType === "paper") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this post." });
  }
  await assertCommunityManager(item.communityId, actorHandle, client);
};

export const assertCommunityCommentDeletion = async (
  item: { communityId?: string | null },
  actorHandle: string,
  client?: PoolClient
) => {
  if (!item.communityId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can delete this comment." });
  }
  await assertCommunityManager(item.communityId, actorHandle, client);
};
