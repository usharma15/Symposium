import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  itemHasPostType,
  postTitlePolicyError,
  postTypeForItem,
  preservePostSemanticProjection,
  publicPostTypeLabel
} from "@/lib/postSemantics";
import { inquiryItems } from "@/lib/mockData";

const main = async () => {
const proposals = inquiryItems.filter((item) => itemHasPostType(item, "proposal"));
const opportunities = inquiryItems.filter((item) => itemHasPostType(item, "opportunity"));
const papers = inquiryItems.filter((item) => itemHasPostType(item, "paper"));
const thoughts = inquiryItems.filter((item) => itemHasPostType(item, "thought"));

assert.ok(proposals.length > 0);
assert.ok(opportunities.length > 0);
assert.equal(proposals.some((item) => papers.includes(item)), false);
assert.equal(opportunities.some((item) => thoughts.includes(item)), false);
assert.equal(postTypeForItem({ kind: "paper", room: "funding", patronage: {} }), "proposal");
assert.equal(postTypeForItem({ kind: "thought", room: "opportunities", opportunity: {} }), "opportunity");
assert.equal(postTypeForItem({ kind: "draft", room: "office" }), null);
assert.equal(postTypeForItem({ kind: "paper", room: "office", postType: "paper" }), null);
assert.equal(publicPostTypeLabel(opportunities[0]!), "Opportunity");
assert.equal(publicPostTypeLabel(proposals[0]!), "Patronage Proposal");
assert.equal(publicPostTypeLabel(thoughts[0]!), "Thought");
assert.equal(postTitlePolicyError(thoughts[0]!, ""), null);
assert.equal(postTitlePolicyError(thoughts[0]!, "A stale Thought title"), "Thoughts do not have titles.");
assert.equal(postTitlePolicyError(papers[0]!, ""), "This post type requires a title.");
assert.equal(postTitlePolicyError(papers[0]!, "A Paper title"), null);
assert.equal(postTitlePolicyError(proposals[0]!, "A proposal title"), null);
assert.equal(postTitlePolicyError(opportunities[0]!, "An opportunity title"), null);

const currentOpportunity = opportunities[0]!;
const partialLiveOpportunity = {
  ...currentOpportunity,
  postType: undefined,
  opportunity: undefined
};
const protectedOpportunity = preservePostSemanticProjection(partialLiveOpportunity, currentOpportunity);
assert.equal(protectedOpportunity.postType, "opportunity");
assert.equal(protectedOpportunity.opportunity, currentOpportunity.opportunity);

const root = process.cwd();
const [feedVisibility, profileViews, discovery, quoteService, workspacePublishing, migration, shell, createBridge, updateBridge] = await Promise.all([
  readFile(path.join(root, "features/feeds/feedVisibility.ts"), "utf8"),
  readFile(path.join(root, "features/profiles/ProfileViews.tsx"), "utf8"),
  readFile(path.join(root, "features/discovery/discoveryPolicy.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/services/contentQuotes.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/services/notePublishing.ts"), "utf8"),
  readFile(path.join(root, "apps/api/src/db/migrate.ts"), "utf8"),
  readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8"),
  readFile(path.join(root, "app/api/posts/route.ts"), "utf8"),
  readFile(path.join(root, "app/api/posts/[id]/route.ts"), "utf8")
]);

assert.match(feedVisibility, /activeRoom === "library"\) return itemHasPostType\(item, "paper"\)/);
assert.match(feedVisibility, /activeRoom === "amphitheater"\) return itemHasPostType\(item, "thought"\)/);
assert.match(profileViews, /itemHasPostType\(item, "proposal"\)/);
assert.match(profileViews, /itemHasPostType\(item, "opportunity"\)/);
assert.match(discovery, /itemHasPostType\(item, "opportunity"\)/);
assert.match(quoteService, /post\.post_type AS "postType"/);
assert.match(workspacePublishing, /postType: target/);
assert.match(migration, /0027_semantic_post_types/);
assert.match(migration, /posts_semantic_destination_check/);
assert.match(shell, /postContextLabel\(attachmentPreviewBaseItem\)/);
assert.doesNotMatch(shell, /inside .\$\{attachmentPreviewBaseItem\.title\}/);
assert.match(shell, /!cleanBody \|\| postTitlePolicyError\(existing, cleanTitle\)/);
assert.match(createBridge, /postTitlePolicyError\(input, input\.title\)/);
assert.doesNotMatch(createBridge, /!input\.title \|\| !input\.body/);
assert.doesNotMatch(updateBridge, /!input\.title \|\| !input\.body/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "exclusive public publication identities",
    "semantic public labels independent of legacy content kind",
    "private drafts remain untyped",
    "partial live payload semantic preservation",
    "feed, profile, discovery, quote, Workspace, and database integration"
  ]
}, null, 2));
};

void main();
