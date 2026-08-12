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
    await page.reload();
    await expect(page).toHaveURL(/\/posts\/paper-bell-epr$/);
    await expect(page.locator("main.symposium-shell")).toHaveAttribute("data-room", "library");
    await page.getByRole("navigation", { name: "View history" }).getByTitle("Back").click();
    await expect(page).toHaveURL(/\/rooms\/library$/);
    clean();
  });

  test("routes native PDF translation as text and scanned PDF translation through vision", async ({ page }) => {
    const clean = watchDiagnostics(page);
    const translationRequests: Array<{
      sourcePages: Array<{ imageDataUrl?: string; segments: Array<{ id: string; text: string }> }>;
    }> = [];
    await page.route("**/api/assistant/document-translations", async (route) => {
      const request = route.request().postDataJSON() as {
        attachmentId: string;
        sourceComplete: boolean;
        sourcePages: Array<{ imageDataUrl?: string; segments: Array<{ id: string; text: string }> }>;
      };
      translationRequests.push(request);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "disabled",
          attachmentId: request.attachmentId,
          sourceFingerprint: "0".repeat(64),
          sourceComplete: request.sourceComplete,
          cached: false,
          targetLanguage: null,
          targetLanguageLabel: null,
          translatedTitle: "",
          pages: [],
          message: "Translation provider disabled for browser routing proof.",
          model: "browser-routing-proof",
          createdAt: "2026-08-11T00:00:00.000Z"
        })
      });
    });

    const requestTranslation = async (postId: string, requestCount: number) => {
      await page.goto(`/posts/${postId}`);
      const pdf = page.locator(".attachment-pdf");
      await expect(pdf.locator(".attachment-pdf-original-canvas").first()).toBeVisible();
      await pdf.locator(".document-translate-button").click();
      await pdf.locator(".document-translation-submit").click();
      await expect.poll(() => translationRequests.length, { timeout: 20_000 }).toBe(requestCount);
      return translationRequests[requestCount - 1]!;
    };

    const nativeRequest = await requestTranslation("paper-bell-epr", 1);
    expect(nativeRequest.sourcePages[0]?.segments.length).toBeGreaterThan(0);
    expect(nativeRequest.sourcePages[0]?.imageDataUrl).toBeUndefined();

    const scannedRequest = await requestTranslation("paper-heisenberg-kinematics", 2);
    expect(scannedRequest.sourcePages[0]?.imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    clean();
  });

  test("opens Notes drafts at the top and returns from quoted posts to the exact Office view", async ({ page, request }) => {
    const clean = watchDiagnostics(page);
    const paragraphs = Array.from({ length: 70 }, (_, index) => ({
      id: `office-origin-paragraph-${index + 1}`,
      type: "paragraph" as const,
      content: [{ text: `Office origin paragraph ${index + 1}. This keeps the private draft long enough to prove exact reading-position restoration.` }],
      align: "left" as const,
      indent: 0
    }));
    const quoteIndex = 35;
    const documentNodes = [
      ...paragraphs.slice(0, quoteIndex),
      {
        id: "office-origin-quoted-post",
        type: "reference" as const,
        resource: { type: "post" as const, id: "paper-bell-epr", label: "On the Einstein Podolsky Rosen paradox" },
        source: {
          kind: "post" as const,
          sourceId: "paper-bell-epr",
          sourcePostId: "paper-bell-epr",
          author: "John Bell",
          authorHandle: "@john_bell",
          title: "On the Einstein Podolsky Rosen paradox",
          body: "A quoted Paper retained inside this private Office draft.",
          postTone: "paper" as const,
          canonicalPath: "/posts/paper-bell-epr"
        }
      },
      ...paragraphs.slice(quoteIndex)
    ];
    const body = paragraphs.map((node) => node.content[0]!.text).join("\n\n");
    const created = await request.post("/api/workspace/documents", {
      data: {
        actorHandle: "@udayan",
        title: "Office quote-origin browser proof",
        body,
        document: { version: 1, nodes: documentNodes },
        kind: "note",
        publicationTarget: "undecided",
        notebookId: null,
        targetId: null,
        proposal: null,
        opportunity: null,
        attachmentIds: []
      }
    });
    expect(created.ok()).toBe(true);
    const noteId = ((await created.json()) as { document: { id: string } }).document.id;

    await page.setViewportSize({ width: 1280, height: 620 });
    await page.goto("/workspace?view=notes");
    const card = page.getByTestId(`workspace-card-${noteId}`);
    await expect(card).toBeVisible();
    await card.evaluate((element) => {
      const spacer = document.createElement("div");
      spacer.dataset.workspaceOpenScrollProof = "true";
      spacer.style.height = "680px";
      element.parentElement?.prepend(spacer);
      window.scrollTo({ top: 620, behavior: "auto" });
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await card.click();
    const draft = page.getByTestId(`workspace-detail-${noteId}`);
    await expect(draft).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(4);

    const quotedPost = draft.locator('a.document-reference[href="/posts/paper-bell-epr"]');
    await quotedPost.scrollIntoViewIfNeeded();
    const draftScrollY = await page.evaluate(() => window.scrollY);
    expect(draftScrollY).toBeGreaterThan(300);
    await quotedPost.click();
    await expect(page).toHaveURL(/\/posts\/paper-bell-epr$/);
    await expect(page.locator("main.symposium-shell")).toHaveAttribute("data-room", "office");

    await page.locator(".back-button").click();
    await expect(page).toHaveURL(new RegExp(`/workspace\\?view=notes&note=${noteId}$`));
    await expect(page.getByTestId(`workspace-detail-${noteId}`)).toBeVisible();
    await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - draftScrollY), { timeout: 10_000 }).toBeLessThan(12);
    clean();
  });

  test("restores the exact comment viewport and deep reply window after reload", async ({ page, request }) => {
    const clean = watchDiagnostics(page);
    const postResponse = await request.post("/api/posts", {
      data: {
        title: "",
        body: "A browser-only thread used to prove that reading position survives refresh.",
        kind: "thought",
        postType: "thought",
        room: "amphitheater",
        authorHandle: "@udayan",
        attachmentIds: []
      }
    });
    expect(postResponse.ok()).toBe(true);
    const postId = ((await postResponse.json()) as { item: { id: string } }).item.id;
    const commentIds: string[] = [];
    let parentId: string | null = null;
    for (let depth = 1; depth <= 7; depth += 1) {
      const commentResponse = await request.post(`/api/posts/${postId}/comments`, {
        data: {
          body: `Reload-preservation reply depth ${depth}.`,
          stance: "Comment",
          parentId,
          authorHandle: "@udayan",
          attachmentIds: []
        }
      });
      expect(commentResponse.ok()).toBe(true);
      const commentId = ((await commentResponse.json()) as { comment: { id: string } }).comment.id;
      commentIds.push(commentId);
      parentId = commentId;
    }

    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`/posts/${postId}`);
    await page.getByRole("button", { name: "Show more replies" }).click();
    const segment = page.locator(".comment-segment");
    const visibleStack = JSON.stringify([commentIds[5]]);
    await expect(segment).toHaveAttribute("data-comment-segment-stack", visibleStack);
    await expect(page.getByRole("button", { name: "Show previous replies" })).toBeVisible();

    const anchor = page.getByTestId(`comment-${commentIds[6]}`);
    await expect(anchor).toBeVisible();
    await anchor.evaluate((element) => {
      window.scrollBy({ top: element.getBoundingClientRect().top - 116, behavior: "auto" });
    });
    const anchorTop = await anchor.evaluate((element) => element.getBoundingClientRect().top);
    expect(anchorTop).toBeGreaterThan(108);
    expect(anchorTop).toBeLessThan(124);
    await expect.poll(() => page.evaluate(() =>
      Object.values((window.history.state?.symposiumView?.commentSegmentStacks ?? {}) as Record<string, string[]>).flat()
    )).toContain(commentIds[5]);
    await expect.poll(() => page.evaluate(() => window.history.state?.symposiumView?.scrollAnchor?.id ?? null))
      .not.toBeNull();
    const persistedDeepReplyTop = await anchor.evaluate((element) => element.getBoundingClientRect().top);

    await page.reload();
    await expect(segment).toHaveAttribute("data-comment-segment-stack", visibleStack);
    await expect(page.getByRole("button", { name: "Show previous replies" })).toBeVisible();
    await expect(anchor).toBeVisible();
    await expect.poll(async () =>
      Math.abs((await anchor.evaluate((element) => element.getBoundingClientRect().top)) - persistedDeepReplyTop)
    ).toBeLessThanOrEqual(8);
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

  test("aligns post and comment detail content to one responsive rail", async ({ page, request }) => {
    const clean = watchDiagnostics(page);

    for (const sample of [
      { kind: "paper", postType: "paper", room: "library", title: "Browser rail proof paper", width: 1440, height: 1000, railWidening: 12 },
      { kind: "thought", postType: "thought", room: "amphitheater", title: "", width: 390, height: 844, railWidening: 6 }
    ] as const) {
      await page.setViewportSize({ width: sample.width, height: sample.height });
      const body = `Browser rail proof for ${sample.postType} detail content.`;
      const postResponse = await request.post("/api/posts", {
        data: {
          ...sample,
          body,
          authorHandle: "@udayan",
          attachmentIds: [],
          document: {
            version: 1,
            settings: { width: "standard", margin: "generous" },
            nodes: [{
              id: `browser-rail-${sample.postType}`,
              type: "paragraph",
              content: [{ text: body }],
              align: "left",
              indent: 0
            }]
          }
        }
      });
      expect(postResponse.ok()).toBe(true);
      const postId = ((await postResponse.json()) as { item: { id: string } }).item.id;
      const commentBody = `Browser rail proof comment for ${sample.postType}.`;
      const commentResponse = await request.post(`/api/posts/${postId}/comments`, {
        data: {
          body: commentBody,
          stance: "Comment",
          parentId: null,
          authorHandle: "@udayan",
          attachmentIds: []
        }
      });
      expect(commentResponse.ok()).toBe(true);

      await page.goto(`/posts/${postId}`);
      await expect(page.getByText(body, { exact: true })).toBeVisible();
      await expect(page.getByText(commentBody, { exact: true })).toBeVisible();
      const geometry = await page.locator("[data-detail-content-rail]").evaluate((detail, postType) => {
        const detailRect = detail.getBoundingClientRect();
        const detailStyle = getComputedStyle(detail);
        const railLeft = detailRect.left + Number.parseFloat(detailStyle.paddingLeft);
        const railRight = detailRect.right - Number.parseFloat(detailStyle.paddingRight);
        const railWidening = Number.parseFloat(detailStyle.getPropertyValue("--authored-content-rail-widening"));
        const required = (selector: string) => {
          const element = detail.querySelector<HTMLElement>(selector);
          if (!element) throw new Error(`Missing rail element: ${selector}`);
          return element.getBoundingClientRect();
        };
        const leftSelectors = [
          ".detail-byline-button",
          ":scope > .content-translation-post",
          ".post-detail-document .symposium-document-detail > [data-document-block-id]",
          ":scope > .post-time-footer",
          ":scope > .social-actions",
          ":scope > .comments-section > h2",
          ".comment-thread .comment-author",
          ".comment-thread .symposium-document-comment [data-document-block-id]",
          ".comment-thread .comment-time-footer",
          ".comment-thread .comment-actions",
          ".comment-thread .reply-button"
        ];
        if (postType === "paper") leftSelectors.unshift(".authored-paper-title-ceremony h1");
        const rightSelectors = [
          ":scope > .post-owner-actions",
          ":scope > .content-translation-post",
          ":scope > .post-detail-document",
          ":scope > .social-actions",
          ":scope > .comments-section",
          ".comment-thread .comment-owner-actions"
        ];
        const museRail = required(postType === "paper"
          ? ".authored-paper-title-ceremony"
          : ".authored-thought-opening-muse");
        return {
          railLeft,
          railRight,
          railWidening,
          museRail: { left: museRail.left, right: museRail.right },
          lefts: leftSelectors.map((selector) => ({ selector, value: required(selector).left })),
          rights: rightSelectors.map((selector) => ({ selector, value: required(selector).right }))
        };
      }, sample.postType);

      expect(geometry.railWidening).toBe(sample.railWidening);
      expect(Math.abs(geometry.museRail.left - (geometry.railLeft + geometry.railWidening)), `${sample.postType} muse left anchor`).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.museRail.right - (geometry.railRight - geometry.railWidening)), `${sample.postType} muse right anchor`).toBeLessThanOrEqual(1);
      for (const measurement of geometry.lefts) {
        expect(Math.abs(measurement.value - geometry.railLeft), `${sample.postType} left rail: ${measurement.selector}`).toBeLessThanOrEqual(1);
      }
      for (const measurement of geometry.rights) {
        expect(Math.abs(measurement.value - geometry.railRight), `${sample.postType} right rail: ${measurement.selector}`).toBeLessThanOrEqual(1);
      }
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/posts/paper-bell-epr");
    const inlineAttachment = page.locator(".post-detail-document .post-attachments-detail").first();
    await expect(inlineAttachment).toBeVisible();
    const attachmentGeometry = await page.locator("[data-detail-content-rail]").evaluate((detail) => {
      const detailRect = detail.getBoundingClientRect();
      const detailStyle = getComputedStyle(detail);
      const attachment = detail.querySelector<HTMLElement>(".post-detail-document .post-attachments-detail");
      if (!attachment) throw new Error("Missing inline detail attachment");
      const attachmentRect = attachment.getBoundingClientRect();
      return {
        railLeft: detailRect.left + Number.parseFloat(detailStyle.paddingLeft),
        railRight: detailRect.right - Number.parseFloat(detailStyle.paddingRight),
        attachmentLeft: attachmentRect.left,
        attachmentRight: attachmentRect.right
      };
    });
    expect(Math.abs(attachmentGeometry.attachmentLeft - attachmentGeometry.railLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(attachmentGeometry.attachmentRight - attachmentGeometry.railRight)).toBeLessThanOrEqual(1);
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
