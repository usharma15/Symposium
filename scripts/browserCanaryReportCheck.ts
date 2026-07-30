import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const expectedCanaries = [
  "symposium-canary.spec.ts\0first session enters the isolated local preview",
  "symposium-canary.spec.ts\0serializes simultaneous local preview writes without loss",
  "symposium-canary.spec.ts\0hydrates canonical routes and preserves in-app history",
  "symposium-canary.spec.ts\0keeps Paper and Thought design identities stable across theme and reload",
  "symposium-canary.spec.ts\0keeps the authored-artifact layouts inside desktop and mobile viewports",
  "symposium-canary.spec.ts\0creates, edits, and durably reloads a titleless Thought"
].sort();

type RecordValue = Record<string, any>;
const collectSpecs = (suites: RecordValue[]): RecordValue[] =>
  suites.flatMap((suite) => [...(suite.specs ?? []), ...collectSpecs(suite.suites ?? [])]);

export const checkBrowserCanaryReport = (report: RecordValue) => {
  assert.equal(report.config?.version, "1.62.0", "unexpected Playwright version");
  assert.equal(report.config?.workers, 1, "browser canaries must remain serial");
  assert.deepEqual(
    {
      expected: report.stats?.expected,
      skipped: report.stats?.skipped,
      unexpected: report.stats?.unexpected,
      flaky: report.stats?.flaky
    },
    { expected: expectedCanaries.length, skipped: 0, unexpected: 0, flaky: 0 }
  );
  assert.deepEqual(report.errors, [], "report-level browser errors");
  const specs = collectSpecs(report.suites ?? []);
  assert.deepEqual(specs.map((spec) => `${spec.file}\0${spec.title}`).sort(), expectedCanaries);
  for (const spec of specs) {
    assert.equal(spec.ok, true, `${spec.title}: not ok`);
    assert.equal(spec.tests?.length, 1, `${spec.title}: unexpected test variants`);
    const test = spec.tests[0];
    assert.equal(test.expectedStatus, "passed", `${spec.title}: expected status changed`);
    assert.equal(test.status, "expected", `${spec.title}: final status`);
    assert.equal(test.results?.length, 1, `${spec.title}: retries or missing result`);
    assert.equal(test.results[0].status, "passed", `${spec.title}: result status`);
    assert.deepEqual(test.results[0].errors, [], `${spec.title}: result errors`);
  }
};

const reportPath = process.argv[2] ?? ".artifacts/browser/report.json";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--self-test")) {
    const specs = expectedCanaries.map((key) => {
      const [file, title] = key.split("\0");
      return { file, title, ok: true, tests: [{ expectedStatus: "passed", status: "expected",
        results: [{ status: "passed", errors: [] }] }] };
    });
    const fixture = { config: { version: "1.62.0", workers: 1 },
      stats: { expected: expectedCanaries.length, skipped: 0, unexpected: 0, flaky: 0 }, errors: [], suites: [{ specs }] };
    checkBrowserCanaryReport(fixture);
    assert.throws(() => checkBrowserCanaryReport({ ...fixture, suites: [] }));
    assert.throws(() => checkBrowserCanaryReport({ ...fixture, stats: { ...fixture.stats, skipped: 1 } }));
    console.log("Browser canary report integrity checks passed.");
  } else {
    checkBrowserCanaryReport(JSON.parse(readFileSync(reportPath, "utf8")));
    console.log("Exact browser canary report verified.");
  }
}
