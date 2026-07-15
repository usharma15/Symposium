import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPostInputSchema,
  createWorkspaceDocumentInputSchema,
  patronageContributionSchema,
  patronageProposalInputSchema,
  patronageProposalSchema
} from "@/packages/contracts/src";
import { parseCanonicalRoute } from "@/features/navigation/canonicalRoute";
import { roomForCanonicalRoute } from "@/features/navigation/viewState";
import { emptySymposiumDocument } from "@/lib/documentModel";
import { inquiryItems } from "@/lib/mockData";

const main = async () => {
const proposal = {
  status: "open" as const,
  currency: "USD" as const,
  goalMinorUnits: 2_500_000,
  deadline: "2026-12-01"
};

assert.deepEqual(patronageProposalInputSchema.parse(proposal), proposal);
assert.deepEqual(
  patronageProposalSchema.parse({ ...proposal, raisedMinorUnits: 0, supporterCount: 0, topSupporters: [] }),
  { ...proposal, raisedMinorUnits: 0, supporterCount: 0, topSupporters: [] }
);
assert.ok(patronageContributionSchema.safeParse({
  id: "4a9fcab2-995e-4f75-9fb0-5314c247bf33",
  postId: "proposal-one",
  contributorHandle: null,
  displayName: "Anonymous",
  amountMinorUnits: 5000,
  currency: "USD",
  anonymous: true,
  provider: "stripe",
  status: "confirmed",
  createdAt: "2026-07-15T12:00:00.000Z",
  confirmedAt: "2026-07-15T12:00:00.000Z"
}).success);

const postBase = {
  title: "An exact proposal",
  body: "A concrete research plan with methods, milestones, risks, and a public budget.",
  kind: "paper" as const,
  room: "funding" as const,
  attachments: []
};
assert.ok(createPostInputSchema.safeParse({ ...postBase, patronage: proposal }).success);
assert.equal(createPostInputSchema.safeParse(postBase).success, false, "Funding posts must include proposal metadata");
assert.equal(
  createPostInputSchema.safeParse({ ...postBase, room: "library", patronage: proposal }).success,
  false,
  "Proposal metadata must stay inside the Patronage Hall"
);

const workspaceProposal = {
  title: "Proposal draft",
  body: "Draft body",
  document: emptySymposiumDocument(),
  kind: "paper" as const,
  publicationTarget: "proposal" as const,
  notebookId: null,
  targetId: null,
  proposal,
  attachmentIds: []
};
assert.ok(createWorkspaceDocumentInputSchema.safeParse(workspaceProposal).success);
assert.equal(
  createWorkspaceDocumentInputSchema.safeParse({ ...workspaceProposal, proposal: null }).success,
  false,
  "Proposal drafts must checkpoint funding metadata"
);

assert.deepEqual(parseCanonicalRoute("/funding"), { kind: "funding" });
assert.deepEqual(parseCanonicalRoute("/funding", "?view=private"), { kind: "funding" });
assert.equal(roomForCanonicalRoute({ kind: "post", postId: "proposal-one" }, () => "funding"), "funding");

const seededProposals = inquiryItems.filter((item) => item.room === "funding");
assert.ok(seededProposals.length >= 2);
for (const item of seededProposals) {
  assert.equal(item.kind, "paper");
  assert.ok(item.patronage, `${item.id} must expose proposal funding metadata`);
  assert.equal(item.patronage?.raisedMinorUnits, item.patronage?.topSupporters.reduce((sum, row) => sum + row.amountMinorUnits, 0));
  assert.ok(item.patronage!.topSupporters.length <= 10);
  assert.equal(item.tags.some((tag) => tag === "civic" || tag === "private"), false);
}

const root = process.cwd();
const read = (file: string) => readFile(path.join(root, file), "utf8");
const [
  contracts,
  migration,
  schema,
  postRepository,
  patronageService,
  notePublishing,
  workspaceRepository,
  workspaceStore,
  attachmentOwnership,
  localAttachmentStore,
  composer,
  patronageViews,
  shell,
  routeModel
] = await Promise.all([
  read("packages/contracts/src/index.ts"),
  read("apps/api/src/db/migrate.ts"),
  read("apps/api/src/db/schema.ts"),
  read("apps/api/src/repository/posts.ts"),
  read("apps/api/src/services/patronage.ts"),
  read("apps/api/src/services/notePublishing.ts"),
  read("apps/api/src/repository/workspaceDocuments.ts"),
  read("lib/localWorkspaceStore.ts"),
  read("apps/api/src/services/attachmentOwnership.ts"),
  read("lib/localAttachmentStore.ts"),
  read("features/posts/PostViews.tsx"),
  read("features/patronage/PatronageViews.tsx"),
  read("components/SymposiumV0.tsx"),
  read("features/navigation/viewState.ts")
]);

assert.match(contracts, /room === "funding" && !input\.patronage/);
assert.match(migration, /0025_patronage_foundation/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS patronage_proposals/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS patronage_contributions/);
assert.match(migration, /UNIQUE \(provider, provider_reference\)/);
assert.match(schema, /patronageContributions/);
assert.match(postRepository, /insertPatronageProposal/);
assert.match(patronageService, /INSERT INTO patronage_proposals/);
assert.match(patronageService, /raisedMinorUnits: 0/);
assert.match(notePublishing, /publicationTarget === "proposal"/);
assert.match(notePublishing, /room: target === "proposal" \? "funding"/);
assert.match(workspaceRepository, /proposal/);
assert.match(workspaceStore, /proposal/);
assert.match(attachmentOwnership, /isPublicDraftStagingTransition/);
assert.match(localAttachmentStore, /record\.ownerType === "post" && input\.ownerType === "note"/);
assert.match(composer, /proposal: "Patronage Proposal"/);
assert.match(composer, /PatronageProposalFields/);
assert.match(composer, /patronage-side-inline/);
assert.match(patronageViews, /CircleDollarSign size=\{17\} \/>Contribute/);
assert.match(patronageViews, /Private Capital <small>Coming soon<\/small>/);
assert.match(patronageViews, /No contribution has been created or charged/);
assert.doesNotMatch(shell, /PatronageLobbyView|matchesPatronageMode|patronageMode/);
assert.doesNotMatch(routeModel, /PatronageMode/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "proposal and contribution contracts",
    "paper-grade Patronage post invariant",
    "exact Workspace proposal revisions",
    "unified funding route",
    "internally consistent seed projections",
    "canonical live proposal and provider ledger storage",
    "local and live draft persistence",
    "attachment staging across post and draft ownership",
    "composer, feed and clicked-proposal UI",
    "honest payment and private-capital feature gates",
    "removed civic/private Patronage modes"
  ]
}, null, 2));
};

void main();
