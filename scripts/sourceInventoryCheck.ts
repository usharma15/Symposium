import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compareSourceInventories,
  countSourceLines,
  createSourceInventory,
  formatSourceInventory,
  sourceInventoryProblems,
  sourcePolicy
} from "@/scripts/sourceInventory";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const main = async () => {
  const repositoryBaseline = createSourceInventory(process.cwd(), sourcePolicy.baselineRef);
  assert.deepEqual(repositoryBaseline.totals, { files: 452, physical: 127_151, nonblank: 119_000 });
  assert.deepEqual(sourceInventoryProblems(repositoryBaseline, { checkBaseline: true }), []);

  assert.deepEqual(countSourceLines(Buffer.from("")), { physical: 0, nonblank: 0 });
  assert.deepEqual(countSourceLines(Buffer.from("one")), { physical: 1, nonblank: 1 });
  assert.deepEqual(countSourceLines(Buffer.from("\r\n")), { physical: 1, nonblank: 0 });
  assert.deepEqual(countSourceLines(Buffer.from("one\r\n\r\ntwo\r\n")), { physical: 3, nonblank: 2 });
  assert.throws(() => countSourceLines(Buffer.from([0])), /NUL/);
  assert.throws(() => countSourceLines(Buffer.from([0xff, 0xfe])), /encoded data/);

  const root = await mkdtemp(path.join(tmpdir(), "symposium-source-inventory-"));
  try {
    git(root, "init", "--quiet");
    git(root, "config", "user.email", "source-inventory@example.invalid");
    git(root, "config", "user.name", "Source Inventory Check");
    for (const directory of ["apps/db", "public", "scripts", "src", "styles"]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }
    await writeFile(path.join(root, ".gitignore"), "ignored.ts\n");
    await writeFile(path.join(root, "README.md"), "# Fixture\n");
    await writeFile(path.join(root, "package.json"), "{}\n");
    await writeFile(path.join(root, "playwright.config.ts"), "export {};\n");
    await writeFile(path.join(root, "render.yaml"), "services: []\n");
    await writeFile(path.join(root, "public", "asset.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(path.join(root, "src", "alpha.ts"), "first\n\nthird\n");
    await writeFile(path.join(root, "src", "space # β.ts"), "space\n");
    await writeFile(path.join(root, "src", "blank-crlf.ts"), "\r\n");
    await writeFile(path.join(root, "styles", "theme.css"), "body {}\r\n");
    await writeFile(path.join(root, "scripts", "tool.py"), "#!/usr/bin/env python3\nprint('ok')\n");
    await writeFile(path.join(root, "scripts", "unterminated.mjs"), "export {}");
    await writeFile(path.join(root, "apps", "db", "001.sql"), "select 1;\n");
    await writeFile(path.join(root, "empty.ts"), "");
    await writeFile(path.join(root, "ignored.ts"), "ignored\n");
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "fixture");

    const baseline = createSourceInventory(root, "HEAD");
    assert.deepEqual(baseline.totals, { files: 9, physical: 11, nonblank: 9 });
    assert.deepEqual(baseline.byCategory["production"], { files: 5, physical: 6, nonblank: 4 });
    assert.deepEqual(baseline.byCategory["styles"], { files: 1, physical: 1, nonblank: 1 });
    assert.deepEqual(baseline.byCategory["checks-tools"], { files: 3, physical: 4, nonblank: 4 });
    assert.deepEqual(baseline.unclassifiedSource, []);
    assert.deepEqual(baseline.invalidSource, []);
    assert.equal(baseline.entries.some((entry) => entry.path === "ignored.ts"), false);
    assert.deepEqual(sourceInventoryProblems(baseline, { maximum: 11 }), []);
    assert.equal(JSON.stringify(createSourceInventory(root, "HEAD")), JSON.stringify(baseline));
    assert.match(formatSourceInventory(baseline), /Distance to 99,999: 0/);

    git(root, "mv", "src/space # β.ts", "src/space # β.mts");
    const renamed = createSourceInventory(root);
    assert.deepEqual(renamed.totals, baseline.totals);
    assert.equal(compareSourceInventories(renamed, baseline).totals.physical, 0);
    assert.deepEqual(renamed.byExtension[".mts"], { files: 1, physical: 1, nonblank: 1 });
    git(root, "mv", "src/space # β.mts", "src/space # β.ts");

    await writeFile(path.join(root, "src", "alpha.ts"), "first\nsecond\nthird\n");
    await writeFile(path.join(root, "scripts", "new.ts"), "new\n");
    git(root, "add", "scripts/new.ts");
    await writeFile(path.join(root, "untracked.ts"), "untracked\n");
    const worktree = createSourceInventory(root);
    const delta = compareSourceInventories(worktree, baseline);
    assert.equal(worktree.scope, "worktree");
    assert.equal(worktree.dirty, true);
    assert.ok(worktree.trackedStatus.length >= 2);
    assert.deepEqual(worktree.untrackedSource, ["untracked.ts"]);
    assert.deepEqual(delta.totals, { files: 1, physical: 1, nonblank: 2 });
    assert.deepEqual(delta.byCategory["checks-tools"], { files: 1, physical: 1, nonblank: 1 });
    assert.match(formatSourceInventory(worktree, delta), /dirty worktree/);
    assert.match(sourceInventoryProblems(worktree, { maximum: 12 })[0] ?? "", /Untracked source/);

    await writeFile(path.join(root, "src", "arbitrary.foo"), "not classified\n");
    await writeFile(path.join(root, "src", "nul.ts"), Buffer.from([0]));
    await writeFile(path.join(root, "src", "invalid.ts"), Buffer.from([0xff, 0xfe]));
    await symlink("alpha.ts", path.join(root, "src", "linked.ts"));
    git(root, "add", "src/arbitrary.foo", "src/nul.ts", "src/invalid.ts", "src/linked.ts");
    const rejected = createSourceInventory(root);
    assert.deepEqual(rejected.unclassifiedSource, ["src/arbitrary.foo"]);
    assert.equal(rejected.invalidSource.length, 3);
    assert.match(rejected.invalidSource.join("\n"), /linked\.ts: unsupported Git mode 120000/);
    assert.match(rejected.invalidSource.join("\n"), /nul\.ts: contains a NUL byte/);
    assert.match(rejected.invalidSource.join("\n"), /invalid\.ts:.*encoded data/);
    assert.match(sourceInventoryProblems(rejected, { maximum: 1 })[0] ?? "", /Invalid source/);
    assert.match(sourceInventoryProblems(baseline, { maximum: 10 }).at(-1) ?? "", /ceiling exceeded/i);
    assert.match(
      sourceInventoryProblems(baseline, { checkBaseline: true, maximum: 11 }).at(-1) ?? "",
      /Baseline mismatch/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log("Canonical source inventory checks passed.");
};

void main();
