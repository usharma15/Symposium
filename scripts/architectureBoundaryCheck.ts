import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const ignoredDirectories = new Set([".git", ".next", "node_modules"]);

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (ignoredDirectories.has(entry.name)) return [];
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(fullPath);
      return sourceExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
    })
  );
  return nested.flat();
};

const root = process.cwd();
const relative = (file: string) => path.relative(root, file).replaceAll(path.sep, "/");
const imports = async (file: string) => {
  const source = await readFile(file, "utf8");
  return [...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)].map((match) => match[2]);
};

const main = async () => {
  const files = await sourceFiles(root);
  const fileNames = new Set(files.map(relative));
  const symposiumImporters: string[] = [];
  const featureGraph = new Map<string, string[]>();
  for (const file of files) {
    const fileName = relative(file);
    const fileImports = await imports(file);

    if (fileImports.some((specifier) => specifier.includes("components/SymposiumV0"))) {
      symposiumImporters.push(fileName);
    }

    if (fileName.startsWith("apps/api/src/")) {
      assert.equal(
        fileImports.some((specifier) => specifier.includes("components/") || specifier.includes("app/api/")),
        false,
        `${fileName} must not depend on frontend components or Next bridge routes.`
      );
    }

    if (fileName.startsWith("features/")) {
      const source = await readFile(file, "utf8");
      assert.ok(
        source.split("\n").length <= 1200,
        `${fileName} has grown beyond a bounded feature module.`
      );
      assert.equal(
        fileImports.some((specifier) => specifier.includes("components/SymposiumV0") || specifier.includes("app/")),
        false,
        `${fileName} must not depend on the legacy application shell.`
      );
      featureGraph.set(
        fileName,
        fileImports.flatMap((specifier) => {
          if (!specifier.startsWith("@/features/")) return [];
          const base = specifier.replace("@/", "");
          return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].filter((candidate) =>
            fileNames.has(candidate)
          );
        })
      );
    }
  }

  assert.deepEqual(symposiumImporters.sort(), ["app/SymposiumPage.tsx"]);
  const symposiumSource = await readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8");
  assert.ok(
    symposiumSource.split("\n").length <= 3500,
    "SymposiumV0.tsx must remain an application controller rather than regrowing feature rendering."
  );
  assert.doesNotMatch(
    symposiumSource,
    /new\s+(?:EventSource|BroadcastChannel)\s*\(/,
    "Browser live and cross-tab transport must remain outside SymposiumV0.tsx."
  );
  assert.doesNotMatch(
    symposiumSource,
    /fetch\(\s*["'`]\/api\//,
    "Same-origin API request semantics must remain owned by features/api."
  );
  for (const infrastructureImport of [
    "features/api/symposiumApiClient",
    "features/live-sync/useCrossTabItemTransport",
    "features/live-sync/useLiveEventStream"
  ]) {
    assert.ok(
      symposiumSource.includes(infrastructureImport),
      `${infrastructureImport} must remain the controller infrastructure boundary.`
    );
  }
  for (const extractedComponent of [
    "AttachmentPreviewModal",
    "CommentThread",
    "CommunitiesDirectoryView",
    "FeedPost",
    "MessagesModal",
    "ProfileView",
    "RoomView",
    "SearchModal"
  ]) {
    assert.equal(
      symposiumSource.includes(`function ${extractedComponent}(`),
      false,
      `${extractedComponent} must remain owned by its feature module.`
    );
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visitFeature = (fileName: string, pathStack: string[]) => {
    if (visited.has(fileName)) return;
    assert.equal(
      visiting.has(fileName),
      false,
      `Feature dependency cycle: ${[...pathStack, fileName].join(" -> ")}`
    );
    visiting.add(fileName);
    for (const dependency of featureGraph.get(fileName) ?? []) visitFeature(dependency, [...pathStack, fileName]);
    visiting.delete(fileName);
    visited.add(fileName);
  };
  for (const fileName of featureGraph.keys()) visitFeature(fileName, []);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: [
          "single legacy shell entrypoint",
          "backend to frontend dependency isolation",
          "feature module independence",
          "bounded shell and feature sizes",
          "controller transport and API isolation",
          "extracted feature ownership",
          "acyclic feature dependencies"
        ]
      },
      null,
      2
    )
  );
};

void main();
