import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  discoverySearchKey,
  discoveryViewerSearchKey,
  emptyDiscoverySearchResults,
  localDiscoverySearch,
  remoteDiscoverySearch,
  reprojectDiscoveryProfiles
} from "@/features/discovery/discoveryModel";
import {
  inquiryItems,
  profile,
  seedProfiles,
  type InquiryItem,
  type ResearchProfile
} from "@/lib/mockData";
import { reportCheck } from "@/scripts/checkReport";

const sourceItem = inquiryItems[0]!;
const item = (
  id: string,
  overrides: Partial<InquiryItem> = {}
): InquiryItem => ({
  ...sourceItem,
  id,
  title: "",
  body: "",
  author: "Ada",
  affiliation: "",
  status: "",
  excerpt: "",
  tags: [],
  claims: [],
  objections: [],
  evidence: [],
  tests: [],
  forks: [],
  comments: [],
  communityId: undefined,
  deletedAt: undefined,
  createdAt: "2026-07-30T12:00:00.000Z",
  kind: "thought",
  postType: "thought",
  ...overrides
});

const titleOlder = item("title-older", {
  createdAt: "2026-07-28T12:00:00.000Z",
  kind: "paper",
  postType: "paper",
  title: "Alpha instrumentation"
});
const titleNewer = item("title-newer", {
  createdAt: "2026-07-30T12:00:00.000Z",
  kind: "paper",
  postType: "paper",
  title: "Alpha replication"
});
const contentMatch = item("content", {
  body: "The alpha result appears only in the body."
});
const hiddenCommunityThought = item("hidden-community", {
  body: "Alpha private room note",
  communityId: "private-room"
});
const publicCommunityPaper = item("community-paper", {
  body: "Alpha public paper body",
  communityId: "private-room",
  createdAt: "2026-07-29T12:00:00.000Z",
  kind: "paper",
  postType: "paper",
  title: "Community alpha paper"
});
const deleted = item("deleted", {
  body: "Alpha deleted result",
  deletedAt: "2026-07-30T12:05:00.000Z"
});

const profileMatches = seedProfiles().slice(0, 10);
const profiles = Object.fromEntries(
  profileMatches.map((person) => [person.handle, person])
);
const local = localDiscoverySearch({
  items: [
    titleOlder,
    contentMatch,
    hiddenCommunityThought,
    publicCommunityPaper,
    deleted,
    titleNewer
  ],
  profiles,
  query: "  ALPHA  "
});

assert.deepEqual(
  local.titleMatches.map((candidate) => candidate.id),
  ["title-newer", "community-paper", "title-older"],
  "local title matches must preserve published recency and public-paper discovery"
);
assert.deepEqual(
  local.contentMatches.map((candidate) => candidate.id),
  ["content"],
  "local content search must exclude private community thoughts and deleted work"
);
assert.deepEqual(
  localDiscoverySearch({
    items: [titleNewer],
    profiles: { [profile.handle]: profile },
    query: "independent   researcher"
  }).profileMatches.map((person) => person.handle),
  [profile.handle],
  "profile fallback search must normalize repeated whitespace"
);
assert.deepEqual(
  localDiscoverySearch({ items: [titleNewer], profiles, query: " " }),
  emptyDiscoverySearchResults(),
  "empty queries must not surface fallback results"
);

const remote = remoteDiscoverySearch({
  posts: [contentMatch, titleOlder, titleNewer],
  profiles: profileMatches.slice(0, 2)
}, "alpha");
assert.deepEqual(
  remote.titleMatches.map((candidate) => candidate.id),
  ["title-older", "title-newer"],
  "remote server ranking must be retained within the title group"
);
assert.deepEqual(
  remote.contentMatches.map((candidate) => candidate.id),
  ["content"],
  "remote non-title matches must remain in the content group"
);

const staleProfile = {
  ...profile,
  handle: "@current_researcher",
  name: "Stale name",
  revision: 1
} satisfies ResearchProfile;
const currentProfile = {
  ...staleProfile,
  name: "Current name",
  revision: 2
};
assert.equal(
  reprojectDiscoveryProfiles(
    { ...emptyDiscoverySearchResults(), profileMatches: [staleProfile] },
    { [currentProfile.handle]: currentProfile }
  ).profileMatches[0]?.name,
  "Current name",
  "visible search profiles must use the canonical current entity projection"
);
assert.equal(discoverySearchKey("  alpha  "), "alpha");
assert.notEqual(
  discoveryViewerSearchKey("@first", "alpha"),
  discoveryViewerSearchKey("@second", "alpha"),
  "remote-result keys must isolate authenticated viewers"
);

const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const controller = readFileSync(
  "features/discovery/useDiscoveryController.ts",
  "utf8"
);
const model = readFileSync("features/discovery/discoveryModel.ts", "utf8");
assert.match(shell, /useDiscoveryController\(\{/);
assert.doesNotMatch(shell, /\/api\/search|setRemoteSearchResults|localSearchResults/);
assert.match(controller, /\/api\/search\?\$\{parameters\.toString\(\)\}/);
assert.match(controller, /limit: "16"/);
assert.match(controller, /limit: "50"/);
assert.match(controller, /communityId/);
assert.match(controller, /new AbortController\(\)/);
assert.match(controller, /abortController\.abort\(\)/);
assert.match(controller, /inputRef\.current\.mergeBoundedRead/);
assert.match(controller, /remoteSearch\?\.key === currentSearchKey/);
assert.match(controller, /communitySearch\?\.key === currentCommunityKey/);
assert.match(controller, /discoveryViewerSearchKey/);
assert.match(model, /communityPostIsExternallyDiscoverable/);
assert.match(model, /reprojectDiscoveryProfiles/);

reportCheck([
  "normalized empty and profile fallback search",
  "local title and content partitioning",
  "published-recency fallback ordering",
  "private-community and deletion exclusion",
  "canonical public community Paper discovery",
  "remote ranking and title partition preservation",
  "canonical profile reprojection",
  "single controller API authority",
  "abortable and request-keyed global and community search",
  "bounded entity merge composition"
]);
