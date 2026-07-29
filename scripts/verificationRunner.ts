import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSourceInventory } from "@/scripts/sourceInventory";
import {
  verificationCategories,
  verificationManifest,
  type VerificationCategory,
  type VerificationStage
} from "@/scripts/verificationManifest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultReportPath = path.join(repositoryRoot, ".artifacts", "refactor", "verification.json");
const tailLimit = 64 * 1024;

export type ProcessResult = {
  status: "passed" | "failed" | "timed-out" | "signaled";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
};
export type VerificationStageResult = ProcessResult & {
  id: string;
  category: VerificationCategory;
  npmScript: string;
};
export type VerificationReport = {
  schemaVersion: 1;
  source: {
    headSha: string;
    dirty: boolean;
    trackedStatus: string[];
    untrackedPaths: number;
    sourceFiles: number;
    physicalSourceLines: number;
    nonblankSourceLines: number;
  };
  selection: { categories: VerificationCategory[]; stages: string[] };
  plannedStages: string[];
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: "running" | "passed" | "failed";
  stages: VerificationStageResult[];
  notRun: string[];
};

const appendTail = (previous: Buffer, chunk: Buffer) => {
  const combined = Buffer.concat([previous, chunk]);
  return combined.length <= tailLimit ? combined : combined.subarray(combined.length - tailLimit);
};

const terminate = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};

export const runProcess = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    terminationGraceMs?: number;
    tee?: boolean;
  } = {}
) => new Promise<ProcessResult>((resolve, reject) => {
  const started = performance.now();
  const child = spawn(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["inherit", "pipe", "pipe"]
  });
  let stdoutTail = Buffer.alloc(0);
  let stderrTail = Buffer.alloc(0);
  let timedOut = false;
  let forwardedSignal: NodeJS.Signals | null = null;
  let forceTimer: NodeJS.Timeout | undefined;
  let settled = false;
  const timeout = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        terminate(child, "SIGTERM");
        forceTimer = setTimeout(() => terminate(child, "SIGKILL"), options.terminationGraceMs ?? 1_000);
      }, options.timeoutMs)
    : undefined;
  const forward = (signal: NodeJS.Signals) => {
    forwardedSignal = signal;
    terminate(child, signal);
    forceTimer ??= setTimeout(() => terminate(child, "SIGKILL"), options.terminationGraceMs ?? 1_000);
  };
  const onInterrupt = () => forward("SIGINT");
  const onTerminate = () => forward("SIGTERM");
  const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    if (forceTimer) clearTimeout(forceTimer);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  child.stdout?.on("data", (value: Buffer) => {
    stdoutTail = appendTail(stdoutTail, value);
    if (options.tee !== false) process.stdout.write(value);
  });
  child.stderr?.on("data", (value: Buffer) => {
    stderrTail = appendTail(stderrTail, value);
    if (options.tee !== false) process.stderr.write(value);
  });
  child.once("error", (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  });
  child.once("close", (exitCode, signal) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve({
      status: timedOut ? "timed-out" : signal || forwardedSignal ? "signaled" : exitCode === 0 ? "passed" : "failed",
      exitCode,
      signal: signal ?? forwardedSignal,
      durationMs: Math.round(performance.now() - started),
      stdoutTail: stdoutTail.toString("utf8"),
      stderrTail: stderrTail.toString("utf8")
    });
  });
});

const npmInvocation = (script: string) => {
  const npmExecPath = process.env.npm_execpath;
  return npmExecPath
    ? { command: process.execPath, args: [npmExecPath, "run", script] }
    : { command: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", script] };
};

export const runVerificationStage = async (stage: VerificationStage): Promise<VerificationStageResult> => {
  const invocation = npmInvocation(stage.script);
  return {
    id: stage.id,
    category: stage.category,
    npmScript: stage.script,
    ...await runProcess(invocation.command, invocation.args)
  };
};

export const runVerificationPlan = async (
  stages: readonly VerificationStage[],
  execute: (stage: VerificationStage) => Promise<VerificationStageResult>,
  progress: (results: VerificationStageResult[]) => Promise<void> = async () => undefined
) => {
  const results: VerificationStageResult[] = [];
  for (const stage of stages) {
    const result = await execute(stage);
    results.push(result);
    await progress(results);
    if (result.status !== "passed") break;
  }
  return { results, notRun: stages.slice(results.length).map((stage) => stage.id) };
};

export const writeVerificationReport = async (report: VerificationReport, reportPath = defaultReportPath) => {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, reportPath);
};

export const selectVerificationStages = (categories: VerificationCategory[], ids: string[]) => {
  if (!categories.length && !ids.length) return [...verificationManifest];
  return verificationManifest.filter((stage) => categories.includes(stage.category) || ids.includes(stage.id));
};

const main = async () => {
  const values = process.argv.slice(2);
  const categories = values.flatMap((value, index) =>
    values[index - 1] === "--category" ? [value as VerificationCategory] : []
  );
  const ids = values.flatMap((value, index) => values[index - 1] === "--stage" ? [value] : []);
  for (const category of categories) {
    if (!verificationCategories.includes(category)) throw new Error(`Unknown verification category: ${category}`);
  }
  for (const id of ids) {
    if (!verificationManifest.some((stage) => stage.id === id)) throw new Error(`Unknown verification stage: ${id}`);
  }
  const stages = selectVerificationStages(categories, ids);
  if (!stages.length) throw new Error("The verification selection matched no stages.");
  const inventory = createSourceInventory(repositoryRoot);
  const started = new Date();
  const report: VerificationReport = {
    schemaVersion: 1,
    source: {
      headSha: inventory.sha,
      dirty: inventory.dirty,
      trackedStatus: inventory.trackedStatus,
      untrackedPaths: inventory.untrackedPaths,
      sourceFiles: inventory.totals.files,
      physicalSourceLines: inventory.totals.physical,
      nonblankSourceLines: inventory.totals.nonblank
    },
    selection: { categories, stages: ids },
    plannedStages: stages.map((stage) => stage.id),
    startedAt: started.toISOString(),
    finishedAt: null,
    durationMs: null,
    status: "running",
    stages: [],
    notRun: stages.map((stage) => stage.id)
  };
  await writeVerificationReport(report);
  const execution = await runVerificationPlan(stages, runVerificationStage, async (results) => {
    report.stages = [...results];
    report.notRun = stages.slice(results.length).map((stage) => stage.id);
    await writeVerificationReport(report);
  });
  const finished = new Date();
  report.stages = execution.results;
  report.notRun = execution.notRun;
  report.finishedAt = finished.toISOString();
  report.durationMs = finished.getTime() - started.getTime();
  report.status = execution.results.every((result) => result.status === "passed") ? "passed" : "failed";
  await writeVerificationReport(report);
  console.log(`Verification ${report.status}: ${report.stages.length}/${stages.length} stages; evidence ${defaultReportPath}`);
  if (report.status !== "passed") process.exitCode = 1;
};

if (fileURLToPath(import.meta.url) === process.argv[1]) void main();
