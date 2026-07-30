import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const main = async () => {
  const repositoryRoot = process.cwd();
  const sourcePath = path.join(repositoryRoot, "lib", "dataStore.ts");
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(source, /from ["']pg["']/);
  assert.doesNotMatch(source, /\bPool\b|\busePostgres\b|\bgetPool\b|\bensureSchema\b/);
  assert.doesNotMatch(
    source,
    /\b(?:SELECT|INSERT INTO|UPDATE\s+(?:posts|items|comments|profiles)|DELETE FROM|CREATE TABLE|ALTER TABLE)\b/i
  );
  assert.match(source, /writeJsonFileAtomically/);
  assert.match(source, /withLocalMutation/);
  assert.match(source, /databaseBackedModeConfigured/);
  assert.match(source, /Direct Postgres access from the Next compatibility store has been retired/);
  assert.match(source, /Configure SYMPOSIUM_API_URL and run the canonical API/);

  const apiSources = await Promise.all([
    "apps/api/src/server.ts",
    "apps/api/src/repository/foundation.ts",
    "apps/api/src/repository/posts.ts",
    "apps/api/src/repository/comments.ts"
  ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")));
  for (const apiSource of apiSources) {
    assert.doesNotMatch(apiSource, /(?:@\/lib|\.\.\/.*)\/dataStore/);
  }

  const childSource = [
    `import(${JSON.stringify(pathToFileURL(sourcePath).href)})`,
    "  .then((store) => store.getSnapshot())",
    "  .then(() => { console.error('database fallback unexpectedly opened'); process.exit(2); })",
    "  .catch((error) => {",
    "    const message = error instanceof Error ? error.message : String(error);",
    "    if (!message.includes('Direct Postgres access from the Next compatibility store has been retired')) {",
    "      console.error(message); process.exit(3);",
    "    }",
    "  });"
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childSource], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://127.0.0.1:1/authority-must-not-connect",
      POSTGRES_URL: "",
      POSTGRES_PRISMA_URL: ""
    }
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "Next compatibility store contains no Postgres client or SQL authority",
      "serialized atomic JSON preview remains explicit",
      "database-configured fallback fails closed before connection or local mutation",
      "canonical API repositories remain independent of the compatibility store"
    ]
  }, null, 2));
};

void main();
