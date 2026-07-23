import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp } from "@/apps/api/src/server";
import {
  contentAnalyticsPageSchema,
  contentAnalyticsQuerySchema
} from "@/packages/contracts/src";
import { escapeContentAnalyticsSearchPattern } from "@/apps/api/src/repository/contentAnalytics";
import { quoteAnalyticsSubjects } from "@/apps/api/src/services/contentNotifications";
import {
  contentAnalyticsInvalidationFromLiveEvent,
  contentAnalyticsTargetMatches,
  isContentAnalyticsInvalidation,
  rememberContentAnalyticsInvalidationKey
} from "@/features/analytics/contentAnalyticsSync";
import {
  clearPendingContentAnalytics,
  consumePendingContentAnalytics,
  isPendingContentAnalytics,
  queuePendingContentAnalytics
} from "@/features/analytics/contentAnalyticsNavigation";

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
  assert.equal(escapeContentAnalyticsSearchPattern("100%_done\\later"), "100\\%\\_done\\\\later");
  assert.deepEqual(quoteAnalyticsSubjects(
    {
      sourceType: "post",
      sourceId: "post-source",
      sourcePostId: "post-source",
      sourceRevision: 1,
      author: "Ada",
      authorHandle: "@ada",
      kind: "thought",
      title: "Source",
      body: "Source excerpt",
      attachmentCount: 0,
      available: true
    },
    {
      sourceType: "comment",
      sourceId: "comment-source",
      sourcePostId: "post-parent",
      sourceRevision: 1,
      author: "Grace",
      authorHandle: "@grace",
      title: "Comment",
      body: "Comment excerpt",
      attachmentCount: 0,
      available: true
    }
  ), [
    { subjectType: "post", postId: "post-source" },
    { subjectType: "comment", postId: "post-parent", commentId: "comment-source" }
  ]);

  const postInvalidation = contentAnalyticsInvalidationFromLiveEvent({
    id: "event-post-action",
    kind: "post.signal",
    subjectType: "post",
    subjectId: "post-1",
    payload: { action: "signal", itemId: "post-1", metrics: { signal: "1" } }
  });
  assert.deepEqual(postInvalidation, {
    eventKey: "event-post-action",
    targets: [{ subjectType: "post", postId: "post-1" }]
  });
  const quoteInvalidation = contentAnalyticsInvalidationFromLiveEvent({
    cursor: "71",
    kind: "comment.updated",
    subjectType: "comment",
    subjectId: "quote-host-comment",
    payload: {
      itemId: "quote-host-post",
      commentId: "quote-host-comment",
      analyticsSubjects: [
        { subjectType: "post", postId: "post-source" },
        { subjectType: "post", postId: "post-source" },
        { subjectType: "comment", postId: "post-parent", commentId: "comment-source" }
      ]
    }
  });
  assert.deepEqual(quoteInvalidation, {
    eventKey: "71",
    targets: [
      { subjectType: "comment", postId: "quote-host-post", commentId: "quote-host-comment" },
      { subjectType: "post", postId: "post-source" },
      { subjectType: "comment", postId: "post-parent", commentId: "comment-source" }
    ]
  });
  assert.equal(contentAnalyticsInvalidationFromLiveEvent({
    id: "event-unrelated",
    kind: "message.sent",
    subjectType: "message",
    subjectId: "message-1"
  }), null);
  assert.equal(contentAnalyticsInvalidationFromLiveEvent({
    id: "event-access",
    kind: "community.settings.updated",
    subjectType: "community",
    subjectId: "community-1"
  })?.all, true);
  assert.equal(contentAnalyticsInvalidationFromLiveEvent({
    id: "event-delete",
    kind: "post.deleted",
    subjectType: "post",
    subjectId: "post-1"
  })?.all, true);
  assert.equal(isContentAnalyticsInvalidation({
    eventKey: "valid",
    targets: [{ subjectType: "comment", postId: "post-1", commentId: "comment-1" }]
  }), true);
  assert.equal(isContentAnalyticsInvalidation({
    eventKey: "invalid",
    targets: [{ subjectType: "comment", postId: "post-1" }]
  }), false);
  assert.equal(contentAnalyticsTargetMatches(
    { subjectType: "comment", postId: "post-1", commentId: "comment-1" },
    { subjectType: "comment", postId: "post-1", commentId: "comment-1" }
  ), true);
  assert.equal(isPendingContentAnalytics({
    subjectType: "post",
    postId: "post-1",
    view: "quotes"
  }), true);
  assert.equal(isPendingContentAnalytics({
    subjectType: "comment",
    postId: "post-1",
    view: "likes"
  }), false);
  const globalWithWindow = globalThis as unknown as {
    window?: {
      sessionStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
      };
    };
  };
  globalWithWindow.window = {
    sessionStorage: {
      getItem: () => null,
      setItem: () => { throw new Error("storage unavailable"); },
      removeItem: () => { throw new Error("storage unavailable"); }
    }
  };
  queuePendingContentAnalytics({
    subjectType: "comment",
    postId: "post-1",
    commentId: "comment-1",
    view: "quotes"
  });
  assert.equal(consumePendingContentAnalytics({
    subjectType: "post",
    postId: "post-1"
  }), null);
  assert.equal(consumePendingContentAnalytics({
    subjectType: "comment",
    postId: "post-1",
    commentId: "comment-1"
  }), "quotes");
  clearPendingContentAnalytics();
  delete globalWithWindow.window;

  let rememberedKeys: string[] = [];
  let duplicateCount = 0;
  for (let step = 0; step < 60_000; step += 1) {
    const eventKey = step % 4 === 3 ? `event-${step - 1}` : `event-${step}`;
    const remembered = rememberContentAnalyticsInvalidationKey(rememberedKeys, eventKey);
    rememberedKeys = remembered.keys;
    if (remembered.seen) duplicateCount += 1;
    assert.ok(rememberedKeys.length <= 128);
    assert.equal(new Set(rememberedKeys).size, rememberedKeys.length);
  }
  assert.equal(duplicateCount, 15_000);

  const repository = readFileSync("apps/api/src/repository/contentAnalytics.ts", "utf8");
  const routes = readFileSync("apps/api/src/routes/postRoutes.ts", "utf8");
  const proxy = readFileSync("app/api/posts/[id]/analytics/route.ts", "utf8");
  const dialog = readFileSync("features/analytics/ContentAnalyticsDialog.tsx", "utf8");
  const posts = readFileSync("features/posts/PostViews.tsx", "utf8");
  const comments = readFileSync("features/comments/CommentThread.tsx", "utf8");
  const renderer = readFileSync("features/content/SymposiumDocument.tsx", "utf8");
  const settings = readFileSync("features/profiles/ProfileViews.tsx", "utf8");
  const sync = readFileSync("features/analytics/contentAnalyticsSync.ts", "utf8");
  const navigation = readFileSync("features/analytics/contentAnalyticsNavigation.ts", "utf8");
  const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
  const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
  const schema = readFileSync("apps/api/src/db/schema.ts", "utf8");

  assert.match(repository, /Only the author can view private content analytics/);
  assert.match(repository, /activity\.active = true/);
  assert.match(repository, /action = 'save' AND active/);
  assert.doesNotMatch(repository, /likes_public|reshares_public/);
  assert.doesNotMatch(repository, /content_views[\s\S]*actor_handle/);
  assert.match(repository, /views: metricNumber\(subject\.metrics, "reads"\)/);
  assert.match(repository, /quoted_comment/);
  assert.match(repository, /escapeContentAnalyticsSearchPattern/);
  assert.match(repository, /ESCAPE E'\\\\\\\\'/);
  assert.match(repository, /'post:' \|\| quoted_post\.id/);
  assert.match(repository, /'comment:' \|\| quoted_comment\.id/);
  assert.match(repository, /Quoted comment/);
  assert.match(repository, /encodeURIComponent\(row\.postId\)/);
  assert.match(repository, /encodeURIComponent\(row\.commentId\)/);
  assert.match(routes, /\/v1\/posts\/:id\/analytics/);
  assert.match(proxy, /proxyMessageRequest/);
  assert.match(dialog, /Saves and viewer identities are never shown/);
  assert.match(posts, /View post analytics/);
  assert.match(comments, /View comment analytics/);
  assert.match(dialog, /contentAnalyticsInvalidationEvent/);
  assert.match(dialog, /visibilitychange/);
  assert.match(dialog, /previousFocus/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /setView\(initialView\)/);
  assert.match(dialog, /Analytics could not refresh\. Showing the latest available results\./);
  assert.match(sync, /symposium-content-analytics-sync-v1/);
  assert.match(navigation, /memoryPendingContentAnalytics/);
  assert.match(shell, /publishContentAnalyticsInvalidation/);
  assert.match(shell, /queuePendingContentAnalytics/);
  assert.match(migration, /0047_content_analytics_live/);
  assert.match(migration, /post_actions_content_analytics_idx/);
  assert.match(migration, /comments_quote_analytics_idx/);
  assert.match(schema, /post_actions_content_analytics_idx/);
  assert.match(schema, /comments_quote_analytics_idx/);
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
