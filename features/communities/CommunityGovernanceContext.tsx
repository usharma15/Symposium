"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { InquiryItem, ResearchCommunity } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { itemHasPostType } from "@/lib/postSemantics";

type CommunityGovernanceContextValue = {
  community: ResearchCommunity | null;
  isManager: boolean;
  roleForHandle: (handle: string | undefined) => "owner" | "moderator" | null;
  containsPost: (itemId: string) => boolean;
  canModeratePost: (item: InquiryItem) => boolean;
  canModerateComment: (itemId: string) => boolean;
};

const emptyContext: CommunityGovernanceContextValue = {
  community: null,
  isManager: false,
  roleForHandle: () => null,
  containsPost: () => false,
  canModeratePost: () => false,
  canModerateComment: () => false
};

const CommunityGovernanceContext = createContext<CommunityGovernanceContextValue>(emptyContext);

export const communityRoleForHandle = (community: ResearchCommunity | null, rawHandle?: string) => {
  if (!community || !rawHandle) return null;
  const handle = cleanHandle(rawHandle);
  const owner = cleanHandle(community.ownerHandle ?? community.memberHandles[0] ?? "");
  if (owner && handle === owner) return "owner" as const;
  if ((community.moderatorHandles ?? []).some((member) => cleanHandle(member) === handle)) return "moderator" as const;
  return null;
};

export function CommunityGovernanceProvider({
  community,
  items,
  children
}: {
  community: ResearchCommunity | null;
  items: InquiryItem[];
  children: ReactNode;
}) {
  const value = useMemo<CommunityGovernanceContextValue>(() => {
    if (!community) return emptyContext;
    const isManager = community.viewerRole === "owner" || community.viewerRole === "moderator";
    const communityItemIds = new Set(items.filter((item) => item.communityId === community.id).map((item) => item.id));
    return {
      community,
      isManager,
      roleForHandle: (handle) => communityRoleForHandle(community, handle),
      containsPost: (itemId) => communityItemIds.has(itemId),
      canModeratePost: (item) => isManager && item.communityId === community.id && !itemHasPostType(item, "paper"),
      canModerateComment: (itemId) => isManager && communityItemIds.has(itemId)
    };
  }, [community, items]);

  return <CommunityGovernanceContext.Provider value={value}>{children}</CommunityGovernanceContext.Provider>;
}

export const useCommunityGovernance = () => useContext(CommunityGovernanceContext);
