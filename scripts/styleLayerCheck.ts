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
  "90-immersive-responsive.css"
];

const main = async () => {
  const root = process.cwd();
  const globals = await readFile(path.join(root, "app/globals.css"), "utf8");
  const expected = layers.map((layer) => `@import "../styles/${layer}";`).join("\n") + "\n";
  assert.equal(globals, expected, "globals.css must remain an ordered stylesheet manifest");

  for (const layer of layers) {
    const source = await readFile(path.join(root, "styles", layer), "utf8");
    const lineCount = source.split("\n").length;
    assert.ok(lineCount <= 1200, `${layer} has grown beyond its architecture boundary (${lineCount} lines)`);
    assert.ok(source.trimStart().startsWith("/*"), `${layer} must declare its ownership purpose`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: ["ordered global manifest", "declared layer ownership", "bounded stylesheet size"]
      },
      null,
      2
    )
  );
};

void main();
