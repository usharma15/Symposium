"use client";

import { LockKeyhole, UsersRound } from "lucide-react";
import type { MouseEvent } from "react";
import type { ResearchCommunity } from "@/lib/mockData";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";

export function CommunityActivityBadge({
  community,
  onOpenCommunity,
  onClick,
  compact = false,
  className
}: {
  community: ResearchCommunity;
  onOpenCommunity: (communityId: string) => void;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  compact?: boolean;
  className?: string;
}) {
  const Icon = community.visibility === "private" ? LockKeyhole : UsersRound;
  return (
    <CanonicalLink
      className={`community-activity-badge${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}
      route={{ kind: "community", communityId: community.id }}
      onNavigate={() => onOpenCommunity(community.id)}
      onClick={onClick}
      title={`Open ${community.name}`}
    >
      <Icon size={13} />
      <span>{community.name}</span>
      <small>{community.visibility}</small>
    </CanonicalLink>
  );
}
