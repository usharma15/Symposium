import type { SearchResponseContract } from "@/packages/contracts/src";
import type { InquiryItem, ResearchProfile } from "@/lib/mockData";
import {
  cleanHandle,
  isDeletedPost,
  itemTimestampScore,
  normalizeSearchPhrase
} from "@/lib/symposiumCore";
import {
  searchableContentText
} from "@/features/discovery/discoveryPolicy";
import {
  communityPostIsExternallyDiscoverable
} from "@/features/communities/communityPolicy";
import { publicPostTitle } from "@/lib/postSemantics";

export type DiscoverySearchResults = {
  titleMatches: InquiryItem[];
  contentMatches: InquiryItem[];
  profileMatches: ResearchProfile[];
};

export const emptyDiscoverySearchResults = (): DiscoverySearchResults => ({
  titleMatches: [],
  contentMatches: [],
  profileMatches: []
});

export const discoverySearchKey = (query: string) => query.trim();

export const discoveryViewerSearchKey = (
  actorHandle: string,
  query: string
) => `${cleanHandle(actorHandle)}:${discoverySearchKey(query)}`;

const byPublishedRecency = (items: InquiryItem[]) =>
  [...items].sort(
    (left, right) => itemTimestampScore(right) - itemTimestampScore(left)
  );

const profileSearchText = (person: ResearchProfile) =>
  normalizeSearchPhrase([
    person.name,
    person.handle,
    person.role,
    person.location,
    person.bio,
    ...person.fields
  ].join(" "));

export const localDiscoverySearch = ({
  items,
  profiles,
  query
}: {
  items: InquiryItem[];
  profiles: Record<string, ResearchProfile>;
  query: string;
}): DiscoverySearchResults => {
  const term = normalizeSearchPhrase(query);
  if (!term) return emptyDiscoverySearchResults();
  const searchableItems = items.filter(
    (item) => !isDeletedPost(item) && communityPostIsExternallyDiscoverable(item)
  );
  const titleMatches = byPublishedRecency(
    searchableItems.filter((item) =>
      normalizeSearchPhrase(publicPostTitle(item)).includes(term)
    )
  );
  const titleIds = new Set(titleMatches.map((item) => item.id));
  const contentMatches = byPublishedRecency(
    searchableItems.filter((item) =>
      !titleIds.has(item.id) &&
      normalizeSearchPhrase(searchableContentText(item)).includes(term)
    )
  );
  const profileMatches = Object.values(profiles)
    .filter((person) => profileSearchText(person).includes(term))
    .slice(0, 8);
  return { titleMatches, contentMatches, profileMatches };
};

export const remoteDiscoverySearch = (
  response: Pick<SearchResponseContract, "posts" | "profiles">,
  query: string
): DiscoverySearchResults => {
  const term = normalizeSearchPhrase(query);
  const titleMatches = response.posts.filter((item) =>
    normalizeSearchPhrase(publicPostTitle(item)).includes(term)
  );
  const titleIds = new Set(titleMatches.map((item) => item.id));
  return {
    titleMatches,
    contentMatches: response.posts.filter((item) => !titleIds.has(item.id)),
    profileMatches: response.profiles
  };
};

export const reprojectDiscoveryProfiles = (
  results: DiscoverySearchResults,
  profiles: Record<string, ResearchProfile>
): DiscoverySearchResults => ({
  ...results,
  profileMatches: results.profileMatches.map(
    (person) => profiles[cleanHandle(person.handle)] ?? person
  )
});
