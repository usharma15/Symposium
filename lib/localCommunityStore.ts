import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CommunityCallContract,
  CreateCommunityAnnouncementInputContract,
  DeleteCommunityAnnouncementInputContract,
  CommunityMemberPageContract,
  CommunityMemberQueryContract,
  CommunityMembershipStatusContract,
  CreateCommunityInputContract,
  CreateCommunityCallInputContract,
  RemoveCommunityMemberInputContract,
  UpdateCommunityMemberInputContract,
  UpdateCommunityAnnouncementInputContract,
  UpdateCommunitySettingsInputContract
} from "@/packages/contracts/src";
import { profile, profilesByName, researchCommunities, type ResearchCommunity, type ResearchProfile } from "@/lib/mockData";
import { seededCommunityCallMap } from "@/lib/communityFixtures";
import { cleanHandle } from "@/lib/symposiumCore";
import { activeCommunityAnnouncements } from "@/lib/communityAnnouncements";

type StoredMembership = {
  status: Exclude<CommunityMembershipStatusContract, "none"> | "removed";
  role: "owner" | "moderator" | "member";
  joinedAt: string;
  lastAccessedAt?: string;
};

type LocalCommunityState = {
  version: 5;
  communities: ResearchCommunity[];
  memberships: Record<string, Record<string, StoredMembership>>;
  calls: CommunityCallContract[];
};

const storagePath = process.env.VERCEL
  ? path.join("/tmp", "symposium-communities.json")
  : path.join(process.cwd(), ".data", "symposium-communities.json");

let queue: Promise<void> = Promise.resolve();
const withLock = <T>(operation: () => Promise<T>) => {
  const result = queue.then(operation, operation);
  queue = result.then(() => undefined, () => undefined);
  return result;
};

const seedState = (): LocalCommunityState => ({
  version: 5,
  communities: researchCommunities,
  memberships: Object.fromEntries(researchCommunities.map((community, communityIndex) => [
    community.id,
    Object.fromEntries(community.memberHandles.map((handle, index) => [cleanHandle(handle), {
      status: "active" as const,
      role: index === 0
        ? "owner" as const
        : (community.moderatorHandles ?? []).map(cleanHandle).includes(cleanHandle(handle))
          ? "moderator" as const
          : "member" as const,
      joinedAt: new Date(Date.UTC(2026, 6, 15 - Math.floor(index / 18), 18 - (communityIndex % 5), index % 60)).toISOString(),
      lastAccessedAt: cleanHandle(handle) === "@udayan"
        ? new Date(Date.UTC(2026, 6, 16, 12 - communityIndex, 0)).toISOString()
        : undefined
    }]))
  ])),
  calls: Object.values(seededCommunityCallMap(researchCommunities)).flat()
});

const readState = async (): Promise<LocalCommunityState> => {
  try {
    const parsed = JSON.parse(await readFile(storagePath, "utf8")) as Omit<Partial<LocalCommunityState>, "version"> & { version?: number };
    if (!Array.isArray(parsed.communities) || !parsed.memberships || !Array.isArray(parsed.calls)) return seedState();
    const seeded = seedState();
    const storedById = new Map(parsed.communities.map((community) => [community.id, community]));
    const seededIds = new Set(seeded.communities.map((community) => community.id));
    const seededCommunities = seeded.communities.map((community) => {
      const stored = storedById.get(community.id);
      if (!stored) return community;
      if (parsed.version === 4 || parsed.version === 5) return { ...community, ...stored };
      return {
        ...stored,
        memberHandles: Array.from(new Set([...community.memberHandles, ...stored.memberHandles])),
        memberCount: community.memberCount,
        monthlyActive: community.monthlyActive,
        moderatorHandles: community.moderatorHandles,
        guidelines: community.guidelines,
        announcements: community.announcements
      };
    });
    const communities = [...seededCommunities, ...parsed.communities.filter((community) => !seededIds.has(community.id))];
    const memberships = Object.fromEntries(communities.map((community) => {
      const merged = { ...(seeded.memberships[community.id] ?? {}), ...(parsed.memberships?.[community.id] ?? {}) };
      return [community.id, Object.fromEntries(Object.entries(merged).map(([handle, membership]) => [handle, {
        ...membership,
        role: parsed.version === 4 || parsed.version === 5 ? membership.role : seeded.memberships[community.id]?.[handle]?.role ?? membership.role,
        joinedAt: parsed.version === 4 || parsed.version === 5
          ? membership.joinedAt ?? membership.lastAccessedAt ?? new Date(0).toISOString()
          : seeded.memberships[community.id]?.[handle]?.joinedAt ?? membership.joinedAt ?? membership.lastAccessedAt ?? new Date(0).toISOString()
      }]))];
    }));
    const seededCallById = new Map(seeded.calls.map((call) => [call.id, call]));
    for (const call of parsed.calls) seededCallById.set(call.id, call);
    return {
      version: 5,
      communities,
      memberships,
      calls: [...seededCallById.values()]
    };
  } catch {
    return seedState();
  }
};

const writeState = async (state: LocalCommunityState) => {
  await mkdir(path.dirname(storagePath), { recursive: true });
  const temporaryPath = `${storagePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, storagePath);
};

const projectCommunity = (state: LocalCommunityState, community: ResearchCommunity, rawHandle?: string) => {
  const handle = rawHandle ? cleanHandle(rawHandle) : "";
  const membership = handle ? state.memberships[community.id]?.[handle] : undefined;
  const activeMembers = Object.entries(state.memberships[community.id] ?? {})
    .filter(([, value]) => value.status === "active")
    .map(([memberHandle]) => memberHandle);
  const status = membership?.status === "active" || membership?.status === "requested" || membership?.status === "invited"
    ? membership.status
    : "none";
  return {
    ...community,
    revision: community.revision ?? 1,
    online: community.visibility === "private" && status !== "active" ? 0 : community.online,
    memberHandles: community.visibility === "private" && status !== "active" ? [] : activeMembers.slice(0, 50),
    memberCount: community.visibility === "private" && status !== "active" ? 0 : activeMembers.length,
    monthlyActive: community.visibility === "private" && status !== "active" ? 0 : Math.max(community.online, Math.round(activeMembers.length * 0.72)),
    membershipStatus: status,
    viewerRole: status === "active" ? membership?.role : undefined,
    ownerHandle: community.visibility === "private" && status !== "active"
      ? undefined
      : Object.entries(state.memberships[community.id] ?? {}).find(([, value]) => value.status === "active" && value.role === "owner")?.[0]
        ?? community.ownerHandle
        ?? activeMembers[0],
    lastAccessedAt: membership?.lastAccessedAt,
    moderatorHandles: community.visibility === "private" && status !== "active" ? [] : community.moderatorHandles ?? activeMembers.slice(0, 2),
    guidelines: community.visibility === "private" && status !== "active" ? undefined : community.guidelines ?? "Keep criticism attached to the work. Preserve sources and leave a legible trail when a claim changes.",
    announcements: community.visibility === "private" && status !== "active" ? [] : activeCommunityAnnouncements(community.announcements),
    callStatus: community.visibility === "private" && status !== "active" ? "quiet" : community.callStatus
  } satisfies ResearchCommunity;
};

export const listLocalCommunities = async (actorHandle?: string) => {
  const state = await readState();
  return state.communities.map((community) => projectCommunity(state, community, actorHandle));
};

export const createLocalCommunity = (input: CreateCommunityInputContract, rawOwnerHandle: string) =>
  withLock(async () => {
    const state = await readState();
    const owner = cleanHandle(rawOwnerHandle);
    const baseId = input.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || `community-${randomUUID().slice(0, 8)}`;
    const id = state.communities.some((community) => community.id === baseId) ? `${baseId}-${randomUUID().slice(0, 6)}` : baseId;
    const now = new Date().toISOString();
    const community: ResearchCommunity = {
      id,
      revision: 1,
      name: input.name,
      field: input.field,
      summary: input.summary,
      visibility: input.visibility,
      online: 1,
      memberHandles: [owner],
      keywords: Array.from(new Set([input.name, input.field, ...input.keywords].map((value) => value.toLowerCase()))),
      seedCounts: { papers: 0, thoughts: 0, opportunities: 0 },
      callStatus: "quiet",
      memberCount: 1,
      monthlyActive: 1,
      membershipStatus: "active",
      viewerRole: "owner",
      ownerHandle: owner,
      lastAccessedAt: now,
      moderatorHandles: Array.from(new Set([owner, ...input.moderatorHandles.map(cleanHandle)])),
      guidelines: input.guidelines || "Keep criticism attached to the work. Preserve sources and leave a legible trail when a claim changes.",
      announcements: []
    };
    state.communities.push(community);
    state.memberships[id] = { [owner]: { status: "active", role: "owner", joinedAt: now, lastAccessedAt: now } };
    await writeState(state);
    return community;
  });

const requireLocalCommunityManager = (
  state: LocalCommunityState,
  communityId: string,
  rawActorHandle: string
) => {
  const handle = cleanHandle(rawActorHandle);
  const community = state.communities.find((candidate) => candidate.id === communityId);
  if (!community) throw new Error("Community not found.");
  const membership = state.memberships[communityId]?.[handle];
  if (membership?.status !== "active" || (membership.role !== "owner" && membership.role !== "moderator")) {
    throw new Error("Only community owners and moderators can manage this community.");
  }
  return { community, handle, membership };
};

const assertLocalCommunityRevision = (community: ResearchCommunity, expectedRevision: number) => {
  if ((community.revision ?? 1) !== expectedRevision) {
    throw new Error("This community changed after it was loaded. Refresh before trying again.");
  }
};

const syncLocalCommunityHandles = (state: LocalCommunityState, community: ResearchCommunity) => {
  const active = Object.entries(state.memberships[community.id] ?? {}).filter(([, membership]) => membership.status === "active");
  community.memberHandles = active.map(([handle]) => handle);
  community.moderatorHandles = active
    .filter(([, membership]) => membership.role === "owner" || membership.role === "moderator")
    .map(([handle]) => handle);
  community.memberCount = active.length;
};

export const updateLocalCommunitySettings = (input: UpdateCommunitySettingsInputContract, rawActorHandle: string) =>
  withLock(async () => {
    const state = await readState();
    const { community, handle } = requireLocalCommunityManager(state, input.communityId, rawActorHandle);
    assertLocalCommunityRevision(community, input.expectedRevision);
    const next = {
      name: input.name ?? community.name,
      summary: input.summary ?? community.summary,
      guidelines: input.guidelines ?? community.guidelines,
      visibility: input.visibility ?? community.visibility
    };
    if (next.name !== community.name || next.summary !== community.summary || next.guidelines !== community.guidelines || next.visibility !== community.visibility) {
      Object.assign(community, next, { revision: input.expectedRevision + 1 });
      await writeState(state);
    }
    return projectCommunity(state, community, handle);
  });

export const updateLocalCommunityMember = (input: UpdateCommunityMemberInputContract, rawActorHandle: string) =>
  withLock(async () => {
    const state = await readState();
    const { community, handle } = requireLocalCommunityManager(state, input.communityId, rawActorHandle);
    assertLocalCommunityRevision(community, input.expectedRevision);
    const memberHandle = cleanHandle(input.memberHandle);
    const target = state.memberships[community.id]?.[memberHandle];
    if (!target || target.status !== "active") throw new Error("Community member not found.");
    if (target.role === "owner") throw new Error("The community owner cannot be reassigned.");
    if (target.role !== input.role) {
      target.role = input.role;
      community.revision = input.expectedRevision + 1;
      syncLocalCommunityHandles(state, community);
      await writeState(state);
    }
    return { community: projectCommunity(state, community, handle), member: { handle: memberHandle, role: target.role } };
  });

export const removeLocalCommunityMember = (input: RemoveCommunityMemberInputContract, rawActorHandle: string) =>
  withLock(async () => {
    const state = await readState();
    const { community, handle } = requireLocalCommunityManager(state, input.communityId, rawActorHandle);
    assertLocalCommunityRevision(community, input.expectedRevision);
    const memberHandle = cleanHandle(input.memberHandle);
    const target = state.memberships[community.id]?.[memberHandle];
    if (!target || target.status !== "active") throw new Error("Community member not found.");
    if (target.role === "owner") throw new Error("The community owner cannot be removed.");
    target.status = "removed";
    community.revision = input.expectedRevision + 1;
    syncLocalCommunityHandles(state, community);
    await writeState(state);
    return { community: projectCommunity(state, community, handle), removedHandle: memberHandle };
  });

export const createLocalCommunityAnnouncement = (input: CreateCommunityAnnouncementInputContract, rawActorHandle: string) =>
  withLock(async () => {
    const state = await readState();
    const { community, handle } = requireLocalCommunityManager(state, input.communityId, rawActorHandle);
    assertLocalCommunityRevision(community, input.expectedRevision);
    const announcement = {
      id: randomUUID(),
      title: input.title,
      body: input.body,
      authorHandle: handle,
      createdAt: new Date().toISOString()
    };
    community.announcements = [announcement, ...activeCommunityAnnouncements(community.announcements)];
    community.revision = input.expectedRevision + 1;
    await writeState(state);
    return { community: projectCommunity(state, community, handle), announcement };
  });

export const updateLocalCommunityAnnouncement = (input: UpdateCommunityAnnouncementInputContract, rawActorHandle: string) =>
  withLock(async () => {
    const state = await readState();
    const { community, handle } = requireLocalCommunityManager(state, input.communityId, rawActorHandle);
    assertLocalCommunityRevision(community, input.expectedRevision);
    const announcements = activeCommunityAnnouncements(community.announcements);
    const current = announcements.find((announcement) => announcement.id === input.announcementId);
    if (!current) throw new Error("Announcement not found.");
    const announcement = {
      ...current,
      title: input.title,
      body: input.body,
      updatedAt: new Date().toISOString(),
      updatedByHandle: handle
    };
    community.announcements = announcements.map((candidate) => candidate.id === announcement.id ? announcement : candidate);
    community.revision = input.expectedRevision + 1;
    await writeState(state);
    return { community: projectCommunity(state, community, handle), announcement };
  });

export const deleteLocalCommunityAnnouncement = (input: DeleteCommunityAnnouncementInputContract, rawActorHandle: string) =>
  withLock(async () => {
    const state = await readState();
    const { community, handle } = requireLocalCommunityManager(state, input.communityId, rawActorHandle);
    assertLocalCommunityRevision(community, input.expectedRevision);
    const announcements = activeCommunityAnnouncements(community.announcements);
    if (!announcements.some((announcement) => announcement.id === input.announcementId)) throw new Error("Announcement not found.");
    community.announcements = announcements.filter((announcement) => announcement.id !== input.announcementId);
    community.revision = input.expectedRevision + 1;
    await writeState(state);
    return { community: projectCommunity(state, community, handle), deletedAnnouncementId: input.announcementId };
  });

export const mutateLocalCommunityMembership = (
  communityId: string,
  rawActorHandle: string,
  action: "join" | "leave" | "access"
) => withLock(async () => {
  const state = await readState();
  const handle = cleanHandle(rawActorHandle);
  const community = state.communities.find((candidate) => candidate.id === communityId);
  if (!community) throw new Error("Community not found.");
  const current = state.memberships[communityId]?.[handle];
  const now = new Date().toISOString();
  state.memberships[communityId] ??= {};
  if (action === "access") {
    if (community.visibility === "private" && current?.status !== "active") throw new Error("This private community requires membership.");
    if (current?.status === "active") current.lastAccessedAt = now;
  } else if (action === "leave") {
    if (current?.role === "owner" && current.status === "active") {
      throw new Error("The community owner cannot leave without transferring ownership.");
    }
    state.memberships[communityId]![handle] = { status: "removed", role: current?.role ?? "member", joinedAt: current?.joinedAt ?? now, lastAccessedAt: current?.lastAccessedAt };
  } else {
    state.memberships[communityId]![handle] = {
      status: community.visibility === "private" ? "requested" : "active",
      role: current?.role ?? "member",
      joinedAt: current?.status === "active" ? current.joinedAt : now,
      lastAccessedAt: community.visibility === "public" ? now : current?.lastAccessedAt
    };
  }
  await writeState(state);
  const projected = projectCommunity(state, community, handle);
  return {
    community: projected,
    status: action === "leave" ? "left" as const : projected.membershipStatus === "active" ? "joined" as const : "requested" as const,
    accessedAt: action === "access" ? now : undefined
  };
});

export const listLocalCommunityCalls = async (communityId: string, rawActorHandle?: string) => {
  const state = await readState();
  const community = state.communities.find((candidate) => candidate.id === communityId);
  if (!community) throw new Error("Community not found.");
  const handle = rawActorHandle ? cleanHandle(rawActorHandle) : "";
  if (community.visibility === "private" && state.memberships[communityId]?.[handle]?.status !== "active") {
    throw new Error("Private community calls require membership.");
  }
  return state.calls.filter((call) => call.communityId === communityId);
};

export const listAllLocalCommunityCalls = async (rawActorHandle?: string) => {
  const state = await readState();
  const handle = rawActorHandle ? cleanHandle(rawActorHandle) : "";
  const visibleIds = new Set(state.communities
    .filter((community) => community.visibility === "public" || state.memberships[community.id]?.[handle]?.status === "active")
    .map((community) => community.id));
  return Object.fromEntries(state.communities.map((community) => [
    community.id,
    visibleIds.has(community.id) ? state.calls.filter((call) => call.communityId === community.id) : []
  ]));
};

const profileByHandle = new Map(
  ([profile, ...Object.values(profilesByName)] as ResearchProfile[]).map((person) => [cleanHandle(person.handle), person])
);

const encodeMemberCursor = (joinedAt: string, handle: string) =>
  Buffer.from(JSON.stringify({ joinedAt, handle })).toString("base64url");

const decodeMemberCursor = (cursor?: string) => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { joinedAt?: unknown; handle?: unknown };
    return typeof parsed.joinedAt === "string" && typeof parsed.handle === "string" ? parsed as { joinedAt: string; handle: string } : null;
  } catch {
    return null;
  }
};

export const listLocalCommunityMembers = async (
  communityId: string,
  rawActorHandle: string | undefined,
  query: CommunityMemberQueryContract
): Promise<CommunityMemberPageContract> => {
  const state = await readState();
  const community = state.communities.find((candidate) => candidate.id === communityId);
  if (!community) throw new Error("Community not found.");
  const actorHandle = rawActorHandle ? cleanHandle(rawActorHandle) : "";
  if (community.visibility === "private" && state.memberships[communityId]?.[actorHandle]?.status !== "active") {
    throw new Error("Private community members require membership.");
  }
  const term = query.q.trim().toLowerCase();
  const visible = Object.entries(state.memberships[communityId] ?? {})
    .filter(([, membership]) => membership.status === "active")
    .filter(([, membership]) => query.role === "all" || membership.role === "owner" || membership.role === "moderator")
    .map(([handle, membership]) => {
      const person = profileByHandle.get(cleanHandle(handle));
      return {
        handle: cleanHandle(handle),
        name: person?.name ?? handle.replace(/^@/, "").replace(/[_-]+/g, " "),
        avatarUrl: person?.avatarUrl,
        role: membership.role,
        joinedAt: membership.joinedAt
      };
    })
    .filter((member) => !term || `${member.name} ${member.handle}`.toLowerCase().includes(term))
    .sort((first, second) => second.joinedAt.localeCompare(first.joinedAt) || second.handle.localeCompare(first.handle));
  const total = visible.length;
  const cursor = decodeMemberCursor(query.cursor);
  const afterCursor = cursor
    ? visible.filter((member) => member.joinedAt < cursor.joinedAt || (member.joinedAt === cursor.joinedAt && member.handle < cursor.handle))
    : visible;
  const page = afterCursor.slice(0, query.limit);
  const last = page.at(-1);
  return {
    members: page,
    nextCursor: afterCursor.length > page.length && last ? encodeMemberCursor(last.joinedAt, last.handle) : null,
    total
  };
};

export const createLocalCommunityCall = (input: CreateCommunityCallInputContract, rawActorHandle: string) =>
  withLock(async () => {
    const state = await readState();
    const handle = cleanHandle(rawActorHandle);
    if (state.memberships[input.communityId]?.[handle]?.status !== "active") throw new Error("Join this community before hosting a call.");
    const call: CommunityCallContract = {
      id: randomUUID(),
      communityId: input.communityId,
      hostHandle: handle,
      title: input.title,
      kind: input.kind,
      status: input.startsAt && Date.parse(input.startsAt) > Date.now() ? "scheduled" : "live",
      startsAt: input.startsAt ?? new Date().toISOString(),
      provider: input.provider,
      providerRoomId: input.providerRoomId,
      participantHandles: [handle]
    };
    state.calls.unshift(call);
    const community = state.communities.find((candidate) => candidate.id === input.communityId);
    if (community && call.status === "live") community.callStatus = input.kind === "video" ? "video live" : "voice live";
    await writeState(state);
    return call;
  });

export const joinLocalCommunityCall = (callId: string, rawActorHandle: string) => withLock(async () => {
  const state = await readState();
  const handle = cleanHandle(rawActorHandle);
  const call = state.calls.find((candidate) => candidate.id === callId);
  if (!call) throw new Error("Call not found.");
  const community = state.communities.find((candidate) => candidate.id === call.communityId);
  if (community?.visibility === "private" && state.memberships[call.communityId]?.[handle]?.status !== "active") {
    throw new Error("Private community calls require membership.");
  }
  call.participantHandles = Array.from(new Set([...call.participantHandles, handle]));
  await writeState(state);
  return call;
});
