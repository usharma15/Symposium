import assert from "node:assert/strict";
import {
  canonicalAssistantBackdropIds,
  canonicalRouteForRoom,
  canonicalRouteHref,
  parseAssistantBackdrop,
  parseCanonicalRoute
} from "@/features/navigation/canonicalRoute";
import {
  assistantBackdropForView,
  canonicalRouteForView,
  roomForCanonicalRoute,
  snapshotForCanonicalRoute
} from "@/features/navigation/viewState";
import {
  assistantBackdropRender,
  communityRenders,
  messageRenders,
  roomRenders
} from "@/features/rooms/roomRenderAssets";

assert.equal(canonicalRouteHref({ kind: "hall" }), "/");
assert.deepEqual(canonicalRouteForRoom("office"), { kind: "workspace" });
assert.deepEqual(canonicalRouteForRoom("symposium"), { kind: "room", roomId: "symposium" });
assert.equal(canonicalRouteHref({ kind: "room", roomId: "library" }), "/rooms/library");
assert.deepEqual(parseCanonicalRoute("/rooms/amphitheater"), { kind: "room", roomId: "amphitheater" });
assert.equal(canonicalRouteHref({ kind: "workspace", view: "notes" }), "/workspace?view=notes");
assert.deepEqual(parseCanonicalRoute("/workspace", "?view=saved"), { kind: "workspace", view: "saved" });
assert.equal(
  canonicalRouteHref({ kind: "workspace", view: "notes", noteId: "note one", commentId: "comment/one" }),
  "/workspace?view=notes&note=note+one&comment=comment%2Fone"
);
assert.deepEqual(parseCanonicalRoute("/workspace", "?view=notes&note=note%20one&comment=comment%2Fone"), {
  kind: "workspace",
  view: "notes",
  noteId: "note one",
  commentId: "comment/one"
});
assert.equal(canonicalRouteHref({ kind: "funding" }), "/funding");
assert.deepEqual(parseCanonicalRoute("/funding", "?view=private"), { kind: "funding" });
assert.deepEqual(parseCanonicalRoute("/opportunities"), { kind: "opportunities" });
assert.equal(
  canonicalRouteHref({ kind: "opportunityApplications", postId: "post/one", applicationId: "application one" }),
  "/posts/post%2Fone/applications?application=application%20one"
);
assert.deepEqual(parseCanonicalRoute("/posts/post%2Fone/applications", "?application=application%20one"), {
  kind: "opportunityApplications",
  postId: "post/one",
  applicationId: "application one"
});
assert.equal(roomForCanonicalRoute({ kind: "opportunityApplications", postId: "post-one" }), "opportunities");
assert.deepEqual(parseCanonicalRoute("/messages"), { kind: "messages" });
assert.equal(
  canonicalRouteHref({ kind: "messages", conversationId: "ai-metascience-lab" }),
  "/messages?conversation=ai-metascience-lab"
);
assert.deepEqual(parseCanonicalRoute("/messages", "?conversation=niko-varga"), {
  kind: "messages",
  conversationId: "niko-varga"
});
assert.equal(
  canonicalRouteHref({ kind: "assistant", threadId: "thread one", backdrop: "library" }),
  "/assistant/threads/thread%20one?backdrop=library"
);
assert.deepEqual(parseCanonicalRoute("/assistant"), { kind: "assistant" });
assert.deepEqual(parseCanonicalRoute("/assistant/threads/thread%20one", "?backdrop=messages"), {
  kind: "assistant",
  threadId: "thread one",
  backdrop: "messages"
});
assert.deepEqual(parseCanonicalRoute("/assistant", "?backdrop=../../private"), { kind: "assistant" });
assert.equal(parseAssistantBackdrop(["messages", "library"]), "messages");
assert.equal(parseAssistantBackdrop("not-a-backdrop"), undefined);
canonicalAssistantBackdropIds.forEach((backdrop) => {
  const href = canonicalRouteHref({ kind: "assistant", backdrop });
  const url = new URL(href, "https://symposium.test");
  assert.deepEqual(
    parseCanonicalRoute(url.pathname, url.search),
    { kind: "assistant", backdrop }
  );
});
assert.equal(assistantBackdropRender("day", "library"), roomRenders.day.library);
assert.equal(assistantBackdropRender("night", "messages"), messageRenders.night);
assert.equal(
  assistantBackdropRender("day", "community-selected"),
  communityRenders.day.selected
);
assert.equal(roomForCanonicalRoute({ kind: "assistant", threadId: "thread-one" }), "hall");
assert.equal(
  roomForCanonicalRoute({ kind: "assistant", threadId: "thread-one", backdrop: "library" }),
  "library"
);
assert.equal(
  assistantBackdropForView({ activeRoom: "library", messagesOpen: false, selectedCommunityId: null }),
  "library"
);
assert.equal(
  assistantBackdropForView({ activeRoom: "hall", messagesOpen: true, selectedCommunityId: null }),
  "messages"
);
assert.equal(
  assistantBackdropForView({ activeRoom: "communities", messagesOpen: false, selectedCommunityId: "community-one" }),
  "community-selected"
);
const assistantSnapshot = snapshotForCanonicalRoute({
  kind: "assistant",
  threadId: "thread-one",
  backdrop: "opportunities"
});
assert.equal(assistantSnapshot.assistantOpen, true);
assert.equal(assistantSnapshot.assistantThreadId, "thread-one");
assert.equal(assistantSnapshot.assistantBackdrop, "opportunities");
assert.equal(assistantSnapshot.activeRoom, "opportunities");
assert.deepEqual(canonicalRouteForView(assistantSnapshot), {
  kind: "assistant",
  threadId: "thread-one",
  backdrop: "opportunities"
});
assert.equal(
  canonicalRouteHref({ kind: "post", postId: "post/one", commentId: "comment one" }),
  "/posts/post%2Fone?comment=comment%20one"
);
assert.deepEqual(parseCanonicalRoute("/posts/post%2Fone", "?comment=comment%20one"), {
  kind: "post",
  postId: "post/one",
  commentId: "comment one"
});
assert.equal(
  roomForCanonicalRoute({ kind: "post", postId: "proposal-one" }, (postId) => postId === "proposal-one" ? "funding" : undefined),
  "funding"
);
assert.equal(canonicalRouteHref({ kind: "profile", handle: "@ada" }), "/profiles/ada");
assert.deepEqual(parseCanonicalRoute("/profiles/ada"), { kind: "profile", handle: "@ada" });
assert.equal(
  canonicalRouteHref({ kind: "profile", handle: "@ada", tab: "papers" }),
  "/profiles/ada/papers"
);
assert.deepEqual(parseCanonicalRoute("/profiles/ada/saved"), {
  kind: "profile",
  handle: "@ada",
  tab: "saved"
});
assert.equal(canonicalRouteHref({ kind: "profile", handle: "@ada", tab: "all" }), "/profiles/ada");
assert.equal(
  canonicalRouteHref({ kind: "profile", handle: "@ada", social: "followers" }),
  "/profiles/ada/followers"
);
assert.deepEqual(parseCanonicalRoute("/profiles/ada/following"), {
  kind: "profile",
  handle: "@ada",
  social: "following"
});
assert.deepEqual(parseCanonicalRoute("/communities/frontier-physics"), {
  kind: "community",
  communityId: "frontier-physics"
});
assert.equal(canonicalRouteHref({ kind: "communities" }), "/communities");
assert.deepEqual(parseCanonicalRoute("/communities"), { kind: "communities" });
assert.deepEqual(parseCanonicalRoute("/unknown/path"), { kind: "hall" });

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "room routes",
        "workspace draft-comment deep links and unified funding route",
        "opportunities, messages, and the AI workspace",
        "post and comment round-trip",
        "profile filter and social-graph routes",
        "community routes",
        "safe fallback"
      ]
    },
    null,
    2
  )
);
