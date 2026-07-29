import { expect, test, type Page } from "@playwright/test";

const sessionCookie = {
  name: "symposium_entrance_session",
  value: "1",
  domain: "localhost",
  path: "/"
};
const watchDiagnostics = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const source = message.location().url;
    if (message.type() === "error" && (!source || source.startsWith("http://localhost:3117"))) {
      errors.push(`console: ${source} ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().startsWith("http://localhost:3117") && request.failure()?.errorText !== "net::ERR_ABORTED") {
      errors.push(`request: ${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    }
  });
  return () => expect(errors, errors.join("\n")).toEqual([]);
};
const expectImageLoaded = async (locator: ReturnType<Page["locator"]>) => {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
};

test("first session enters the isolated local preview", async ({ page }) => {
  const clean = watchDiagnostics(page);
  await page.goto("/");
  await expect(page.getByRole("main", { name: "Approaching Symposium" })).toBeVisible();
  await expect(page.getByText("Welcome to the Symposium")).toBeVisible();
  await page.getByRole("button", { name: "Enter local preview" }).click({ timeout: 8_000 });
  await expect(page.locator("main.symposium-shell")).toBeVisible();
  await expect(page.locator(".sync-status")).toContainText(/Local preview|Live data connected|Using seed data|Synced locally/);
  clean();
});

test.describe("returning browser session", () => {
  test.beforeEach(async ({ context }) => context.addCookies([sessionCookie]));

  test("hydrates canonical routes and preserves in-app history", async ({ page }) => {
    const clean = watchDiagnostics(page);
    for (const route of ["/", "/rooms/library", "/rooms/amphitheater"]) {
      await page.goto(route);
      await expect(page.locator("main.symposium-shell")).toBeVisible();
    }
    await page.goto("/rooms/library");
    await page.getByTestId("feed-card-paper-bell-epr")
      .getByRole("link", { name: "On the Einstein Podolsky Rosen paradox" }).click();
    await expect(page).toHaveURL(/\/posts\/paper-bell-epr$/);
    const renderedPdfPage = page.locator(".attachment-pdf-page[data-attachment-page='1']");
    const renderedPdfCanvas = renderedPdfPage.locator(".attachment-pdf-original-canvas");
    await expect(renderedPdfCanvas).toHaveAccessibleName(/bell-on-the-einstein.*page 1 of 6/i);
    await expect.poll(() => renderedPdfCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 0)).toBe(true);
    await expect(renderedPdfPage.locator(".attachment-pdf-text-layer span").first()).toBeVisible();
    await expect(renderedPdfPage.getByRole("status", { name: "Preparing page…" })).toHaveCount(0);
    await page.getByRole("navigation", { name: "View history" }).getByTitle("Back").click();
    await expect(page).toHaveURL(/\/rooms\/library$/);
    clean();
  });

  test("keeps Paper and Thought design identities stable across theme and reload", async ({ page }) => {
    const clean = watchDiagnostics(page);
    await page.goto("/posts/paper-bell-epr");
    const paperMuse = page.locator(".authored-paper-title-ceremony[data-paper-muse=calliope]");
    const paperBottom = page.locator(".authored-bottom-caricature[data-bottom-caricature-id=harp-girl]");
    await expect(paperMuse.getByRole("heading", { name: "On the Einstein Podolsky Rosen paradox" })).toBeVisible();
    await expect(paperBottom).toHaveAttribute("data-bottom-fill-contract", "paper-material");
    await expectImageLoaded(paperMuse.locator(".authored-artifact-day"));
    await page.getByTitle("Enter night mode").click();
    await expect(page.locator("main.symposium-shell")).toHaveClass(/night/);
    await expectImageLoaded(paperMuse.locator(".authored-artifact-night"));
    await page.reload();
    await expect(page.locator("main.symposium-shell")).toHaveClass(/night/);
    await expect(page.locator(".authored-paper-title-ceremony")).toHaveAttribute("data-paper-muse", "calliope");
    await expect(page.locator(".authored-bottom-caricature")).toHaveAttribute("data-bottom-caricature-id", "harp-girl");

    await page.goto("/posts/thought-franklin-weather-ledger");
    await expect(page.locator(".authored-thought-opening-muse")).toHaveAttribute("data-thought-muse", "erato");
    await expect(page.locator(".authored-bottom-caricature")).toHaveAttribute("data-bottom-caricature-id", "discus-thrower");
    await expect(page.locator(".authored-bottom-caricature")).toHaveAttribute("data-bottom-fill-contract", "thought-material");
    await expect(page.getByRole("heading", { name: "A weather complaint improves when it acquires a ledger" })).toHaveCount(0);
    clean();
  });

  test("keeps the authored-artifact layouts inside desktop and mobile viewports", async ({ page }) => {
    const clean = watchDiagnostics(page);
    for (const sample of [
      { route: "/posts/paper-bell-epr", width: 1440, height: 1000 },
      { route: "/posts/thought-franklin-weather-ledger", width: 390, height: 844 }
    ]) {
      await page.setViewportSize({ width: sample.width, height: sample.height });
      await page.goto(sample.route);
      await expect(page.locator("main.symposium-shell")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
    clean();
  });
});
