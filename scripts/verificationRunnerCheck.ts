import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runProcess,
  runVerificationPlan,
  selectVerificationStages,
  writeVerificationReport,
  type VerificationReport,
  type VerificationStageResult
} from "@/scripts/verificationRunner";
import { verificationManifest, type VerificationStage } from "@/scripts/verificationManifest";

const passed = (stage: VerificationStage): VerificationStageResult => ({
  id: stage.id,
  category: stage.category,
  npmScript: stage.script,
  status: "passed",
  exitCode: 0,
  signal: null,
  durationMs: 1,
  stdoutTail: "",
  stderrTail: ""
});

const processExists = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const main = async () => {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const legacyStages = packageJson.scripts["verify:legacy"]?.split("&&")
    .map((command) => command.trim().replace(/^npm run /, ""));
  assert.equal(verificationManifest.length, 66);
  assert.equal(new Set(verificationManifest.map((stage) => stage.id)).size, 66);
  assert.deepEqual(verificationManifest.map((stage) => stage.script), legacyStages);
  for (const stage of verificationManifest) assert.ok(packageJson.scripts[stage.script], `${stage.script} must exist.`);
  assert.equal(selectVerificationStages(["assistant"], []).length, 8);
  assert.deepEqual(selectVerificationStages([], ["build"]).map((stage) => stage.id), ["build"]);

  const root = await mkdtemp(path.join(tmpdir(), "symposium-verification-runner-"));
  try {
    const environment = { ...process.env, SYMPOSIUM_RUNNER_FIXTURE: "present" };
    const success = await runProcess(process.execPath, ["-e", [
      "if (process.env.SYMPOSIUM_RUNNER_FIXTURE !== 'present') process.exit(3);",
      "process.stdout.write(process.cwd() + '\\n');",
      "process.stdout.write('fixture stdout');",
      "process.stderr.write('fixture stderr');"
    ].join("")], { cwd: root, env: environment, tee: false });
    assert.equal(success.status, "passed");
    assert.equal(success.stdoutTail.split("\n")[0], await realpath(root));
    assert.match(success.stdoutTail, /fixture stdout/);
    assert.match(success.stderrTail, /fixture stderr/);

    const failed = await runProcess(process.execPath, ["-e", "process.exit(7)"], { tee: false });
    assert.equal(failed.status, "failed");
    assert.equal(failed.exitCode, 7);

    const tail = await runProcess(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(70000) + 'END'); process.stderr.write('y'.repeat(70000) + 'ERR')"],
      { tee: false }
    );
    assert.ok(Buffer.byteLength(tail.stdoutTail) <= 64 * 1024);
    assert.ok(Buffer.byteLength(tail.stderrTail) <= 64 * 1024);
    assert.ok(tail.stdoutTail.endsWith("END"));
    assert.ok(tail.stderrTail.endsWith("ERR"));

    if (process.platform !== "win32") {
      const signaled = await runProcess(
        process.execPath,
        ["-e", "process.kill(process.pid, 'SIGTERM')"],
        { tee: false }
      );
      assert.equal(signaled.status, "signaled");
      assert.equal(signaled.signal, "SIGTERM");

      const nestedPidPath = path.join(root, "nested.pid");
      const timedOut = await runProcess(process.execPath, ["-e", [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        `writeFileSync(${JSON.stringify(nestedPidPath)}, String(child.pid));`,
        "process.on('SIGTERM', () => {});",
        "setInterval(() => {}, 1000);"
      ].join("")], { timeoutMs: 300, terminationGraceMs: 100, tee: false });
      assert.equal(timedOut.status, "timed-out");
      assert.equal(timedOut.signal, "SIGKILL");
      const nestedPid = Number(await readFile(nestedPidPath, "utf8"));
      for (let attempt = 0; attempt < 20 && processExists(nestedPid); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(processExists(nestedPid), false, "Timed-out process descendants must not survive.");
    }

    const fixtureStages = verificationManifest.slice(0, 3);
    const executed: string[] = [];
    let progressWrites = 0;
    const plan = await runVerificationPlan(
      fixtureStages,
      async (stage) => {
        executed.push(stage.id);
        return stage === fixtureStages[1] ? { ...passed(stage), status: "failed", exitCode: 9 } : passed(stage);
      },
      async () => { progressWrites += 1; }
    );
    assert.deepEqual(executed, fixtureStages.slice(0, 2).map((stage) => stage.id));
    assert.equal(progressWrites, 2);
    assert.deepEqual(plan.notRun, [fixtureStages[2]?.id]);

    const reportPath = path.join(root, "evidence", "verification.json");
    const report: VerificationReport = {
      schemaVersion: 1,
      source: {
        headSha: "fixture",
        dirty: false,
        trackedStatus: [],
        untrackedPaths: 0,
        sourceFiles: 1,
        physicalSourceLines: 1,
        nonblankSourceLines: 1
      },
      selection: { categories: [], stages: [] },
      plannedStages: fixtureStages.map((stage) => stage.id),
      startedAt: "2026-07-29T00:00:00.000Z",
      finishedAt: "2026-07-29T00:00:01.000Z",
      durationMs: 1_000,
      status: "failed",
      stages: plan.results,
      notRun: plan.notRun
    };
    await writeVerificationReport(report, reportPath);
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
    const blocker = path.join(root, "not-a-directory");
    await writeFile(blocker, "block");
    await assert.rejects(writeVerificationReport(report, path.join(blocker, "report.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log("Observable verification runner checks passed.");
};

void main();
