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

const foundationSource = readFileSync(join(process.cwd(), "apps/api/src/repository/foundation.ts"), "utf8");

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
  thoughts: 75,
  patronage: 3,
  opportunities: 3,
  comments: 287
});
assert.equal(historicalInquiryItems.length, 96);
assert.match(
  foundationSource,
  /era:\s*person\.era\s*\?\?\s*undefined[\s\S]+lifeDates:\s*person\.lifeDates\s*\?\?\s*undefined/,
  "Nullable database metadata must be omitted from non-historical profile payloads."
);
assert.match(
  foundationSource,
  /const seedDatabase = async \(\) => \{\s*if \(!hasDatabase\(\)\) return;/,
  "The approved one-time historical replacement must not be disabled by the legacy seed flag."
);
assert.ok(historicalInquiryItems.every((entry) => Number.isFinite(Date.parse(entry.createdAt ?? ""))));
assert.ok(historicalInquiryItems.every((entry) => !/strategy\s*2032/i.test(`${entry.title} ${entry.body}`)));

const usedHandles = new Set<string>();
const knownHandles = new Set(historicalProfiles.map((person) => person.handle));
const actionCounts = new Map<string, number>();
const countActions = (handles: string[] | undefined) => handles?.forEach((handle) => {
  assert.ok(knownHandles.has(handle), `Unknown historical action actor: ${handle}`);
  actionCounts.set(handle, (actionCounts.get(handle) ?? 0) + 1);
});
const visitComments = (comments: typeof historicalInquiryItems[number]["comments"]) => {
  for (const comment of comments) {
    if (comment.authorHandle) {
      assert.ok(knownHandles.has(comment.authorHandle), `Unknown historical comment author: ${comment.authorHandle}`);
      usedHandles.add(comment.authorHandle);
    }
    assert.ok((comment.signaledBy?.length ?? 0) >= 7, `${comment.id} needs realistic comment likes.`);
    assert.ok((comment.savedBy?.length ?? 0) >= 3, `${comment.id} needs realistic comment saves.`);
    assert.ok((comment.forkedBy?.length ?? 0) >= 2, `${comment.id} needs realistic comment reshares.`);
    countActions(comment.signaledBy);
    countActions(comment.savedBy);
    countActions(comment.forkedBy);
    visitComments(comment.replies ?? []);
  }
};
for (const entry of historicalInquiryItems) {
  if (entry.authorHandle) {
    assert.ok(knownHandles.has(entry.authorHandle), `Unknown historical post author: ${entry.authorHandle}`);
    usedHandles.add(entry.authorHandle);
  }
  assert.ok((entry.signaledBy?.length ?? 0) >= 20, `${entry.id} needs realistic post likes.`);
  assert.ok((entry.savedBy?.length ?? 0) >= 12, `${entry.id} needs realistic post saves.`);
  assert.ok((entry.forkedBy?.length ?? 0) >= 6, `${entry.id} needs realistic post reshares.`);
  countActions(entry.signaledBy);
  countActions(entry.savedBy);
  countActions(entry.forkedBy);
  visitComments(entry.comments);
}
assert.deepEqual(
  historicalProfiles.filter((person) => !usedHandles.has(person.handle)).map((person) => person.handle),
  [],
  "Every historical profile must author a post or comment."
);
assert.deepEqual(
  historicalProfiles.filter((person) => (actionCounts.get(person.handle) ?? 0) < 100).map((person) => person.handle),
  [],
  "Every historical profile needs a substantial like, save, and reshare trail."
);
assert.equal(
  historicalInquiryItems.filter((entry) => entry.id.startsWith("casual-") || entry.id.startsWith("community-") || entry.id.startsWith("symposium-")).length,
  56,
  "The casual activity layer changed without review."
);
const casualAuthorHandles = new Set(
  historicalInquiryItems
    .filter((entry) => entry.id.startsWith("casual-") || entry.id.startsWith("community-") || entry.id.startsWith("symposium-"))
    .map((entry) => entry.authorHandle)
);
assert.deepEqual(
  historicalProfiles.filter((person) => !casualAuthorHandles.has(person.handle)).map((person) => person.handle),
  [],
  "Every historical profile needs authored casual activity."
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
const normalizedPaperFileNames = [
  "plato-ion.pdf",
  "meitner-frisch-disintegration-uranium.pdf",
  "watson-crick-molecular-structure-nucleic-acids.pdf",
  "heisenberg-quantum-theoretical-kinematics.pdf",
  "feynman-space-time-approach-qm.pdf",
  "godel-incompleteness.pdf",
  "nash-equilibrium-points-n-person-games.pdf"
] as const;
for (const fileName of normalizedPaperFileNames) {
  const asset = allHistoricalAssets.find((entry) => entry.fileName === fileName);
  assert.ok(asset, `Missing normalized paper asset: ${fileName}`);
  const editionNote = asset.metadata?.editionNote;
  if (typeof editionNote !== "string") throw new Error(`Missing edition note for normalized paper: ${fileName}`);
  assert.match(editionNote, /clean reading edition|browser-compatible RGB reproduction/i);
}
for (const fileName of normalizedPaperFileNames.filter((name) => name !== "plato-ion.pdf")) {
  assert.equal(
    allHistoricalAssets.find((asset) => asset.fileName === fileName)?.metadata?.searchableEdition,
    false,
    `${fileName} must disclose that its compatibility reproduction is image-based.`
  );
}
const normalizationSource = readFileSync(join(process.cwd(), "scripts/normalizeHistoricalPapers.py"), "utf8");
for (const requiredCompatibilityGuard of [
  "COMPATIBILITY_PAPERS",
  "MINIMUM_PAGE_INK_RATIO",
  "page_ink_ratio",
  "validate_compatibility_pdf",
  "/DCTDecode",
  "/DeviceRGB"
]) assert.ok(
  normalizationSource.includes(requiredCompatibilityGuard),
  `Missing historical PDF compatibility guard: ${requiredCompatibilityGuard}`
);
for (const fileName of normalizedPaperFileNames.filter((name) => name !== "plato-ion.pdf")) {
  assert.ok(normalizationSource.includes(fileName), `${fileName} is not covered by the reproducible PDF compatibility pass.`);
}
assert.ok(!existsSync(join(process.cwd(), "public/historical-world/images/71baeb5b116f780a78c3edf795671b5e.jpg")));

const fixtureSource = readFileSync(join(process.cwd(), "apps/api/src/repository/historicalWorldFixtures.ts"), "utf8");
const localStoreSource = readFileSync(join(process.cwd(), "lib/dataStore.ts"), "utf8");
for (const requiredBoundary of [
  "historical_world_snapshots",
  "clerk_user_id IS NOT NULL",
  "historical_protected_handles",
  "historical_preserved_comment_lineage",
  "Historical fixture handles collide with protected Clerk profiles",
  "strategy2032Included: false",
  "INNER JOIN historical_protected_handles action_actor",
  "INNER JOIN historical_protected_handles view_actor",
  "comment.saved_by ? protected_action.handle"
]) assert.ok(fixtureSource.includes(requiredBoundary), `Missing replacement safety boundary: ${requiredBoundary}`);
assert.match(fixtureSource, /historical-world-v2-casual-activity/);
assert.match(localStoreSource, /historical-world-v2-casual-activity/);
assert.match(fixtureSource, /historical-world-assets-v1-pdfjs-compatibility/);
assert.match(fixtureSource, /syncHistoricalWorldAssetFixtures/);
assert.match(fixtureSource, /await upsertHistoricalAttachments\(client\)/);
assert.match(fixtureSource, /INSERT INTO comment_actions/);
assert.match(fixtureSource, /ON CONFLICT \(id\) DO UPDATE SET[\s\S]+author_handle = EXCLUDED\.author_handle/);

console.log(`historical world checks passed (${historicalProfiles.length} profiles, ${historicalInquiryItems.length} posts, ${historicalWorldCounts.comments} comments, ${allHistoricalAssets.length} assets)`);
