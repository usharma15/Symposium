import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  AUTHORED_ARTIFACT_ASSET_MANIFEST,
  BOTTOM_CARICATURE_REGISTRY,
  PAPER_MUSE_REGISTRY,
  THOUGHT_MUSE_REGISTRY
} from "@/features/posts/artifacts/authoredArtifactRegistry";
import { paperTitleEntry } from "@/features/posts/artifacts/paperTitleEntry";

const main = async () => {
  const root = process.cwd();
  const publicRoot = path.join(root, "public");
  const artifactRoot = path.join(publicRoot, "symposium-artifacts", "v1");
  const manifestPaths = AUTHORED_ARTIFACT_ASSET_MANIFEST.map((entry) => entry.path);
  assert.equal(AUTHORED_ARTIFACT_ASSET_MANIFEST.length, 51, "The frozen runtime manifest must contain exactly 51 assets.");
  assert.equal(new Set(manifestPaths).size, manifestPaths.length, "The runtime manifest must not contain duplicate assets.");

  const copiedFiles = (await readdir(artifactRoot)).sort();
  const manifestFiles = manifestPaths.map((assetPath) => path.basename(assetPath)).sort();
  assert.deepEqual(copiedFiles, manifestFiles, "The versioned runtime directory must contain only frozen manifest assets.");

  for (const entry of AUTHORED_ARTIFACT_ASSET_MANIFEST) {
    assert.match(entry.path, /^\/symposium-artifacts\/v1\/[^/]+$/, `Asset is not versioned: ${entry.path}`);
    const contents = await readFile(path.join(publicRoot, entry.path.slice(1)));
    assert.equal(
      createHash("sha256").update(contents).digest("hex"),
      entry.sha256,
      `Frozen asset hash changed: ${entry.path}`
    );
  }

  assert.deepEqual(Object.keys(PAPER_MUSE_REGISTRY), ["calliope", "urania"]);
  assert.deepEqual(Object.keys(THOUGHT_MUSE_REGISTRY), ["erato", "thalia"]);
  assert.equal(THOUGHT_MUSE_REGISTRY.erato.approvalScope, "all-registered-breakpoints");
  assert.equal(THOUGHT_MUSE_REGISTRY.thalia.approvalScope, "desktop-day-night");
  assert.deepEqual(Object.keys(BOTTOM_CARICATURE_REGISTRY), [
    "resting-warrior",
    "flute-girl",
    "discus-thrower",
    "harp-girl",
    "wanderer",
    "lovers",
    "chariot"
  ]);
  for (const bottom of Object.values(BOTTOM_CARICATURE_REGISTRY)) {
    assert.deepEqual(bottom.eligiblePostTypes, ["paper", "thought"]);
    assert.equal(bottom.approved, true);
    assert.ok(bottom.thoughtSurfaceAssets, `${bottom.id}: missing Thought surface-through artwork`);

    const [
      { data: paperDay, info: paperDayInfo },
      { data: thoughtDay, info: thoughtDayInfo },
      { data: thoughtNight, info: thoughtNightInfo }
    ] = await Promise.all([
      sharp(path.join(publicRoot, bottom.assets.day.slice(1)))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(path.join(publicRoot, bottom.thoughtSurfaceAssets.day.slice(1)))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(path.join(publicRoot, bottom.thoughtSurfaceAssets.night.slice(1)))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    ]);

    for (const info of [paperDayInfo, thoughtDayInfo, thoughtNightInfo]) {
      assert.deepEqual(
        [info.width, info.height],
        [bottom.canvas.width, bottom.canvas.height],
        `${bottom.id}: runtime canvas drifted`
      );
    }

    let paperAlphaMass = 0;
    let thoughtAlphaMass = 0;
    let visibleThoughtPixels = 0;
    for (let offset = 0; offset < thoughtDay.length; offset += 4) {
      const paperAlpha = paperDay[offset + 3];
      const dayAlpha = thoughtDay[offset + 3];
      const nightAlpha = thoughtNight[offset + 3];
      assert.equal(dayAlpha, nightAlpha, `${bottom.id}: Thought Day/Night alpha geometry drifted`);
      assert.ok(dayAlpha <= paperAlpha, `${bottom.id}: Thought line escaped the approved Paper silhouette`);
      if (dayAlpha > 0) {
        assert.deepEqual(
          [thoughtDay[offset], thoughtDay[offset + 1], thoughtDay[offset + 2]],
          [79, 91, 70],
          `${bottom.id}: Thought Day engraving pigment drifted`
        );
        assert.deepEqual(
          [thoughtNight[offset], thoughtNight[offset + 1], thoughtNight[offset + 2]],
          [88, 97, 95],
          `${bottom.id}: Thought Night engraving pigment drifted`
        );
        visibleThoughtPixels += 1;
      }
      paperAlphaMass += paperAlpha;
      thoughtAlphaMass += dayAlpha;
    }
    assert.ok(visibleThoughtPixels > 0, `${bottom.id}: Thought engraving is empty`);
    assert.ok(
      thoughtAlphaMass < paperAlphaMass * 0.75,
      `${bottom.id}: Thought artwork retained an opaque Paper fill`
    );
  }
  assert.deepEqual(paperTitleEntry("“Éclair”"), {
    direction: "ltr",
    start: 1,
    end: 2,
    grapheme: "É"
  });
  assert.deepEqual(paperTitleEntry("e\u0301lan"), {
    direction: "ltr",
    start: 0,
    end: 2,
    grapheme: "e\u0301"
  });
  assert.deepEqual(paperTitleEntry("— نظرية"), {
    direction: "rtl",
    start: 2,
    end: 3,
    grapheme: "ن"
  });
  assert.deepEqual(paperTitleEntry("（量子）"), {
    direction: "ltr",
    start: 1,
    end: 2,
    grapheme: "量"
  });

  const implementationFiles = [
    "features/posts/artifacts/authoredArtifactRegistry.ts",
    "features/posts/artifacts/AuthoredArtifactFigures.tsx",
    "features/posts/artifacts/AuthoredArtifactFrames.tsx",
    "features/posts/artifacts/PaperTitleCeremony.tsx",
    "features/posts/PostViews.tsx",
    "styles/95-authored-artifacts.css"
  ];
  const sources = await Promise.all(
    implementationFiles.map((file) => readFile(path.join(root, file), "utf8"))
  );
  const implementation = sources.join("\n");
  assert.doesNotMatch(implementation, /\/design-lab\//, "Production code must not reference the isolated Design Lab path.");
  assert.doesNotMatch(implementation, /Math\.random|randomInt|crypto\.random/, "Rendering must never select an artifact.");
  assert.match(sources[4], /itemHasPostType\(item, "paper"\)/, "Paper ceremony eligibility must use postType.");
  assert.match(sources[4], /itemHasPostType\(item, "thought"\)/, "Thought ceremony eligibility must use postType.");
  assert.match(sources[4], /<PostTypeEmblem/, "Feed and profile cards must render a compact post-type emblem.");
  assert.doesNotMatch(
    await readFile(path.join(root, "features/comments/CommentThread.tsx"), "utf8"),
    /PostTypeEmblem/,
    "Comments must remain emblem-free."
  );
  assert.match(sources[4], /!isPaper && !isThought/, "Thought and Paper detail indicators must be absent.");
  assert.match(sources[4], /isThought && thoughtMuseId \? <ThoughtOpeningMuse/, "Thought muses must be title-independent.");
  assert.match(
    sources[1],
    /postType === "thought" \? bottom\.thoughtSurfaceAssets : bottom\.assets/,
    "Every Thought bottom caricature must use its surface-through artwork."
  );
  assert.doesNotMatch(
    sources[1],
    /bottom\.id\s*===\s*"chariot"/,
    "Thought surface-through behavior must not special-case Chariot."
  );
  assert.doesNotMatch(
    sources[5],
    /\.detail-layout\.authored-artifact-detail\s*\{/,
    "Authored design CSS must not override the established detail grid or width."
  );
  assert.doesNotMatch(
    sources[5],
    /width:\s*min\(980px/,
    "Authored design CSS must retain the original centre-feed width."
  );
  const nextConfig = await readFile(path.join(root, "next.config.mjs"), "utf8");
  assert.match(nextConfig, /source: "\/symposium-artifacts\/v1\/:path\*"/);
  assert.match(nextConfig, /max-age=31536000, immutable/);

  console.log("Authored artifact assets and rendering boundaries verified.");
};

void main();
