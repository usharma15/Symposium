import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp } from "@/apps/api/src/server";

const contracts = readFileSync("packages/contracts/src/index.ts", "utf8");
const systemRoutes = readFileSync("apps/api/src/routes/systemRoutes.ts", "utf8");
const postRoutes = readFileSync("apps/api/src/routes/postRoutes.ts", "utf8");
const profileRoutes = readFileSync("apps/api/src/routes/profileRoutes.ts", "utf8");
const opportunities = readFileSync("apps/api/src/repository/opportunities.ts", "utf8");
const reads = readFileSync("apps/api/src/repository/inquiryReads.ts", "utf8");
const search = readFileSync("apps/api/src/repository/search.ts", "utf8");
const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const cachedBootstrap = readFileSync("features/bootstrap/cachedBootstrap.ts", "utf8");
const localBootstrap = readFileSync("app/api/bootstrap/route.ts", "utf8");
const infiniteFeed = readFileSync("features/feeds/InfiniteFeedBoundary.tsx", "utf8");

assert.match(contracts, /postPageQuerySchema[\s\S]*max\(50\)/);
assert.match(contracts, /commentIds: z\.array\(z\.string\(\)\.trim\(\)\.min\(1\)\.max\(240\)\)\.max\(50\)\.optional\(\)/);
assert.match(contracts, /includeSummary:[\s\S]*z\.boolean\(\)\.default\(true\)/);
assert.match(contracts, /profileActivityResponseSchema[\s\S]*items: z\.array\(inquiryItemSchema\)\.max\(100\)\.optional\(\)/);
assert.match(contracts, /commentCount: z\.number\(\)\.int\(\)\.nonnegative\(\)\.optional\(\)/);
assert.match(systemRoutes, /getBoundedBootstrap/);
assert.doesNotMatch(systemRoutes, /getInitialState|getPublicInitialState/);
assert.doesNotMatch(profileRoutes, /getPublicInitialState/);
assert.match(profileRoutes, /profile: publicProfile\(profile\)/);
assert.doesNotMatch(opportunities, /getPublicInitialState/);
assert.match(postRoutes, /GET|app\.get/);
assert.match(postRoutes, /listPostPage/);
assert.match(postRoutes, /commentIds: request\.query\.commentIds/);
assert.match(postRoutes, /getPostDetail/);
assert.match(reads, /ORDER BY post\.created_at DESC, post\.id DESC/);
assert.match(reads, /LIMIT \$\{limitParameter\}/);
assert.match(reads, /detailLoaded: false/);
assert.match(reads, /detailLoaded: true/);
assert.match(reads, /selectCommentsById/);
assert.match(reads, /viewerActionsForComments/);
assert.match(reads, /getActiveAttachmentsByOwner\(getPool\(\), "comment", selectedCommentIds\)/);
assert.match(search, /websearch_to_tsquery/);
assert.match(search, /to_tsvector\('english', post\.search_text\)/);
assert.match(search, /to_tsquery\('simple', \$2\)/);
assert.match(search, /to_tsvector\('simple', post\.search_text\)/);
assert.match(search, /visible_posts AS NOT MATERIALIZED/);
assert.doesNotMatch(search, /getInitialState|getPublicInitialState/);
assert.match(shell, /\/api\/posts\?\$\{parameters\.toString\(\)\}/);
assert.match(shell, /\/api\/posts\/\$\{encodeURIComponent\(postId\)\}/);
assert.match(shell, /\/api\/search\?\$\{parameters\.toString\(\)\}/);
assert.doesNotMatch(shell, /limit: "500"/);
assert.match(shell, /useInquiryEntityStore\(initialBoundedInquiryItems\)/);
assert.match(cachedBootstrap, /cachedBootstrapItemLimit = 32/);
assert.match(localBootstrap, /projectedItems\.slice\(0, 24\)/);
assert.match(infiniteFeed, /IntersectionObserver/);
assert.match(infiniteFeed, /rootMargin: "0px 0px 900px 0px"/);
assert.match(infiniteFeed, /requestPendingRef/);

const main = async () => {
  const app = await buildApp({ logger: false });
  try {
    const headers = { "x-symposium-handle": "@bounded-reader" };
    const bootstrapResponse = await app.inject({ method: "GET", url: "/v1/bootstrap", headers });
    assert.equal(bootstrapResponse.statusCode, 200);
    assert.match(
      String(bootstrapResponse.headers["server-timing"]),
      /db;dur=[\d.]+;desc="\d+ queries", app;dur=[\d.]+/
    );
    const bootstrap = bootstrapResponse.json();
    assert.equal(bootstrap.readModelVersion, 2);
    assert.ok(bootstrap.items.length <= 24);
    assert.ok(Object.values(bootstrap.profiles).every((person: any) => person.email === undefined));

    const pageResponse = await app.inject({ method: "GET", url: "/v1/posts?limit=2", headers });
    assert.equal(pageResponse.statusCode, 200);
    const page = pageResponse.json();
    assert.ok(page.items.length <= 2);
    assert.equal(typeof page.profiles, "object");
    assert.ok(Object.values(page.profiles).every((person: any) => person.email === undefined));
    assert.ok(page.items.every((item: any) => ["savedBy", "signaledBy", "forkedBy"].every((key) =>
      item[key].every((handle: string) => handle === "@bounded_reader")
    )));
    assert.ok(page.nextCursor === null || typeof page.nextCursor === "string");
    if (page.items[0]) {
      const detailResponse = await app.inject({
        method: "GET",
        url: `/v1/posts/${encodeURIComponent(page.items[0].id)}`,
        headers
      });
      assert.equal(detailResponse.statusCode, 200);
      const detail = detailResponse.json();
      assert.equal(detail.item.detailLoaded, true);
      assert.ok(Object.values(detail.profiles).every((person: any) => person.email === undefined));
    }

    const profileResponse = await app.inject({ method: "GET", url: "/v1/profiles/@plato", headers });
    assert.equal(profileResponse.statusCode, 200);
    assert.equal(profileResponse.json().profile.email, undefined);

    const activityPageResponse = await app.inject({
      method: "GET",
      url: "/v1/profiles/@plato/activity?limit=2&actions=signal&includeComments=false&includeSummary=false",
      headers
    });
    assert.equal(activityPageResponse.statusCode, 200);
    assert.equal(activityPageResponse.json().totals, undefined);
    assert.equal(activityPageResponse.json().hiddenCommunityCounts, undefined);

    const searchResponse = await app.inject({ method: "GET", url: "/v1/search?q=s&limit=3", headers });
    assert.equal(searchResponse.statusCode, 200);
    assert.ok(searchResponse.json().posts.length > 0);
    assert.ok(searchResponse.json().profiles.length > 0);
    assert.ok(searchResponse.json().posts.length <= 3);
  } finally {
    await app.close();
  }
  console.log("Bounded read-model checks passed.");
};

void main();
