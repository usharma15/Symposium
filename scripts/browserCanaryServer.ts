import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryName = "symposium-browser-canary-";
const temporaryPrefix = path.join(tmpdir(), temporaryName);
const allowedEnvironmentKeys = ["CI", "FORCE_COLOR", "LANG", "LC_ALL", "NO_COLOR", "PATH", "TEMP", "TMP", "TMPDIR"];

export const createBrowserCanaryEnvironment = (source: Readonly<Record<string, string | undefined>> = process.env): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(allowedEnvironmentKeys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]])),
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_ENV: "development",
  SYMPOSIUM_AI_ENABLED: "false",
  SYMPOSIUM_ALLOW_DEV_ACTOR: "true",
  SYMPOSIUM_REQUIRE_AUTH: "false",
  SYMPOSIUM_STRICT_ENV: "false",
  WATCHPACK_POLLING: "true"
});

const copyTrackedTree = async (projectRoot: string) => {
  const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  }).split("\0").filter(Boolean);
  for (const trackedPath of trackedPaths) {
    const source = path.resolve(repositoryRoot, trackedPath);
    const target = path.resolve(projectRoot, trackedPath);
    if (!source.startsWith(`${repositoryRoot}${path.sep}`) || !target.startsWith(`${projectRoot}${path.sep}`)) {
      throw new Error(`Tracked path escapes the browser fixture: ${trackedPath}`);
    }
    const metadata = await lstat(source);
    if (!metadata.isFile()) throw new Error(`Tracked path must be a regular file: ${trackedPath}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
};

const main = async () => {
  const projectRoot = await mkdtemp(temporaryPrefix);
  const environment = createBrowserCanaryEnvironment();
  let child: ChildProcess | undefined;
  let requestedSignal: NodeJS.Signals | undefined;
  const terminate = (signal: NodeJS.Signals) => {
    requestedSignal = signal;
    if (!child?.pid) return;
    try {
      child.kill(signal);
    } catch {
      // The child may have completed between the readiness check and signal.
    }
  };
  const stop = (signal: NodeJS.Signals) => {
    terminate(signal);
    setTimeout(() => terminate("SIGKILL"), 2_000).unref();
  };
  const onInterrupt = () => stop("SIGINT");
  const onTerminate = () => stop("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    await copyTrackedTree(projectRoot);
    const npm = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");
    execFileSync(npm, ["ci", "--include=dev", "--cache", path.join(repositoryRoot, ".artifacts", "npm-cache")], {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit"
    });
    if (requestedSignal) {
      process.exitCode = 1;
      return;
    }
    const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child = spawn(process.execPath, [nextCli, "dev", projectRoot, "--webpack", "--hostname", "localhost", "--port", "3117"], {
        cwd: projectRoot,
        env: environment,
        stdio: "inherit"
      });
      child.once("error", reject);
      child.once("close", (code, signal) => resolve(signal ? 1 : code ?? 1));
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    terminate("SIGKILL");
    if (path.dirname(projectRoot) !== tmpdir() || !path.basename(projectRoot).startsWith(temporaryName)) {
      throw new Error("Refusing unsafe browser-fixture cleanup.");
    }
    await rm(projectRoot, { recursive: true, force: true });
  }
};

const selfTest = () => {
  const environment = createBrowserCanaryEnvironment({
    PATH: "trusted", NODE_OPTIONS: "--require=evil", NPM_CONFIG_USERCONFIG: "/secret",
    CLERK_SECRET_KEY: "secret", SYMPOSIUM_API_URL: "https://production.invalid"
  });
  assert.equal(environment.PATH, "trusted");
  assert.equal(environment.NODE_ENV, "development");
  for (const key of ["NODE_OPTIONS", "NPM_CONFIG_USERCONFIG", "CLERK_SECRET_KEY", "SYMPOSIUM_API_URL"]) {
    assert.equal(key in environment, false, `${key} leaked into browser fixture`);
  }
  console.log("Browser canary environment checks passed.");
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--self-test")) selfTest();
  else void main();
}
