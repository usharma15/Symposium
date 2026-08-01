import { expect, test, type Page, type Route } from "@playwright/test";

const sessionCookie = {
  name: "symposium_entrance_session",
  value: "1",
  domain: "localhost",
  path: "/"
};
const watchDiagnostics = (
  page: Page,
  allowedRequestFailures: readonly string[] = []
) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const source = message.location().url;
    const expectedNetworkFailure = allowedRequestFailures.some((failure) =>
      message.text().includes(failure)
    );
    if (
      message.type() === "error" &&
      !expectedNetworkFailure &&
      (!source || source.startsWith("http://localhost:3117"))
    ) {
      errors.push(`console: ${source} ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    if (
      request.url().startsWith("http://localhost:3117") &&
      failure !== "net::ERR_ABORTED" &&
      !allowedRequestFailures.includes(failure)
    ) {
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

test("replays entrance and retires the previous local session on sign-out", async ({ page }) => {
  const clean = watchDiagnostics(page);
  await page.goto("/");
  await expect(
    page.getByRole("main", { name: "Approaching Symposium" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Enter local preview" }).click({
    timeout: 8_000
  });
  await page.getByRole("link", { name: "Open your profile" }).click();
  await expect(page).toHaveURL(/\/profiles\/udayan$/);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByText("Profile settings", { exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(
    page.getByRole("main", { name: "Approaching Symposium" })
  ).toBeVisible();
  await expect(page.locator("main.symposium-shell")).toHaveCount(0);
  await page.getByRole("button", { name: "Enter local preview" }).click({
    timeout: 8_000
  });
  await expect(page.locator("main.symposium-shell")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your profile" }))
    .toHaveAttribute("href", "/profiles/udayan");
  clean();
});

test("serializes simultaneous local preview writes without loss", async ({ request }) => {
  const bodies = Array.from(
    { length: 12 },
    (_, index) => `Browser concurrency proof ${index + 1}: every write persists.`
  );
  const responses = await Promise.all(bodies.map((body) => request.post("/api/posts", {
    data: {
      title: "",
      body,
      kind: "thought",
      postType: "thought",
      room: "amphitheater",
      authorHandle: "@udayan",
      attachmentIds: []
    }
  })));
  responses.forEach((response) => expect(response.ok()).toBe(true));
  const ids = await Promise.all(responses.map(async (response) =>
    ((await response.json()) as { item: { id: string } }).item.id
  ));
  expect(new Set(ids).size).toBe(bodies.length);

  const persisted = await request.get(`/api/posts?actorHandle=%40udayan&ids=${ids.join(",")}`);
  expect(persisted.ok()).toBe(true);
  const snapshot = await persisted.json() as { items: Array<{ body: string; id: string }> };
  expect(new Set(snapshot.items.map((item) => item.id))).toEqual(new Set(ids));
  expect(new Set(snapshot.items.map((item) => item.body))).toEqual(new Set(bodies));
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

  test("keeps profile activity, social navigation, and follow state authoritative across reload", async ({ page }) => {
    const clean = watchDiagnostics(page);
    const profileActivityResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname.startsWith("/api/profiles/")
        && url.pathname.endsWith("/activity");
    });
    await page.goto("/profiles/plato");
    expect((await profileActivityResponse).ok()).toBe(true);
    await expect(page.getByRole("heading", { name: "Plato" })).toBeVisible();
    await expect(page.locator('section[aria-label="Plato profile feed"]')).toHaveAttribute("aria-busy", "false");

    const activityTotals = page.locator('[aria-label="Plato activity totals"]');
    await activityTotals.getByText("Likes", { exact: true }).click();
    await expect(page).toHaveURL(/\/profiles\/plato\/likes$/);
    await expect(activityTotals.locator("a.active")).toContainText("Likes");

    const socialGraph = page.locator('[aria-label="Plato social graph"]');
    await socialGraph.getByText("Followers", { exact: true }).click();
    await expect(page).toHaveURL(/\/profiles\/plato\/followers$/);
    await expect(page.locator('section[aria-label="Followers"]')).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

    const followButton = page.getByRole("button", { name: "Follow", exact: true });
    const followResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST"
        && url.pathname.endsWith("/follow");
    });
    await followButton.click();
    expect((await followResponse).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Following", exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Plato" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Following", exact: true })).toBeVisible();

    const unfollowResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "DELETE"
        && url.pathname.endsWith("/follow");
    });
    await page.getByRole("button", { name: "Following", exact: true }).click();
    expect((await unfollowResponse).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Follow", exact: true })).toBeVisible();
    clean();
  });

  test("keeps global and community discovery authoritative across rapid queries", async ({ page }) => {
    const clean = watchDiagnostics(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const search = page.getByPlaceholder("Search posts, comments, people");
    await expect(search).toBeFocused();

    const firstRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "GET"
        && url.pathname === "/api/search"
        && url.searchParams.get("q") === "olives";
    });
    await search.fill("olives");
    await firstRequest;

    const finalResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname === "/api/search"
        && url.searchParams.get("q") === "Einstein Podolsky Rosen"
        && url.searchParams.get("limit") === "16"
        && Boolean(url.searchParams.get("actorHandle"));
    });
    await search.fill("Einstein Podolsky Rosen");
    expect((await finalResponse).ok()).toBe(true);
    const eprResult = page.getByRole("link", {
      name: /On the Einstein Podolsky Rosen paradox/
    });
    await expect(eprResult).toBeVisible();
    await page.waitForTimeout(400);
    await expect(search).toHaveValue("Einstein Podolsky Rosen");
    await expect(eprResult).toBeVisible();
    await expect(eprResult).toHaveAttribute("href", "/posts/paper-bell-epr");

    await page.goto("/communities/science-rebirth-commons");
    await expect(page.getByRole("heading", { name: "Science Rebirth Commons" })).toBeVisible();
    const communitySearch = page.getByPlaceholder("Search this community");
    const communityResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname === "/api/search"
        && url.searchParams.get("q") === "glamorous instrument"
        && url.searchParams.get("communityId") === "science-rebirth-commons"
        && url.searchParams.get("limit") === "50";
    });
    await communitySearch.fill("glamorous instrument");
    expect((await communityResponse).ok()).toBe(true);
    await expect(
      page.getByText(/Not the glamorous instrument\./)
    ).toBeVisible();
    clean();
  });

  test("keeps Notifications transport and optimistic recovery authoritative", async ({ page }) => {
    const clean = watchDiagnostics(page, ["409 (Conflict)"]);
    const actorHandle = "@udayan";
    const recordedRequests: Array<{
      body: Record<string, unknown> | null;
      method: string;
      path: string;
      search: string;
    }> = [];
    const now = "2026-07-31T12:00:00.000Z";
    const notification = (
      index: number,
      title: string,
      readAt: string | null
    ) => ({
      id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      groupKey: `browser-notification-${index}`,
      groupCount: 1,
      actorHandles: ["@plato"],
      priority: "activity",
      actionLabel: null,
      kind: "post_signal",
      title,
      body: `${title} body`,
      href: null,
      readAt,
      resolvedAt: null,
      metadata: {},
      createdAt: `2026-07-31T11:${String(60 - index).padStart(2, "0")}:00.000Z`
    });
    const initialNotifications = [
      notification(1, "Browser authority unread one", null),
      notification(2, "Browser authority unread two", null),
      notification(3, "Browser authority already read", now)
    ];
    const olderNotification = notification(4, "Browser authority older", now);
    let preferences = {
      activityEnabled: true,
      likes: true,
      commentsAndReplies: true,
      reshares: true,
      quotes: true,
      newFollowers: true,
      workspaceActivity: true,
      revision: 1,
      updatedAt: now
    };
    let preferenceReads = 0;
    let preferenceWrites = 0;

    await page.route("**/api/notifications**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const rawBody = request.postData();
      const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : null;
      recordedRequests.push({
        body,
        method: request.method(),
        path: url.pathname,
        search: url.search
      });

      if (request.method() === "GET" && url.pathname === "/api/notifications/unread") {
        await route.fulfill({ json: { unreadCount: 2 } });
        return;
      }
      if (request.method() === "GET" && url.pathname === "/api/notifications/preferences") {
        preferenceReads += 1;
        await route.fulfill({ json: preferences });
        return;
      }
      if (request.method() === "PATCH" && url.pathname === "/api/notifications/preferences") {
        preferenceWrites += 1;
        if (preferenceWrites === 2) {
          preferences = {
            ...preferences,
            commentsAndReplies: true,
            revision: preferences.revision + 1,
            updatedAt: "2026-07-31T12:02:00.000Z"
          };
          await route.fulfill({ status: 409, json: { error: "revision_conflict" } });
          return;
        }
        preferences = {
          ...preferences,
          ...(body?.changes as Record<string, boolean>),
          revision: preferences.revision + 1,
          updatedAt: "2026-07-31T12:01:00.000Z"
        };
        await route.fulfill({ json: preferences });
        return;
      }
      if (request.method() === "GET" && url.pathname === "/api/notifications") {
        await route.fulfill({
          json: url.searchParams.get("cursor")
            ? { notifications: [olderNotification], unreadCount: 2, nextCursor: null }
            : { notifications: initialNotifications, unreadCount: 2, nextCursor: "browser cursor/+" }
        });
        return;
      }
      if (
        request.method() === "POST" &&
        (url.pathname === "/api/notifications/read" || url.pathname === "/api/notifications/archive")
      ) {
        await route.fulfill({ json: { ok: true } });
        return;
      }
      await route.abort("failed");
    });

    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Notifications · 2 unread" });
    await expect(trigger).toBeVisible();
    expect(recordedRequests.find((entry) => entry.path.endsWith("/unread"))).toMatchObject({
      method: "GET",
      search: "?actorHandle=%40udayan"
    });

    await trigger.click();
    await expect(page.getByRole("region", { name: "Notifications" })).toBeVisible();
    await expect(page.getByText("Browser authority unread one", { exact: true })).toBeVisible();
    const firstPageRead = recordedRequests.find((entry) =>
      entry.method === "GET" && entry.path === "/api/notifications" && !entry.search.includes("cursor=")
    );
    expect(firstPageRead?.search).toBe("?actorHandle=%40udayan&limit=50");

    await page.getByRole("button", { name: /View all notifications/ }).click();
    await page.getByRole("button", { name: "Load older notifications" }).click();
    await expect(page.getByText("Browser authority older", { exact: true })).toBeVisible();
    expect(recordedRequests.find((entry) => entry.search.includes("cursor="))?.search)
      .toBe("?actorHandle=%40udayan&limit=50&cursor=browser+cursor%2F%2B");

    await page.getByRole("button", { name: "Notification settings" }).click();
    await expect(page.getByRole("region", { name: "Notification settings" })).toBeVisible();
    const likes = page.getByRole("switch", { name: /Likes/ });
    await expect(likes).toHaveAttribute("aria-checked", "true");
    await likes.click();
    await expect(likes).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(".notification-preferences-status")).toHaveText("Saved");

    const comments = page.getByRole("switch", { name: /Comments, replies & mentions/ });
    await comments.click();
    await expect.poll(() => preferenceReads).toBe(2);
    await expect(comments).toHaveAttribute("aria-checked", "true");
    expect(recordedRequests.filter((entry) => entry.method === "PATCH").map((entry) => entry.body))
      .toEqual([
        { actorHandle, expectedRevision: 1, changes: { likes: false } },
        { actorHandle, expectedRevision: 2, changes: { commentsAndReplies: false } }
      ]);

    await page.getByRole("button", { name: "Back to notifications" }).click();
    const firstUnread = page.locator(".notification-card-main").filter({
      hasText: "Browser authority unread one"
    });
    await firstUnread.click();
    await expect(page.getByRole("button", { name: "Notifications · 1 unread" })).toBeVisible();
    await page.getByRole("button", { name: "Mark all notifications read" }).click();
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Archive Browser authority unread one" }).click();
    await expect(page.getByText("Browser authority unread one", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear read notifications" }).click();
    await expect(page.getByText("You are all caught up.")).toBeVisible();

    expect(recordedRequests.filter((entry) => entry.path === "/api/notifications/read").map((entry) => entry.body))
      .toEqual([
        {
          actorHandle,
          notificationId: initialNotifications[0].id,
          groupKey: initialNotifications[0].groupKey
        },
        { actorHandle, all: true }
      ]);
    expect(recordedRequests.filter((entry) => entry.path === "/api/notifications/archive").map((entry) => entry.body))
      .toEqual([
        {
          actorHandle,
          notificationId: initialNotifications[0].id,
          groupKey: initialNotifications[0].groupKey
        },
        { actorHandle, clearRead: true }
      ]);

    await page.keyboard.press("Escape");
    await expect(page.locator(".notifications-panel")).toHaveCount(0);
    clean();
  });

  test("keeps Workspace gateway, cache precedence, persistence, and cross-tab revisions authoritative", async ({
    context,
    page
  }) => {
    test.setTimeout(90_000);
    const clean = watchDiagnostics(page);
    const secondPage = await context.newPage();
    const cleanSecondPage = watchDiagnostics(secondPage);
    try {
      const firstSnapshot = page.waitForResponse((response) =>
        response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/workspace"
      );
      const secondSnapshot = secondPage.waitForResponse((response) =>
        response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/workspace"
      );
      await Promise.all([
        page.goto("/workspace?view=notes"),
        secondPage.goto("/workspace?view=notes")
      ]);
      expect((await firstSnapshot).ok()).toBe(true);
      expect((await secondSnapshot).ok()).toBe(true);
      await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
      await expect(secondPage.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "New draft" }).click();
      const createRequest = page.waitForRequest((request) =>
        request.method() === "POST"
        && new URL(request.url()).pathname === "/api/workspace/documents"
      );
      const createResponse = page.waitForResponse((response) =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/workspace/documents"
      );
      await page.locator(".workspace-create-menu").getByRole("button", { name: /^Note\b/ }).click();
      const createdRequest = await createRequest;
      const createdResponse = await createResponse;
      expect(createdResponse.ok()).toBe(true);
      expect(createdRequest.headers()["idempotency-key"])
        .toMatch(/^symposium:workspace-document-create:[0-9a-f-]{36}$/);
      expect(createdRequest.postDataJSON()).toMatchObject({
        actorHandle: "@udayan",
        attachmentIds: [],
        body: "",
        kind: "note",
        notebookId: null,
        opportunity: null,
        proposal: null,
        publicationTarget: "undecided",
        targetId: null,
        title: "Untitled note"
      });
      const created = await createdResponse.json() as { document: { id: string; revision: number } };
      const documentId = created.document.id;
      await expect(page.getByTestId(`workspace-detail-${documentId}`)).toBeVisible();
      await expect(secondPage.getByRole("button", { name: "Untitled note", exact: true })).toBeVisible();

      const canonicalTitle = "Browser Workspace canonical revision";
      const canonicalBody = "Browser proof: Workspace gateway revisions survive reload and another tab.";
      await page.locator(".workspace-title-input").fill(canonicalTitle);
      await page.locator(".workspace-editor .ProseMirror").fill(canonicalBody);
      const saveRequest = page.waitForRequest((request) => {
        if (request.method() !== "PATCH" || new URL(request.url()).pathname !== `/api/workspace/documents/${documentId}`) return false;
        return (request.postDataJSON() as { checkpoint?: boolean }).checkpoint === true;
      });
      const saveResponse = page.waitForResponse((response) => {
        if (response.request().method() !== "PATCH" || new URL(response.url()).pathname !== `/api/workspace/documents/${documentId}`) return false;
        return (response.request().postDataJSON() as { checkpoint?: boolean }).checkpoint === true;
      });
      await page.getByRole("button", { name: "Save Draft" }).click();
      const savedRequest = await saveRequest;
      expect((await saveResponse).ok()).toBe(true);
      expect(savedRequest.headers()["idempotency-key"])
        .toMatch(/^symposium:workspace-document-checkpoint:[0-9a-f-]{36}$/);
      expect(savedRequest.postDataJSON()).toMatchObject({
        actorHandle: "@udayan",
        attachmentIds: [],
        body: canonicalBody,
        checkpoint: true,
        expectedRevision: created.document.revision,
        kind: "note",
        publicationTarget: "undecided",
        title: canonicalTitle
      });
      await expect(page.locator(".workspace-save-state")).toHaveText(/Draft saved/);
      await expect(secondPage.getByRole("button", { name: canonicalTitle, exact: true })).toBeVisible();

      const staleTitle = "Browser Workspace stale cache";
      await page.evaluate(({ documentId: id, staleTitle: title }) => {
        const key = "symposium-workspace-v1:@udayan";
        const raw = window.localStorage.getItem(key);
        if (!raw) throw new Error("Workspace cache was not written.");
        const snapshot = JSON.parse(raw) as {
          documents: Array<{ id: string; title: string; body: string; document: unknown }>;
        };
        const document = snapshot.documents.find((candidate) => candidate.id === id);
        if (!document) throw new Error("Saved Workspace document was absent from the cache.");
        document.title = title;
        document.body = "Stale cached body";
        document.document = {
          version: 1,
          nodes: [{
            id: "stale-cache-paragraph",
            type: "paragraph",
            content: [{ text: "Stale cached body" }],
            align: "left",
            indent: 0
          }]
        };
        window.localStorage.setItem(key, JSON.stringify(snapshot));
      }, { documentId, staleTitle });

      let delayedCanonicalRead = false;
      const delayWorkspaceRead = async (route: Route) => {
        const url = new URL(route.request().url());
        if (!delayedCanonicalRead && route.request().method() === "GET" && url.pathname === "/api/workspace") {
          delayedCanonicalRead = true;
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
        await route.continue();
      };
      await page.route("**/api/workspace**", delayWorkspaceRead);
      const canonicalReload = page.waitForResponse((response) =>
        response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/workspace"
      );
      await page.reload();
      await expect(page.getByRole("heading", { name: staleTitle, exact: true })).toBeVisible();
      expect((await canonicalReload).ok()).toBe(true);
      await expect(page.getByRole("heading", { name: canonicalTitle, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: staleTitle, exact: true })).toHaveCount(0);
      await expect(page.getByTestId(`workspace-card-${documentId}`).getByText(canonicalBody, { exact: true })).toBeVisible();
      await page.unroute("**/api/workspace**", delayWorkspaceRead);

      page.once("dialog", (dialog) => void dialog.accept());
      const deleteRequest = page.waitForRequest((request) =>
        request.method() === "DELETE"
        && new URL(request.url()).pathname === `/api/workspace/documents/${documentId}`
      );
      const deleteResponse = page.waitForResponse((response) =>
        response.request().method() === "DELETE"
        && new URL(response.url()).pathname === `/api/workspace/documents/${documentId}`
      );
      await page.getByTestId(`workspace-card-${documentId}`).getByTitle("Delete draft").click();
      const deletedRequest = await deleteRequest;
      expect((await deleteResponse).ok()).toBe(true);
      expect(deletedRequest.headers()["idempotency-key"])
        .toMatch(/^symposium:workspace-document-delete:[0-9a-f-]{36}$/);
      expect(deletedRequest.postDataJSON()).toMatchObject({ actorHandle: "@udayan" });
      await expect(secondPage.getByRole("button", { name: canonicalTitle, exact: true })).toHaveCount(0);
      cleanSecondPage();
    } finally {
      await secondPage.close();
    }
    clean();
  });

  test("routes canonical live events without a bootstrap refresh", async ({ page }) => {
    const clean = watchDiagnostics(page);
    const sourceResponse = await page.request.get(
      "/api/posts/paper-bell-epr?actorHandle=%40udayan"
    );
    expect(sourceResponse.ok()).toBe(true);
    const source = await sourceResponse.json() as {
      item: Record<string, unknown> & { id: string; revision?: number };
    };
    const liveBody =
      "Browser live-routing proof: the canonical stream projection arrived without a bootstrap refresh.";
    const liveTitle =
      "Browser live-routing proof: canonical title projection";
    const liveItem = {
      ...source.item,
      title: liveTitle,
      body: liveBody,
      excerpt: liveBody,
      revision: (source.item.revision ?? 1) + 1000
    };
    let releaseEvent: () => void = () => undefined;
    const eventGate = new Promise<void>((resolve) => {
      releaseEvent = resolve;
    });
    let delivered = false;
    await page.route("**/api/events/stream*", async (route) => {
      if (!delivered) {
        await eventGate;
        delivered = true;
        await route.fulfill({
          contentType: "text/event-stream; charset=utf-8",
          body: [
            "retry: 2000",
            "",
            "event: symposium-ready",
            "data: {\"ok\":true}",
            "",
            "event: symposium-event",
            "id: browser-live-routing-cursor",
            `data: ${JSON.stringify({
              id: "browser-live-routing-event",
              cursor: "browser-live-routing-cursor",
              kind: "post.updated",
              actorHandle: "@udayan",
              subjectType: "post",
              subjectId: liveItem.id,
              payload: { item: liveItem },
              createdAt: "2026-07-30T12:34:56.000Z"
            })}`,
            "",
            ""
          ].join("\n")
        });
        return;
      }
      await route.fulfill({
        contentType: "text/event-stream; charset=utf-8",
        body: "event: symposium-ready\ndata: {\"ok\":true}\n\n"
      });
    });

    const initialDetail = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/posts/paper-bell-epr"
    );
    await page.goto("/posts/paper-bell-epr");
    expect((await initialDetail).ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: "On the Einstein Podolsky Rosen paradox" })
    ).toBeVisible();

    const unexpectedAuthoritativeReads: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "GET"
        && (url.pathname === "/api/bootstrap" || url.pathname === "/api/posts/paper-bell-epr")
      ) {
        unexpectedAuthoritativeReads.push(url.pathname);
      }
    });
    releaseEvent();
    await expect(page.getByRole("heading", { name: liveTitle })).toBeVisible();
    await page.waitForTimeout(300);
    expect(unexpectedAuthoritativeReads).toEqual([]);
    clean();
  });

  test("replays missed live events after offline recovery without a reload", async ({
    context,
    page,
    request
  }) => {
    const clean = watchDiagnostics(page, [
      "net::ERR_INTERNET_DISCONNECTED",
      "net::ERR_NETWORK_CHANGED"
    ]);
    const baselineCursor =
      "2026-07-31T06:40:00.000Z::00000000-0000-4000-8000-000000000001";
    const replayCursor =
      "2026-07-31T06:40:01.000Z::00000000-0000-4000-8000-000000000002";
    let replayItem: Record<string, unknown> | null = null;
    let replayDelivered = false;
    const requestedCursors: Array<string | null> = [];
    await page.route("**/api/events*", async (route) => {
      const url = new URL(route.request().url());
      if (
        route.request().method() !== "GET" ||
        url.pathname !== "/api/events"
      ) {
        await route.continue();
        return;
      }
      const cursor = url.searchParams.get("cursor");
      requestedCursors.push(cursor);
      const event = replayItem && cursor === baselineCursor && !replayDelivered
        ? {
            id: "00000000-0000-4000-8000-000000000002",
            cursor: replayCursor,
            kind: "post.created",
            actorHandle: "@udayan",
            subjectType: "post",
            subjectId: String(replayItem.id),
            payload: { item: replayItem },
            createdAt: "2026-07-31T06:40:01.000Z"
          }
        : null;
      if (event) replayDelivered = true;
      await route.fulfill({
        json: {
          events: event ? [event] : [],
          cursor: event ? replayCursor : baselineCursor
        }
      });
    });
    const initialCursorResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/events"
    );
    await page.goto("/rooms/amphitheater");
    expect((await initialCursorResponse).ok()).toBe(true);
    await expect(page.locator(".sync-status")).toContainText(
      "Live data connected"
    );

    await context.setOffline(true);
    await expect(page.locator(".sync-status")).toContainText(
      "Live updates reconnecting"
    );

    const body =
      "Browser recovery proof: the event created offline arrived after cursor replay.";
    const create = await request.post("/api/posts", {
      data: {
        attachmentIds: [],
        authorHandle: "@udayan",
        body,
        kind: "thought",
        postType: "thought",
        room: "amphitheater",
        title: ""
      }
    });
    expect(create.ok()).toBe(true);
    replayItem = ((await create.json()) as {
      item: Record<string, unknown>;
    }).item;

    await context.setOffline(false);
    await expect(page.getByText(body, { exact: true })).toBeVisible();
    expect(replayDelivered).toBe(true);
    expect(requestedCursors).toContain(baselineCursor);
    await expect(page.locator(".sync-status")).toContainText(
      "Live data connected"
    );
    await expect(page).toHaveURL(/\/rooms\/amphitheater$/);
    clean();
  });

  test("creates, edits, and durably reloads a titleless Thought", async ({ page, browser }) => {
    const clean = watchDiagnostics(page);
    const initial = "Browser proof: titleless Thought creation persists.";
    const edited = "Browser proof: titleless Thought editing persists.";
    await page.goto("/");
    await page.getByRole("button", { name: "New post" }).click();
    const composer = page.locator("form.post-composer-modal");
    await expect(composer.locator('input[placeholder="Title"]')).toHaveCount(0);
    await composer.locator(".ProseMirror").fill(initial);
    const createResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/posts"
    );
    await composer.getByRole("button", { name: "Post", exact: true }).click();
    expect((await createResponse).ok()).toBe(true);
    await expect(page).toHaveURL(/\/posts\/post-/);
    await expect(page.getByText(initial, { exact: true })).toBeVisible();
    await expect(page.locator(".post-detail-title")).toHaveCount(0);
    const canonicalUrl = page.url();
    const postId = new URL(canonicalUrl).pathname.split("/").at(-1)!;
    const apiPostPath = `/api/posts/${postId}`;
    const thoughtMuse = await page.locator(".authored-thought-opening-muse").getAttribute("data-thought-muse");
    const bottomCaricature = await page.locator(".authored-bottom-caricature").getAttribute("data-bottom-caricature-id");
    expect(thoughtMuse).toBeTruthy();
    expect(bottomCaricature).toBeTruthy();

    await page.getByTitle("Edit post").click();
    const edit = page.locator("form.post-edit-modal");
    await expect(edit.locator('input[placeholder="Title"]')).toHaveCount(0);
    await edit.locator(".ProseMirror").fill(edited);
    const updateResponse = page.waitForResponse((response) =>
      response.request().method() === "PATCH" && new URL(response.url()).pathname === apiPostPath
    );
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    expect((await updateResponse).ok()).toBe(true);
    await expect(edit).toHaveCount(0);
    await expect(page.getByText(edited, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText(edited, { exact: true })).toBeVisible();
    await expect(page.locator(".post-detail-title")).toHaveCount(0);
    await expect(page.locator(".authored-thought-opening-muse")).toHaveAttribute("data-thought-muse", thoughtMuse!);
    await expect(page.locator(".authored-bottom-caricature")).toHaveAttribute("data-bottom-caricature-id", bottomCaricature!);

    const freshContext = await browser.newContext();
    try {
      await freshContext.addCookies([sessionCookie]);
      const freshPage = await freshContext.newPage();
      const cleanFreshPage = watchDiagnostics(freshPage);
      const detailResponse = freshPage.waitForResponse((response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === apiPostPath
      );
      await freshPage.goto(canonicalUrl);
      const canonicalDetail = await detailResponse;
      expect(canonicalDetail.ok()).toBe(true);
      const detail = await canonicalDetail.json() as {
        item?: { designAssignment?: { bottomCaricatureId?: string; museId?: string } };
      };
      expect(detail.item?.designAssignment?.museId).toBe(thoughtMuse);
      expect(detail.item?.designAssignment?.bottomCaricatureId).toBe(bottomCaricature);
      await expect(freshPage.getByText(edited, { exact: true })).toBeVisible();
      await expect(freshPage.locator(".post-detail-title")).toHaveCount(0);
      await expect(freshPage.locator(".authored-thought-opening-muse")).toHaveAttribute("data-thought-muse", thoughtMuse!);
      await expect(freshPage.locator(".authored-bottom-caricature")).toHaveAttribute("data-bottom-caricature-id", bottomCaricature!);
      cleanFreshPage();
    } finally {
      await freshContext.close();
    }
    clean();
  });
});
