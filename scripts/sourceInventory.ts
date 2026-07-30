import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

export const sourceExtensions = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".css", ".scss", ".py", ".sql", ".sh"
] as const;

const nonSourceExtensions = new Set([
  ".avif", ".example", ".gif", ".ico", ".jpeg", ".jpg", ".json", ".lock",
  ".md", ".otf", ".pdf", ".png", ".svg", ".toml", ".ttf", ".webp", ".woff",
  ".woff2", ".yaml", ".yml"
]);
const textNonSourceExtensions = new Set([".example", ".json", ".lock", ".md", ".toml", ".yaml", ".yml"]);
const nonSourceBasenames = new Set([".gitattributes", ".gitignore", "LICENSE", "NOTICE"]);
const countedExtensions = new Set<string>(sourceExtensions);
const styleExtensions = new Set([".css", ".scss"]);
const checkRoots = ["scripts/", "test/", "tests/"];
const checkFiles = new Set(["playwright.config.ts"]);
const regularModes = new Set(["100644", "100755"]);
const maximumBuffer = 128 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export const sourcePolicy = {
  baselineRef: "8e900d0fa675b311a67029b8d2f109b4da97301e",
  baselinePhysical: 127_151,
  baselineNonblank: 119_000,
  passMaximum: 125_725,
  programMaximum: 99_999
} as const;

export type SourceTotals = { files: number; physical: number; nonblank: number };
type TrackedFile = { path: string; mode: string };
type SourceEntry = SourceTotals & { path: string; extension: string; category: string; root: string };
export type SourceInventory = {
  version: 1;
  scope: "worktree" | "commit";
  ref: string | null;
  sha: string;
  dirty: boolean;
  trackedStatus: string[];
  trackedChanges: number;
  untrackedPaths: number;
  totals: SourceTotals;
  byExtension: Record<string, SourceTotals>;
  byRoot: Record<string, SourceTotals>;
  byCategory: Record<string, SourceTotals>;
  entries: SourceEntry[];
  invalidSource: string[];
  unclassifiedSource: string[];
  untrackedSource: string[];
};
export type SourceInventoryDelta = {
  baselineRef: string;
  totals: SourceTotals;
  byExtension: Record<string, SourceTotals>;
  byRoot: Record<string, SourceTotals>;
  byCategory: Record<string, SourceTotals>;
};

const zero = (): SourceTotals => ({ files: 0, physical: 0, nonblank: 0 });
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const add = (target: SourceTotals, value: SourceTotals, direction = 1) => {
  target.files += direction * value.files;
  target.physical += direction * value.physical;
  target.nonblank += direction * value.nonblank;
  return target;
};
const git = (cwd: string, args: string[], encoding: BufferEncoding | "buffer" = "utf8") =>
  execFileSync("git", args, { cwd, encoding, maxBuffer: maximumBuffer });
const nulRecords = (value: Buffer | string) => value.toString().split("\0").filter(Boolean);

const trackedFiles = (cwd: string, ref: string | null): TrackedFile[] =>
  nulRecords(
    git(cwd, ref ? ["ls-tree", "-r", "-z", ref] : ["ls-files", "--stage", "-z"], "buffer")
  ).map((record) => {
    const separator = record.indexOf("\t");
    if (separator < 0) throw new Error(`Unparseable Git index record: ${record}`);
    return { path: record.slice(separator + 1), mode: record.slice(0, separator).split(" ")[0] ?? "" };
  }).sort((left, right) => compareText(left.path, right.path));

const batchTreeFiles = (cwd: string, ref: string, files: string[]) => {
  if (files.some((file) => file.includes("\n"))) throw new Error("Newlines in source paths are unsupported.");
  const result = spawnSync("git", ["cat-file", "--batch"], {
    cwd,
    input: files.map((file) => `${ref}:${file}\n`).join(""),
    maxBuffer: maximumBuffer
  });
  if (result.status !== 0) throw new Error(result.stderr.toString() || "git cat-file failed.");
  const values = new Map<string, Buffer>();
  let offset = 0;
  for (const file of files) {
    const headerEnd = result.stdout.indexOf(10, offset);
    if (headerEnd < 0) throw new Error(`Missing git cat-file header for ${file}.`);
    const header = result.stdout.subarray(offset, headerEnd).toString();
    if (header.endsWith(" missing")) throw new Error(`Git object is missing for ${file}.`);
    const size = Number(header.split(" ").at(-1));
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid git object size for ${file}.`);
    const start = headerEnd + 1;
    values.set(file, result.stdout.subarray(start, start + size));
    offset = start + size + 1;
  }
  return values;
};

const classifiedNonSource = (file: string) =>
  nonSourceBasenames.has(path.basename(file)) || nonSourceExtensions.has(path.extname(file).toLowerCase());

const sourceCategory = (file: string, extension: string) =>
  styleExtensions.has(extension)
    ? "styles"
    : checkFiles.has(file) || checkRoots.some((prefix) => file.startsWith(prefix))
      ? "checks-tools"
      : "production";

const sourceRoot = (file: string) => file.includes("/") ? file.slice(0, file.indexOf("/")) : "(root)";

export const countSourceLines = (content: Buffer) => {
  if (content.includes(0)) throw new Error("contains a NUL byte");
  const text = utf8.decode(content);
  if (!text) return { physical: 0, nonblank: 0 };
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  return { physical: lines.length, nonblank: lines.filter((line) => /\S/.test(line)).length };
};

const summarize = (entries: SourceEntry[], key: (entry: SourceEntry) => string) => {
  const values: Record<string, SourceTotals> = {};
  for (const entry of entries) add(values[key(entry)] ??= zero(), entry);
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => compareText(left, right)));
};

const statusIdentity = (cwd: string, ref: string | null) => {
  if (ref) return { dirty: false, trackedStatus: [], trackedChanges: 0, untrackedPaths: 0 };
  const rows = git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]).toString()
    .split("\n").filter(Boolean);
  const trackedStatus = rows.filter((row) => !row.startsWith("??")).sort(compareText);
  return {
    dirty: rows.length > 0,
    trackedStatus,
    trackedChanges: trackedStatus.length,
    untrackedPaths: rows.filter((row) => row.startsWith("??")).length
  };
};

export const createSourceInventory = (cwd = process.cwd(), ref: string | null = null): SourceInventory => {
  const tracked = trackedFiles(cwd, ref);
  const contentPaths = tracked
    .filter(({ path: file }) =>
      countedExtensions.has(path.extname(file).toLowerCase()) ||
      textNonSourceExtensions.has(path.extname(file).toLowerCase()) ||
      nonSourceBasenames.has(path.basename(file))
    )
    .map(({ path: file }) => file);
  const treeContent = ref ? batchTreeFiles(cwd, ref, contentPaths) : null;
  const content = (file: string) => treeContent?.get(file) ?? readFileSync(path.join(cwd, file));
  const entries: SourceEntry[] = [];
  const invalidSource: string[] = [];
  const unclassifiedSource: string[] = [];

  for (const trackedFile of tracked) {
    const extension = path.extname(trackedFile.path).toLowerCase();
    if (countedExtensions.has(extension)) {
      try {
        if (!regularModes.has(trackedFile.mode)) throw new Error(`unsupported Git mode ${trackedFile.mode}`);
        entries.push({
          path: trackedFile.path,
          extension,
          category: sourceCategory(trackedFile.path, extension),
          root: sourceRoot(trackedFile.path),
          files: 1,
          ...countSourceLines(content(trackedFile.path))
        });
      } catch (error) {
        invalidSource.push(`${trackedFile.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    if (!classifiedNonSource(trackedFile.path)) {
      unclassifiedSource.push(trackedFile.path);
      continue;
    }
    if (
      (textNonSourceExtensions.has(extension) || nonSourceBasenames.has(path.basename(trackedFile.path))) &&
      content(trackedFile.path).subarray(0, 2).toString() === "#!"
    ) {
      unclassifiedSource.push(`${trackedFile.path} (executable shebang)`);
    }
  }

  const totals = entries.reduce((total, entry) => add(total, entry), zero());
  const untrackedSource = ref ? [] : nulRecords(
    git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], "buffer")
  ).filter((file) => countedExtensions.has(path.extname(file).toLowerCase()) || !classifiedNonSource(file)).sort(compareText);
  return {
    version: 1,
    scope: ref ? "commit" : "worktree",
    ref,
    sha: git(cwd, ["rev-parse", ref ?? "HEAD"]).toString().trim(),
    ...statusIdentity(cwd, ref),
    totals,
    byExtension: summarize(entries, (entry) => entry.extension),
    byRoot: summarize(entries, (entry) => entry.root),
    byCategory: summarize(entries, (entry) => entry.category),
    entries,
    invalidSource,
    unclassifiedSource,
    untrackedSource
  };
};

const recordDelta = (current: Record<string, SourceTotals>, baseline: Record<string, SourceTotals>) => {
  const result: Record<string, SourceTotals> = {};
  for (const name of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const value = add(add(zero(), current[name] ?? zero()), baseline[name] ?? zero(), -1);
    if (value.files || value.physical || value.nonblank) result[name] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => compareText(left, right)));
};

export const compareSourceInventories = (
  current: SourceInventory,
  baseline: SourceInventory
): SourceInventoryDelta => ({
  baselineRef: baseline.ref ?? baseline.sha,
  totals: add(add(zero(), current.totals), baseline.totals, -1),
  byExtension: recordDelta(current.byExtension, baseline.byExtension),
  byRoot: recordDelta(current.byRoot, baseline.byRoot),
  byCategory: recordDelta(current.byCategory, baseline.byCategory)
});

export const sourceInventoryProblems = (
  report: SourceInventory,
  options: { checkBaseline?: boolean; maximum?: number } = {}
) => {
  const problems: string[] = [];
  if (report.invalidSource.length) problems.push(`Invalid source: ${report.invalidSource.join(", ")}`);
  if (report.unclassifiedSource.length) {
    problems.push(`Unclassified tracked files: ${report.unclassifiedSource.join(", ")}`);
  }
  if (report.untrackedSource.length) {
    problems.push(`Untracked source is absent from the canonical metric: ${report.untrackedSource.join(", ")}`);
  }
  const maximum = options.maximum ?? (options.checkBaseline ? sourcePolicy.baselinePhysical : sourcePolicy.passMaximum);
  if (report.totals.physical > maximum) {
    problems.push(`Source ceiling exceeded: ${report.totals.physical} > ${maximum}`);
  }
  if (
    options.checkBaseline &&
    (report.dirty ||
      report.sha !== sourcePolicy.baselineRef ||
      report.totals.physical !== sourcePolicy.baselinePhysical ||
      report.totals.nonblank !== sourcePolicy.baselineNonblank)
  ) {
    problems.push(
      `Baseline mismatch: ${report.sha} has ${report.totals.physical}/${report.totals.nonblank}, ` +
      `expected clean ${sourcePolicy.baselineRef} at ${sourcePolicy.baselinePhysical}/${sourcePolicy.baselineNonblank}`
    );
  }
  return problems;
};

const signed = (value: number) => value > 0 ? `+${value}` : String(value);
export const formatSourceInventory = (report: SourceInventory, delta?: SourceInventoryDelta) => {
  const rows = (values: Record<string, SourceTotals>) =>
    Object.entries(values).map(([name, total]) =>
      `${name.padEnd(18)} ${String(total.files).padStart(4)} files  ${String(total.physical).padStart(7)} physical  ${String(total.nonblank).padStart(7)} nonblank`
    );
  const warnings = [
    ...report.invalidSource.map((file) => `INVALID: ${file}`),
    ...report.unclassifiedSource.map((file) => `UNCLASSIFIED: ${file}`),
    ...report.untrackedSource.map((file) => `UNTRACKED SOURCE: ${file}`)
  ];
  return [
    `Source inventory ${report.sha}${report.ref ? ` (${report.ref})` : report.dirty ? " (dirty worktree)" : ""}`,
    `TOTAL              ${String(report.totals.files).padStart(4)} files  ${String(report.totals.physical).padStart(7)} physical  ${String(report.totals.nonblank).padStart(7)} nonblank`,
    `Distance to 99,999: ${Math.max(0, report.totals.physical - sourcePolicy.programMaximum)}`,
    ...(delta ? [
      `Delta vs ${delta.baselineRef}: ${signed(delta.totals.files)} files, ${signed(delta.totals.physical)} physical, ${signed(delta.totals.nonblank)} nonblank`
    ] : []),
    ...(warnings.length ? ["", ...warnings] : []),
    "", "By category", ...rows(report.byCategory),
    "", "By root", ...rows(report.byRoot),
    "", "By extension", ...rows(report.byExtension)
  ].join("\n");
};

const main = () => {
  const args = new Set(process.argv.slice(2));
  const refIndex = process.argv.indexOf("--ref");
  const ref = refIndex >= 0 ? process.argv[refIndex + 1] : null;
  if (refIndex >= 0 && !ref) throw new Error("--ref requires a Git revision.");
  const report = createSourceInventory(process.cwd(), ref);
  const baseline = ref ? undefined : createSourceInventory(process.cwd(), sourcePolicy.baselineRef);
  const delta = baseline ? compareSourceInventories(report, baseline) : undefined;
  console.log(args.has("--json")
    ? JSON.stringify({ report, ...(delta ? { delta } : {}) }, null, 2)
    : formatSourceInventory(report, delta));
  if (args.has("--check") || args.has("--check-baseline")) {
    const problems = sourceInventoryProblems(report, { checkBaseline: args.has("--check-baseline") });
    if (problems.length) {
      for (const problem of problems) console.error(problem);
      process.exitCode = 1;
    }
  }
};

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
