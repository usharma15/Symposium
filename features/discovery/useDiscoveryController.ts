"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { SearchResponseContract } from "@/packages/contracts/src";
import type {
  InquiryItem,
  ResearchProfile,
  RoomId
} from "@/lib/mockData";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import {
  discoverySearchKey,
  discoveryViewerSearchKey,
  localDiscoverySearch,
  remoteDiscoverySearch,
  reprojectDiscoveryProfiles,
  type DiscoverySearchResults
} from "@/features/discovery/discoveryModel";

type DiscoveryReadPort = {
  mergeBoundedRead: (
    data: {
      items: InquiryItem[];
      profiles?: Record<string, ResearchProfile>;
    },
    options?: { persist?: boolean }
  ) => InquiryItem[];
};

type DiscoveryControllerInput = DiscoveryReadPort & {
  actorHandle: string;
  activeRoom: RoomId;
  communityId: string | null;
  communityQuery: string;
  items: InquiryItem[];
  profiles: Record<string, ResearchProfile>;
};

type RemoteSearchSnapshot = {
  key: string;
  results: DiscoverySearchResults;
};

type CommunitySearchSnapshot = {
  key: string;
  resultIds: string[];
};

const requestSearch = (
  parameters: URLSearchParams,
  signal: AbortSignal
) => symposiumApi.request<SearchResponseContract>(
  `/api/search?${parameters.toString()}`,
  { cache: "no-store", signal }
);

const communitySearchKey = (
  actorHandle: string,
  communityId: string,
  query: string
) => `${discoveryViewerSearchKey(actorHandle, query)}:${communityId}`;

export const useDiscoveryController = (input: DiscoveryControllerInput) => {
  const inputRef = useRef(input);
  inputRef.current = input;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteSearch, setRemoteSearch] =
    useState<RemoteSearchSnapshot | null>(null);
  const [pendingSearchKey, setPendingSearchKey] = useState<string | null>(null);
  const [communitySearch, setCommunitySearch] =
    useState<CommunitySearchSnapshot | null>(null);
  const [pendingCommunityKey, setPendingCommunityKey] =
    useState<string | null>(null);

  const currentSearchTerm = open ? discoverySearchKey(query) : "";
  const currentSearchKey = currentSearchTerm
    ? discoveryViewerSearchKey(input.actorHandle, currentSearchTerm)
    : "";
  const currentCommunityKey =
    input.activeRoom === "communities" &&
    input.communityId &&
    discoverySearchKey(input.communityQuery)
      ? communitySearchKey(
          input.actorHandle,
          input.communityId,
          input.communityQuery
        )
      : "";

  const localResults = useMemo(
    () => localDiscoverySearch({
      items: input.items,
      profiles: input.profiles,
      query
    }),
    [input.items, input.profiles, query]
  );
  const searchResults = useMemo(
    () => reprojectDiscoveryProfiles(
      remoteSearch?.key === currentSearchKey
        ? remoteSearch.results
        : localResults,
      input.profiles
    ),
    [currentSearchKey, input.profiles, localResults, remoteSearch]
  );

  useEffect(() => {
    const searchTerm = open ? discoverySearchKey(query) : "";
    const requestKey = searchTerm
      ? discoveryViewerSearchKey(input.actorHandle, searchTerm)
      : "";
    if (!searchTerm) {
      setPendingSearchKey(null);
      return;
    }
    let cancelled = false;
    const abortController = new AbortController();
    const timer = window.setTimeout(() => {
      setPendingSearchKey(requestKey);
      const parameters = new URLSearchParams({
        q: searchTerm,
        limit: "16",
        actorHandle: inputRef.current.actorHandle
      });
      void requestSearch(parameters, abortController.signal)
        .then((data) => {
          if (cancelled) return;
          inputRef.current.mergeBoundedRead({
            items: data.posts,
            profiles: Object.fromEntries(
              data.profiles.map((person) => [person.handle, person])
            )
          });
          setRemoteSearch({
            key: requestKey,
            results: remoteDiscoverySearch(data, searchTerm)
          });
        })
        .catch(() => {
          if (!cancelled) setRemoteSearch(null);
        })
        .finally(() => {
          if (!cancelled) {
            setPendingSearchKey((current) =>
              current === requestKey ? null : current
            );
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      abortController.abort();
      setPendingSearchKey((current) =>
        current === requestKey ? null : current
      );
    };
  }, [input.actorHandle, open, query]);

  useEffect(() => {
    const communityId =
      input.activeRoom === "communities" ? input.communityId : null;
    const requestKey = communityId
      ? communitySearchKey(
          input.actorHandle,
          communityId,
          input.communityQuery
        )
      : "";
    if (!communityId || !discoverySearchKey(input.communityQuery)) {
      setPendingCommunityKey(null);
      return;
    }
    let cancelled = false;
    const abortController = new AbortController();
    const timer = window.setTimeout(() => {
      setPendingCommunityKey(requestKey);
      const parameters = new URLSearchParams({
        q: discoverySearchKey(input.communityQuery),
        limit: "50",
        communityId,
        actorHandle: inputRef.current.actorHandle
      });
      void requestSearch(parameters, abortController.signal)
        .then((data) => {
          if (cancelled) return;
          inputRef.current.mergeBoundedRead({
            items: data.posts,
            profiles: Object.fromEntries(
              data.profiles.map((person) => [person.handle, person])
            )
          });
          setCommunitySearch({
            key: requestKey,
            resultIds: data.posts.map((item) => item.id)
          });
        })
        .catch(() => {
          if (!cancelled) setCommunitySearch(null);
        })
        .finally(() => {
          if (!cancelled) {
            setPendingCommunityKey((current) =>
              current === requestKey ? null : current
            );
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      abortController.abort();
      setPendingCommunityKey((current) =>
        current === requestKey ? null : current
      );
    };
  }, [
    input.activeRoom,
    input.actorHandle,
    input.communityId,
    input.communityQuery
  ]);

  return {
    close: () => setOpen(false),
    communityResultIds:
      communitySearch?.key === currentCommunityKey
        ? communitySearch.resultIds
        : null,
    communitySearchLoading:
      Boolean(currentCommunityKey) &&
      pendingCommunityKey === currentCommunityKey,
    loading:
      Boolean(currentSearchKey) &&
      pendingSearchKey === currentSearchKey,
    open,
    openSearch: () => setOpen(true),
    query,
    results: searchResults,
    setOpen,
    setQuery
  };
};
