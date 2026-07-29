import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
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
  assert.equal(AUTHORED_ARTIFACT_ASSET_MANIFEST.length, 39, "The frozen runtime manifest must contain exactly 39 assets.");
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
  assert.ok(BOTTOM_CARICATURE_REGISTRY.chariot.thoughtSurfaceAssets);
  for (const bottom of Object.values(BOTTOM_CARICATURE_REGISTRY)) {
    assert.deepEqual(bottom.eligiblePostTypes, ["paper", "thought"]);
    assert.equal(bottom.approved, true);
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
  const nextConfig = await readFile(path.join(root, "next.config.mjs"), "utf8");
  assert.match(nextConfig, /source: "\/symposium-artifacts\/v1\/:path\*"/);
  assert.match(nextConfig, /max-age=31536000, immutable/);

  console.log("Authored artifact assets and rendering boundaries verified.");
};

void main();
