import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  postToneClassName,
  postToneForItem,
  postToneForWorkspaceDocument
} from "@/lib/postTone";

const main = async () => {
const proposal = {
  status: "open" as const,
  currency: "USD" as const,
  goalMinorUnits: 25_000,
  deadline: null
};

assert.equal(postToneForItem({ kind: "thought", room: "symposium", patronage: undefined }), "thought");
assert.equal(
  postToneForItem({ kind: "note", room: "amphitheater", patronage: undefined }),
  "thought",
  "Legacy Amphitheater notes are public Thoughts and must keep the Thought palette."
);
assert.equal(postToneForItem({ kind: "paper", room: "library", patronage: undefined }), "paper");
assert.equal(
  postToneForItem({ kind: "paper", room: "amphitheater", patronage: undefined }),
  "paper",
  "Post kind must still win when a Paper is viewed outside its usual room."
);
assert.equal(
  postToneForItem({
    kind: "paper",
    room: "funding",
    patronage: { ...proposal, raisedMinorUnits: 0, supporterCount: 0, topSupporters: [] }
  }),
  "patronage"
);
assert.equal(
  postToneForItem({ kind: "note", room: "opportunities", patronage: undefined }),
  "opportunity",
  "Opportunity tone must be semantic even while seeded opportunities use note or draft tooling."
);
assert.equal(postToneForItem({ kind: "note", room: "office", patronage: undefined }), null);

assert.equal(postToneForWorkspaceDocument({ kind: "thought", publicationTarget: "thought", proposal: null }), "thought");
assert.equal(postToneForWorkspaceDocument({ kind: "paper", publicationTarget: "paper", proposal: null }), "paper");
assert.equal(
  postToneForWorkspaceDocument({ kind: "paper", publicationTarget: "proposal", proposal }),
  "patronage"
);
assert.equal(postToneForWorkspaceDocument({ kind: "note", publicationTarget: "undecided", proposal: null }), null);
assert.equal(postToneClassName("opportunity"), "post-tone post-tone-opportunity");
assert.equal(postToneClassName(null), "");

const root = process.cwd();
const read = (file: string) => readFile(path.join(root, file), "utf8");
const [
  posts,
  comments,
  profiles,
  workspaceCard,
  workspaceDetail,
  workspaceNavigator,
  contracts,
  scribble,
  documentRenderer,
  documentEditor,
  tones,
  feedStyles,
  nightStyles,
  patronageStyles
] = await Promise.all([
  read("features/posts/PostViews.tsx"),
  read("features/comments/CommentThread.tsx"),
  read("features/profiles/ProfileViews.tsx"),
  read("features/workspace/WorkspaceDocumentCard.tsx"),
  read("features/workspace/WorkspaceDocumentDetail.tsx"),
  read("features/workspace/WorkspaceNavigatorDocument.tsx"),
  read("packages/contracts/src/index.ts"),
  read("features/scribble/ScribbleContext.tsx"),
  read("features/content/SymposiumDocument.tsx"),
  read("features/content/SymposiumTiptapEditor.tsx"),
  read("styles/89-post-tones.css"),
  read("styles/60-immersive-communities-feed.css"),
  read("styles/80-immersive-overlays.css"),
  read("styles/89-patronage.css")
]);

assert.match(posts, /postToneForItem\(item\)/);
assert.match(posts, /tone=\{tone\}/);
assert.match(comments, /comment-thread depth-\$\{depth\} \$\{postToneClassName\(tone\)\}/);
assert.match(profiles, /profile-comment-card \$\{postToneClassName\(postToneForItem\(activity\.item\)\)\}/);
assert.match(workspaceCard, /postToneForWorkspaceDocument\(document\)/);
assert.match(workspaceDetail, /tone=\{tone\}/);
assert.match(workspaceNavigator, /postToneForWorkspaceDocument\(document\)/);
assert.match(contracts, /postTone: postToneSchema\.optional\(\)/);
assert.match(scribble, /postToneForItem\(item\)/);
assert.match(documentRenderer, /postToneClassName\(node\.source\?\.postTone \?\? null\)/);
assert.match(documentEditor, /postToneClassName\(source\?\.postTone \?\? null\)/);

for (const tone of ["thought", "paper", "patronage", "opportunity"]) {
  assert.match(tones, new RegExp(`\\.post-tone-${tone} \\{`));
  assert.match(tones, new RegExp(`\\.symposium-shell\\.night \\.post-tone-${tone},`));
  assert.match(tones, new RegExp(`\\.scribble-panel\\.night \\.post-tone-${tone} \\{`));
}
assert.match(tones, /\.feed-post\.post-tone,/);
assert.match(tones, /\.detail-layout\.post-tone > \.detail-main/);
assert.match(tones, /\.profile-comment-card\.post-tone/);
assert.match(tones, /\.comment-thread\.post-tone \.comment-card/);
assert.match(tones, /\.document-source-card\.post-tone,/);
assert.match(tones, /\.document-source-editor\.post-tone,/);
assert.match(tones, /\.scribble-source-shelf a\.post-tone/);
assert.match(tones, /\.workspace-sidebar-document-row\.post-tone \.workspace-sidebar-document/);
assert.doesNotMatch(tones, /inset 3px 0 var\(--post-tone-sidebar-accent\)/);
assert.doesNotMatch(feedStyles, /\.post-kind-(?:paper|draft|code|thought|note)/);
assert.doesNotMatch(nightStyles, /\.post-kind-(?:paper|draft|code|thought|note)/);
assert.doesNotMatch(`${posts}\n${patronageStyles}`, /post-patronage-proposal/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "semantic precedence for thoughts, papers, Patronage proposals, and opportunities",
    "neutral treatment for unpublished general notes",
    "shared feed and detail post classes",
    "matching post discussion and profile comment treatment",
    "matching Office cards, detail discussions, and navigator treatment",
    "persisted semantic tone for Scribble and Quick Note source cards",
    "subtle Notes tint and label without type-coloured edge tabs",
    "central day and night palettes",
    "removal of scattered kind-specific background rules"
  ]
}, null, 2));
};

void main();
