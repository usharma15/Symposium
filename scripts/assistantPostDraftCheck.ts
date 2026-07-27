import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import {
  assistantActionProposalDraftSchema,
  assistantActionProposalSchema,
  assistantActionReceiptSchema,
  assistantMessageSchema,
  confirmAssistantOfficePostDraftInputSchema
} from "@/packages/contracts/src";
import {
  assistantActionProposalFromDraft,
  assistantActionRequestForTurn,
  assistantActionRegistry
} from "@/apps/api/src/services/assistantActionRegistry";

process.env.OPENAI_API_KEY ||= "assistant-post-draft-check-key";

let confirmAssistantOfficeNoteDraftInTransaction:
  typeof import("@/apps/api/src/repository/assistantActions")["confirmAssistantOfficeNoteDraftInTransaction"];
let confirmAssistantOfficePostDraftInTransaction:
  typeof import("@/apps/api/src/repository/assistantActions")["confirmAssistantOfficePostDraftInTransaction"];

const assistantMessageId = "00000000-0000-4000-8000-000000000701";
const conversationId = "00000000-0000-4000-8000-000000000702";
const documentId = "00000000-0000-4000-8000-000000000703";
const workspaceId = "00000000-0000-4000-8000-000000000704";
const actorHandle = "assistant-post-check";
const now = "2026-07-27T16:00:00.000Z";

const input = confirmAssistantOfficePostDraftInputSchema.parse({
  assistantMessageId,
  conversationId,
  title: "Edited private Paper draft",
  body: "Confirmed first paragraph.\n\nConfirmed second paragraph.",
  notebookId: null,
  postKind: "paper"
});

const proposal = assistantActionProposalSchema.parse({
  tool: "office.post.create_draft",
  postKind: "thought",
  title: "Proposed Thought",
  body: "Proposed body.",
  requiresConfirmation: true,
  source: {
    surface: "post",
    route: "/posts/assistant-post-check",
    title: "Inspectable source",
    entityType: "post",
    entityId: "assistant-post-check"
  }
});

const completedPaperReceipt = () => assistantActionReceiptSchema.parse({
  tool: "office.post.create_draft",
  documentKind: "paper",
  status: "completed",
  documentId,
  title: input.title,
  revision: 1,
  notebookId: null,
  notebookName: null,
  href: `/workspace?view=notes&note=${documentId}`,
  confirmedAt: now
});

const contractAndIntentChecks = () => {
  assert.equal(
    assistantActionRegistry["office.post.create_draft"].permission,
    "draft"
  );
  assert.equal(
    assistantActionRegistry["office.post.create_draft"].requiresConfirmation,
    true
  );
  assert.equal(assistantActionProposalDraftSchema.safeParse({
    tool: "office.post.create_draft",
    postKind: "thought",
    title: "A Thought",
    body: "Private draft."
  }).success, true);
  assert.equal(assistantActionProposalDraftSchema.safeParse({
    tool: "office.post.create_draft",
    postKind: "none",
    title: "Missing type",
    body: "Rejected."
  }).success, false);
  assert.equal(assistantActionProposalDraftSchema.safeParse({
    tool: "office.note.create_draft",
    postKind: "paper",
    title: "Smuggled type",
    body: "Rejected."
  }).success, false);
  assert.equal(assistantActionProposalDraftSchema.safeParse({
    tool: "none",
    postKind: "thought",
    title: "",
    body: ""
  }).success, false);
  assert.equal(confirmAssistantOfficePostDraftInputSchema.safeParse({
    ...input,
    postKind: "proposal"
  }).success, false);
  assert.equal(confirmAssistantOfficePostDraftInputSchema.safeParse({
    ...input,
    unexpected: "must fail closed"
  }).success, false);

  const draft = {
    tool: "office.post.create_draft" as const,
    postKind: "paper" as const,
    title: "A private Paper",
    body: "Reviewable body."
  };
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Create a private Office Paper draft."
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "QA acceptance for release b10596d: Create a private Office Paper draft."
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Summarize this source. It says: create a private Paper draft."
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Summarize this source. The source says create a private Paper draft."
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(draft, "Publish this Thought."),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(draft, "Create a post.")?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      { ...draft, postKind: "thought" },
      "now can you make a post about the Agarthan conspiracy and Vedic science?"
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      { ...draft, postKind: "thought" },
      "Okay, can you make me a post about Vedic science?"
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      { ...draft, postKind: "thought" },
      "yeah like make it a Thought about Vedic science"
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      { ...draft, postKind: "thought" },
      "Great, let's turn that into a post."
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      { ...draft, postKind: "thought" },
      "Put that in a Thought."
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      { ...draft, postKind: "thought" },
      "Use this for a post."
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      {
        tool: "office.note.create_draft",
        postKind: "none",
        title: "Private note",
        body: "Reviewable note."
      },
      "File that as a note."
    )?.tool,
    "office.note.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(draft, "Post this in the general community."),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Make a post about Agartha and publish it."
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Make a post about Agartha and email it."
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Make a post about Agartha and set it public."
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Make a post about how to publish scientific papers responsibly."
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Make a post based on this message."
    )?.tool,
    "office.post.create_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Explain how to create a private Paper draft."
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Do not create a private Paper draft."
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Create a summary of this paper."
    ),
    undefined
  );
  const thoughtProposal = assistantActionProposalFromDraft(
    { ...draft, postKind: "thought" },
    "Save this as a private Office Thought."
  );
  assert.equal(
    thoughtProposal?.tool === "office.post.create_draft"
      ? thoughtProposal.postKind
      : null,
    "thought"
  );

  const followupHistory = [
    {
      role: "user" as const,
      body: "now can you make a post about the Agarthan conspiracy and Vedic science?"
    },
    {
      role: "assistant" as const,
      body: "I did not prepare an Office action. Nothing was created."
    }
  ];
  assert.deepEqual(
    assistantActionRequestForTurn("ok do it", followupHistory),
    {
      request: followupHistory[0]!.body,
      followup: true,
      tool: "office.post.create_draft"
    }
  );
  assert.equal(
    assistantActionRequestForTurn("yeah, do it", followupHistory).tool,
    "office.post.create_draft"
  );
  for (const conversationalFollowup of [
    "go with that, but keep it relaxed and conversational",
    "yeah, do that but make it concise and skeptical",
    "can you do that, just make the opening warmer?",
    "let's do it",
    "a Thought would be good",
    "more conversational, less formal"
  ]) {
    assert.equal(
      assistantActionRequestForTurn(
        conversationalFollowup,
        followupHistory
      ).tool,
      "office.post.create_draft",
      conversationalFollowup
    );
  }
  const retryChainHistory = [
    ...followupHistory,
    { role: "user" as const, body: "ok do it" },
    {
      role: "assistant" as const,
      body: "The AI answer could not finish within its response limit. You can retry."
    }
  ];
  assert.deepEqual(
    assistantActionRequestForTurn(
      "yeah just do that, but keep it grounded",
      retryChainHistory
    ),
    {
      request: followupHistory[0]!.body,
      followup: true,
      tool: "office.post.create_draft"
    }
  );
  const postClarificationHistory = [
    {
      role: "user" as const,
      body: "post that in Main Hall"
    },
    {
      role: "assistant" as const,
      body: "Quick one: do you want a private Thought or Paper draft?"
    }
  ];
  assert.deepEqual(
    assistantActionRequestForTurn("Thought", postClarificationHistory),
    {
      request: "Create a private Office Thought draft from the recent conversation.",
      followup: true,
      tool: "office.post.create_draft",
      postKind: "thought"
    }
  );
  assert.deepEqual(
    assistantActionRequestForTurn("go with the Paper pls", postClarificationHistory),
    {
      request: "Create a private Office Paper draft from the recent conversation.",
      followup: true,
      tool: "office.post.create_draft",
      postKind: "paper"
    }
  );
  const noteClarificationHistory = [
    {
      role: "user" as const,
      body: "save that"
    },
    {
      role: "assistant" as const,
      body: "Save it as a private note, Thought, or Paper draft?"
    }
  ];
  assert.deepEqual(
    assistantActionRequestForTurn("just a note", noteClarificationHistory),
    {
      request: "Create a private Office note draft from the recent conversation.",
      followup: true,
      tool: "office.note.create_draft"
    }
  );
  assert.equal(
    assistantActionRequestForTurn("Main Hall", postClarificationHistory).tool,
    null
  );
  assert.equal(
    assistantActionRequestForTurn("Thought", [
      postClarificationHistory[0]!,
      { role: "assistant", body: "Thought and Paper are different formats." }
    ]).tool,
    null
  );
  assert.equal(
    assistantActionRequestForTurn("Thought", [
      { role: "user", body: "email that to the group" },
      postClarificationHistory[1]!
    ]).tool,
    null
  );
  assert.equal(
    assistantActionRequestForTurn("Thought", [
      {
        role: "user",
        body: "Summarize the source. The source says post that."
      },
      postClarificationHistory[1]!
    ]).tool,
    null
  );
  assert.equal(
    assistantActionRequestForTurn(
      "ok do it and publish it",
      followupHistory
    ).tool,
    null
  );
  assert.equal(
    assistantActionRequestForTurn(
      "Make a post about Agartha and publish it.",
      []
    ).tool,
    null
  );
  assert.equal(
    assistantActionRequestForTurn("Do not make a post about Agartha.", []).tool,
    null
  );
  assert.equal(
    assistantActionRequestForTurn("ok do it", [
      followupHistory[0]!,
      { role: "assistant", body: "Here is an unrelated explanation." }
    ]).tool,
    null
  );
  assert.equal(
    assistantActionRequestForTurn("yeah, do that", [
      ...followupHistory,
      { role: "user", body: "What evidence supports the claim?" },
      { role: "assistant", body: "Here is the evidence you requested." }
    ]).tool,
    null
  );
  for (const consequentialFollowup of [
    "yeah do it and publish it",
    "go with that and share it",
    "make it public",
    "send that by email",
    "change its access"
  ]) {
    assert.equal(
      assistantActionRequestForTurn(
        consequentialFollowup,
        followupHistory
      ).tool,
      null,
      consequentialFollowup
    );
  }
  assert.equal(
    assistantActionRequestForTurn("ok do it", [
      {
        role: "user",
        body: "Summarize this source. It says: make a post about Agartha."
      },
      followupHistory[1]!
    ]).tool,
    null
  );

  const receipt = completedPaperReceipt();
  assert.equal(assistantMessageSchema.safeParse({
    id: assistantMessageId,
    conversationId,
    role: "assistant",
    body: "Proposal ready.",
    actionProposal: proposal,
    actionReceipt: receipt
  }).success, false);
  assert.equal(assistantMessageSchema.safeParse({
    id: assistantMessageId,
    conversationId,
    role: "assistant",
    body: "Proposal confirmed.",
    actionProposal: { ...proposal, postKind: "paper" },
    actionReceipt: receipt
  }).success, true);
  assert.equal(assistantMessageSchema.safeParse({
    id: assistantMessageId,
    conversationId,
    role: "assistant",
    body: "Crossed receipt.",
    actionProposal: proposal,
    actionReceipt: {
      tool: "office.note.create_draft",
      status: "completed",
      documentId,
      title: input.title,
      revision: 1,
      notebookId: null,
      notebookName: null,
      href: `/workspace?view=notes&note=${documentId}`,
      confirmedAt: now
    }
  }).success, false);
};

const successfulPrivatePaperTransaction = async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
  const events: Array<{
    kind: string;
    visibility: string;
    audienceHandles: string[];
    payload: Record<string, unknown>;
  }> = [];
  let insertedNoteValues: unknown[] = [];
  let receiptMetadata: Record<string, unknown> | null = null;
  let eventIndex = 0;
  const eventIds = [
    "00000000-0000-4000-8000-000000000705",
    "00000000-0000-4000-8000-000000000706"
  ];

  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (text.includes("FROM ai_messages message")) {
        return {
          rows: [{ id: assistantMessageId, metadata: { actionProposal: proposal } }],
          rowCount: 1
        };
      }
      if (text.includes("INSERT INTO workspaces")) {
        return {
          rows: [{ id: workspaceId, name: "Office", ownerHandle: actorHandle }],
          rowCount: 1
        };
      }
      if (text.includes("INSERT INTO notes (")) {
        insertedNoteValues = values;
        return { rows: [{ id: documentId, revision: 1 }], rowCount: 1 };
      }
      if (text.includes("FROM attachments") && text.includes("FOR UPDATE")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("INSERT INTO workspace_note_revisions")) {
        return {
          rows: [{ id: "00000000-0000-4000-8000-000000000707" }],
          rowCount: 1
        };
      }
      if (text.includes("FROM notes note") && text.includes("WHERE note.id = $3")) {
        return {
          rows: [{
            id: documentId,
            workspaceId,
            notebookId: null,
            notebookName: null,
            ownerHandle: actorHandle,
            ownerName: "Post Check",
            kind: "paper",
            publicationTarget: "paper",
            proposal: null,
            opportunity: null,
            targetId: null,
            title: input.title,
            body: input.body,
            document: JSON.parse(String(insertedNoteValues[5])),
            lifecycle: "draft",
            revision: 1,
            publishedPostId: null,
            createdAt: now,
            updatedAt: now,
            publishedAt: null,
            commentCount: 0,
            collaboratorCount: 0,
            role: "owner",
            inheritedFromNotebook: false,
            attachments: []
          }],
          rowCount: 1
        };
      }
      if (text.includes("SELECT owner_handle AS handle FROM notes")) {
        return { rows: [{ handle: actorHandle }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO audit_logs")) {
        audits.push({
          action: String(values[1]),
          metadata: JSON.parse(String(values[4]))
        });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("INSERT INTO events")) {
        const event = {
          kind: String(values[0]),
          visibility: String(values[5]),
          audienceHandles: JSON.parse(String(values[2])) as string[],
          payload: JSON.parse(String(values[6])) as Record<string, unknown>
        };
        events.push(event);
        return {
          rows: [{
            id: eventIds[eventIndex++]!,
            ...event,
            actorHandle: values[1],
            subjectType: values[3],
            subjectId: values[4],
            createdAt: now
          }],
          rowCount: 1
        };
      }
      if (text.includes("UPDATE ai_messages")) {
        receiptMetadata = JSON.parse(String(values[1]));
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("UPDATE ai_conversations")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected post-draft query: ${text}`);
    }
  } as unknown as PoolClient;

  const result = await confirmAssistantOfficePostDraftInTransaction(
    client,
    input,
    actorHandle
  );
  assert.equal(result.value.tool, "office.post.create_draft");
  assert.equal(
    result.value.tool === "office.post.create_draft"
      ? result.value.documentKind
      : null,
    "paper"
  );
  assert.equal(result.value.documentId, documentId);
  assert.equal(insertedNoteValues[6], "paper");
  assert.equal(insertedNoteValues[7], "paper");
  assert.equal(insertedNoteValues[8], null);
  assert.equal(insertedNoteValues[9], null);
  assert.equal(insertedNoteValues[10], null);
  assert.match(
    queries.find((query) => query.text.includes("INSERT INTO notes ("))?.text ?? "",
    /'draft', 'private'/
  );
  assert.equal(
    queries.some((query) => /INSERT INTO (?:posts|inquiries)/.test(query.text)),
    false
  );
  const savedDocument = JSON.parse(String(insertedNoteValues[5])) as {
    nodes: Array<{
      type: string;
      content?: Array<{ text: string }>;
      resource?: { type: string; id: string; label?: string };
    }>;
  };
  assert.deepEqual(
    savedDocument.nodes.slice(0, 2).map((node) =>
      node.content?.map((run) => run.text).join("") ?? ""
    ),
    ["Confirmed first paragraph.", "Confirmed second paragraph."]
  );
  assert.deepEqual(savedDocument.nodes.at(-1)?.resource, {
    type: "post",
    id: "assistant-post-check",
    label: "Inspectable source"
  });
  assert.deepEqual(
    audits.map((audit) => audit.action),
    ["workspace.document.create", "assistant.action.office_post.create_draft"]
  );
  assert.equal(audits[1]?.metadata.documentKind, "paper");
  assert.equal(audits[1]?.metadata.publicationTarget, "paper");
  assert.ok(events.every((event) => event.visibility === "private"));
  assert.ok(events.every((event) =>
    event.audienceHandles.length === 1 &&
    event.audienceHandles[0] === actorHandle
  ));
  assert.equal(events[1]?.payload.documentKind, "paper");
  const persisted = receiptMetadata as Record<string, unknown> | null;
  assert.ok(persisted);
  assert.equal(
    (persisted.actionProposal as { postKind: string }).postKind,
    "paper"
  );
  assert.equal(
    assistantActionReceiptSchema.parse(persisted.actionReceipt).tool,
    "office.post.create_draft"
  );
  const insertIndex = queries.findIndex((query) =>
    query.text.includes("INSERT INTO notes (")
  );
  const receiptIndex = queries.findIndex((query) =>
    query.text.includes("UPDATE ai_messages")
  );
  assert.ok(insertIndex >= 0 && receiptIndex > insertIndex);
};

const postReplayChecks = async () => {
  const receipt = completedPaperReceipt();
  let persistentQueryCount = 0;
  const persistentClient = {
    query: async (text: string) => {
      persistentQueryCount += 1;
      assert.match(text, /FROM ai_messages message/);
      return {
        rows: [{
          id: assistantMessageId,
          metadata: {
            actionProposal: { ...proposal, postKind: "paper" },
            actionReceipt: receipt
          }
        }],
        rowCount: 1
      };
    }
  } as unknown as PoolClient;
  const persistent = await confirmAssistantOfficePostDraftInTransaction(
    persistentClient,
    input,
    actorHandle
  );
  assert.deepEqual(persistent.value, receipt);
  assert.equal(persistentQueryCount, 1);
  assert.equal(persistent.events, undefined);

  const ledgerQueries: string[] = [];
  const ledgerClient = {
    query: async (text: string) => {
      ledgerQueries.push(text);
      if (text.includes("INSERT INTO mutation_receipts")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("FROM mutation_receipts")) {
        return {
          rows: [{
            requestHash: "post-draft-ledger-hash",
            status: "completed",
            response: receipt
          }],
          rowCount: 1
        };
      }
      throw new Error(`Unexpected post replay query: ${text}`);
    }
  } as unknown as PoolClient;
  const ledger = await confirmAssistantOfficePostDraftInTransaction(
    ledgerClient,
    input,
    actorHandle,
    {
      idempotencyKey: "assistant-post-ledger-replay",
      requestHash: "post-draft-ledger-hash",
      scope: "assistant.action.office-post.create-draft"
    }
  );
  assert.deepEqual(ledger.value, receipt);
  assert.equal(ledgerQueries.length, 2);
  assert.ok(ledgerQueries.every((query) =>
    !query.includes("FROM ai_messages message") &&
    !query.includes("INSERT INTO notes")
  ));
};

const foreignNotebookFailsClosed = async () => {
  let insertedNote = false;
  const client = {
    query: async (text: string) => {
      if (text.includes("FROM ai_messages message")) {
        return {
          rows: [{ id: assistantMessageId, metadata: { actionProposal: proposal } }],
          rowCount: 1
        };
      }
      if (text.includes("INSERT INTO workspaces")) {
        return {
          rows: [{ id: workspaceId, name: "Office", ownerHandle: actorHandle }],
          rowCount: 1
        };
      }
      if (text.includes("FROM workspace_notebooks")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("INSERT INTO notes")) insertedNote = true;
      throw new Error(`Unexpected foreign-notebook query: ${text}`);
    }
  } as unknown as PoolClient;
  await assert.rejects(
    confirmAssistantOfficePostDraftInTransaction(
      client,
      {
        ...input,
        notebookId: "00000000-0000-4000-8000-000000000799"
      },
      actorHandle
    ),
    /Notebook not found/
  );
  assert.equal(insertedNote, false);
};

const crossedEndpointsFailClosed = async () => {
  let wrote = false;
  const postProposalClient = {
    query: async (text: string) => {
      if (text.includes("FROM ai_messages message")) {
        return {
          rows: [{ id: assistantMessageId, metadata: { actionProposal: proposal } }],
          rowCount: 1
        };
      }
      wrote = true;
      throw new Error(`Unexpected write after mismatch: ${text}`);
    }
  } as unknown as PoolClient;
  await assert.rejects(
    confirmAssistantOfficeNoteDraftInTransaction(
      postProposalClient,
      {
        assistantMessageId,
        conversationId,
        title: input.title,
        body: input.body,
        notebookId: null
      },
      actorHandle
    ),
    /does not match this confirmation endpoint/
  );
  assert.equal(wrote, false);

  const noteProposal = assistantActionProposalSchema.parse({
    tool: "office.note.create_draft",
    title: "Private note",
    body: "Note body.",
    requiresConfirmation: true
  });
  const noteProposalClient = {
    query: async (text: string) => {
      if (text.includes("FROM ai_messages message")) {
        return {
          rows: [{ id: assistantMessageId, metadata: { actionProposal: noteProposal } }],
          rowCount: 1
        };
      }
      wrote = true;
      throw new Error(`Unexpected write after mismatch: ${text}`);
    }
  } as unknown as PoolClient;
  await assert.rejects(
    confirmAssistantOfficePostDraftInTransaction(
      noteProposalClient,
      input,
      actorHandle
    ),
    /does not match this confirmation endpoint/
  );
  assert.equal(wrote, false);
};

const replayedCrossToolReceiptFailsClosed = async () => {
  const noteReceipt = assistantActionReceiptSchema.parse({
    tool: "office.note.create_draft",
    status: "completed",
    documentId,
    title: input.title,
    revision: 1,
    notebookId: null,
    notebookName: null,
    href: `/workspace?view=notes&note=${documentId}`,
    confirmedAt: now
  });
  const client = {
    query: async (text: string) => {
      if (text.includes("INSERT INTO mutation_receipts")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("FROM mutation_receipts")) {
        return {
          rows: [{
            requestHash: "post-draft-request-hash",
            status: "completed",
            response: noteReceipt
          }],
          rowCount: 1
        };
      }
      throw new Error(`Unexpected replay query: ${text}`);
    }
  } as unknown as PoolClient;
  await assert.rejects(
    confirmAssistantOfficePostDraftInTransaction(
      client,
      input,
      actorHandle,
      {
        idempotencyKey: "assistant-post-draft-replay",
        requestHash: "post-draft-request-hash",
        scope: "assistant.action.office-post.create-draft"
      }
    ),
    /does not match this confirmation endpoint/
  );
};

const providerChecks = async () => {
  const { callAssistantModel } = await import(
    "@/apps/api/src/services/openaiResponses"
  );
  const providerFollowupHistory = [
    {
      role: "user" as const,
      body: "now can you make a post about the Agarthan conspiracy and Vedic science?"
    },
    {
      role: "assistant" as const,
      body: "I did not prepare an Office action. Nothing was created."
    }
  ];
  let providerPayload = "";
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    providerPayload = String(init?.body);
    return new Response(JSON.stringify({
      id: "resp_assistant_post_draft_check",
      model: "gpt-5.6-terra",
      status: "completed",
      output_text: JSON.stringify({
        body: "I prepared a private Paper draft proposal for review.",
        claims: [],
        shouldOfferQuickNote: false,
        quickNoteTitle: "",
        quickNoteBody: "",
        action: {
          tool: "office.post.create_draft",
          title: "Provider Paper",
          body: "Editable provider body.",
          postKind: "paper",
          editOperations: []
        }
      }),
      usage: { input_tokens: 90, output_tokens: 32 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const result = await callAssistantModel({
    ownerHandle: actorHandle,
    history: providerFollowupHistory,
    context: null,
    message: "yeah, go with that but keep it relaxed and concise",
    intent: "answer",
    resolvedActionRequest: providerFollowupHistory[0]!.body,
    actionDraftRequested: true,
    fetchImpl
  });
  assert.equal(result.action?.tool, "office.post.create_draft");
  assert.equal(
    result.action?.tool === "office.post.create_draft"
      ? result.action.postKind
      : null,
    "paper"
  );
  const payload = JSON.parse(providerPayload) as {
    instructions: string;
    input: Array<{ role: string; content: string }>;
    max_output_tokens: number;
  };
  assert.match(payload.instructions, /Thought, Paper, or post/);
  assert.match(payload.instructions, /RESOLVED ACTION CONTEXT/);
  assert.match(payload.instructions, /relaxed and conversational/i);
  assert.match(payload.instructions, /recent exchange naturally/i);
  assert.match(payload.instructions, /ask at most one short practical clarification/i);
  assert.match(payload.instructions, /Thought or Paper/i);
  assert.match(payload.instructions, /Do not lecture/i);
  assert.match(payload.instructions, /not draft requests/);
  assert.match(payload.instructions, /Never claim it ran/);
  assert.equal(payload.max_output_tokens >= 2000, true);
  assert.match(payload.input.at(-1)?.content ?? "", /RESOLVED ACTION CONTEXT/);
  assert.match(
    payload.input.at(-1)?.content ?? "",
    /now can you make a post about the Agarthan conspiracy and Vedic science/
  );
  assert.match(
    payload.input.at(-1)?.content ?? "",
    /yeah, go with that but keep it relaxed and concise/
  );
  assert.match(payload.input.at(-1)?.content ?? "", /reviewable private Office draft/);
  assert.match(payload.input.at(-1)?.content ?? "", /post publicly/);

  const invalidKindFetch = (async () => new Response(JSON.stringify({
    id: "resp_assistant_post_draft_invalid_kind",
    model: "gpt-5.6-terra",
    status: "completed",
    output_text: JSON.stringify({
      body: "Invalid proposal.",
      claims: [],
      shouldOfferQuickNote: false,
      quickNoteTitle: "",
      quickNoteBody: "",
      action: {
        tool: "office.post.create_draft",
        title: "Invalid",
        body: "Invalid",
        postKind: "none",
        editOperations: []
      }
    }),
    usage: { input_tokens: 60, output_tokens: 20 }
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  await assert.rejects(
    callAssistantModel({
      ownerHandle: actorHandle,
      history: [],
      context: null,
      message: "Create a private Office Paper draft.",
      intent: "answer",
      fetchImpl: invalidKindFetch
    }),
    /unusable response/
  );
};

const staticBoundaryChecks = () => {
  const repository = readFileSync(
    "apps/api/src/repository/assistantActions.ts",
    "utf8"
  );
  const route = readFileSync(
    "apps/api/src/routes/workspaceRoutes.ts",
    "utf8"
  );
  const proxy = readFileSync(
    "app/api/assistant/actions/office-post-drafts/route.ts",
    "utf8"
  );
  const card = readFileSync(
    "features/assistant/AssistantActionCards.tsx",
    "utf8"
  );
  const assistantRepository = readFileSync(
    "apps/api/src/repository/assistant.ts",
    "utf8"
  );
  assert.match(repository, /proposal\.data\.tool !== expectedTool/);
  assert.match(repository, /receiptForExpectedTool/);
  assert.match(repository, /FOR UPDATE OF message, conversation/);
  assert.match(repository, /conversation\.owner_handle = \$3/);
  assert.match(repository, /conversation\.archived_at IS NULL/);
  assert.match(repository, /conversation\.deleted_at IS NULL/);
  assert.match(repository, /kind: documentKind/);
  assert.match(repository, /publicationTarget/);
  assert.match(repository, /assistant\.action\.office_post\.create_draft/);
  assert.doesNotMatch(repository, /reserveAssistantUsage|completeAssistantUsage/);
  assert.match(route, /\/v1\/assistant\/actions\/office-post-drafts/);
  assert.match(route, /assistant\.action\.office-post\.create-draft/);
  assert.match(proxy, /proxyLiveBackend/);
  assert.match(proxy, /AI Assistant actions require the live workspace/);
  assert.doesNotMatch(proxy, /localStorage|fallback/i);
  assert.match(card, /Private draft only · not published/);
  assert.match(card, /Nothing is created until you confirm, and nothing is published/);
  assert.match(card, /Private post draft type/);
  assert.match(card, /office-post-drafts/);
  assert.match(card, /Confirm & create private draft/);
  assert.match(card, /symposium-workspace-change/);
  assert.match(card, /type="button"/);
  assert.match(card, /role="alert"/);
  assert.match(assistantRepository, /actionRequestPostKind/);
  assert.match(
    assistantRepository,
    /actionProposal\.postKind !== prepared\.actionRequest\.postKind/
  );
};

const main = async () => {
  ({
    confirmAssistantOfficeNoteDraftInTransaction,
    confirmAssistantOfficePostDraftInTransaction
  } = await import("@/apps/api/src/repository/assistantActions"));
  contractAndIntentChecks();
  await successfulPrivatePaperTransaction();
  await postReplayChecks();
  await foreignNotebookFailsClosed();
  await crossedEndpointsFailClosed();
  await replayedCrossToolReceiptFailsClosed();
  await providerChecks();
  staticBoundaryChecks();
  console.log(
    "Assistant private Thought/Paper proposal contracts, explicit-intent gate, fail-closed tool dispatch, private draft persistence, source preservation, receipts, replay safety, audit, events, provider restrictions, and UI boundaries passed."
  );
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
