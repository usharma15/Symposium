import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: ".artifacts/browser/results",
  reporter: [["line"], ["json", { outputFile: ".artifacts/browser/report.json" }]],
  use: {
    baseURL: "http://localhost:3117",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node --import tsx scripts/browserCanaryServer.ts",
    url: "http://localhost:3117",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe"
  }
});
