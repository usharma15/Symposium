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
  "90-immersive-responsive.css"
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

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "ordered global manifest",
          "declared layer ownership",
          "bounded stylesheet size",
          "bounded attachment composer layout",
          "shared quote card and composer layout"
        ]
      },
      null,
      2
    )
  );
};

void main();
