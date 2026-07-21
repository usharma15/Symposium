import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  inquiryItemSchema,
  researchCommunitySchema,
  researchProfileSchema
} from "../packages/contracts/src";
import { allHistoricalAssets } from "../lib/historicalWorld/assets";
import { historicalProfiles } from "../lib/historicalWorld/characters";
import { historicalCommunities } from "../lib/historicalWorld/communities";
import { historicalInquiryItems, historicalWorldCounts } from "../lib/historicalWorld/content";

assert.equal(historicalProfiles.length, 33, "The curated cast changed without updating the fixture review.");
assert.equal(new Set(historicalProfiles.map((person) => person.handle)).size, historicalProfiles.length, "Historical handles must be unique.");
for (const person of historicalProfiles) {
  researchProfileSchema.parse(person);
  assert.equal(person.actorKind, "historical_simulation");
  assert.match(person.disclosure ?? "", /newly authored|historical simulation/i);
  assert.ok((person.bio?.length ?? 0) >= 150, `${person.handle} needs a substantive profile biography.`);
  assert.ok(person.avatarUrl, `${person.handle} needs a recognisable portrait.`);
  assert.ok(person.sourceUrl, `${person.handle} needs a profile source.`);
}

assert.equal(historicalCommunities.length, 7);
for (const community of historicalCommunities) researchCommunitySchema.parse(community);

for (const entry of historicalInquiryItems) inquiryItemSchema.parse(entry);
assert.deepEqual(historicalWorldCounts, {
  profiles: 33,
  papers: 15,
  thoughts: 19,
  patronage: 3,
  opportunities: 3,
  comments: 116
});
assert.equal(historicalInquiryItems.length, 40);
assert.ok(historicalInquiryItems.every((entry) => Number.isFinite(Date.parse(entry.createdAt ?? ""))));
assert.ok(historicalInquiryItems.every((entry) => !/strategy\s*2032/i.test(`${entry.title} ${entry.body}`)));

const usedHandles = new Set<string>();
const visitComments = (comments: typeof historicalInquiryItems[number]["comments"]) => {
  for (const comment of comments) {
    if (comment.authorHandle) usedHandles.add(comment.authorHandle);
    visitComments(comment.replies ?? []);
  }
};
for (const entry of historicalInquiryItems) {
  if (entry.authorHandle) usedHandles.add(entry.authorHandle);
  visitComments(entry.comments);
}
assert.deepEqual(
  historicalProfiles.filter((person) => !usedHandles.has(person.handle)).map((person) => person.handle),
  [],
  "Every historical profile must author a post or comment."
);

const nodes = historicalInquiryItems.flatMap((entry) => entry.document?.nodes ?? []);
const textRuns = nodes.flatMap((node) =>
  node.type === "paragraph" || node.type === "heading" || node.type === "quote" ? node.content : []
);
assert.ok(nodes.filter((node) => node.type === "heading").length >= 20, "The corpus needs genuine section structure.");
assert.ok(nodes.filter((node) => node.type === "quote").length >= 20, "The corpus needs varied quotation blocks.");
assert.ok(nodes.filter((node) => node.type === "citation").length >= 8, "Paper records need source citations.");
assert.ok(textRuns.filter((run) => run.link).length >= 10, "The corpus needs real external links.");
for (const mark of ["bold", "italic", "underline"] as const) {
  assert.ok(textRuns.some((run) => run.marks?.includes(mark)), `The corpus needs ${mark} text.`);
}

assert.equal(allHistoricalAssets.filter((asset) => asset.kind === "pdf").length, 15);
assert.equal(allHistoricalAssets.filter((asset) => asset.kind === "image").length, 19);
assert.equal(new Set(allHistoricalAssets.map((asset) => asset.id)).size, allHistoricalAssets.length);
for (const asset of allHistoricalAssets) {
  const path = join(process.cwd(), "public", asset.staticPublicPath.replace(/^\//, ""));
  assert.ok(existsSync(path), `Missing bundled asset: ${path}`);
  assert.equal(statSync(path).size, asset.byteSize, `Byte-size drift for ${asset.fileName}`);
  assert.ok(!/strategy.*2032/i.test(asset.fileName));
}
assert.ok(!existsSync(join(process.cwd(), "public/historical-world/images/71baeb5b116f780a78c3edf795671b5e.jpg")));

const fixtureSource = readFileSync(join(process.cwd(), "apps/api/src/repository/historicalWorldFixtures.ts"), "utf8");
for (const requiredBoundary of [
  "historical_world_snapshots",
  "clerk_user_id IS NOT NULL",
  "historical_protected_handles",
  "Historical fixture handles collide with protected Clerk profiles",
  "strategy2032Included: false"
]) assert.ok(fixtureSource.includes(requiredBoundary), `Missing replacement safety boundary: ${requiredBoundary}`);

console.log(`historical world checks passed (${historicalProfiles.length} profiles, ${historicalInquiryItems.length} posts, ${historicalWorldCounts.comments} comments, ${allHistoricalAssets.length} assets)`);
