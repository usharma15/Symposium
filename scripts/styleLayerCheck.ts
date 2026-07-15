import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const layers = [
  "00-foundations-entry.css",
  "10-legacy-shell.css",
  "20-legacy-content.css",
  "30-legacy-discussion-profile.css",
  "40-legacy-responsive.css",
  "50-immersive-shell.css",
  "60-immersive-communities-feed.css",
  "70-immersive-content-profile.css",
  "80-immersive-overlays.css",
  "85-symposium-document.css",
  "87-structured-attachments.css",
  "88-workspace.css",
  "89-patronage.css",
  "89-workspace-sharing.css",
  "89-post-tones.css",
  "90-immersive-responsive.css",
  "91-scribble.css"
];

const main = async () => {
  const root = process.cwd();
  const globals = await readFile(path.join(root, "app/globals.css"), "utf8");
  const expected = layers.map((layer) => `@import "../styles/${layer}";`).join("\n") + "\n";
  assert.equal(globals, expected, "globals.css must remain an ordered stylesheet manifest");

  const sources = new Map<string, string>();
  for (const layer of layers) {
    const source = await readFile(path.join(root, "styles", layer), "utf8");
    sources.set(layer, source);
    const lineCount = source.split("\n").length;
    assert.ok(lineCount <= 1200, `${layer} has grown beyond its architecture boundary (${lineCount} lines)`);
    assert.ok(source.trimStart().startsWith("/*"), `${layer} must declare its ownership purpose`);
  }

  const composerStyles = [
    sources.get("20-legacy-content.css") ?? "",
    sources.get("30-legacy-discussion-profile.css") ?? "",
    sources.get("40-legacy-responsive.css") ?? ""
  ].join("\n");
  assert.doesNotMatch(
    composerStyles,
    /\.comment-composer(?:\.compact)?\s+div/,
    "Comment composer layout rules must target owned classes instead of every descendant div."
  );
  assert.match(composerStyles, /\.comment-composer-actions/);
  assert.match(composerStyles, /\.composer-attachment-list[\s\S]*min-width:\s*0/);
  assert.match(composerStyles, /\.comment-composer\.compact \.comment-composer-actions > button/);
  assert.doesNotMatch(
    composerStyles,
    /\.comment-composer\.compact\s+button\s*\{/,
    "Compact reply actions must not resize every document-toolbar button."
  );

  const quoteStyles = [
    sources.get("20-legacy-content.css") ?? "",
    sources.get("30-legacy-discussion-profile.css") ?? "",
    sources.get("60-immersive-communities-feed.css") ?? "",
    sources.get("70-immersive-content-profile.css") ?? ""
  ].join("\n");
  assert.match(quoteStyles, /\.quote-card-shell/);
  assert.match(quoteStyles, /\.quote-card[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(quoteStyles, /\.quote-card-author/);
  assert.match(quoteStyles, /\.quote-kind-paper/);
  assert.match(quoteStyles, /\.comment-card > \.quote-card-shell/);
  assert.match(quoteStyles, /\.quote-destination-switch/);
  assert.match(quoteStyles, /\.quote-link-input-row/);

  const commentActionStyles = [
    sources.get("30-legacy-discussion-profile.css") ?? "",
    sources.get("70-immersive-content-profile.css") ?? ""
  ].join("\n");
  assert.match(commentActionStyles, /\.comment-actions\s*\{[^}]*gap:\s*4px/);
  assert.match(commentActionStyles, /\.profile-comment-card \.comment-actions button,\s*\.profile-comment-card \.comment-actions a/);

  const documentStyles = sources.get("85-symposium-document.css") ?? "";
  const patronageStyles = sources.get("89-patronage.css") ?? "";
  assert.match(patronageStyles, /\.patronage-proposal-fields/);
  assert.match(patronageStyles, /\.patronage-feed-summary/);
  assert.match(patronageStyles, /\.paper-detail\.patronage-detail > \.patronage-side/);
  assert.match(patronageStyles, /\.symposium-shell\.night \.patronage-feed-summary/);
  assert.match(documentStyles, /\.symposium-document-editor\.disabled\s*\{[^}]*pointer-events:\s*none/);
  assert.doesNotMatch(documentStyles, /\.symposium-document-editor\.disabled\s*\{[^}]*opacity:/);
  const attachmentStyles = [sources.get("20-legacy-content.css") ?? "", sources.get("87-structured-attachments.css") ?? ""].join("\n");
  const foundationStyles = sources.get("00-foundations-entry.css") ?? "";
  const shellStyles = sources.get("10-legacy-shell.css") ?? "";
  const feedStyles = [
    sources.get("60-immersive-communities-feed.css") ?? "",
    sources.get("70-immersive-content-profile.css") ?? "",
    sources.get("80-immersive-overlays.css") ?? "",
    sources.get("88-workspace.css") ?? ""
  ].join("\n");
  const responsiveStyles = sources.get("90-immersive-responsive.css") ?? "";
  assert.match(foundationStyles, /--symposium-feed-width:\s*840px/);
  assert.match(shellStyles, /\.symposium-shell[\s\S]*overflow-x:\s*clip/);
  assert.match(feedStyles, /\.feed-stream[\s\S]*max-width:\s*var\(--symposium-feed-width\)/);
  assert.match(feedStyles, /\.detail-layout\.simple-detail[\s\S]*var\(--symposium-feed-width\)/);
  assert.match(feedStyles, /\.workspace-main-column[\s\S]*var\(--symposium-feed-width\)/);
  assert.match(responsiveStyles, /\.detail-layout\.simple-detail,[\s\S]*\.profile-page[\s\S]*width:\s*min\(var\(--symposium-feed-width\), calc\(100vw - 28px\)\)/);
  assert.match(responsiveStyles, /\.feed-stream\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(responsiveStyles, /\.feed-post\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/);
  assert.match(documentStyles, /\.symposium-shell\.night[\s\S]*--document-surface-solid/);
  assert.match(documentStyles, /\.symposium-shell\s*\{[^}]*--document-color-default:\s*var\(--ink\)[^}]*--document-color-gold:\s*#9a6b16/);
  assert.match(documentStyles, /\.symposium-shell\.night\s*\{[^}]*--document-color-default:\s*var\(--ink\)[^}]*--document-color-blue:\s*#8ec5f4[^}]*--document-color-crimson:\s*#f0a0ad[^}]*--document-color-forest:\s*#8fd0ae[^}]*--document-color-gold:\s*#e7bd65/);
  assert.match(documentStyles, /\.symposium-document ::selection,[\s\S]*\.document-editor-canvas \.tiptap ::selection\s*\{[^}]*color:\s*var\(--ink\)/);
  assert.match(documentStyles, /\.post-composer-modal,[\s\S]*padding-top:\s*0/);
  assert.match(documentStyles, /\.symposium-document-editor\s*\{[^}]*--document-editor-sticky-top:\s*0px/);
  assert.match(documentStyles, /\.document-editor-toolbar\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--document-editor-sticky-top\)/);
  assert.match(documentStyles, /\.comment-composer \.document-editor-toolbar\s*\{[^}]*position:\s*static[^}]*top:\s*auto/);
  assert.match(documentStyles, /\.comment-composer \.symposium-document-editor:focus-within \.document-editor-toolbar\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--document-editor-sticky-top\)/);
  assert.match(documentStyles, /\.comment-composer\.compact \.document-editor-toolbar\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/);
  const documentToolbarStyles = layers.map((layer) => sources.get(layer) ?? "").join("\n");
  for (const block of documentToolbarStyles.matchAll(/[^{}]*\.document-editor-toolbar[^{}]*\{([^}]*)\}/g)) {
    for (const declaration of block[1].matchAll(/\btop:\s*([^;\n}]+)/g)) {
      const value = declaration[1].trim();
      assert.ok(
        value === "auto" || value === "var(--document-editor-sticky-top)",
        `Document toolbars must use the shared flush-top contract, not ${value}`
      );
    }
  }
  assert.match(documentStyles, /\.document-collapsible-content\.collapsed\.is-collapsible::after/);
  assert.match(attachmentStyles, /\.attachment-modal[\s\S]*background:\s*var\(--document-surface-solid\)/);
  assert.match(attachmentStyles, /\.attachment-sheet-scroll[\s\S]*background:\s*var\(--attachment-preview-surface\)/);
  assert.match(feedStyles, /\.social-actions\s*\{[^}]*repeat\(2, 42px\)[^}]*overflow-wrap:\s*normal/);
  assert.match(feedStyles, /\.social-actions button > svg,\s*\.social-actions a > svg,\s*\.social-actions strong\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(feedStyles, /\.social-actions strong\s*\{[^}]*margin-left:\s*0[^}]*white-space:\s*nowrap[^}]*word-break:\s*normal/);
  assert.match(feedStyles, /\.social-actions button,\s*\.social-actions a\s*\{[^}]*gap:\s*8px[^}]*white-space:\s*nowrap/);
  assert.match(feedStyles, /\.social-actions \.metric-label\s*\{[^}]*flex:\s*0 1 auto[^}]*min-width:\s*0/);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "ordered global manifest",
          "declared layer ownership",
          "bounded stylesheet size",
          "bounded attachment composer layout",
          "shared quote card and composer layout",
          "one canonical feed and clicked-post width",
          "day and night document ink with theme-safe selection contrast",
          "flush sticky editor and opaque themed attachment surfaces",
          "focus-scoped inline comment and compact reply toolbars",
          "compact single-line post metrics across feed and detail surfaces",
          "aligned compact comment metrics with quote and link actions",
          "overflow-only feed preview fades"
        ]
      },
      null,
      2
    )
  );
};

void main();
