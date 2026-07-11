import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  resourceReferenceSchema,
  versionedDocumentSchema
} from "@/packages/contracts/src";

const root = process.cwd();
const source = (file: string) => readFile(path.join(root, file), "utf8");

const domainRepositories = [
  "actions",
  "assistant",
  "attachments",
  "comments",
  "communities",
  "conversations",
  "identity",
  "notifications",
  "opportunities",
  "posts",
  "profiles",
  "search",
  "workspace"
];

const main = async () => {
  const [mockData, canonicalLink, liveRepository] = await Promise.all([
    source("lib/mockData.ts"),
    source("features/navigation/CanonicalLink.tsx"),
    source("apps/api/src/repository/liveRepository.ts")
  ]);

  assert.equal(mockData.includes("export type InquiryItem = {"), false);
  assert.match(mockData, /export type InquiryItem = InquiryItemContract/);
  assert.match(mockData, /export type ResearchProfile = ResearchProfileContract/);

  for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
    assert.ok(canonicalLink.includes(modifier), `CanonicalLink must preserve ${modifier} browser navigation.`);
  }
  assert.match(canonicalLink, /href={canonicalRouteHref\(route\)}/);

  assert.ok(liveRepository.split("\n").length <= 250, "liveRepository must remain a bounded compatibility façade.");
  for (const repository of domainRepositories) {
    const repositorySource = await source(`apps/api/src/repository/${repository}.ts`);
    assert.ok(repositorySource.split("\n").length <= 900, `${repository} repository has outgrown its domain boundary.`);
    assert.equal(
      repositorySource.includes('from "./liveRepository"'),
      false,
      `${repository} repository must not depend on the compatibility façade.`
    );
  }

  for (const route of [
    "app/profiles/[handle]/followers/page.tsx",
    "app/profiles/[handle]/following/page.tsx"
  ]) {
    assert.ok((await source(route)).includes("SymposiumPage"), `${route} must remain a canonical shell route.`);
  }

  resourceReferenceSchema.parse({ type: "comment", id: "comment-1", label: "A comment" });
  versionedDocumentSchema.parse({
    version: 1,
    nodes: [
      { type: "heading", level: 2, content: [{ text: "Working claim" }] },
      { type: "paragraph", content: [{ text: "Evidence and context." }] },
      { type: "reference", resource: { type: "post", id: "post-1" } },
      { type: "attachment", attachmentId: "attachment-1", caption: "Result" }
    ]
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "contract-owned client domain types",
          "modifier-safe canonical links",
          "bounded backend domain repositories",
          "social graph route ownership",
          "versioned document and resource-reference contracts"
        ]
      },
      null,
      2
    )
  );
};

void main();
