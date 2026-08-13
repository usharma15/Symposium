import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createSavedLibraryFolderInputSchema,
  savedLibraryResponseSchema,
  updateSavedLibraryEntryInputSchema,
  updateSavedLibraryFolderInputSchema,
  type SavedLibraryEntryContract
} from "@/packages/contracts/src";
import { buildLegacyProfileActivity } from "@/lib/profileActivity";
import type { InquiryItem } from "@/lib/mockData";
import { mapSymposiumApiRoute } from "@/lib/symposiumApiRoute";
import {
  compareSavedLibraryEntries,
  resolveSavedLibraryEntry
} from "@/features/saved/SavedLibraryView";

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

const item = (id: string, title: string, saved: boolean, savedComments: number): InquiryItem => ({
  id,
  kind: "thought",
  postType: "thought",
  room: "amphitheater",
  title,
  author: "Ada Lovelace",
  authorHandle: "@ada",
  affiliation: "Independent",
  date: "Today",
  createdAt: `2026-08-${id === "post-1" ? "01" : id === "post-2" ? "02" : "03"}T12:00:00.000Z`,
  status: "Open",
  metrics: { signal: String(id.length), critiques: String(savedComments), forks: "2", saves: saved ? "1" : "0", reads: "20" },
  gatheringReason: "Saved library verification",
  excerpt: `${title} excerpt`,
  body: `${title} body`,
  tags: [],
  signals: [],
  claims: [],
  objections: [],
  evidence: [],
  tests: [],
  forks: [],
  comments: Array.from({ length: savedComments }, (_, index) => ({
    id: `${id}-comment-${index + 1}`,
    author: "Grace Hopper",
    authorHandle: "@grace",
    stance: "Comment",
    body: `Saved comment ${index + 1}`,
    createdAt: `2026-08-0${index + 4}T12:00:00.000Z`,
    metrics: { signal: "3", forks: "1", saves: "1", reads: "8" },
    savedBy: ["@ada"],
    signaledBy: [],
    forkedBy: [],
    replies: []
  })),
  saved,
  savedBy: saved ? ["@ada"] : [],
  signaledBy: [],
  forkedBy: []
});

const items = [
  item("post-1", "Alpha", true, 1),
  item("post-2", "Beta", true, 1),
  item("post-3", "Gamma", true, 0)
];
const saves = buildLegacyProfileActivity(items, "@ada", ["save"]);
assert.equal(saves.length, 5, "Three saved posts plus two saved comments must produce five canonical saves.");
assert.equal(saves.filter((entry) => entry.subjectType === "post").length, 3);
assert.equal(saves.filter((entry) => entry.subjectType === "comment").length, 2);

const entries: SavedLibraryEntryContract[] = saves.map((activity, index) => ({
  subjectType: activity.subjectType,
  subjectId: activity.subjectId,
  postId: activity.postId,
  folderId: index < 2 ? "a2ef80d5-9d2f-4dc8-b5a8-a60b7ece31a0" : null,
  savedAt: new Date(Date.UTC(2026, 7, 10, 12, index)).toISOString(),
  archivedAt: null,
  archiveExpiresAt: null,
  revision: 1
}));
const itemById = new Map(items.map((candidate) => [candidate.id, candidate]));
const resolved = entries.map((entry) => resolveSavedLibraryEntry(entry, itemById.get(entry.postId)));
assert.equal(resolved.length, 5, "The Office model must preserve post and comment saves instead of collapsing to parent posts.");
assert.equal(resolved.filter((entry) => entry.comment).length, 2);
assert.deepEqual(
  [...resolved].sort(compareSavedLibraryEntries("alphabetical")).slice(0, 2).map((entry) => entry.title),
  ["Alpha", "Beta"]
);
assert.equal([...resolved].sort(compareSavedLibraryEntries("recently_saved"))[0].entry.subjectId, entries[4].subjectId);
assert.equal([...resolved].sort(compareSavedLibraryEntries("oldest_saved"))[0].entry.subjectId, entries[0].subjectId);
for (const metricSort of ["likes", "saves", "comments", "views", "reshares"] as const) {
  const sorted = [...resolved].sort(compareSavedLibraryEntries(metricSort));
  assert.ok(sorted.every((entry, index) => index === 0 || sorted[index - 1][metricSort] >= entry[metricSort]));
}
for (const createdSort of ["created_newest", "created_oldest"] as const) {
  assert.equal([...resolved].sort(compareSavedLibraryEntries(createdSort)).length, 5);
}

assert.equal(createSavedLibraryFolderInputSchema.safeParse({ name: "Methods" }).success, true);
assert.equal(createSavedLibraryFolderInputSchema.safeParse({ name: "" }).success, false);
assert.equal(updateSavedLibraryFolderInputSchema.safeParse({ name: "Methods", expectedRevision: 2 }).success, true);
assert.equal(updateSavedLibraryFolderInputSchema.safeParse({ name: "Methods" }).success, false);
assert.equal(updateSavedLibraryEntryInputSchema.safeParse({ subjectType: "comment", subjectId: "comment-1", archived: true, expectedRevision: 1 }).success, true);
assert.equal(updateSavedLibraryEntryInputSchema.safeParse({ subjectType: "post", subjectId: "post-1", expectedRevision: 1 }).success, false);
assert.equal(savedLibraryResponseSchema.safeParse({ entries, folders: [], items, profiles: {} }).success, true);

assert.deepEqual(
  mapSymposiumApiRoute("/api/saved-library?actorHandle=%40ada", { method: "GET" }),
  {
    actorHandle: "@ada",
    body: undefined,
    boundary: null,
    livePath: "/v1/saved-library",
    method: "GET"
  }
);

const repository = source("apps/api/src/repository/savedLibrary.ts");
for (const boundary of [
  "FROM post_actions action",
  "FROM comment_actions action",
  "'comment'::text AS subject_type",
  "listProfileActivitySubjects",
  "now() + interval '60 days'",
  "archive_expires_at <= now()",
  "action = 'save'",
  "action.active = true"
]) {
  assert.ok(repository.includes(boundary), `Saved library repository must retain ${boundary}.`);
}
assert.match(repository, /SET active = false, count = 0, revision = revision \+ 1/);

const migration = source("apps/api/src/db/migrate.ts");
assert.match(migration, /0067_saved_library_organization/);
assert.match(migration, /saved_library_folders/);
assert.match(migration, /saved_library_entries/);
assert.match(migration, /archive_expires_at/);

const view = source("features/saved/SavedLibraryView.tsx");
const viewStyles = source("styles/89-saved-library.css");
for (const label of [
  "All Saved",
  "Folders",
  "Archived",
  "Recently added",
  "Oldest added",
  "Alphabetical",
  "Most likes",
  "Most saves",
  "Most comments",
  "Most views",
  "Most reshares",
  "Date created · newest",
  "Date created · oldest",
  "Archived saves expire after 60 days"
]) {
  assert.ok(view.includes(label), `Saved library interface must expose ${label}.`);
}
assert.match(view, /<FeedPost/);
assert.match(view, /<ProfileCommentCard/);
assert.match(view, /className="workspace-tabs saved-library-tabs"/);
assert.match(view, /section === "folders" \|\| section === "folder"/);
assert.match(view, /className="saved-library-folder-list"/);
assert.doesNotMatch(view, /className="saved-library-heading"/);
assert.doesNotMatch(view, /className="saved-library-folder-grid"/);
assert.match(viewStyles, /\.saved-library-toolbar\.workspace-toolbar\s*\{[^}]*align-content:\s*start;[^}]*grid-template-rows:\s*none;[^}]*grid-auto-rows:\s*max-content;/);

const shell = source("components/SymposiumV0.tsx");
assert.match(shell, /officeMode === "saved"[\s\S]{0,200}<SavedLibraryView/);
assert.doesNotMatch(shell, /key: "office:saved", query: \{ saved: true/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "five canonical post and comment saves remain five Office entries",
    "all requested saved-library sorts",
    "revision-guarded folder and entry contracts",
    "private API routing",
    "post and comment action-ledger synchronization",
    "60-day archive expiry without source deletion",
    "left-panel folders and header-free canonical feed rendering"
  ]
}, null, 2));

export {};
