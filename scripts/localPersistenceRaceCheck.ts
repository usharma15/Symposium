import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reportCheck } from "@/scripts/checkReport";

const databaseEnvironmentKeys = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "VERCEL"
] as const;

const main = async () => {
  const originalDirectory = process.cwd();
  const originalEnvironment = Object.fromEntries(
    databaseEnvironmentKeys.map((key) => [key, process.env[key]])
  );
  const root = await mkdtemp(path.join(tmpdir(), "symposium-local-persistence-"));
  try {
    for (const key of databaseEnvironmentKeys) delete process.env[key];
    process.chdir(root);
    const { createPost, getSnapshot } = await import("@/lib/localPreviewStore");

    for (let iteration = 0; iteration < 12; iteration += 1) {
      await rm(path.join(root, ".data"), { recursive: true, force: true });
      const marker = `cold-start-${iteration}`;
      const creates = Array.from({ length: 12 }, (_, index) =>
        createPost({
          title: "",
          body: `${marker}-thought-${index}`,
          kind: "thought",
          postType: "thought",
          room: "amphitheater"
        }, "@udayan")
      );
      const simultaneousReads = Array.from({ length: 12 }, () => getSnapshot());
      const results = await Promise.all([...creates, ...simultaneousReads]);
      const created = results.slice(0, creates.length);
      assert.ok(created.every(Boolean), `Cold-start mutation failed in iteration ${iteration}.`);
      const snapshot = await getSnapshot();
      const retained = snapshot.items.filter((item) => item.body.startsWith(marker));
      assert.equal(retained.length, creates.length, `Cold-start writes were lost in iteration ${iteration}.`);
      assert.equal(new Set(retained.map((item) => item.id)).size, creates.length);
      assert.deepEqual(
        retained.map((item) => item.body).sort(),
        Array.from({ length: creates.length }, (_, index) => `${marker}-thought-${index}`).sort()
      );
    }

    const dataPath = path.join(root, ".data", "symposium.json");
    await mkdir(path.dirname(dataPath), { recursive: true });
    await writeFile(dataPath, "{corrupt", "utf8");
    await assert.rejects(getSnapshot(), /JSON/);

    reportCheck([
      "serialized cold-start local reads and mutations",
      "twelve concurrent first-access writes retained exactly",
      "distinct identifiers across concurrent local creates",
      "repeat cold-start persistence across twelve isolated rounds",
      "corrupt local persistence fails closed without seed replacement"
    ]);
  } finally {
    process.chdir(originalDirectory);
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
};

void main();
