import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import {
  assistantNoteTargetTitleForPrompt,
  assistantSiteSearchRequestForPrompt,
  searchAssistantSite
} from "@/apps/api/src/repository/assistantSiteSearch";
import { assistantRenderedInput } from "@/apps/api/src/services/openaiResponses";
import { assistantActionProposalFromDraft } from "@/apps/api/src/services/assistantActionRegistry";

process.env.OPENAI_API_KEY ||= "assistant-site-search-check-key";

assert.deepEqual(
  assistantSiteSearchRequestForPrompt("Search the site for related papers about protein folding."),
  { query: "protein folding", scopes: ["site"] }
);
assert.deepEqual(
  assistantSiteSearchRequestForPrompt("Look through my Office notes for \"folding checkpoint\"."),
  { query: "folding checkpoint", scopes: ["office"] }
);
assert.deepEqual(
  assistantSiteSearchRequestForPrompt("Find the idea about peer review in my messages and notes."),
  { query: "idea peer review", scopes: ["office", "messages"] }
);
assert.deepEqual(
  assistantSiteSearchRequestForPrompt("Search everywhere for photosynthesis priors."),
  { query: "photosynthesis priors", scopes: ["site", "office", "messages"] }
);
assert.equal(
  assistantSiteSearchRequestForPrompt("Do not search my messages for this."),
  null
);
assert.equal(
  assistantSiteSearchRequestForPrompt("Find a good restaurant for tonight."),
  null
);
assert.equal(
  assistantNoteTargetTitleForPrompt(
    "Search the site for replication concerns and integrate them into my Office note named \"Review plan\"."
  ),
  "Review plan"
);
assert.equal(
  assistantNoteTargetTitleForPrompt("Do not add this to my note named \"Review plan\"."),
  null
);
assert.deepEqual(
  assistantSiteSearchRequestForPrompt(
    "Search the site for replication concerns and integrate them into my Office note named \"Review plan\"."
  ),
  { query: "replication concerns", scopes: ["site", "office"] }
);
assert.equal(
  assistantActionProposalFromDraft({
    tool: "office.document.edit_draft",
    title: "Review plan",
    body: "Append one evidence-grounded paragraph.",
    postKind: "none",
    editOperations: [{
      operation: "insert_paragraph_after",
      blockId: "",
      afterBlockId: "review-plan-opening",
      text: "Integrated finding."
    }]
  }, "Integrate the findings into my Office note named \"Review plan\".", undefined, {
    documentId: "00000000-0000-4000-8000-000000000701",
    expectedRevision: 9,
    title: "Review plan"
  })?.tool,
  "office.document.edit_draft"
);

const commentId = "comment-search-check";
const noteId = "00000000-0000-4000-8000-000000000701";
const messageId = "00000000-0000-4000-8000-000000000702";
const assistantMessageId = "00000000-0000-4000-8000-000000000704";
const calls: Array<{ text: string; values: unknown[] }> = [];
const client = {
  query: async (text: string, values: unknown[]) => {
    calls.push({ text, values });
    if (text.includes("visible_posts")) {
      return {
        rows: [{
          scope: "site",
          entityType: "comment",
          entityId: commentId,
          title: "Matched Paper",
          excerpt: "A comment excerpt with the requested phrase.",
          route: `/posts/paper-search-check?comment=${commentId}`,
          revision: 4,
          rank: 0.8,
          markerId: commentId
        }]
      };
    }
    if (text.includes("visible_notes")) {
      return {
        rows: [{
          scope: "office",
          entityType: "note",
          entityId: noteId,
          title: "Private Note",
          excerpt: "A private note excerpt.",
          route: `/workspace?view=notes&note=${noteId}`,
          revision: 3,
          rank: 0.7,
          markerId: null
        }]
      };
    }
    return {
      rows: [{
        scope: "messages",
        entityType: "message",
        entityId: messageId,
        title: "Research chat",
        excerpt: "A private message excerpt.",
        route: `/messages?conversation=00000000-0000-4000-8000-000000000703#message-${messageId}`,
        revision: 2,
        rank: 0.6,
        markerId: messageId
      }, {
        scope: "messages",
        entityType: "assistant_message",
        entityId: assistantMessageId,
        title: "Earlier Assistant chat",
        excerpt: "An earlier Assistant exchange with the requested phrase.",
        route: "/assistant/threads/00000000-0000-4000-8000-000000000705",
        revision: null,
        rank: 0.5,
        markerId: null
      }]
    };
  }
} as unknown as PoolClient;

const main = async () => {
  const contexts = await searchAssistantSite(client, "search-check", {
    query: "protein folding",
    scopes: ["site", "office", "messages"]
  }, 5);

  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.values.includes("search-check")));
  assert.match(calls[0]!.text, /post\.deleted_at IS NULL/);
  assert.match(calls[0]!.text, /community_memberships viewer/);
  assert.match(calls[1]!.text, /workspace_note_grants direct/);
  assert.match(calls[1]!.text, /workspace_notebook_grants inherited/);
  assert.match(calls[2]!.text, /viewer\.cleared_through_sequence/);
  assert.match(calls[2]!.text, /message_hidden_for hidden/);
  assert.match(calls[2]!.text, /profile_blocks blocked/);
  assert.match(calls[2]!.text, /ai_messages assistant_message/);
  assert.match(calls[2]!.text, /assistant_chat\.owner_handle = \$2/);
  assert.match(calls[2]!.text, /assistant_chat\.deleted_at IS NULL/);
  assert.equal(contexts.length, 4);
  assert.equal(contexts[0]!.content, `[Comment ${commentId}]\nA comment excerpt with the requested phrase.`);
  assert.equal(contexts[1]!.entityId, noteId);
  assert.equal(contexts[1]!.metadata.revision, 3);
  assert.equal(contexts[2]!.content, `[Message ${messageId}]\nA private message excerpt.`);
  assert.equal(contexts[3]!.entityType, "assistant_message");
  assert.equal(contexts[3]!.route, "/assistant/threads/00000000-0000-4000-8000-000000000705");
  assert.equal(contexts[3]!.metadata.revision, undefined);
  const rendered = assistantRenderedInput({
    history: [],
    context: null,
    evidencePackets: [{
      sourceRef: "S1",
      title: contexts[0]!.title,
      surface: contexts[0]!.surface,
      savedSourceRevision: 1,
      capturedEntityRevision: 4,
      currentEntityRevision: 4,
      revisionStatus: "current",
      active: false,
      blocks: [{
        ref: "S1.B1",
        label: "Comment",
        excerpt: contexts[0]!.content,
        kind: "comment"
      }]
    }],
    message: "Search the site for protein folding.",
    intent: "answer"
  });
  assert.match(rendered, /SOURCE EVIDENCE PACKETS/);
  assert.doesNotMatch(rendered, /No Symposium view or source is attached/);

  const emptyClient = {
    query: async () => ({ rows: [] })
  } as unknown as PoolClient;
  const noMatches = await searchAssistantSite(emptyClient, "search-check", {
    query: "no-such-authorized-result",
    scopes: ["office", "messages"]
  }, 5);
  assert.equal(noMatches.length, 1);
  assert.match(noMatches[0]!.content, /no authorized matches/i);
  assert.equal(noMatches[0]!.metadata.ephemeral, true);

  const targetQueries: Array<{ text: string; values: unknown[] }> = [];
  const targetClient = {
    query: async (text: string, values: unknown[]) => {
      targetQueries.push({ text, values });
      return {
        rows: [{
          id: noteId,
          title: "Review plan",
          revision: 9,
          kind: "note",
          body: "Current review plan.",
          document: {
            version: 1,
            nodes: [{
              id: "review-plan-opening",
              type: "paragraph",
              content: [{ text: "Current review plan." }],
              align: "left",
              indent: 0
            }]
          }
        }]
      };
    }
  } as unknown as PoolClient;
  const { findExplicitAssistantNoteTargetInTransaction } = await import(
    "@/apps/api/src/repository/assistantActions"
  );
  const target = await findExplicitAssistantNoteTargetInTransaction(
    targetClient,
    "Integrate the findings into my Office note named \"Review plan\".",
    "search-check"
  );
  assert.equal(target?.documentId, noteId);
  assert.equal(target?.revision, 9);
  assert.deepEqual(target?.blocks, [{
    id: "review-plan-opening",
    type: "paragraph",
    text: "Current review plan.",
    editable: true
  }]);
  assert.deepEqual(targetQueries[0]!.values, ["search-check", "Review plan"]);
  assert.match(targetQueries[0]!.text, /note\.owner_handle = \$1/);
  assert.match(targetQueries[0]!.text, /note\.lifecycle = 'draft'/);
  assert.match(targetQueries[0]!.text, /note\.visibility = 'private'/);

  console.log("assistant site search check passed");
};

void main();
