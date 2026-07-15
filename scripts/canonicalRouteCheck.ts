import assert from "node:assert/strict";
import {
  canonicalRouteForRoom,
  canonicalRouteHref,
  parseCanonicalRoute
} from "@/features/navigation/canonicalRoute";
import { roomForCanonicalRoute } from "@/features/navigation/viewState";

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
        "opportunities and messages",
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
