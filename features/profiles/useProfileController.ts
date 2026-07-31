"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { CommunityCallContract } from "@/packages/contracts/src";
import {
  getProfileForName,
  profile as fallbackProfile,
  type InquiryItem,
  type ResearchCommunity,
  type ResearchProfile
} from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { selectActiveProfile } from "@/features/identity/selectActiveProfile";
import {
  persistCachedIdentity,
  readCachedIdentity
} from "@/features/identity/cachedIdentity";
import {
  createClientMutationId,
  shouldRetainRetryMutation,
  symposiumApi
} from "@/features/api/symposiumApiClient";
import {
  isCrossTabItemMessage,
  type CrossTabItemMessage
} from "@/features/live-sync/crossTabItemSync";
import { compareEntityRevisions } from "@/features/live-sync/entityRevision";
import {
  createFollowMutationCoordinator,
  type RevisionedFollowRecord
} from "@/features/live-sync/followMutationCoordinator";
import { useCrossTabItemTransport } from "@/features/live-sync/useCrossTabItemTransport";
import { useCoalescedRefresh } from "@/features/live-sync/useCoalescedRefresh";
import { createItemMutationCoordinator } from "@/features/mutations/itemMutationCoordinator";
import { readCachedBootstrapSnapshot } from "@/features/bootstrap/cachedBootstrap";
import {
  persistCachedProfileSocial,
  readCachedProfileSocial
} from "@/features/profiles/profileReadCache";
import { profileAvatarForPersistence } from "@/features/profiles/profilePersistence";
import { profileActivityScopeForTab } from "@/features/profiles/profileActivityModel";
import type {
  ProfileSettingsDraft,
  ProfileSocialLists,
  ProfileTab
} from "@/features/profiles/profileTypes";
import type {
  ProfileControllerBridgeRefs,
  ProfileRetryMutationPort
} from "@/features/profiles/profileControllerPorts";
import { useProfileActivityController } from "@/features/profiles/useProfileActivityController";

type ProfileFollowRecord = RevisionedFollowRecord;
type ProfileFollowResponse = {
  following?: ProfileFollowRecord[];
  followers?: ProfileFollowRecord[];
};
type ProfileSyncEntity = ResearchProfile & { id: string };

type ProfileControllerInput = ProfileControllerBridgeRefs & {
  activeTab: ProfileTab;
  fallbackProfile?: ResearchProfile;
  localPreview: boolean;
  onStatus: (status: string) => void;
  readsEnabled: boolean;
  retryMutation: ProfileRetryMutationPort;
  selectedProfileName: string | null;
  socialHydrationEnabled: boolean;
};

const profileSyncEntity = (person: ResearchProfile): ProfileSyncEntity => ({
  ...person,
  id: person.handle
});

const researchProfileFromSyncEntity = ({
  id: _id,
  ...person
}: ProfileSyncEntity): ResearchProfile => person;

const isCrossTabProfileMessage = (
  value: unknown
): value is CrossTabItemMessage<ProfileSyncEntity> =>
  isCrossTabItemMessage<ProfileSyncEntity>(value);

const normalizeSocialLists = (
  lists: ProfileSocialLists
): ProfileSocialLists => ({
  following: Array.from(
    new Set(
      lists.following
        .map(cleanHandle)
        .filter((candidate) => candidate && candidate !== "@")
    )
  ),
  followers: Array.from(
    new Set(
      lists.followers
        .map(cleanHandle)
        .filter((candidate) => candidate && candidate !== "@")
    )
  )
});

const followingStorageKey = (handle: string) =>
  `symposium-following-${cleanHandle(handle)}`;

export const useProfileController = (input: ProfileControllerInput) => {
  const inputRef = useRef(input);
  inputRef.current = input;
  const initialProfile = input.fallbackProfile ?? fallbackProfile;
  const [profiles, setProfiles] = useState<Record<string, ResearchProfile>>({});
  const [currentProfile, setCurrentProfile] =
    useState<ResearchProfile>(initialProfile);
  const [followingHandles, setFollowingHandles] = useState<string[]>([]);
  const [socialLists, setSocialLists] = useState<
    Record<string, ProfileSocialLists>
  >({});
  const profilesRef = useRef(profiles);
  const currentProfileRef = useRef(currentProfile);
  const followingHandlesRef = useRef(followingHandles);
  const socialListsRef = useRef(socialLists);
  const selectedProfileNameRef = useRef(input.selectedProfileName);
  const profileMutationCoordinatorRef = useRef(
    createItemMutationCoordinator<ProfileSyncEntity>()
  );
  const followMutationCoordinatorRef = useRef(
    createFollowMutationCoordinator()
  );
  const lastPersistedProfilesRef = useRef<ProfileSyncEntity[]>([]);
  const authenticatedProfileHandleRef = useRef<string | null>(null);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    currentProfileRef.current = currentProfile;
  }, [currentProfile]);

  useEffect(() => {
    followingHandlesRef.current = followingHandles;
  }, [followingHandles]);

  useEffect(() => {
    socialListsRef.current = socialLists;
  }, [socialLists]);

  useEffect(() => {
    selectedProfileNameRef.current = input.selectedProfileName;
  }, [input.selectedProfileName]);

  const profileList = useMemo(() => Object.values(profiles), [profiles]);
  const findProfile = (nameOrHandle: string) =>
    profileList.find((person) => person.handle === nameOrHandle) ??
    profileList.find((person) => person.name === nameOrHandle) ??
    getProfileForName(nameOrHandle);
  const selectedProfile = input.selectedProfileName
    ? findProfile(input.selectedProfileName)
    : null;
  const selectedProfileHandle = input.selectedProfileName
    ? selectedProfile?.handle ?? cleanHandle(input.selectedProfileName)
    : null;

  const activity = useProfileActivityController({
    activeTab: input.activeTab,
    currentProfileRef,
    inquiryRef: input.inquiryRef,
    readsEnabled: input.readsEnabled,
    selectedProfile,
    selectedProfileName: input.selectedProfileName
  });

  const setProfileState = (
    nextProfiles: Record<string, ResearchProfile>,
    nextCurrent: ResearchProfile = currentProfileRef.current
  ) => {
    profilesRef.current = nextProfiles;
    currentProfileRef.current = nextCurrent;
    setProfiles(nextProfiles);
    setCurrentProfile(nextCurrent);
  };

  const setFollowingState = (handles: string[]) => {
    const normalized = Array.from(
      new Set(handles.map(cleanHandle).filter((handle) => handle !== "@"))
    );
    followingHandlesRef.current = normalized;
    setFollowingHandles(normalized);
    return normalized;
  };

  const applySocialLists = (
    handle: string,
    lists: ProfileSocialLists,
    persist = true
  ) => {
    const normalizedHandle = cleanHandle(handle);
    const normalizedLists = normalizeSocialLists(lists);
    const next = {
      ...socialListsRef.current,
      [normalizedHandle]: normalizedLists
    };
    socialListsRef.current = next;
    setSocialLists(next);
    if (persist) {
      persistCachedProfileSocial(window.localStorage, {
        viewerHandle: currentProfileRef.current.handle,
        targetHandle: normalizedHandle,
        lists: normalizedLists
      });
    }
    return normalizedLists;
  };

  const readLocalFollowing = (handle: string) => {
    try {
      const raw = window.localStorage.getItem(followingStorageKey(handle));
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      return parsed.map(cleanHandle).filter((candidate) => candidate !== "@");
    } catch {
      return [];
    }
  };

  const persistLocalFollowing = (handle: string, handles: string[]) => {
    window.localStorage.setItem(
      followingStorageKey(handle),
      JSON.stringify(
        Array.from(
          new Set(handles.map(cleanHandle).filter((candidate) => candidate !== "@"))
        )
      )
    );
  };

  const captureFollowRevisions = (data: ProfileFollowResponse) => {
    for (const record of [...(data.following ?? []), ...(data.followers ?? [])]) {
      followMutationCoordinatorRef.current.observe({
        ...record,
        followerHandle: cleanHandle(String(record.followerHandle ?? "")),
        followingHandle: cleanHandle(String(record.followingHandle ?? ""))
      });
    }
  };

  const socialListsFromResponse = (
    data: ProfileFollowResponse,
    ownerHandle: string
  ): ProfileSocialLists => {
    const coordinator = followMutationCoordinatorRef.current;
    const normalizedOwner = cleanHandle(ownerHandle);
    const following = Array.from(
      new Set(
        (data.following ?? []).flatMap((follow) => {
          const normalized = {
            ...follow,
            followerHandle: cleanHandle(String(follow.followerHandle ?? "")),
            followingHandle: cleanHandle(String(follow.followingHandle ?? ""))
          };
          if (!coordinator.observe(normalized) || normalized.status !== "active") {
            return [];
          }
          return normalized.followingHandle
            ? [normalized.followingHandle]
            : [];
        })
      )
    );
    const followers = Array.from(
      new Set(
        (data.followers ?? []).flatMap((follow) => {
          const normalized = {
            ...follow,
            followerHandle: cleanHandle(String(follow.followerHandle ?? "")),
            followingHandle: cleanHandle(String(follow.followingHandle ?? ""))
          };
          if (!coordinator.observe(normalized) || normalized.status !== "active") {
            return [];
          }
          return normalized.followerHandle ? [normalized.followerHandle] : [];
        })
      )
    );
    return {
      following: coordinator.protectFollowing(normalizedOwner, following),
      followers: coordinator.protectFollowers(normalizedOwner, followers)
    };
  };

  const publishCrossTabProfile =
    useCrossTabItemTransport<CrossTabItemMessage<ProfileSyncEntity>>({
      channelName: "symposium-profile-sync-v1",
      isMessage: isCrossTabProfileMessage,
      onMessage: (message) => {
        const currentEntities = Object.values(profilesRef.current).map(
          profileSyncEntity
        );
        const received = profileMutationCoordinatorRef.current.receive(
          message,
          currentEntities
        );
        if (!received.accepted) return;
        const nextProfiles = Object.fromEntries(
          received.items.map((entity) => [
            entity.handle,
            researchProfileFromSyncEntity(entity)
          ])
        );
        const currentHandle = currentProfileRef.current.handle;
        const previousCurrent = profilesRef.current[currentHandle];
        const nextCurrent =
          nextProfiles[currentHandle] ?? currentProfileRef.current;
        setProfileState(nextProfiles, nextCurrent);
        lastPersistedProfilesRef.current = received.items;

        const inquiry = inputRef.current.inquiryRef.current;
        if (
          inquiry &&
          JSON.stringify(previousCurrent) !== JSON.stringify(nextCurrent)
        ) {
          inquiry.projectProfile(nextCurrent, { persist: false });
        }
        inquiry?.persistSnapshot();
      },
      storageKey: "symposium-cross-tab-profile"
    });

  const persistProfileSnapshot = (
    broadcastProfileHandles: string[] = []
  ) => {
    const inquiry = inputRef.current.inquiryRef.current;
    inquiry?.persistSnapshot();
    const entities = Object.values(profilesRef.current).map(profileSyncEntity);
    const messages = profileMutationCoordinatorRef.current.publishChanges(
      entities,
      lastPersistedProfilesRef.current,
      broadcastProfileHandles
    );
    lastPersistedProfilesRef.current = entities;
    for (const message of messages) publishCrossTabProfile(message);
  };

  const mergeDiscoveredProfiles = (
    incomingProfiles: Record<string, ResearchProfile>
  ) => {
    const nextProfiles = { ...profilesRef.current };
    for (const [rawHandle, incoming] of Object.entries(incomingProfiles)) {
      const handle = cleanHandle(rawHandle);
      if (!handle || handle === "@") continue;
      const current = nextProfiles[handle];
      const protectedEntity =
        profileMutationCoordinatorRef.current.protectIncomingItem(
          profileSyncEntity({ ...incoming, handle }),
          current ? profileSyncEntity(current) : undefined
        );
      nextProfiles[handle] = researchProfileFromSyncEntity(protectedEntity);
    }
    const nextCurrent =
      nextProfiles[currentProfileRef.current.handle] ??
      currentProfileRef.current;
    setProfileState(nextProfiles, nextCurrent);
    return nextProfiles;
  };

  const refreshData = async (
    preferredHandle = currentProfileRef.current.handle
  ) => {
    const inquiry = inputRef.current.inquiryRef.current;
    const commitInquiryRefresh = inquiry?.beginRefresh();
    const data = await symposiumApi.request<{
      items: InquiryItem[];
      profiles: Record<string, ResearchProfile>;
      communities?: ResearchCommunity[];
      communityCalls?: Record<string, CommunityCallContract[]>;
      defaultProfile: ResearchProfile;
    }>(
      `/api/bootstrap?actorHandle=${encodeURIComponent(preferredHandle)}`,
      { cache: "no-store" }
    );
    const incomingProfiles = Object.keys(data.profiles).length
      ? data.profiles
      : { [data.defaultProfile.handle]: data.defaultProfile };
    const loadedProfiles = mergeDiscoveredProfiles(incomingProfiles);
    const nextProfile = selectActiveProfile({
      profiles: loadedProfiles,
      defaultProfile: data.defaultProfile,
      authenticatedHandle: authenticatedProfileHandleRef.current,
      authenticatedProfile: currentProfileRef.current,
      preferredHandle
    });
    setProfileState(loadedProfiles, nextProfile);
    inputRef.current.environmentRef.current?.applyBootstrap({
      communities: data.communities,
      communityCalls: data.communityCalls
    });
    commitInquiryRefresh?.(data.items, nextProfile.handle);
    inputRef.current.onStatus("Live data connected");
    return nextProfile;
  };

  const refreshFollowing = async (
    actorHandle = currentProfileRef.current.handle
  ) => {
    const cached = readLocalFollowing(actorHandle);
    setFollowingState(cached);
    applySocialLists(actorHandle, {
      following: cached,
      followers:
        socialListsRef.current[cleanHandle(actorHandle)]?.followers ?? []
    });
    if (inputRef.current.localPreview) return;
    const data = await symposiumApi.request<ProfileFollowResponse>(
      `/api/follows?actorHandle=${encodeURIComponent(actorHandle)}`,
      { cache: "no-store" }
    );
    captureFollowRevisions(data);
    const lists = socialListsFromResponse(data, actorHandle);
    const remoteHandles = setFollowingState(lists.following);
    applySocialLists(actorHandle, lists);
    persistLocalFollowing(actorHandle, remoteHandles);
  };

  const refreshProfileFollows = async (handle: string) => {
    const normalizedHandle = cleanHandle(handle);
    if (!normalizedHandle || normalizedHandle === "@") return;
    if (inputRef.current.localPreview) return;
    const data = await symposiumApi.request<ProfileFollowResponse>(
      `/api/profiles/${encodeURIComponent(normalizedHandle)}/follows`,
      { cache: "no-store" }
    );
    captureFollowRevisions(data);
    applySocialLists(
      normalizedHandle,
      socialListsFromResponse(data, normalizedHandle)
    );
  };

  const loadProfile = async (handle: string) => {
    const normalizedHandle = cleanHandle(handle);
    if (
      !normalizedHandle ||
      normalizedHandle === "@" ||
      profilesRef.current[normalizedHandle]
    ) {
      return;
    }
    const data = await symposiumApi.request<{ profile: ResearchProfile }>(
      `/api/profiles/${encodeURIComponent(normalizedHandle)}`,
      { cache: "no-store" }
    );
    mergeDiscoveredProfiles({
      [data.profile.handle]: data.profile
    });
    persistProfileSnapshot();
  };

  const mergeLiveProfile = (incoming: ResearchProfile) => {
    const handle = cleanHandle(incoming.handle);
    if (!handle || handle === "@") return false;
    const current = profilesRef.current[handle];
    const protectedEntity =
      profileMutationCoordinatorRef.current.protectIncomingItem(
        profileSyncEntity({ ...incoming, handle }),
        current ? profileSyncEntity(current) : undefined
      );
    const nextProfile = researchProfileFromSyncEntity(protectedEntity);
    if (
      current &&
      JSON.stringify(current) === JSON.stringify(nextProfile)
    ) {
      return false;
    }
    if ((compareEntityRevisions(nextProfile, current) ?? 0) > 0) {
      profileMutationCoordinatorRef.current.complete(handle);
    }
    const nextProfiles = {
      ...profilesRef.current,
      [handle]: nextProfile
    };
    const nextCurrent =
      currentProfileRef.current.handle === handle
        ? nextProfile
        : currentProfileRef.current;
    setProfileState(nextProfiles, nextCurrent);
    inputRef.current.inquiryRef.current?.projectProfile(nextProfile, {
      persist: false
    });
    persistProfileSnapshot([handle]);
    return true;
  };

  const mergeLiveFollow = (
    record: ProfileFollowRecord | undefined,
    active: boolean
  ) => {
    const followerHandle = cleanHandle(
      String(record?.followerHandle ?? "")
    );
    const followingHandle = cleanHandle(
      String(record?.followingHandle ?? "")
    );
    if (
      !followerHandle ||
      !followingHandle ||
      followerHandle === "@" ||
      followingHandle === "@"
    ) {
      return;
    }
    const normalizedRecord = {
      ...record,
      followerHandle,
      followingHandle,
      status: record?.status ?? (active ? "active" : "none")
    };
    if (!followMutationCoordinatorRef.current.observe(normalizedRecord)) return;
    const canonicalActive = normalizedRecord.status === "active";
    const followerLists = socialListsRef.current[followerHandle] ?? {
      following: [],
      followers: []
    };
    const followingLists = socialListsRef.current[followingHandle] ?? {
      following: [],
      followers: []
    };
    const nextFollowerFollowing = canonicalActive
      ? Array.from(new Set([...followerLists.following, followingHandle]))
      : followerLists.following.filter(
          (handle) => handle !== followingHandle
        );
    const nextFollowingFollowers = canonicalActive
      ? Array.from(new Set([...followingLists.followers, followerHandle]))
      : followingLists.followers.filter((handle) => handle !== followerHandle);
    const nextSocialLists = {
      ...socialListsRef.current,
      [followerHandle]: {
        ...followerLists,
        following: nextFollowerFollowing
      },
      [followingHandle]: {
        ...followingLists,
        followers: nextFollowingFollowers
      }
    };
    socialListsRef.current = nextSocialLists;
    setSocialLists(nextSocialLists);

    if (followerHandle === currentProfileRef.current.handle) {
      const stored = readLocalFollowing(followerHandle);
      const merged = Array.from(
        new Set([...followingHandlesRef.current, ...stored])
      );
      const next = canonicalActive
        ? Array.from(new Set([...merged, followingHandle]))
        : merged.filter((handle) => handle !== followingHandle);
      setFollowingState(next);
      persistLocalFollowing(followerHandle, next);
    }
  };

  const saveSettings = async (draft: ProfileSettingsDraft) => {
    const previousProfile = currentProfileRef.current;
    const previousProfiles = profilesRef.current;
    const updatedProfile: ResearchProfile = {
      ...previousProfile,
      name: draft.name.trim() || previousProfile.name,
      avatarUrl: draft.avatarUrl?.trim() || undefined,
      bio: (draft.bio.trim() || previousProfile.bio).slice(0, 200),
      likesPublic: draft.likesPublic,
      resharesPublic: draft.resharesPublic
    };
    const nextProfiles = {
      ...previousProfiles,
      [updatedProfile.handle]: updatedProfile
    };
    profileMutationCoordinatorRef.current.begin(updatedProfile.handle);
    setProfileState(nextProfiles, updatedProfile);
    inputRef.current.inquiryRef.current?.projectProfile(updatedProfile);
    inputRef.current.onStatus("Saving profile settings");
    const profilePayload = {
      name: updatedProfile.name,
      handle: updatedProfile.handle,
      email: updatedProfile.email,
      avatarUrl: profileAvatarForPersistence(updatedProfile.avatarUrl),
      likesPublic: updatedProfile.likesPublic,
      resharesPublic: updatedProfile.resharesPublic,
      role: updatedProfile.role,
      location: updatedProfile.location,
      bio: updatedProfile.bio,
      fields: updatedProfile.fields
    };
    const mutation = inputRef.current.retryMutation.acquire(
      "profile-upsert",
      JSON.stringify(profilePayload)
    );

    try {
      const data = await symposiumApi.request<{ profile: ResearchProfile }>(
        "/api/profiles",
        {
          method: "POST",
          idempotencyKey: mutation.idempotencyKey,
          body: profilePayload
        }
      );
      inputRef.current.retryMutation.clear(mutation.fingerprintKey);
      const committedEntity =
        profileMutationCoordinatorRef.current.protectIncomingItem(
          profileSyncEntity({ ...updatedProfile, ...data.profile }),
          profileSyncEntity(updatedProfile)
        );
      profileMutationCoordinatorRef.current.complete(updatedProfile.handle);
      const committedProfile =
        researchProfileFromSyncEntity(committedEntity);
      const committedProfiles = {
        ...nextProfiles,
        [committedProfile.handle]: committedProfile
      };
      setProfileState(committedProfiles, committedProfile);
      inputRef.current.inquiryRef.current?.projectProfile(committedProfile, {
        persist: false
      });
      persistProfileSnapshot([committedProfile.handle]);
      inputRef.current.onStatus("Profile settings saved");
      return committedProfile;
    } catch (error) {
      if (!shouldRetainRetryMutation(error)) {
        inputRef.current.retryMutation.clear(mutation.fingerprintKey);
      }
      profileMutationCoordinatorRef.current.complete(updatedProfile.handle);
      setProfileState(previousProfiles, previousProfile);
      inputRef.current.inquiryRef.current?.projectProfile(previousProfile, {
        persist: false
      });
      persistProfileSnapshot([updatedProfile.handle]);
      inputRef.current.onStatus("Profile settings could not sync");
      return null;
    }
  };

  const toggleFollow = async (targetHandle: string) => {
    const normalizedTarget = cleanHandle(targetHandle);
    const actorHandle = currentProfileRef.current.handle;
    if (
      !normalizedTarget ||
      normalizedTarget === "@" ||
      normalizedTarget === actorHandle
    ) {
      return;
    }
    const previousHandles = followingHandlesRef.current;
    const wasFollowing = previousHandles.includes(normalizedTarget);
    const nextHandles = wasFollowing
      ? previousHandles.filter((handle) => handle !== normalizedTarget)
      : Array.from(new Set([...previousHandles, normalizedTarget]));
    const currentSocial = socialListsRef.current[actorHandle] ?? {
      following: previousHandles,
      followers: []
    };
    const targetSocial = socialListsRef.current[normalizedTarget] ?? {
      following: [],
      followers: []
    };
    const nextTargetFollowers = wasFollowing
      ? targetSocial.followers.filter((handle) => handle !== actorHandle)
      : Array.from(new Set([...targetSocial.followers, actorHandle]));
    const mutation = followMutationCoordinatorRef.current.begin(
      actorHandle,
      normalizedTarget,
      !wasFollowing
    );
    const idempotencyKey = createClientMutationId(
      wasFollowing ? "profile-unfollow" : "profile-follow"
    );
    setFollowingState(nextHandles);
    applySocialLists(actorHandle, {
      ...currentSocial,
      following: nextHandles
    });
    applySocialLists(normalizedTarget, {
      ...targetSocial,
      followers: nextTargetFollowers
    });
    persistLocalFollowing(actorHandle, nextHandles);
    inputRef.current.onStatus(
      wasFollowing ? "Unfollowing profile" : "Following profile"
    );

    try {
      const data = await symposiumApi.request<{ follow?: ProfileFollowRecord }>(
        `/api/profiles/${encodeURIComponent(normalizedTarget)}/follow`,
        {
          method: wasFollowing ? "DELETE" : "POST",
          idempotencyKey,
          body: { actorHandle }
        }
      );
      if (data.follow) {
        const normalizedFollow = {
          ...data.follow,
          followerHandle: cleanHandle(
            String(data.follow.followerHandle ?? actorHandle)
          ),
          followingHandle: cleanHandle(
            String(data.follow.followingHandle ?? normalizedTarget)
          )
        };
        followMutationCoordinatorRef.current.complete(
          mutation,
          normalizedFollow
        );
        mergeLiveFollow(
          normalizedFollow,
          normalizedFollow.status === "active"
        );
      }
      inputRef.current.onStatus(
        wasFollowing ? "Profile unfollowed" : "Following profile"
      );
    } catch {
      if (!followMutationCoordinatorRef.current.fail(mutation)) {
        inputRef.current.onStatus("Follow state synced");
        return;
      }
      setFollowingState(previousHandles);
      applySocialLists(actorHandle, {
        ...currentSocial,
        following: previousHandles
      });
      applySocialLists(normalizedTarget, targetSocial);
      persistLocalFollowing(actorHandle, previousHandles);
      inputRef.current.onStatus("Follow could not sync");
    }
  };

  const hydrateCachedBootstrap = (storedProfileHandle: string | null) => {
    const inquiry = inputRef.current.inquiryRef.current;
    if (!inquiry) return null;
    const cached = inquiry.hydrateCachedSnapshot(storedProfileHandle);
    setProfileState(cached.profiles, cached.currentProfile);
    inputRef.current.environmentRef.current?.applyBootstrap({
      communities: cached.communities
    });
    return cached.currentProfile;
  };

  const enterLocalPreview = () => {
    const availableProfiles = Object.keys(profilesRef.current).length
      ? profilesRef.current
      : { [initialProfile.handle]: initialProfile };
    const previewProfile =
      availableProfiles[currentProfileRef.current.handle] ??
      availableProfiles[initialProfile.handle] ??
      currentProfileRef.current;
    setProfileState(availableProfiles, previewProfile);
    inputRef.current.inquiryRef.current?.persistSnapshot();
    return previewProfile;
  };

  const hydrateCachedIdentity = (userId: string) => {
    const cachedIdentity = readCachedIdentity(window.localStorage, userId);
    if (!cachedIdentity) return null;
    authenticatedProfileHandleRef.current = cachedIdentity.handle;
    const nextProfiles = {
      ...profilesRef.current,
      [cachedIdentity.handle]: cachedIdentity
    };
    setProfileState(nextProfiles, cachedIdentity);
    return cachedIdentity;
  };

  const syncAuthenticatedAccount = async (userId: string) => {
    const data = await symposiumApi.request<{ profile: ResearchProfile }>(
      "/api/auth/sync",
      { method: "POST" }
    );
    authenticatedProfileHandleRef.current = data.profile.handle;
    const nextProfiles = {
      ...profilesRef.current,
      [data.profile.handle]: data.profile
    };
    setProfileState(nextProfiles, data.profile);
    persistCachedIdentity(window.localStorage, userId, data.profile);
    return data.profile;
  };

  const clearAuthenticatedIdentity = () => {
    authenticatedProfileHandleRef.current = null;
  };

  const scheduleLiveRefresh = useCoalescedRefresh(() => {
    const handle = currentProfileRef.current.handle;
    const selectedKey = selectedProfileNameRef.current;
    const selected = selectedKey
      ? profilesRef.current[selectedKey] ??
        Object.values(profilesRef.current).find(
          (person) => person.name === selectedKey
        ) ??
        getProfileForName(selectedKey)
      : null;
    return [
      refreshData(handle),
      refreshFollowing(handle),
      activity.refresh(handle, handle, "all", false, true),
      ...(selected?.handle
        ? [
            refreshProfileFollows(selected.handle),
            activity.refresh(
              selected.handle,
              handle,
              profileActivityScopeForTab(inputRef.current.activeTab),
              false,
              true
            )
          ]
        : [])
    ];
  });

  const scheduleActivityRefresh = useCoalescedRefresh(() => {
    const viewerHandle = currentProfileRef.current.handle;
    const selectedKey = selectedProfileNameRef.current;
    const selected = selectedKey
      ? profilesRef.current[selectedKey] ??
        Object.values(profilesRef.current).find(
          (person) => person.name === selectedKey
        ) ??
        getProfileForName(selectedKey)
      : null;
    const requests = [
      activity.refresh(viewerHandle, viewerHandle, "all", false, true)
    ];
    if (
      selected?.handle &&
      cleanHandle(selected.handle) !== cleanHandle(viewerHandle)
    ) {
      requests.push(
        activity.refresh(
          selected.handle,
          viewerHandle,
          profileActivityScopeForTab(inputRef.current.activeTab),
          false,
          true
        )
      );
    }
    return requests;
  });

  useEffect(() => {
    if (!input.socialHydrationEnabled || !currentProfile.handle) return;
    void refreshFollowing(currentProfile.handle).catch(() => undefined);
  }, [currentProfile.handle, input.socialHydrationEnabled]);

  useEffect(() => {
    if (!input.readsEnabled || !selectedProfile?.handle) return;
    void refreshProfileFollows(selectedProfile.handle).catch(() => undefined);
  }, [input.readsEnabled, selectedProfile?.handle]);

  useEffect(() => {
    if (
      !input.readsEnabled ||
      !selectedProfileHandle ||
      selectedProfileHandle === "@" ||
      profilesRef.current[selectedProfileHandle]
    ) {
      return;
    }
    void loadProfile(selectedProfileHandle).catch(() => undefined);
  }, [input.readsEnabled, selectedProfileHandle]);

  useLayoutEffect(() => {
    if (!input.readsEnabled || !selectedProfile?.handle) return;
    const targetHandle = cleanHandle(selectedProfile.handle);
    const viewerHandle = cleanHandle(currentProfile.handle);
    if (socialListsRef.current[targetHandle]) return;
    const cached = readCachedProfileSocial(window.localStorage, {
      viewerHandle,
      targetHandle
    });
    if (cached) applySocialLists(targetHandle, cached, false);
  }, [currentProfile.handle, input.readsEnabled, selectedProfile?.handle]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.newValue) return;
      if (
        event.key.startsWith("symposium-following-") &&
        !event.key.startsWith("symposium-following-lease:")
      ) {
        const handle = cleanHandle(
          event.key.slice("symposium-following-".length)
        );
        try {
          const storedHandles = (
            JSON.parse(event.newValue) as string[]
          )
            .map(cleanHandle)
            .filter((candidate) => candidate !== "@");
          const nextHandles =
            followMutationCoordinatorRef.current.protectFollowing(
              handle,
              storedHandles
            );
          const current = socialListsRef.current[handle] ?? {
            following: [],
            followers: []
          };
          applySocialLists(
            handle,
            { ...current, following: nextHandles },
            false
          );
          if (handle === currentProfileRef.current.handle) {
            setFollowingState(nextHandles);
          }
        } catch {
          // Malformed legacy following state is ignored.
        }
        return;
      }
      if (event.key !== "symposium-local-snapshot") return;
      const snapshot = readCachedBootstrapSnapshot(window.localStorage);
      if (!snapshot) return;
      if (snapshot.communities?.length) {
        inputRef.current.environmentRef.current?.applyBootstrap({
          communities: snapshot.communities
        });
      }
      const currentHandle = currentProfileRef.current.handle;
      const previousCurrent = profilesRef.current[currentHandle];
      const revisionSafeProfiles = Object.fromEntries(
        Object.entries(snapshot.profiles).map(([handle, incoming]) => [
          handle,
          researchProfileFromSyncEntity(
            profileMutationCoordinatorRef.current.protectIncomingItem(
              profileSyncEntity(incoming),
              profilesRef.current[handle]
                ? profileSyncEntity(profilesRef.current[handle])
                : undefined
            )
          )
        ])
      );
      const nextCurrent =
        revisionSafeProfiles[currentHandle] ?? currentProfileRef.current;
      setProfileState(revisionSafeProfiles, nextCurrent);
      if (
        JSON.stringify(previousCurrent) !== JSON.stringify(nextCurrent)
      ) {
        inputRef.current.inquiryRef.current?.projectProfile(nextCurrent, {
          persist: false
        });
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return {
    activity,
    applySocialLists,
    clearAuthenticatedIdentity,
    currentProfile,
    currentProfileRef,
    enterLocalPreview,
    findProfile,
    followingHandles,
    hydrateCachedBootstrap,
    hydrateCachedIdentity,
    mergeDiscoveredProfiles,
    mergeLiveFollow,
    mergeLiveProfile,
    persistProfileSnapshot,
    profiles,
    profilesRef,
    refreshData,
    refreshFollowing,
    refreshProfileFollows,
    saveSettings,
    scheduleActivityRefresh,
    scheduleLiveRefresh,
    selectedProfile,
    selectedProfileHandle,
    socialLists,
    syncAuthenticatedAccount,
    toggleFollow
  };
};

export type { ProfileFollowRecord };
