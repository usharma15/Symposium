import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertLocalPreviewPersistenceAvailable,
  selectNextPersistenceMode
} from "@/lib/runtimeSafety";

const main = async () => {
  const repositoryRoot = process.cwd();
  const sourcePath = path.join(repositoryRoot, "lib", "localPreviewStore.ts");
  const source = await readFile(sourcePath, "utf8");

  await assert.rejects(
    access(path.join(repositoryRoot, "lib", "dataStore.ts")),
    /ENOENT/
  );

  assert.doesNotMatch(source, /from ["']pg["']/);
  assert.doesNotMatch(source, /\bPool\b|\busePostgres\b|\bgetPool\b|\bensureSchema\b/);
  assert.doesNotMatch(
    source,
    /\b(?:SELECT|INSERT INTO|UPDATE\s+(?:posts|items|comments|profiles)|DELETE FROM|CREATE TABLE|ALTER TABLE)\b/i
  );
  assert.match(source, /writeJsonFileAtomically/);
  assert.match(source, /withLocalMutation/);
  assert.match(source, /databaseBackedModeConfigured/);
  assert.match(source, /assertLocalPreviewPersistenceAvailable/);

  assert.equal(selectNextPersistenceMode({ backendUrl: "https://api.example", localPreviewAllowed: false }), "canonical-api");
  assert.equal(selectNextPersistenceMode({ backendUrl: null, localPreviewAllowed: true }), "local-preview");
  assert.equal(selectNextPersistenceMode({ backendUrl: null, localPreviewAllowed: false }), "unavailable");
  assert.doesNotThrow(() => assertLocalPreviewPersistenceAvailable({
    databaseBackedModeConfigured: false,
    nodeEnv: "development"
  }));
  assert.throws(() => assertLocalPreviewPersistenceAvailable({
    databaseBackedModeConfigured: false,
    nodeEnv: "production"
  }), /unavailable in production/);
  assert.throws(() => assertLocalPreviewPersistenceAvailable({
    databaseBackedModeConfigured: true,
    nodeEnv: "development"
  }), /Direct Postgres access/);

  const localPreviewStoreImport = `${["@", "lib", "localPreviewStore"].join("/")}[\"']`;
  const runtimeImporters = execFileSync(
    "rg",
    ["-l", localPreviewStoreImport, "app", "features", "lib", "scripts"],
    { cwd: repositoryRoot, encoding: "utf8" }
  ).trim().split("\n").filter(Boolean).sort();
  assert.deepEqual(runtimeImporters, [
    "app/api/auth/sync/route.ts",
    "app/api/bootstrap/route.ts",
    "app/api/posts/[id]/actions/route.ts",
    "app/api/posts/[id]/comments/[commentId]/actions/route.ts",
    "app/api/posts/[id]/comments/[commentId]/route.ts",
    "app/api/posts/[id]/comments/route.ts",
    "app/api/posts/[id]/route.ts",
    "app/api/posts/route.ts",
    "app/api/profiles/[handle]/activity/route.ts",
    "app/api/profiles/[handle]/route.ts",
    "app/api/profiles/route.ts",
    "app/api/search/route.ts",
    "app/api/workspace/documents/[noteId]/publish/route.ts",
    "lib/localOpportunityApplicationStore.ts",
    "scripts/localPersistenceRaceCheck.ts"
  ]);

  const featureSearch = spawnSync(
    "rg",
    ["-l", "localPreviewStore", "features"],
    { cwd: repositoryRoot, encoding: "utf8" }
  );
  assert.equal(featureSearch.status, 1, featureSearch.stderr || featureSearch.stdout);
  assert.equal(featureSearch.stdout.trim(), "");

  const authSyncSource = await readFile(path.join(repositoryRoot, "app/api/auth/sync/route.ts"), "utf8");
  assert.ok(
    authSyncSource.indexOf("if (live) return live;") < authSyncSource.indexOf("const existingProfile"),
    "Auth sync must attempt the canonical API before reading local preview persistence."
  );

  const apiSources = await Promise.all([
    "apps/api/src/server.ts",
    "apps/api/src/repository/foundation.ts",
    "apps/api/src/repository/posts.ts",
    "apps/api/src/repository/comments.ts"
  ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")));
  for (const apiSource of apiSources) {
    assert.doesNotMatch(apiSource, /(?:@\/lib|\.\.\/.*)\/dataStore/);
  }

  const childSource = (expectedMessage: string) => [
    `import(${JSON.stringify(pathToFileURL(sourcePath).href)})`,
    "  .then((store) => store.getSnapshot())",
    "  .then(() => { console.error('local preview unexpectedly opened'); process.exit(2); })",
    "  .catch((error) => {",
    "    const message = error instanceof Error ? error.message : String(error);",
    `    if (!message.includes(${JSON.stringify(expectedMessage)})) {`,
    "      console.error(message); process.exit(3);",
    "    }",
    "  });"
  ].join("\n");
  const databaseChild = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childSource(
    "Direct Postgres access from the local preview store has been retired"
  )], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://127.0.0.1:1/authority-must-not-connect",
      POSTGRES_URL: "",
      POSTGRES_PRISMA_URL: ""
    }
  });
  assert.equal(databaseChild.status, 0, databaseChild.stderr || databaseChild.stdout);

  const productionChild = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childSource(
    "Local preview persistence is unavailable in production"
  )], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "",
      POSTGRES_URL: "",
      POSTGRES_PRISMA_URL: ""
    }
  });
  assert.equal(productionChild.status, 0, productionChild.stderr || productionChild.stdout);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "one explicit canonical API, local preview, or unavailable runtime mode",
      "ambiguous dataStore authority retired",
      "client features own no persistence-store types or imports",
      "auth sync reaches the canonical API before local preview persistence",
      "serialized atomic JSON preview remains explicit",
      "production and database-configured local preview fail closed before mutation",
      "canonical API repositories remain independent of the local preview store"
    ]
  }, null, 2));
};

void main();
