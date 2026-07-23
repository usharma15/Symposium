import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp } from "@/apps/api/src/server";
import {
  contentAnalyticsPageSchema,
  contentAnalyticsQuerySchema
} from "@/packages/contracts/src";

const main = async () => {
  assert.equal(contentAnalyticsQuerySchema.safeParse({
    subjectType: "post",
    view: "likes"
  }).success, true);
  assert.equal(contentAnalyticsQuerySchema.safeParse({
    subjectType: "comment",
    view: "likes"
  }).success, false);
  assert.equal(contentAnalyticsQuerySchema.safeParse({
    subjectType: "comment",
    commentId: "comment-1",
    view: "quotes",
    query: "researcher"
  }).success, true);
  assert.equal(contentAnalyticsPageSchema.safeParse({
    subjectType: "post",
    subjectId: "post-1",
    postId: "post-1",
    title: "A post",
    overview: { likes: 1, reshares: 2, quotes: 3, saves: 4, views: 5 },
    actors: [],
    quotes: [],
    nextCursor: null
  }).success, true);

  const repository = readFileSync("apps/api/src/repository/contentAnalytics.ts", "utf8");
  const routes = readFileSync("apps/api/src/routes/postRoutes.ts", "utf8");
  const proxy = readFileSync("app/api/posts/[id]/analytics/route.ts", "utf8");
  const dialog = readFileSync("features/analytics/ContentAnalyticsDialog.tsx", "utf8");
  const posts = readFileSync("features/posts/PostViews.tsx", "utf8");
  const comments = readFileSync("features/comments/CommentThread.tsx", "utf8");
  const renderer = readFileSync("features/content/SymposiumDocument.tsx", "utf8");
  const settings = readFileSync("features/profiles/ProfileViews.tsx", "utf8");

  assert.match(repository, /Only the author can view private content analytics/);
  assert.match(repository, /activity\.active = true/);
  assert.match(repository, /action = 'save' AND active/);
  assert.doesNotMatch(repository, /likes_public|reshares_public/);
  assert.doesNotMatch(repository, /content_views[\s\S]*actor_handle/);
  assert.match(repository, /views: metricNumber\(subject\.metrics, "reads"\)/);
  assert.match(repository, /quoted_comment/);
  assert.match(routes, /\/v1\/posts\/:id\/analytics/);
  assert.match(proxy, /proxyMessageRequest/);
  assert.match(dialog, /Saves and viewer identities are never shown/);
  assert.match(posts, /View post analytics/);
  assert.match(comments, /View comment analytics/);
  assert.match(renderer, /hierarchyOffset/);
  assert.match(settings, /Authors can still see when you like their work/);

  const app = await buildApp({ logger: false });
  try {
    const unavailable = await app.inject({
      method: "GET",
      url: "/v1/posts/post-1/analytics?subjectType=post",
      headers: { "x-symposium-handle": "@analytics-owner" }
    });
    assert.equal(unavailable.statusCode, 412);

    const invalidComment = await app.inject({
      method: "GET",
      url: "/v1/posts/post-1/analytics?subjectType=comment",
      headers: { "x-symposium-handle": "@analytics-owner" }
    });
    assert.equal(invalidComment.statusCode, 400);
  } finally {
    await app.close();
  }

  console.log("SYMPOSIUM private content analytics checks passed.");
};

void main();
