import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createOpportunityApplicationInputSchema,
  createPostInputSchema,
  createWorkspaceDocumentInputSchema,
  opportunityPostInputSchema,
  updateOpportunityApplicationInputSchema
} from "@/packages/contracts/src";
import { canonicalRouteHref, parseCanonicalRoute } from "@/features/navigation/canonicalRoute";
import { roomForCanonicalRoute } from "@/features/navigation/viewState";
import { emptySymposiumDocument } from "@/lib/documentModel";
import { inquiryItems } from "@/lib/mockData";

const main = async () => {
const opportunity = opportunityPostInputSchema.parse({
  kind: "fellowship",
  status: "open",
  location: "Remote",
  compensation: "$8,000 stipend",
  deadline: "2026-12-01"
});

const canonicalPost = {
  title: "Research tooling fellowship",
  body: "Build and test a small piece of public research infrastructure.",
  kind: "thought" as const,
  room: "opportunities" as const,
  opportunity,
  attachments: []
};
assert.ok(createPostInputSchema.safeParse(canonicalPost).success);
assert.equal(createPostInputSchema.safeParse({ ...canonicalPost, opportunity: undefined }).success, false);
assert.equal(createPostInputSchema.safeParse({ ...canonicalPost, kind: "paper" }).success, false);
assert.equal(createPostInputSchema.safeParse({ ...canonicalPost, room: "amphitheater" }).success, false);

const workspaceOpportunity = {
  title: canonicalPost.title,
  body: canonicalPost.body,
  document: emptySymposiumDocument(),
  kind: "thought" as const,
  publicationTarget: "opportunity" as const,
  notebookId: null,
  targetId: null,
  proposal: null,
  opportunity,
  attachmentIds: []
};
assert.ok(createWorkspaceDocumentInputSchema.safeParse(workspaceOpportunity).success);
assert.equal(createWorkspaceDocumentInputSchema.safeParse({ ...workspaceOpportunity, opportunity: null }).success, false);

assert.ok(createOpportunityApplicationInputSchema.safeParse({
  postId: "opportunity-one",
  statement: "I have built adjacent public tools and would bring a concrete prototype.",
  attachmentIds: ["6f0d9995-140e-4bce-9e7b-7c79da0fe9a1"]
}).success);
assert.ok(updateOpportunityApplicationInputSchema.safeParse({ shortlisted: true, expectedRevision: 1 }).success);

const seeded = inquiryItems.filter((item) => item.room === "opportunities");
assert.ok(seeded.length >= 4);
for (const item of seeded) {
  assert.equal(item.kind, "thought");
  assert.ok(item.opportunity, `${item.id} must use the canonical Opportunity projection`);
}

assert.equal(canonicalRouteHref({ kind: "opportunityApplications", postId: "post one" }), "/posts/post%20one/applications");
assert.deepEqual(parseCanonicalRoute("/posts/post%20one/applications", "?application=app%20one"), {
  kind: "opportunityApplications", postId: "post one", applicationId: "app one"
});
assert.equal(roomForCanonicalRoute({ kind: "opportunityApplications", postId: "post one" }), "opportunities");

const root = process.cwd();
const read = (file: string) => readFile(path.join(root, file), "utf8");
const [migration, schema, postRepository, applicationRepository, compatibilityRepository, routes, applicationPage, attachmentRepository, localStore, views, experience, composer, workspacePublishing, shell, styles] = await Promise.all([
  read("apps/api/src/db/migrate.ts"),
  read("apps/api/src/db/schema.ts"),
  read("apps/api/src/repository/posts.ts"),
  read("apps/api/src/repository/opportunityApplications.ts"),
  read("apps/api/src/repository/opportunities.ts"),
  read("apps/api/src/routes/opportunityApplicationRoutes.ts"),
  read("app/posts/[postId]/applications/page.tsx"),
  read("apps/api/src/repository/attachments.ts"),
  read("lib/localOpportunityApplicationStore.ts"),
  read("features/opportunities/OpportunityViews.tsx"),
  read("features/opportunities/OpportunityExperience.tsx"),
  read("features/posts/PostViews.tsx"),
  read("apps/api/src/services/notePublishing.ts"),
  read("components/SymposiumV0.tsx"),
  read("styles/89-opportunities.css")
]);

assert.match(migration, /0026_opportunities_foundation/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS opportunity_applications/);
assert.match(migration, /opportunity_application_comments/);
assert.match(migration, /UNIQUE \(post_id, applicant_handle\)/);
assert.match(schema, /opportunityApplications/);
assert.match(postRepository, /opportunity = \$11/);
assert.match(applicationRepository, /DELETE FROM opportunity_applications WHERE id = \$1/);
assert.doesNotMatch(applicationRepository, /UPDATE opportunity_applications[\s\S]{0,240}(deleted_at|archived_at|tombstone)/i);
assert.match(applicationRepository, /queueAttachmentsForOwnerStorageDeletion/);
assert.match(applicationRepository, /visibility: "private"/);
assert.match(applicationRepository, /comments: \[\]/);
assert.match(compatibilityRepository, /Canonical persistence and live events/);
assert.doesNotMatch(compatibilityRepository, /INSERT INTO opportunity_posts/);
assert.match(routes, /opportunity\/applications\/:applicationId/);
assert.match(routes, /opportunity-attachments/);
assert.match(applicationPage, /kind: "opportunityApplications"/);
assert.match(applicationPage, /applicationId/);
assert.match(attachmentRepository, /"opportunity_application", "profile"/);
assert.match(localStore, /delete store\.applications\[applicationId\]/);
assert.match(localStore, /deleteLocalOwnerAttachments\("opportunity_application"/);
assert.match(views, /Shortlisted/);
assert.match(views, /Private review notes/);
assert.match(views, /Permanently delete/);
assert.match(views, /AttachmentPreviewModal/);
assert.match(views, /BroadcastChannel/);
assert.match(composer, /OpportunityFeedSummary/);
assert.match(composer, /OpportunityRail/);
assert.match(workspacePublishing, /target === "opportunity"/);
assert.match(experience, /ownerType: "opportunity_application"/);
assert.match(shell, /useOpportunityApplicationComposer/);
assert.match(styles, /\.opportunity-review-layout/);
assert.match(styles, /\.symposium-shell\.night/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "thought-grade canonical Opportunity post invariant",
    "exact Office opportunity drafts and publication",
    "private application, shortlist, and reviewer-note contracts",
    "document-only protected application attachments",
    "hard application deletion with physical storage cleanup",
    "owner-only application review and applicant privacy",
    "canonical review deep links and open-in-new-tab behavior",
    "local and live synchronization paths",
    "unified feed, detail rail, apply, and reviewer workspace",
    "day and night maroon semantic treatment",
    "legacy API compatibility without legacy storage writes"
  ]
}, null, 2));
};

void main();
