import { entityRevision } from "@/features/live-sync/entityRevision";

export type RevisionedFollowRecord = {
  followerHandle?: string;
  followingHandle?: string;
  status?: string;
  revision?: number;
  updatedAt?: string;
};

type PendingFollowMutation = {
  desiredStatus: "active" | "none";
  startRevision: number;
  token: number;
};

const relationKey = (followerHandle: string, followingHandle: string) =>
  `${followerHandle}:${followingHandle}`;

export const createFollowMutationCoordinator = () => {
  const latestRevision = new Map<string, number>();
  const pending = new Map<string, PendingFollowMutation>();
  let nextToken = 0;

  const recordKey = (record: RevisionedFollowRecord) =>
    relationKey(String(record.followerHandle ?? ""), String(record.followingHandle ?? ""));

  const observe = (record: RevisionedFollowRecord) => {
    const key = recordKey(record);
    if (key === ":") return false;
    const revision = entityRevision(record) ?? 0;
    const knownRevision = latestRevision.get(key) ?? 0;
    if (revision > 0 && revision < knownRevision) return false;

    const activeMutation = pending.get(key);
    if (activeMutation) {
      const status = record.status === "active" ? "active" : "none";
      const supersedesMutation = revision > activeMutation.startRevision;
      if (!supersedesMutation && status !== activeMutation.desiredStatus) return false;
      if (supersedesMutation || status === activeMutation.desiredStatus) pending.delete(key);
    }

    if (revision > knownRevision) latestRevision.set(key, revision);
    return true;
  };

  const begin = (followerHandle: string, followingHandle: string, desiredActive: boolean) => {
    const key = relationKey(followerHandle, followingHandle);
    const mutation = {
      desiredStatus: desiredActive ? "active" as const : "none" as const,
      startRevision: latestRevision.get(key) ?? 0,
      token: ++nextToken
    };
    pending.set(key, mutation);
    return { key, token: mutation.token };
  };

  const isCurrent = (mutation: { key: string; token: number }) =>
    pending.get(mutation.key)?.token === mutation.token;

  const fail = (mutation: { key: string; token: number }) => {
    if (!isCurrent(mutation)) return false;
    pending.delete(mutation.key);
    return true;
  };

  const complete = (mutation: { key: string; token: number }, record: RevisionedFollowRecord) => {
    const accepted = observe(record);
    if (isCurrent(mutation)) pending.delete(mutation.key);
    return accepted;
  };

  const desiredFor = (followerHandle: string, followingHandle: string) =>
    pending.get(relationKey(followerHandle, followingHandle))?.desiredStatus;

  const protectFollowing = (followerHandle: string, handles: string[]) => {
    const next = new Set(handles);
    for (const [key, mutation] of pending) {
      const separator = key.indexOf(":");
      const follower = key.slice(0, separator);
      const following = key.slice(separator + 1);
      if (follower !== followerHandle) continue;
      if (mutation.desiredStatus === "active") next.add(following);
      else next.delete(following);
    }
    return [...next];
  };

  const protectFollowers = (followingHandle: string, handles: string[]) => {
    const next = new Set(handles);
    for (const [key, mutation] of pending) {
      const separator = key.indexOf(":");
      const follower = key.slice(0, separator);
      const following = key.slice(separator + 1);
      if (following !== followingHandle) continue;
      if (mutation.desiredStatus === "active") next.add(follower);
      else next.delete(follower);
    }
    return [...next];
  };

  return {
    begin,
    complete,
    desiredFor,
    fail,
    observe,
    protectFollowers,
    protectFollowing,
    revisionFor: (followerHandle: string, followingHandle: string) =>
      latestRevision.get(relationKey(followerHandle, followingHandle)) ?? 0
  };
};
