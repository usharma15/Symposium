import type { CommunityCallContract, ResearchCommunityContract } from "@/packages/contracts/src";

export const seededCommunityCalls = (
  community: ResearchCommunityContract,
  index: number,
  now = Date.now()
): CommunityCallContract[] => {
  const hostHandle = community.moderatorHandles?.[0] ?? community.memberHandles[0];
  if (!hostHandle) return [];
  const calls: CommunityCallContract[] = [
    {
      id: `00000000-0000-4000-8000-${String(100 + index * 2).padStart(12, "0")}`,
      communityId: community.id,
      hostHandle,
      title: index % 3 === 0 ? "Weekly work review" : index % 3 === 1 ? "Open methods clinic" : "Member artifact table",
      kind: index % 2 === 0 ? "video" : "voice",
      status: "scheduled",
      startsAt: new Date(now + (index % 6 + 1) * 18 * 60 * 60 * 1000).toISOString(),
      provider: "symposium",
      providerRoomId: `${community.id}-weekly-review`,
      participantHandles: community.memberHandles.slice(0, 4 + (index % 5))
    },
    {
      id: `00000000-0000-4000-8000-${String(101 + index * 2).padStart(12, "0")}`,
      communityId: community.id,
      hostHandle: community.moderatorHandles?.[1] ?? hostHandle,
      title: index % 2 === 0 ? "Paper and source packet salon" : "New member working session",
      kind: index % 2 === 0 ? "voice" : "video",
      status: "scheduled",
      startsAt: new Date(now + (index % 8 + 4) * 24 * 60 * 60 * 1000).toISOString(),
      provider: "symposium",
      providerRoomId: `${community.id}-salon`,
      participantHandles: community.memberHandles.slice(3, 8 + (index % 4))
    },
    {
      id: `00000000-0000-4000-8000-${String(1000 + index * 2).padStart(12, "0")}`,
      communityId: community.id,
      hostHandle: community.moderatorHandles?.[2] ?? hostHandle,
      title: index % 2 === 0 ? "New work orientation" : "Open questions roundtable",
      kind: index % 3 === 0 ? "video" : "voice",
      status: "scheduled",
      startsAt: new Date(now + (index % 7 + 8) * 24 * 60 * 60 * 1000).toISOString(),
      provider: "symposium",
      providerRoomId: `${community.id}-roundtable`,
      participantHandles: community.memberHandles.slice(6, 12 + (index % 4))
    },
    {
      id: `00000000-0000-4000-8000-${String(1001 + index * 2).padStart(12, "0")}`,
      communityId: community.id,
      hostHandle,
      title: index % 2 === 0 ? "Monthly evidence review" : "Methods and failures salon",
      kind: "video",
      status: "scheduled",
      startsAt: new Date(now + (index % 9 + 15) * 24 * 60 * 60 * 1000).toISOString(),
      provider: "symposium",
      providerRoomId: `${community.id}-monthly-review`,
      participantHandles: community.memberHandles.slice(2, 10 + (index % 6))
    }
  ];
  if (community.callStatus !== "quiet") {
    calls.unshift({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      communityId: community.id,
      hostHandle,
      title: community.callStatus === "video live" ? "Open video workroom" : "Open voice workroom",
      kind: community.callStatus === "video live" ? "video" : "voice",
      status: "live",
      startsAt: new Date(now - (index % 5 + 1) * 11 * 60_000).toISOString(),
      provider: "symposium",
      providerRoomId: `${community.id}-live`,
      participantHandles: community.memberHandles.slice(0, Math.min(community.online, 10))
    });
  }
  return calls;
};

export const seededCommunityCallMap = (communities: ResearchCommunityContract[], now = Date.now()) =>
  Object.fromEntries(communities.map((community, index) => [community.id, seededCommunityCalls(community, index, now)]));
