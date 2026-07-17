"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CommunityCallContract } from "@/packages/contracts/src";
import { researchCommunities, type ResearchCommunity } from "@/lib/mockData";
import { seededCommunityCallMap } from "@/lib/communityFixtures";
import { cleanHandle } from "@/lib/symposiumCore";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import {
  defaultCommunityFeedFilter,
  type CommunityFeedFilter
} from "@/features/communities/communityPolicy";

export type CommunityFeedViewState = {
  filter: CommunityFeedFilter;
  query: string;
};

const defaultCommunityFeedView: CommunityFeedViewState = {
  filter: defaultCommunityFeedFilter,
  query: ""
};

export const useCommunityState = (currentProfileHandle: string, selectedCommunityId: string | null) => {
  const [communities, setCommunities] = useState<ResearchCommunity[]>(researchCommunities);
  const [communityCalls, setCommunityCalls] = useState<Record<string, CommunityCallContract[]>>(
    () => seededCommunityCallMap(researchCommunities, Date.UTC(2026, 6, 16, 16))
  );
  const [communityMembershipBusy, setCommunityMembershipBusy] = useState(false);
  const [composerCommunityId, setComposerCommunityId] = useState<string | null>(null);
  const [communityFeedViews, setCommunityFeedViews] = useState<Record<string, CommunityFeedViewState>>({});
  const communitiesRef = useRef(communities);
  const selectedCommunity = useMemo(
    () => selectedCommunityId ? communities.find((community) => community.id === selectedCommunityId) ?? null : null,
    [communities, selectedCommunityId]
  );
  const selectedCommunityFeedView = selectedCommunityId
    ? communityFeedViews[selectedCommunityId] ?? defaultCommunityFeedView
    : defaultCommunityFeedView;
  const setSelectedCommunityFeedView = (view: CommunityFeedViewState) => {
    if (!selectedCommunityId) return;
    setCommunityFeedViews((current) => ({ ...current, [selectedCommunityId]: view }));
  };

  useEffect(() => {
    communitiesRef.current = communities;
  }, [communities]);

  useEffect(() => {
    if (!selectedCommunityId || !selectedCommunity) return undefined;
    const activeMember = selectedCommunity.membershipStatus === "active"
      || selectedCommunity.memberHandles.some((handle) => cleanHandle(handle) === cleanHandle(currentProfileHandle));
    if (selectedCommunity.visibility === "private" && !activeMember) {
      setCommunityCalls((current) => ({ ...current, [selectedCommunity.id]: [] }));
      return undefined;
    }
    const controller = new AbortController();
    symposiumApi.request<{ calls: CommunityCallContract[] }>(
      `/api/communities/${encodeURIComponent(selectedCommunity.id)}/calls?actorHandle=${encodeURIComponent(currentProfileHandle)}`,
      { cache: "no-store", signal: controller.signal }
    ).then((data) => {
      if (!controller.signal.aborted) setCommunityCalls((current) => ({ ...current, [selectedCommunity.id]: data.calls }));
    }).catch(() => undefined);

    if (activeMember) {
      symposiumApi.request<{ accessedAt: string }>(
        `/api/communities/${encodeURIComponent(selectedCommunity.id)}/membership`,
        { method: "POST", body: { action: "access", actorHandle: currentProfileHandle }, signal: controller.signal }
      ).then((data) => {
        if (controller.signal.aborted) return;
        setCommunities((current) => current.map((community) => community.id === selectedCommunity.id
          ? { ...community, lastAccessedAt: data.accessedAt }
          : community));
      }).catch(() => undefined);
    }
    return () => controller.abort();
  }, [currentProfileHandle, selectedCommunity?.id, selectedCommunity?.membershipStatus, selectedCommunity?.visibility, selectedCommunityId]);

  return {
    communities,
    communitiesRef,
    setCommunities,
    communityCalls,
    setCommunityCalls,
    communityMembershipBusy,
    setCommunityMembershipBusy,
    composerCommunityId,
    setComposerCommunityId,
    selectedCommunity,
    selectedCommunityFeedView,
    setSelectedCommunityFeedView
  };
};
