import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  CommunityCallContract,
  CreateCommunityAnnouncementInputContract,
  CreateCommunityCallInputContract,
  CreateCommunityInputContract,
  UpdateCommunitySettingsInputContract
} from "@/packages/contracts/src";
import type { ResearchCommunity } from "@/lib/mockData";
import {
  shouldRetainRetryMutation,
  symposiumApi
} from "@/features/api/symposiumApiClient";
import { canonicalRouteHref } from "@/features/navigation/canonicalRoute";

type RetryMutation = { fingerprintKey: string; idempotencyKey: string };

export const createCommunityController = (input: {
  currentProfileHandle: string;
  communitiesRef: MutableRefObject<ResearchCommunity[]>;
  setCommunities: Dispatch<SetStateAction<ResearchCommunity[]>>;
  setCommunityCalls: Dispatch<SetStateAction<Record<string, CommunityCallContract[]>>>;
  setMembershipBusy: Dispatch<SetStateAction<boolean>>;
  membershipBusy: boolean;
  selectedCommunity: ResearchCommunity | null;
  retryMutationKey: (scope: string, fingerprint: string) => RetryMutation;
  clearRetryMutationKey: (fingerprintKey: string) => void;
  persist: () => void;
  openCommunity: (communityId: string) => void;
  refresh: () => void;
  setStatus: (status: string) => void;
}) => {
  const mergeCommunity = (community: ResearchCommunity) => {
    input.setCommunities((current) => {
      const next = current.some((candidate) => candidate.id === community.id)
        ? current.map((candidate) => candidate.id === community.id ? community : candidate)
        : [community, ...current];
      input.communitiesRef.current = next;
      return next;
    });
  };

  const createCommunity = async (communityInput: CreateCommunityInputContract) => {
    const mutation = input.retryMutationKey("community-create", JSON.stringify(communityInput));
    input.setStatus("Creating community");
    try {
      const data = await symposiumApi.request<{ community: ResearchCommunity }>("/api/communities", {
        method: "POST",
        idempotencyKey: mutation.idempotencyKey,
        body: { ...communityInput, actorHandle: input.currentProfileHandle }
      });
      input.clearRetryMutationKey(mutation.fingerprintKey);
      mergeCommunity(data.community);
      window.setTimeout(input.persist, 0);
      input.setStatus("Community created");
      input.openCommunity(data.community.id);
      return { ok: true };
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) input.clearRetryMutationKey(mutation.fingerprintKey);
      const message = error instanceof Error ? error.message : "Community could not be created";
      input.setStatus(message);
      return { ok: false, error: message };
    }
  };

  const changeMembership = async () => {
    const community = input.selectedCommunity;
    if (!community || input.membershipBusy) return;
    const action = community.membershipStatus === "active" || community.memberHandles.includes(input.currentProfileHandle) ? "leave" : "join";
    const mutation = input.retryMutationKey("community-membership", `${community.id}:${action}`);
    input.setMembershipBusy(true);
    input.setStatus(action === "leave" ? "Leaving community" : community.visibility === "private" ? "Requesting membership" : "Joining community");
    try {
      const data = await symposiumApi.request<{ community: ResearchCommunity; status: string }>(
        `/api/communities/${encodeURIComponent(community.id)}/membership`,
        { method: "POST", idempotencyKey: mutation.idempotencyKey, body: { action, actorHandle: input.currentProfileHandle } }
      );
      input.clearRetryMutationKey(mutation.fingerprintKey);
      mergeCommunity(data.community);
      window.setTimeout(input.persist, 0);
      input.setStatus(data.status === "requested" ? "Membership requested" : data.status === "left" ? "Left community" : "Community joined");
      if (data.status === "left" && data.community.visibility === "private") {
        input.setCommunityCalls((current) => ({ ...current, [data.community.id]: [] }));
      }
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) input.clearRetryMutationKey(mutation.fingerprintKey);
      input.setStatus(error instanceof Error ? error.message : "Membership could not be changed");
    } finally {
      input.setMembershipBusy(false);
    }
  };

  const changeVisibility = async (visibility: ResearchCommunity["visibility"]) => {
    const community = input.selectedCommunity;
    if (!community) return { ok: false, error: "Community not found." };
    if (visibility === community.visibility) return { ok: true };
    const payload = { communityId: community.id, visibility, expectedRevision: community.revision ?? 1 };
    const mutation = input.retryMutationKey("community-visibility", JSON.stringify(payload));
    input.setStatus(`Making community ${visibility}`);
    try {
      const data = await symposiumApi.request<{ community: ResearchCommunity }>(
        `/api/communities/${encodeURIComponent(community.id)}`,
        { method: "PATCH", idempotencyKey: mutation.idempotencyKey, body: { ...payload, actorHandle: input.currentProfileHandle } }
      );
      input.clearRetryMutationKey(mutation.fingerprintKey);
      mergeCommunity(data.community);
      window.setTimeout(input.persist, 0);
      input.refresh();
      input.setStatus(`Community is now ${visibility}`);
      return { ok: true };
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) input.clearRetryMutationKey(mutation.fingerprintKey);
      const message = error instanceof Error ? error.message : "Community visibility could not be changed";
      input.setStatus(message);
      if (message.includes("changed")) input.refresh();
      return { ok: false, error: message };
    }
  };

  const updateSettings = async (settings: Pick<UpdateCommunitySettingsInputContract, "name" | "summary" | "guidelines">) => {
    const community = input.selectedCommunity;
    if (!community) return { ok: false, error: "Community not found." };
    const payload = { communityId: community.id, ...settings, expectedRevision: community.revision ?? 1 };
    const mutation = input.retryMutationKey("community-settings", JSON.stringify(payload));
    input.setStatus("Saving community settings");
    try {
      const data = await symposiumApi.request<{ community: ResearchCommunity }>(`/api/communities/${encodeURIComponent(community.id)}`, {
        method: "PATCH", idempotencyKey: mutation.idempotencyKey, body: { ...payload, actorHandle: input.currentProfileHandle }
      });
      input.clearRetryMutationKey(mutation.fingerprintKey);
      mergeCommunity(data.community);
      window.setTimeout(input.persist, 0);
      input.setStatus("Community updated");
      return { ok: true };
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) input.clearRetryMutationKey(mutation.fingerprintKey);
      const message = error instanceof Error ? error.message : "Community settings could not be saved";
      input.setStatus(message);
      if (message.includes("changed")) input.refresh();
      return { ok: false, error: message };
    }
  };

  const updateMemberRole = async (memberHandle: string, role: "moderator" | "member") => {
    const community = input.selectedCommunity;
    if (!community) return { ok: false, error: "Community not found." };
    const payload = { communityId: community.id, memberHandle, role, expectedRevision: community.revision ?? 1 };
    const mutation = input.retryMutationKey("community-member-role", JSON.stringify(payload));
    input.setStatus(role === "moderator" ? "Promoting community moderator" : "Updating community role");
    try {
      const data = await symposiumApi.request<{ community: ResearchCommunity }>(`/api/communities/${encodeURIComponent(community.id)}/members/${encodeURIComponent(memberHandle)}`, {
        method: "PATCH", idempotencyKey: mutation.idempotencyKey, body: { ...payload, actorHandle: input.currentProfileHandle }
      });
      input.clearRetryMutationKey(mutation.fingerprintKey);
      mergeCommunity(data.community);
      window.setTimeout(input.persist, 0);
      input.setStatus(role === "moderator" ? "Moderator promoted" : "Moderator returned to member");
      return { ok: true };
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) input.clearRetryMutationKey(mutation.fingerprintKey);
      const message = error instanceof Error ? error.message : "Member role could not be changed";
      input.setStatus(message);
      if (message.includes("changed")) input.refresh();
      return { ok: false, error: message };
    }
  };

  const removeMember = async (memberHandle: string) => {
    const community = input.selectedCommunity;
    if (!community) return { ok: false, error: "Community not found." };
    const payload = { communityId: community.id, memberHandle, expectedRevision: community.revision ?? 1 };
    const mutation = input.retryMutationKey("community-member-remove", JSON.stringify(payload));
    input.setStatus("Removing community member");
    try {
      const data = await symposiumApi.request<{ community: ResearchCommunity }>(`/api/communities/${encodeURIComponent(community.id)}/members/${encodeURIComponent(memberHandle)}`, {
        method: "DELETE", idempotencyKey: mutation.idempotencyKey, body: { ...payload, actorHandle: input.currentProfileHandle }
      });
      input.clearRetryMutationKey(mutation.fingerprintKey);
      mergeCommunity(data.community);
      window.setTimeout(input.persist, 0);
      input.setStatus("Community member removed");
      return { ok: true };
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) input.clearRetryMutationKey(mutation.fingerprintKey);
      const message = error instanceof Error ? error.message : "Member could not be removed";
      input.setStatus(message);
      if (message.includes("changed")) input.refresh();
      return { ok: false, error: message };
    }
  };

  const createAnnouncement = async (announcement: Pick<CreateCommunityAnnouncementInputContract, "title" | "body">) => {
    const community = input.selectedCommunity;
    if (!community) return { ok: false, error: "Community not found." };
    const payload = { communityId: community.id, ...announcement, expectedRevision: community.revision ?? 1 };
    const mutation = input.retryMutationKey("community-announcement", JSON.stringify(payload));
    input.setStatus("Publishing announcement");
    try {
      const data = await symposiumApi.request<{ community: ResearchCommunity }>(`/api/communities/${encodeURIComponent(community.id)}/announcements`, {
        method: "POST", idempotencyKey: mutation.idempotencyKey, body: { ...payload, actorHandle: input.currentProfileHandle }
      });
      input.clearRetryMutationKey(mutation.fingerprintKey);
      mergeCommunity(data.community);
      window.setTimeout(input.persist, 0);
      input.setStatus("Announcement published");
      return { ok: true };
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) input.clearRetryMutationKey(mutation.fingerprintKey);
      const message = error instanceof Error ? error.message : "Announcement could not be published";
      input.setStatus(message);
      if (message.includes("changed")) input.refresh();
      return { ok: false, error: message };
    }
  };

  const createCall = async (callInput: Omit<CreateCommunityCallInputContract, "communityId">) => {
    const community = input.selectedCommunity;
    if (!community) return { ok: false, error: "Community not found." };
    const payload = { ...callInput, communityId: community.id };
    const mutation = input.retryMutationKey("community-call-create", JSON.stringify(payload));
    input.setStatus(callInput.startsAt ? "Scheduling call" : "Opening call");
    try {
      const data = await symposiumApi.request<{ call: CommunityCallContract }>(
        `/api/communities/${encodeURIComponent(community.id)}/calls`,
        { method: "POST", idempotencyKey: mutation.idempotencyKey, body: { ...payload, actorHandle: input.currentProfileHandle } }
      );
      input.clearRetryMutationKey(mutation.fingerprintKey);
      input.setCommunityCalls((current) => ({
        ...current,
        [community.id]: [data.call, ...(current[community.id] ?? []).filter((call) => call.id !== data.call.id)]
      }));
      input.setStatus(data.call.status === "scheduled" ? "Call scheduled" : "Call is live");
      return { ok: true };
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) input.clearRetryMutationKey(mutation.fingerprintKey);
      const message = error instanceof Error ? error.message : "Call could not be created";
      input.setStatus(message);
      return { ok: false, error: message };
    }
  };

  const joinCall = async (callId: string) => {
    try {
      const data = await symposiumApi.request<{ call?: CommunityCallContract; status: string }>(
        `/api/calls/${encodeURIComponent(callId)}/join`,
        { method: "POST", body: { actorHandle: input.currentProfileHandle } }
      );
      if (data.call) {
        input.setCommunityCalls((current) => ({
          ...current,
          [data.call!.communityId]: (current[data.call!.communityId] ?? []).map((call) => call.id === data.call!.id ? data.call! : call)
        }));
      }
      input.setStatus("Joined call");
    } catch (error) {
      input.setStatus(error instanceof Error ? error.message : "Call could not be joined");
    }
  };

  const invite = async () => {
    const community = input.selectedCommunity;
    if (!community) return;
    const url = `${window.location.origin}${canonicalRouteHref({ kind: "community", communityId: community.id })}`;
    const canShare = "share" in navigator && typeof navigator.share === "function";
    try {
      if (canShare) await navigator.share({ title: community.name, url });
      else await navigator.clipboard.writeText(url);
      input.setStatus(canShare ? "Invitation shared" : "Community link copied");
    } catch {
      input.setStatus("Could not share community link");
    }
  };

  return { changeMembership, changeVisibility, createCall, createCommunity, createAnnouncement, invite, joinCall, removeMember, updateMemberRole, updateSettings };
};
