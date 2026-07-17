import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  communitySummaryMaxLength,
  communityMemberQuerySchema,
  createCommunityAnnouncementInputSchema,
  deleteCommunityAnnouncementInputSchema,
  createCommunityInputSchema,
  createPostInputSchema,
  removeCommunityMemberInputSchema,
  resolveCommunityRequestInputSchema,
  researchCommunitySchema,
  updateCommunityMemberInputSchema,
  updateCommunityAnnouncementInputSchema,
  updateCommunitySettingsInputSchema,
  type InquiryItemContract,
} from "../packages/contracts/src";
import {
  canViewCommunity,
  defaultCommunityFeedFilter,
  filterCommunityFeedItems,
  communityMembershipLabel,
  communityPostIsExternallyDiscoverable
} from "../features/communities/communityPolicy";
import { getCommunityItems } from "../features/discovery/discoveryPolicy";
import { communityViewerProjectionChanged, projectCommunityItemsForViewer } from "../lib/communityContentProjection";
import { communityActivityItems, researchCommunities } from "../lib/mockData";
import { listLocalCommunityMembers } from "../lib/localCommunityStore";
import { hiddenCommunityActivityCounts, profileCommentsArePubliclyListable, profileItemIsPubliclyListable } from "../lib/profileActivity";
import { activeCommunityAnnouncements, communityAnnouncementRetentionMs } from "../lib/communityAnnouncements";

const profile = { handle: "@viewer" };
const community = researchCommunitySchema.parse({
  id: "test-community",
  name: "Test Community",
  field: "Tests and verification",
  summary: "A community used to verify the shared construction path.",
  visibility: "private",
  online: 2,
  memberHandles: [],
  keywords: ["test"],
  seedCounts: { papers: 0, thoughts: 0, opportunities: 0 },
  callStatus: "quiet",
  membershipStatus: "none"
});

const item = (input: Partial<InquiryItemContract> & Pick<InquiryItemContract, "id" | "kind" | "postType" | "room" | "title">): InquiryItemContract => ({
  author: "Researcher",
  authorHandle: "@researcher",
  affiliation: "Test bench",
  date: "Now",
  status: "New",
  metrics: { signal: "0", critiques: "0", forks: "0", saves: "0", reads: "0" },
  gatheringReason: "Verification",
  excerpt: "Verification item",
  body: "Verification item body",
  tags: [],
  signals: [],
  claims: [],
  objections: [],
  evidence: [],
  tests: [],
  forks: [],
  comments: [],
  ...input
});

const privateThought = item({
  id: "private-thought",
  kind: "thought",
  postType: "thought",
  room: "amphitheater",
  title: "Private source",
  communityId: community.id
});
const publicPaper = item({
  id: "public-paper",
  kind: "paper",
  postType: "paper",
  room: "library",
  title: "Public paper",
  communityId: community.id,
  quote: {
    sourceType: "post",
    sourceId: privateThought.id,
    sourcePostId: privateThought.id,
    available: true,
    attachmentCount: 0
  },
  comments: [{
    id: "public-paper-comment",
    author: "Paper Commenter",
    authorHandle: "@paper-commenter",
    body: "This comment belongs to the paper's canonical public discussion.",
    stance: "comment",
    quote: {
      sourceType: "post",
      sourceId: privateThought.id,
      sourcePostId: privateThought.id,
      available: true,
      attachmentCount: 0
    },
    replies: [{
      id: "public-paper-reply",
      author: "Paper Replier",
      authorHandle: "@paper-replier",
      body: "The complete reply tree remains public with the paper.",
      stance: "reply"
    }]
  }, {
    id: "quoted-paper-comment",
    author: "Paper Quoter",
    authorHandle: "@paper-quoter",
    body: "Comments from a paper discussion are themselves public quote sources.",
    stance: "comment",
    quote: {
      sourceType: "comment",
      sourceId: "public-paper-comment",
      sourcePostId: "public-paper",
      available: true,
      attachmentCount: 0
    },
    replies: []
  }]
});
const privateCommentSource = item({
  id: "private-comment-source",
  kind: "thought",
  postType: "thought",
  room: "amphitheater",
  title: "Private comment context",
  communityId: community.id,
  comments: [{
    id: "private-cited-comment",
    author: "Comment Author",
    authorHandle: "@comment-author",
    body: "Only this cited comment should survive the private projection.",
    stance: "note",
    replies: [{
      id: "private-hidden-reply",
      author: "Hidden Reply Author",
      body: "This reply is community context and must stay hidden.",
      stance: "reply"
    }]
  }]
});
const commentCitingPaper = item({
  id: "comment-citing-paper",
  kind: "paper",
  postType: "paper",
  room: "library",
  title: "Paper citing a private comment",
  communityId: community.id,
  quote: {
    sourceType: "comment",
    sourceId: "private-cited-comment",
    sourcePostId: privateCommentSource.id,
    available: true,
    attachmentCount: 0
  }
});

assert.equal(canViewCommunity(community, profile), false, "Private communities must remain closed to non-members.");
assert.equal(communityMembershipLabel(community, profile), "Request to join");
assert.equal(communityPostIsExternallyDiscoverable(privateThought), false, "Community thoughts must not enter external discovery.");
assert.equal(communityPostIsExternallyDiscoverable(publicPaper), true, "Community papers must remain globally discoverable.");
assert.deepEqual(getCommunityItems([privateThought, publicPaper], community).map((entry) => entry.id), [privateThought.id, publicPaper.id], "Community feeds must use explicit community identity.");

const projected = projectCommunityItemsForViewer([privateThought, publicPaper], [community]);
assert.deepEqual(projected.map((entry) => entry.id), [privateThought.id, publicPaper.id], "A paper-cited private source must remain directly available.");
assert.equal(projected[0]?.communityAccess, "citation-only", "Private cited sources must be non-interactive projections.");
assert.equal(projected[1]?.communityAccess, "full", "Papers must retain full public access.");
assert.equal(projected[1]?.comments.length, 2, "A private-community paper's complete discussion must remain public.");
assert.equal(projected[1]?.comments[0]?.replies?.length, 1, "A private-community paper's nested replies must remain public.");
assert.equal(projected[1]?.comments[0]?.quote?.available, false, "Private non-paper material quoted inside a public paper comment must be unavailable externally.");
assert.equal(projected[1]?.comments[1]?.quote?.available, true, "Comments in a public paper discussion must remain available as quote sources.");
assert.equal(
  communityViewerProjectionChanged({ ...projected[1]!, comments: [] }, projected[1]!),
  true,
  "Equal-revision cached items must not mask a newly public paper discussion projection."
);

const ownerProjected = projectCommunityItemsForViewer([privateThought, publicPaper], [community], "@researcher");
assert.equal(ownerProjected.find((entry) => entry.id === privateThought.id)?.communityAccess, "activity-only", "Users must retain their own private-community profile activity.");
assert.equal(projectCommunityItemsForViewer([privateThought], [{ ...community, visibility: "public" }])[0]?.communityAccess, "full", "Current public visibility must immediately restore normal access.");
assert.equal(projectCommunityItemsForViewer([privateThought], [{ ...community, visibility: "private" }]).length, 0, "Current private visibility must immediately remove external profile activity.");

const externalQuoteOwner = item({
  id: "external-quote-owner",
  kind: "thought",
  postType: "thought",
  room: "amphitheater",
  title: "External quote owner",
  comments: [{
    id: "external-private-quote",
    author: "External Commenter",
    authorHandle: "@external",
    body: "A comment quoting private community content.",
    stance: "comment",
    quote: { sourceType: "post", sourceId: privateThought.id, sourcePostId: privateThought.id, available: true, attachmentCount: 0 },
    replies: []
  }, {
    id: "external-paper-quote",
    author: "External Commenter",
    authorHandle: "@external",
    body: "A comment quoting a permanently public paper.",
    stance: "comment",
    quote: { sourceType: "post", sourceId: publicPaper.id, sourcePostId: publicPaper.id, available: true, attachmentCount: 0 },
    replies: []
  }]
});
const externalQuoteProjection = projectCommunityItemsForViewer([privateThought, publicPaper, externalQuoteOwner], [community]);
assert.equal(externalQuoteProjection.find((entry) => entry.id === externalQuoteOwner.id)?.comments[0]?.quote?.available, false, "Comments must flatten quotes from current private non-paper community content.");
assert.equal(externalQuoteProjection.find((entry) => entry.id === externalQuoteOwner.id)?.comments[1]?.quote?.available, true, "Quoted papers must remain available regardless of community visibility.");

const commentProjected = projectCommunityItemsForViewer([privateCommentSource, commentCitingPaper], [community]);
const citedCommentSource = commentProjected.find((entry) => entry.id === privateCommentSource.id);
assert.equal(citedCommentSource?.title, "Cited community comment", "A private cited comment must not reveal its parent post context.");
assert.equal(citedCommentSource?.authorHandle, "@comment-author", "A private cited comment may reveal only its own author.");
assert.equal(citedCommentSource?.body, "", "A private cited comment must not reveal the parent post body.");
assert.deepEqual(citedCommentSource?.comments.map((comment) => comment.id), ["private-cited-comment"], "Only the exact cited comment may remain visible.");
assert.deepEqual(citedCommentSource?.comments[0]?.replies, [], "Replies around a cited private comment must remain hidden.");

assert.equal(createCommunityInputSchema.safeParse({
  name: "New Bench",
  field: "Instrument tests",
  summary: "A place to test instruments together.",
  visibility: "public"
}).success, true);
assert.equal(updateCommunitySettingsInputSchema.safeParse({ communityId: community.id, visibility: "public", expectedRevision: 1 }).success, true);
assert.equal(updateCommunityMemberInputSchema.safeParse({ communityId: community.id, memberHandle: "@member", role: "moderator", expectedRevision: 1 }).success, true);
assert.equal(removeCommunityMemberInputSchema.safeParse({ communityId: community.id, memberHandle: "@member", expectedRevision: 1 }).success, true);
assert.equal(createCommunityAnnouncementInputSchema.safeParse({ communityId: community.id, title: "New review", body: "The next review has opened.", expectedRevision: 1 }).success, true);
assert.equal(updateCommunityAnnouncementInputSchema.safeParse({ communityId: community.id, announcementId: "announcement-1", title: "Updated review", body: "The review time changed.", expectedRevision: 2 }).success, true);
assert.equal(deleteCommunityAnnouncementInputSchema.safeParse({ communityId: community.id, announcementId: "announcement-1", expectedRevision: 3 }).success, true);
const retentionNow = Date.parse("2026-07-16T12:00:00.000Z");
const retainedAnnouncements = activeCommunityAnnouncements([
  { id: "active", title: "Active", body: "Still here", createdAt: new Date(retentionNow - communityAnnouncementRetentionMs + 1).toISOString() },
  { id: "expired", title: "Expired", body: "Gone", createdAt: new Date(retentionNow - communityAnnouncementRetentionMs).toISOString() },
  { id: "undated", title: "Undated", body: "Invalid legacy record" }
], retentionNow);
assert.deepEqual(retainedAnnouncements.map((announcement) => announcement.id), ["active"], "Announcements must disappear exactly 30 days after original publication, and undated records must fail closed.");
assert.equal(createCommunityInputSchema.safeParse({ name: "Too long", field: "Tests", summary: "x".repeat(communitySummaryMaxLength + 1), visibility: "public" }).success, false, "Community descriptions must obey the visible three-line character budget.");

const basePost = {
  title: "Community paper",
  body: "A fully public paper from a community.",
  kind: "paper" as const,
  postType: "paper" as const,
  authorHandle: "@viewer",
  communityId: community.id,
  attachmentIds: [],
  attachments: []
};
assert.equal(createPostInputSchema.safeParse({ ...basePost, room: "library" }).success, true);
assert.equal(createPostInputSchema.safeParse({ ...basePost, room: "amphitheater" }).success, false, "Community papers must publish in the Library.");

const filterItems = [
  item({ id: "filter-thought", kind: "thought", postType: "thought", room: "amphitheater", title: "Thought", createdAt: "2026-07-16T12:00:00.000Z" }),
  item({ id: "filter-paper", kind: "paper", postType: "paper", room: "library", title: "Paper", createdAt: "2026-07-15T12:00:00.000Z", metrics: { signal: "40", critiques: "0", forks: "8", saves: "12", reads: "800" } }),
  item({ id: "filter-proposal", kind: "paper", postType: "proposal", room: "funding", title: "Proposal", createdAt: "2026-07-14T12:00:00.000Z" })
];
assert.deepEqual(filterCommunityFeedItems(filterItems, defaultCommunityFeedFilter).map((entry) => entry.id), ["filter-thought", "filter-paper", "filter-proposal"]);
assert.deepEqual(filterCommunityFeedItems(filterItems, { ...defaultCommunityFeedFilter, content: "proposal" }).map((entry) => entry.id), ["filter-proposal"]);
assert.equal(filterCommunityFeedItems(filterItems, { content: "all", sort: "popular", popularityWindow: "week" }, Date.parse("2026-07-16T13:00:00.000Z"))[0]?.id, "filter-paper");

for (const seededCommunity of researchCommunities) {
  assert.ok((seededCommunity.memberCount ?? 0) >= 30, `${seededCommunity.name} needs a substantial seeded roster.`);
  assert.ok((seededCommunity.moderatorHandles?.length ?? 0) >= 3, `${seededCommunity.name} needs visible moderators.`);
  assert.ok((seededCommunity.announcements?.length ?? 0) >= 6, `${seededCommunity.name} needs active announcements.`);
  assert.ok((seededCommunity.guidelines?.length ?? 0) >= 300, `${seededCommunity.name} needs useful guidelines.`);
  const activity = communityActivityItems.filter((entry) => entry.communityId === seededCommunity.id);
  assert.ok(activity.length >= 6, `${seededCommunity.name} needs a substantial community feed.`);
  for (const postType of ["paper", "thought", "proposal", "opportunity"] as const) {
    assert.ok(activity.some((entry) => entry.postType === postType), `${seededCommunity.name} needs ${postType} activity.`);
  }
  assert.ok(activity.every((entry) => entry.comments.length >= 3), `${seededCommunity.name} activity needs real discussion.`);
  assert.ok(activity.every((entry) => Boolean(entry.quote)), `${seededCommunity.name} activity needs quote trails.`);
  assert.ok(activity.every((entry) => (entry.signaledBy?.length ?? 0) >= 8 && (entry.savedBy?.length ?? 0) >= 5 && (entry.forkedBy?.length ?? 0) >= 3), `${seededCommunity.name} activity needs likes, saves, and reshares.`);
}

const privateCommunity = researchCommunities.find((entry) => entry.visibility === "private")!;
const privateActivity = communityActivityItems.filter((entry) => entry.communityId === privateCommunity.id);
const seededPrivateThought = privateActivity.find((entry) => entry.postType === "thought")!;
const seededPrivatePaper = privateActivity.find((entry) => entry.postType === "paper")!;
assert.equal(profileItemIsPubliclyListable(seededPrivateThought, researchCommunities), false, "Private community activity must never enter public profile lists.");
assert.equal(profileItemIsPubliclyListable(seededPrivatePaper, researchCommunities), true, "Private-community papers must remain profile-visible.");
assert.equal(profileCommentsArePubliclyListable(seededPrivatePaper, researchCommunities), true, "Private-community paper discussions must remain visible on public profiles.");
assert.equal(profileItemIsPubliclyListable({ ...seededPrivateThought, communityId: "missing-community" }, researchCommunities), false, "Unknown community state must fail closed on public profiles.");
const privateActor = seededPrivateThought.authorHandle!;
const hiddenCounts = hiddenCommunityActivityCounts(communityActivityItems, researchCommunities, privateActor);
assert.ok(hiddenCounts.all > 0 && hiddenCounts.thoughts > 0, "Hidden private activity must still advance public profile totals.");
const privatePaperCommentActor = seededPrivatePaper.comments[0]!.authorHandle!;
assert.equal(
  hiddenCommunityActivityCounts([seededPrivatePaper], researchCommunities, privatePaperCommentActor).comments,
  0,
  "Comments around private-community papers must enter public profile lists instead of hidden-count compensation."
);

const main = async () => {
const firstCommunity = researchCommunities[0]!;
const firstMemberPage = await listLocalCommunityMembers(firstCommunity.id, "@udayan", { q: "", limit: 8, role: "all", status: "active" });
assert.equal(firstMemberPage.members.length, 8, "Member directories must load bounded pages.");
assert.ok(firstMemberPage.nextCursor, "Substantial communities must expose a continuation cursor.");
assert.ok(firstMemberPage.members.every((member, index, members) => index === 0 || members[index - 1]!.joinedAt >= member.joinedAt), "Members must be ordered by newest join date.");
const moderatorPage = await listLocalCommunityMembers(firstCommunity.id, "@udayan", { q: "", limit: 20, role: "moderators", status: "active" });
assert.ok(moderatorPage.members.every((member) => member.role === "owner" || member.role === "moderator"), "Moderator directories must not leak ordinary member rows.");
assert.equal(communityMemberQuerySchema.parse({ status: "requested" }).status, "requested", "Join-request pagination must have an explicit request status.");
assert.equal(resolveCommunityRequestInputSchema.parse({ communityId: firstCommunity.id, memberHandle: "@requester", decision: "approve", expectedRevision: 1 }).decision, "approve", "Join-request decisions must be revision guarded.");

const sources = await Promise.all([
  readFile(new URL("../features/communities/CommunityViews.tsx", import.meta.url), "utf8"),
  readFile(new URL("../features/communities/CommunityFeedFilterModal.tsx", import.meta.url), "utf8"),
  readFile(new URL("../features/communities/CommunityPeopleModal.tsx", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/repository/communities.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/repository/foundation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/communities/[id]/membership/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../components/SymposiumV0.tsx", import.meta.url), "utf8"),
  readFile(new URL("../features/posts/PostViews.tsx", import.meta.url), "utf8"),
  readFile(new URL("../features/profiles/ProfileViews.tsx", import.meta.url), "utf8"),
  readFile(new URL("../styles/89-communities.css", import.meta.url), "utf8"),
  readFile(new URL("../styles/89-community-activity.css", import.meta.url), "utf8"),
  readFile(new URL("../lib/localCommunityStore.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/services/contentQuotes.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/communities/[id]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/repository/comments.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/repository/posts.ts", import.meta.url), "utf8"),
  readFile(new URL("../features/navigation/viewState.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/repository/communityMembers.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/repository/communityAuthorization.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/repository/communityAnnouncements.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/communities/[id]/announcements/[announcementId]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../styles/89-community-announcements.css", import.meta.url), "utf8"),
  readFile(new URL("../app/api/communities/[id]/requests/[handle]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/api/src/repository/communityRequests.ts", import.meta.url), "utf8")
]);
const [views, filterModal, peopleModal, repository, foundation, membershipRoute, shell, postViews, profileViews, communityStyles, communityActivityStyles, localStore, quoteService, communityRoute, commentsRepository, postsRepository, viewState, communityMembersRepository, communityAuthorization, announcementRepository, announcementRoute, announcementStyles, requestRoute, communityRequestsRepository] = sources;
assert.match(views, /communityMembershipLabel/, "The selected view must use one canonical membership control.");
assert.match(views, /Create community/, "The directory must expose community creation.");
assert.match(views, /Events & calls/, "The active right rail must expose events and calls.");
assert.doesNotMatch(views, /community-people-panel/, "Member and moderator lists must not consume the fixed right rail.");
assert.match(views, /setPeopleOpen\("members"\)/, "The member count must open the searchable member directory.");
assert.match(views, /setPeopleOpen\("moderators"\)/, "Contact moderators must open the moderator directory.");
assert.match(peopleModal, /nextCursor/, "Community people must use cursor pagination instead of loading an unbounded roster.");
assert.match(peopleModal, /Quick search members/, "The member directory must expose quick search.");
assert.match(peopleModal, /Make moderator/, "Managers must be able to promote ordinary members from the member directory.");
assert.match(peopleModal, /Remove member/, "Managers must be able to remove ordinary members from the member directory.");
assert.match(views, /setPeopleOpen\("requests"\)/, "Private-community managers need a dedicated join-request entry point.");
assert.match(peopleModal, /Newest requests first/, "Join requests must use the paginated people directory in newest-first order.");
assert.match(peopleModal, /Approve join request/, "Managers must be able to approve join requests.");
assert.match(peopleModal, /Decline join request/, "Managers must be able to decline join requests.");
assert.match(requestRoute, /export async function PATCH/, "Join-request decisions need a revision-guarded Next route.");
assert.match(communityRequestsRepository, /resolveCommunityRequest/, "Join-request decisions must persist through the live repository.");
assert.match(localStore, /resolveLocalCommunityRequest/, "Join-request decisions must persist through the local canonical store.");
assert.match(communityStyles, /community-invite-row\.has-requests[\s\S]+repeat\(2/, "Invite and Requests must share the final left-rail row.");
assert.match(filterModal, /Hot right now/, "Community feed filtering must expose a real heat ranking.");
assert.match(repository, /assertCommunityParticipation/, "Community writes must enforce active participation.");
assert.match(communityMembersRepository, /last_accessed_at/, "Recent community access must persist server-side.");
assert.match(foundation, /projectCommunityItemsForViewer/, "Bootstrap delivery must use the canonical current-state community projection.");
assert.match(foundation, /syncCommunityActivityFixtures/, "Community activity fixtures must hydrate the durable live backend.");
assert.match(foundation, /fixture_revisions/, "Community activity enrichment must not rerun on every backend cold start.");
assert.match(foundation, /communityCalls/, "Canonical bootstrap refreshes must reconcile community calls.");
assert.match(foundation, /communities-content-v1/, "Rich community content must hydrate the durable backend exactly once.");
assert.match(foundation, /community\.memberHandles\.slice\(0, communityMemberPreviewLimit\)/, "General bootstrap delivery must cap member previews; the directory endpoint owns full pagination.");
assert.match(membershipRoute, /action === "leave"/, "The single membership control must support leave through the same client route.");
assert.match(shell, /selectedCommunity && canParticipateInCommunity/, "The global composer must default to the selected community when participation is allowed.");
assert.match(shell, /<ProfileView[\s\S]+items=\{items\}/, "Profiles must receive the complete viewer-projected item collection rather than a global-feed subset.");
assert.match(postViews, /Post destination/, "The global composer must allow switching between community and global publication.");
assert.match(postViews, /className="profile-community-provenance"/, "Profile post provenance must render in the post header actions.");
assert.match(profileViews, /className="profile-community-provenance"/, "Profile comment provenance must render in the comment header actions.");
assert.match(communityActivityStyles, /\.profile-community-provenance[\s\S]+margin:\s*0 0 0 auto/, "Profile community provenance must stay aligned at the top right.");
assert.doesNotMatch(communityStyles, /data-room=\"communities\"[^}]+display:\s*none/, "Communities must never hide the global bottom launchers.");
assert.match(localStore, /version: 5/, "Existing local community state must migrate to governance-aware communities.");
assert.match(localStore, /updateLocalCommunitySettings/, "Local community settings must persist through the canonical store.");
assert.match(localStore, /updateLocalCommunityMember/, "Local member roles must persist through the canonical store.");
assert.match(localStore, /createLocalCommunityAnnouncement/, "Local announcements must persist through the canonical store.");
assert.match(localStore, /updateLocalCommunityAnnouncement/, "Local announcement edits must persist through the canonical store.");
assert.match(localStore, /deleteLocalCommunityAnnouncement/, "Local announcement deletions must persist through the canonical store.");
assert.match(repository, /community\.settings\.update/, "Live community settings changes must be audited.");
assert.match(repository, /community\.settings\.updated/, "Live community settings changes must invalidate every connected projection.");
assert.match(repository, /community\.member\.role\.update/, "Live member promotions must be audited.");
assert.match(announcementRepository, /community\.announcement\.create/, "Live announcement creation must be audited.");
assert.match(announcementRepository, /community\.announcement\.update/, "Live announcement edits must be audited.");
assert.match(announcementRepository, /community\.announcement\.delete/, "Live announcement deletions must be audited.");
assert.doesNotMatch(foundation, /jsonb_array_length\(community\.announcements\) < 4/, "Backend seeding must never resurrect deleted announcements.");
assert.match(foundation, /activeCommunityAnnouncements\(community\.announcements\)/, "Expired announcements must be filtered from backend projections.");
assert.match(announcementRoute, /export async function PATCH/, "Announcement edits need a revision-guarded Next route.");
assert.match(announcementRoute, /export async function DELETE/, "Announcement deletion needs a revision-guarded Next route.");
assert.match(communityRoute, /export async function PATCH/, "Community settings need a revision-guarded Next route.");
assert.match(views, /community-visibility-modal/, "Owners and moderators need explicit current-state visibility controls.");
assert.match(views, /communitySummaryMaxLength/, "Community create and edit surfaces must expose the canonical description limit.");
assert.match(views, /setAnnouncementComposerOpen\(true\)/, "Managers must have a fixed announcement composer entry point.");
assert.match(views, /community-announcement-card/, "Announcements in the right rail must open a focused viewer.");
assert.match(views, /community-announcement-viewer/, "Announcements need a dedicated viewing window.");
assert.match(views, /onUpdateAnnouncement/, "Managers need an announcement edit control.");
assert.match(views, /onDeleteAnnouncement/, "Managers need an announcement delete control.");
assert.match(announcementStyles, /community-announcement-card strong[\s\S]+-webkit-line-clamp:\s*1/, "Announcement titles must stay to one compact preview line.");
assert.match(announcementStyles, /community-announcement-card p[\s\S]+-webkit-line-clamp:\s*3/, "Announcement bodies must stay to a three-line preview.");
assert.match(views, /community-announcement-header-actions/, "Announcement manager controls belong in the viewer header.");
assert.match(views, /community-call-viewer/, "Full event and call titles need a focused viewing window.");
assert.match(communityStyles, /community-calls-panel article strong[\s\S]+white-space:\s*nowrap/, "Event and call titles must stay to one compact preview line.");
assert.match(views, /name[\s\S]+summary[\s\S]+guidelines[\s\S]+visibility/, "The edit-community mutation must expose current public or private access.");
assert.match(communityStyles, /community-summary-field textarea[\s\S]+resize:\s*none/, "The community bio editor must remain a fixed three-line field.");
assert.match(communityStyles, /-webkit-line-clamp:\s*3/, "Selected community descriptions must allow three compact lines.");
assert.match(communityStyles, /\.selected-community-right \.community-activity-panel[\s\S]+border-top:\s*0/, "The first right-rail activity section must not waste space on a top divider.");
assert.match(shell, /returnToDetailOrigin/, "Post details must expose a stable return to the source space.");
assert.match(shell, /detailOriginFromSnapshot/, "The first detail hop must capture the complete source view.");
assert.match(viewState, /DetailOriginSnapshot/, "Canonical view state must preserve a stable detail-journey origin.");
assert.match(postsRepository, /assertCommunityPostDeletion/, "Community post deletion must use the canonical manager authorization boundary.");
assert.match(commentsRepository, /assertCommunityCommentDeletion/, "Community comment deletion must use the canonical manager authorization boundary.");
assert.match(communityAuthorization, /item\.postType === "paper"/, "Community managers must never acquire delete authority over core paper posts.");
assert.match(quoteService, /Private community content can only be quoted inside that community or cited by a public paper/, "Private quote sources need one canonical destination boundary.");
assert.match(quoteService, /source\.postType === "paper"/, "Paper posts and their comments must remain public quote sources.");
assert.equal(
  (commentsRepository.match(/communityEventScope\(client, [^)]+postType === "paper" \? null/g) ?? []).length,
  4,
  "Paper comment creation, editing, deletion, and actions must all publish through the public live-event scope."
);

console.log("community construction checks passed");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
