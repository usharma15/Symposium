import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { InquiryItem } from "@/lib/mockData";
import {
  initialSymposiumSurfaceState,
  symposiumSurfaceReducer,
  type AssistantSurfaceContext,
  type SymposiumSurfaceAction
} from "@/features/shell/symposiumSurfaceState";
import { reportCheck } from "@/scripts/checkReport";

const post = { id: "post-one" } as InquiryItem;
const otherPost = { id: "post-two" } as InquiryItem;
const quote = {
  sourceType: "post" as const,
  sourceId: post.id,
  sourcePostId: post.id
};
const assistantContext = {
  surface: "post",
  route: `/posts/${post.id}`,
  title: "Post one",
  content: "Current post context"
} as AssistantSurfaceContext;
const attachment = {
  itemId: post.id,
  attachmentId: "attachment-one"
};

let state = initialSymposiumSurfaceState(false);
const reduce = (action: SymposiumSurfaceAction) => {
  state = symposiumSurfaceReducer(state, action);
};

assert.deepEqual(state, {
  assistantOriginContext: null,
  attachmentPreview: null,
  composer: null,
  editingComment: null,
  editingPost: null,
  messagesQuick: null,
  quoteSelection: null,
  settingsOpen: false,
  tabletOpen: false
});
assert.equal(initialSymposiumSurfaceState(true).tabletOpen, true);

reduce({ type: "composer-opened", communityId: "community-one" });
assert.deepEqual(state.composer, { communityId: "community-one" });
assert.equal(state.tabletOpen, false);
reduce({
  type: "composer-community-changed",
  communityId: "community-two"
});
assert.deepEqual(state.composer, { communityId: "community-two" });
reduce({ type: "settings-opened" });
assert.equal(state.composer, null);
assert.equal(state.settingsOpen, true);

reduce({ type: "quick-messages-opened" });
assert.equal(
  state.settingsOpen,
  true,
  "Quick Messages must preserve the existing independently opened Settings surface."
);
assert.deepEqual(state.messagesQuick, { conversationId: null });
reduce({
  type: "quick-conversation-selected",
  conversationId: "conversation-one"
});
assert.deepEqual(state.messagesQuick, {
  conversationId: "conversation-one"
});

reduce({ type: "post-editor-opened", item: post });
assert.deepEqual(state.messagesQuick, {
  conversationId: "conversation-one"
});
assert.equal(state.editingPost, post);
reduce({ type: "post-editor-closed", itemId: otherPost.id });
assert.equal(state.editingPost, post);
reduce({ type: "post-editor-closed", itemId: post.id });
assert.equal(state.editingPost, null);

reduce({
  type: "comment-editor-opened",
  target: { itemId: post.id, commentId: "comment-one" }
});
reduce({
  type: "comment-editor-closed",
  itemId: post.id,
  commentId: "comment-two"
});
assert.deepEqual(state.editingComment, {
  itemId: post.id,
  commentId: "comment-one"
});
reduce({ type: "comment-editor-closed", commentId: "comment-one" });
assert.equal(state.editingComment, null);

reduce({ type: "tablet-opened" });
assert.equal(state.settingsOpen, false);
assert.equal(state.messagesQuick, null);
reduce({ type: "attachment-preview-changed", target: attachment });
assert.equal(
  state.tabletOpen,
  true,
  "The compact Assistant must remain available beside attachment context."
);
assert.deepEqual(state.attachmentPreview, attachment);
reduce({ type: "quote-opened", selection: quote });
assert.equal(state.tabletOpen, false);
assert.deepEqual(
  state.attachmentPreview,
  attachment,
  "Quote composition must not silently close an independently opened attachment."
);
assert.equal(state.quoteSelection, quote);

reduce({ type: "assistant-expanded", context: assistantContext });
assert.equal(state.tabletOpen, true);
assert.equal(state.quoteSelection, quote);
assert.equal(state.assistantOriginContext, assistantContext);
reduce({ type: "navigation-committed", assistantOpen: true });
assert.equal(state.assistantOriginContext, assistantContext);
assert.equal(state.quoteSelection, quote);
assert.deepEqual(state.attachmentPreview, attachment);
reduce({ type: "navigation-committed", assistantOpen: false });
assert.equal(state.assistantOriginContext, null);

reduce({ type: "quote-closed" });
reduce({ type: "attachment-preview-changed", target: null });
reduce({ type: "global-composer-opened", communityId: null });
assert.equal(state.tabletOpen, false);
reduce({ type: "navigation-restored" });
assert.equal(state.composer, null);
assert.equal(state.attachmentPreview, null);
assert.equal(state.tabletOpen, false);
assert.equal(state.assistantOriginContext, null);

reduce({ type: "settings-opened" });
reduce({ type: "initial-route-applied" });
assert.equal(
  state.settingsOpen,
  true,
  "Applying the initial route must preserve the pre-existing surface behavior."
);
assert.equal(state.tabletOpen, false);
reduce({ type: "settings-closed" });

const closedComposerState = state;
reduce({
  type: "composer-community-changed",
  communityId: "must-not-open"
});
assert.equal(state, closedComposerState);

const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
const communityState = readFileSync(
  "features/communities/useCommunityState.ts",
  "utf8"
);
const controller = readFileSync(
  "features/shell/useSymposiumSurfaceController.ts",
  "utf8"
);
const model = readFileSync(
  "features/shell/symposiumSurfaceState.ts",
  "utf8"
);

assert.equal(
  shell.match(/useSymposiumSurfaceController\(/g)?.length,
  1,
  "The shell must compose exactly one transient-surface authority."
);
assert.match(controller, /useReducer\(\s*symposiumSurfaceReducer/);
assert.doesNotMatch(
  shell,
  /const \[(?:tabletOpen|composerOpen|quoteSelection|settingsOpen|messagesQuickOpen|quickConversationId|editingPost|editingComment|attachmentPreview),/
);
assert.doesNotMatch(
  shell,
  /set(?:TabletOpen|ComposerOpen|QuoteSelection|SettingsOpen|MessagesQuickOpen|QuickConversationId|EditingPost|EditingComment|AssistantOriginContext)/
);
assert.doesNotMatch(
  communityState,
  /composerCommunityId|setComposerCommunityId/,
  "Composer destination is transient surface state, not community domain state."
);
assert.match(model, /type: "navigation-committed"/);
assert.match(model, /type: "attachment-preview-changed"/);
assert.match(model, /const closeNavigationSurfaces/);
assert.match(model, /type: "global-composer-opened"/);

reportCheck([
  "single transient-surface reducer authority",
  "atomic composer destination lifecycle",
  "exact surface coexistence behavior preservation",
  "guarded live-deletion editor cleanup",
  "attachment and compact-Assistant coexistence",
  "Assistant origin preservation across expansion navigation",
  "navigation and session cleanup",
  "community-domain composer-state retirement",
  "shell local-state regression guard"
]);
