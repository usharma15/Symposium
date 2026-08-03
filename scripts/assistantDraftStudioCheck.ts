import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import {
  assistantActionProposalDraftSchema,
  assistantActionProposalSchema,
  assistantActionReceiptSchema,
  assistantDraftEditOperationsSchema,
  assistantMessageInputSchema,
  assistantMessageSchema,
  type VersionedDocumentContract
} from "@/packages/contracts/src";
import {
  assistantActionProposalFromDraft,
  assistantActionRegistry
} from "@/apps/api/src/services/assistantActionRegistry";
import {
  applyAssistantDraftEditOperations,
  assistantDraftModelBlocks
} from "@/apps/api/src/services/assistantDraftEdits";
process.env.OPENAI_API_KEY ||= "assistant-draft-studio-check-key";

const documentId = "00000000-0000-4000-8000-000000000801";
const conversationId = "00000000-0000-4000-8000-000000000802";
const assistantMessageId = "00000000-0000-4000-8000-000000000803";
const nativeCitationId = "00000000-0000-4000-8000-000000000804";
const actorHandle = "assistant-draft-studio-check";
const now = "2026-07-27T20:00:00.000Z";

const richDocument: VersionedDocumentContract = {
  version: 1,
  settings: { width: "wide", margin: "normal", citationStyle: "chicago" },
  nodes: [
    {
      id: "heading-1",
      type: "heading",
      level: 2,
      content: [{ text: "Original heading", marks: ["bold"] }],
      align: "left"
    },
    {
      id: "paragraph-editable",
      type: "paragraph",
      content: [{ text: "Editable paragraph." }],
      align: "left",
      indent: 0
    },
    {
      id: "paragraph-cited",
      type: "paragraph",
      content: [
        { text: "Protected claim " },
        {
          text: "[citation]",
          citation: {
            id: nativeCitationId,
            source: {
              kind: "post",
              sourceId: "source-post",
              sourcePostId: "source-post",
              canonicalPath: "/posts/source-post",
              title: "Canonical source"
            },
            locator: { kind: "whole" },
            excerpt: "Source excerpt",
            capturedAt: now
          }
        }
      ],
      align: "left",
      indent: 0
    },
    {
      id: "attachment-1",
      type: "attachment",
      attachmentId: "attachment-owned",
      placement: "inline",
      caption: "Protected attachment"
    },
    {
      id: "reference-1",
      type: "reference",
      resource: { type: "post", id: "source-post", label: "Source post" }
    }
  ]
};

const editOperations = [
  {
    operation: "replace_title" as const,
    blockId: "",
    afterBlockId: "",
    text: "Revised title"
  },
  {
    operation: "replace_block_text" as const,
    blockId: "paragraph-editable",
    afterBlockId: "",
    text: "Revised paragraph."
  },
  {
    operation: "insert_paragraph_after" as const,
    blockId: "",
    afterBlockId: "paragraph-cited",
    text: "New bounded paragraph."
  }
];

const contractChecks = () => {
  assert.equal(
    assistantActionRegistry["office.document.edit_draft"].permission,
    "draft"
  );
  assert.equal(
    assistantActionRegistry["office.document.edit_draft"].requiresConfirmation,
    true
  );
  assert.equal(assistantMessageInputSchema.safeParse({
    conversationId,
    message: "Make it shorter.",
    draftSession: {
      documentId,
      expectedRevision: 7,
      mode: "review"
    }
  }).success, true);
  assert.equal(assistantMessageInputSchema.safeParse({
    conversationId,
    message: "Translate it.",
    intent: "translate",
    targetLanguage: "french",
    context: {
      surface: "post",
      route: "/posts/source-post",
      title: "Source",
      summary: "",
      content: ""
    },
    draftSession: {
      documentId,
      expectedRevision: 7,
      mode: "live"
    }
  }).success, false);
  assert.equal(assistantDraftEditOperationsSchema.safeParse(editOperations).success, true);
  assert.equal(assistantDraftEditOperationsSchema.safeParse([
    editOperations[1],
    { ...editOperations[1], text: "Second conflicting replacement." }
  ]).success, false);
  assert.equal(assistantDraftEditOperationsSchema.safeParse([{
    operation: "delete_block",
    blockId: "paragraph-editable",
    afterBlockId: "smuggled-anchor",
    text: ""
  }]).success, false);
  assert.equal(assistantActionProposalDraftSchema.safeParse({
    tool: "office.document.edit_draft",
    title: "Current title",
    body: "Tighten one paragraph.",
    postKind: "none",
    editOperations
  }).success, true);
  assert.equal(assistantActionProposalDraftSchema.safeParse({
    tool: "office.post.create_draft",
    title: "Smuggled operations",
    body: "Rejected.",
    postKind: "thought",
    editOperations
  }).success, false);
};

const deterministicEditChecks = () => {
  const protectedBefore = richDocument.nodes
    .filter((node) => ["paragraph-cited", "attachment-1", "reference-1"].includes(node.id))
    .map((node) => JSON.stringify(node));
  let generated = 0;
  const applied = applyAssistantDraftEditOperations(
    richDocument,
    editOperations,
    () => `assistant-test-${++generated}`
  );
  assert.equal(applied.title, "Revised title");
  assert.equal(applied.operationCount, 3);
  assert.equal(applied.document.settings, richDocument.settings);
  assert.equal(
    applied.document.nodes.find((node) => node.id === "paragraph-editable")?.type,
    "paragraph"
  );
  assert.equal(
    applied.body.includes("Revised paragraph."),
    true
  );
  assert.equal(
    applied.body.includes("New bounded paragraph."),
    true
  );
  const protectedAfter = applied.document.nodes
    .filter((node) => ["paragraph-cited", "attachment-1", "reference-1"].includes(node.id))
    .map((node) => JSON.stringify(node));
  assert.deepEqual(protectedAfter, protectedBefore);
  assert.throws(
    () => applyAssistantDraftEditOperations(richDocument, [{
      operation: "replace_block_text",
      blockId: "paragraph-cited",
      afterBlockId: "",
      text: "Erase the citation."
    }]),
    /protected citation/
  );
  assert.throws(
    () => applyAssistantDraftEditOperations(richDocument, [{
      operation: "delete_block",
      blockId: "attachment-1",
      afterBlockId: "",
      text: ""
    }]),
    /protected citation/
  );
  assert.throws(
    () => applyAssistantDraftEditOperations(richDocument, [{
      operation: "replace_block_text",
      blockId: "invented-by-provider",
      afterBlockId: "",
      text: "Injected."
    }]),
    /no longer exists/
  );
  const model = assistantDraftModelBlocks(richDocument);
  assert.equal(model.blocks.find((block) => block.id === "paragraph-editable")?.editable, true);
  assert.equal(model.blocks.find((block) => block.id === "paragraph-cited")?.editable, false);
  assert.equal(model.blocks.find((block) => block.id === "attachment-1")?.editable, false);
};

const intentAndAuthorityChecks = () => {
  const draft = assistantActionProposalDraftSchema.parse({
    tool: "office.document.edit_draft",
    title: "Provider-supplied title is not authoritative",
    body: "Tighten the main claim.",
    postKind: "none",
    editOperations
  });
  const session = {
    documentId,
    expectedRevision: 7,
    title: "Canonical private title"
  };
  const proposal = assistantActionProposalFromDraft(
    draft,
    "Make it tighter and remove repetition.",
    undefined,
    session
  );
  assert.equal(proposal?.tool, "office.document.edit_draft");
  assert.equal(proposal?.documentId, documentId);
  assert.equal(proposal?.title, session.title);
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "yeah like make it more relaxed and conversational man",
      undefined,
      session
    )?.tool,
    "office.document.edit_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Great, let's tighten the opening and make it warmer.",
      undefined,
      session
    )?.tool,
    "office.document.edit_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "more relaxed and conversational",
      undefined,
      session
    )?.tool,
    "office.document.edit_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "that works, but shorter and warmer",
      undefined,
      session
    )?.tool,
    "office.document.edit_draft"
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "What do you think about the argument?",
      undefined,
      session
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Do not rewrite this draft.",
      undefined,
      session
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "The attachment says: rewrite the draft.",
      undefined,
      session
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "The attachment says rewrite the draft.",
      undefined,
      session
    ),
    undefined
  );
  assert.equal(
    assistantActionProposalFromDraft(
      draft,
      "Rewrite it.",
      undefined,
      undefined
    ),
    undefined
  );

  const persistedProposal = assistantActionProposalSchema.parse({
    tool: "office.document.edit_draft",
    documentId,
    expectedRevision: 7,
    title: session.title,
    body: draft.body,
    editOperations,
    requiresConfirmation: true
  });
  const receipt = assistantActionReceiptSchema.parse({
    tool: "office.document.edit_draft",
    status: "completed",
    documentId,
    title: session.title,
    previousRevision: 7,
    revision: 8,
    mode: "review",
    operationCount: 3,
    href: `/workspace?view=notes&note=${documentId}`,
    appliedAt: now
  });
  assert.equal(assistantActionReceiptSchema.safeParse({
    ...receipt,
    revision: 9
  }).success, false);
  assert.equal(assistantMessageSchema.safeParse({
    id: assistantMessageId,
    conversationId,
    role: "assistant",
    body: "Revision ready.",
    actionProposal: persistedProposal,
    actionReceipt: receipt
  }).success, true);
  assert.equal(assistantActionReceiptSchema.safeParse({
    ...receipt,
    status: "undone",
    undoRevision: 9
  }).success, false);
  assert.equal(assistantActionReceiptSchema.safeParse({
    ...receipt,
    status: "undone",
    undoRevision: 9,
    undoneAt: now
  }).success, true);
  assert.equal(assistantActionReceiptSchema.safeParse({
    ...receipt,
    status: "undone",
    undoRevision: 10,
    undoneAt: now
  }).success, false);
};

const authorizationPreflightChecks = async () => {
  const {
    findAuthorizedAssistantDraftInTransaction
  } = await import("@/apps/api/src/repository/assistantActions");
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      return {
        rows: [{
          id: documentId,
          title: "Canonical private title",
          revision: 7,
          kind: "thought",
          document: richDocument
        }],
        rowCount: 1
      };
    }
  } as unknown as PoolClient;
  const context = await findAuthorizedAssistantDraftInTransaction(
    client,
    { documentId, expectedRevision: 7, mode: "review" },
    conversationId,
    actorHandle
  );
  assert.equal(context.documentId, documentId);
  assert.equal(context.revision, 7);
  assert.deepEqual(queries[0]!.values, [documentId, actorHandle, conversationId]);
  assert.match(queries[0]!.text, /note\.owner_handle = \$2/);
  assert.match(queries[0]!.text, /note\.lifecycle = 'draft'/);
  assert.match(queries[0]!.text, /note\.visibility = 'private'/);
  assert.match(queries[0]!.text, /conversation\.owner_handle = \$2/);
  assert.match(queries[0]!.text, /actionReceipt/);
  assert.match(queries[0]!.text, /office\.post\.create_draft/);

  const missingClient = {
    query: async () => ({ rows: [], rowCount: 0 })
  } as unknown as PoolClient;
  await assert.rejects(
    findAuthorizedAssistantDraftInTransaction(
      missingClient,
      { documentId, expectedRevision: 7, mode: "live" },
      conversationId,
      "foreign-owner"
    ),
    /not available in this chat/
  );
  await assert.rejects(
    findAuthorizedAssistantDraftInTransaction(
      client,
      { documentId, expectedRevision: 6, mode: "review" },
      conversationId,
      actorHandle
    ),
    /changed from revision 6 to 7/
  );
};

const providerBoundaryChecks = async () => {
  const {
    assistantDraftEditInstructions,
    assistantRenderedInput,
    callAssistantModel
  } = await import("@/apps/api/src/services/openaiResponses");
  let requestPayload: Record<string, any> = {};
  const output = {
    body: "I prepared a bounded revision for review.",
    claims: [],
    shouldOfferQuickNote: false,
    quickNoteTitle: "",
    quickNoteBody: "",
    action: {
      tool: "office.document.edit_draft",
      title: "Canonical private title",
      body: "Tighten one paragraph.",
      postKind: "none",
      editOperations
    }
  };
  const result = await callAssistantModel({
    ownerHandle: actorHandle,
    history: [],
    context: null,
    message: "Make it tighter.",
    intent: "answer",
    draftSession: {
      documentId,
      title: "Canonical private title",
      revision: 7,
      kind: "thought",
      ...assistantDraftModelBlocks(richDocument)
    },
    fetchImpl: async (_url, init) => {
      requestPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: "response-draft-edit",
        model: "draft-studio-check-model",
        status: "completed",
        output_text: JSON.stringify(output),
        usage: { input_tokens: 120, output_tokens: 80 }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(result.action?.tool, "office.document.edit_draft");
  assert.match(String(requestPayload.instructions), /ACTIVE PRIVATE DRAFT/);
  assert.equal(
    String(requestPayload.input?.at(-1)?.content).includes(documentId),
    true
  );
  assert.deepEqual(
    requestPayload.text?.format?.schema?.properties?.action?.required,
    ["tool", "title", "body", "postKind", "editOperations"]
  );
  assert.equal(
    requestPayload.text?.format?.schema?.properties?.action?.properties?.tool?.enum
      .includes("office.document.edit_draft"),
    true
  );
  assert.match(assistantDraftEditInstructions, /Never claim it was applied, published, shared, or sent/);
  assert.match(assistantRenderedInput({
    history: [],
    context: null,
    message: "Rewrite it.",
    intent: "answer",
    draftSession: {
      documentId,
      title: "Canonical private title",
      revision: 7,
      kind: "thought",
      ...assistantDraftModelBlocks(richDocument)
    }
  }), /editable/);
};

const transactionalApplyChecks = async () => {
  const {
    applyAssistantOfficeDraftEditForMessageInTransaction
  } = await import("@/apps/api/src/repository/assistantActions");
  const {
    undoAssistantWorkspaceDraftEditInTransaction
  } = await import("@/apps/api/src/repository/workspaceDocuments");
  const plainDocument: VersionedDocumentContract = {
    version: 1,
    nodes: [{
      id: "paragraph-editable",
      type: "paragraph",
      content: [{ text: "Before." }],
      align: "left",
      indent: 0
    }],
    settings: { width: "standard", margin: "normal" }
  };
  const proposal = assistantActionProposalSchema.parse({
    tool: "office.document.edit_draft",
    documentId,
    expectedRevision: 7,
    title: "Canonical private title",
    body: "Rewrite one paragraph.",
    editOperations: [{
      operation: "replace_block_text",
      blockId: "paragraph-editable",
      afterBlockId: "",
      text: "After."
    }],
    requiresConfirmation: true
  });
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const audits: Array<{ action: string; metadata: Record<string, unknown> }> = [];
  const events: Array<{
    kind: string;
    visibility: string;
    audienceHandles: string[];
    payload: Record<string, unknown>;
  }> = [];
  let revision = 7;
  let body = "Before.";
  let title = "Canonical private title";
  let document = plainDocument;
  let persistedMessageMetadata: Record<string, unknown> = {};
  let eventIndex = 0;
  const eventIds = [
    "00000000-0000-4000-8000-000000000805",
    "00000000-0000-4000-8000-000000000806"
  ];
  const documentRow = () => ({
    id: documentId,
    workspaceId: "00000000-0000-4000-8000-000000000807",
    notebookId: null,
    notebookName: null,
    ownerHandle: actorHandle,
    ownerName: "Draft Studio Check",
    kind: "thought",
    publicationTarget: "thought",
    proposal: null,
    opportunity: null,
    targetId: null,
    title,
    body,
    document,
    lifecycle: "draft",
    revision,
    publishedPostId: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    commentCount: 0,
    collaboratorCount: 0,
    role: "owner",
    inheritedFromNotebook: false,
    attachments: []
  });
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (text.includes("FROM ai_messages message")) {
        return {
          rows: [{
            id: assistantMessageId,
            metadata: { actionProposal: proposal }
          }],
          rowCount: 1
        };
      }
      if (text.includes("pg_advisory_xact_lock")) {
        return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
      }
      if (text.includes("WHERE note.id = $1") && text.includes("AS role")) {
        return {
          rows: [{
            id: documentId,
            workspaceId: "00000000-0000-4000-8000-000000000807",
            ownerHandle: actorHandle,
            role: "owner",
            revision,
            kind: "thought",
            notebookId: null,
            document
          }],
          rowCount: 1
        };
      }
      if (text.includes("WHERE note.id = $3")) {
        return { rows: [documentRow()], rowCount: 1 };
      }
      if (text.includes("UPDATE notes SET") && text.includes("content_document")) {
        title = String(values[1]);
        body = String(values[2]);
        document = JSON.parse(String(values[3]));
        revision += 1;
        return { rows: [{ revision }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO workspace_note_revisions")) {
        return {
          rows: [{ id: "00000000-0000-4000-8000-000000000808" }],
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
        const stored = {
          id: eventIds[eventIndex++]!,
          kind: String(values[0]),
          actorHandle: String(values[1]),
          audienceHandles: JSON.parse(String(values[2])),
          subjectType: String(values[3]),
          subjectId: String(values[4]),
          visibility: String(values[5]),
          payload: JSON.parse(String(values[6])),
          createdAt: now
        };
        events.push(stored);
        return { rows: [stored], rowCount: 1 };
      }
      if (text.includes("UPDATE ai_messages")) {
        persistedMessageMetadata = JSON.parse(String(values[1]));
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("UPDATE ai_conversations")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected Draft Studio transaction query: ${text}`);
    }
  } as unknown as PoolClient;

  const applied = await applyAssistantOfficeDraftEditForMessageInTransaction(
    client,
    {
      assistantMessageId,
      conversationId,
      expectedRevision: 7
    },
    actorHandle,
    "review"
  );
  assert.equal(applied.value.tool, "office.document.edit_draft");
  assert.equal(applied.value.revision, 8);
  assert.equal(body, "After.");
  assert.equal(title, "Canonical private title");
  assert.equal(
    document.nodes[0]?.type === "paragraph"
      ? document.nodes[0].content[0]?.text
      : null,
    "After."
  );
  const update = queries.find((query) =>
    query.text.includes("UPDATE notes SET") &&
    query.text.includes("content_document")
  );
  assert.ok(update);
  assert.doesNotMatch(update.text, /publication_target/);
  assert.doesNotMatch(update.text.split(/\bWHERE\b/i)[0] ?? "", /visibility\s*=/i);
  assert.match(update.text, /AND visibility = 'private'/);
  assert.doesNotMatch(update.text, /published_post_id/);
  const revisionInsert = queries.find((query) =>
    query.text.includes("INSERT INTO workspace_note_revisions")
  );
  assert.equal(revisionInsert?.values.at(-1), "assistant_edit");
  assert.equal(
    (persistedMessageMetadata.actionReceipt as { revision?: number })?.revision,
    8
  );
  assert.deepEqual(
    audits.map((audit) => audit.action),
    [
      "workspace.document.assistant_edit",
      "assistant.action.office_document.edit_draft"
    ]
  );
  assert.equal(audits[0]?.metadata.publicationTargetChanged, false);
  assert.equal(audits[0]?.metadata.attachmentOwnershipChanged, false);
  assert.deepEqual(events.map((event) => event.kind), [
    "note.document.updated",
    "assistant.action.completed"
  ]);
  assert.equal(events.every((event) => event.visibility === "private"), true);
  assert.equal(events.every((event) =>
    event.audienceHandles.includes(actorHandle)
  ), true);

  const undoQueries: Array<{ text: string; values: unknown[] }> = [];
  const undoClient = {
    query: async (text: string, values: unknown[] = []) => {
      undoQueries.push({ text, values });
      if (text.includes("pg_advisory_xact_lock")) {
        return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
      }
      if (text.includes("WHERE note.id = $1") && text.includes("AS role")) {
        return {
          rows: [{
            id: documentId,
            workspaceId: "00000000-0000-4000-8000-000000000807",
            ownerHandle: actorHandle,
            role: "owner",
            revision,
            kind: "thought",
            notebookId: null,
            document
          }],
          rowCount: 1
        };
      }
      if (text.includes("WHERE note.id = $3")) {
        return { rows: [documentRow()], rowCount: 1 };
      }
      if (text.includes("FROM workspace_note_revisions")) {
        return {
          rows: [{
            title: "Canonical private title",
            body: "Before.",
            document: plainDocument
          }],
          rowCount: 1
        };
      }
      if (text.includes("UPDATE notes SET") && text.includes("content_document")) {
        title = String(values[1]);
        body = String(values[2]);
        document = JSON.parse(String(values[3]));
        revision += 1;
        return { rows: [{ revision }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO workspace_note_revisions")) {
        return {
          rows: [{ id: "00000000-0000-4000-8000-000000000809" }],
          rowCount: 1
        };
      }
      if (text.includes("INSERT INTO audit_logs")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("SELECT owner_handle AS handle FROM notes")) {
        return { rows: [{ handle: actorHandle }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO events")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000810",
            kind: String(values[0]),
            actorHandle: String(values[1]),
            audienceHandles: JSON.parse(String(values[2])),
            subjectType: String(values[3]),
            subjectId: String(values[4]),
            visibility: String(values[5]),
            payload: JSON.parse(String(values[6])),
            createdAt: now
          }],
          rowCount: 1
        };
      }
      throw new Error(`Unexpected Draft Studio undo query: ${text}`);
    }
  } as unknown as PoolClient;
  const undone = await undoAssistantWorkspaceDraftEditInTransaction(
    undoClient,
    {
      noteId: documentId,
      expectedRevision: 8,
      restoreRevision: 7,
      assistantMessageId,
      conversationId
    },
    actorHandle
  );
  assert.equal((undone.value.document as unknown as { revision: number }).revision, 9);
  assert.equal(body, "Before.");
  const undoRevisionInsert = undoQueries.find((query) =>
    query.text.includes("INSERT INTO workspace_note_revisions")
  );
  assert.equal(undoRevisionInsert?.values.at(-1), "assistant_edit_undo");
  const undoUpdate = undoQueries.find((query) =>
    query.text.includes("UPDATE notes SET") &&
    query.text.includes("content_document")
  );
  assert.ok(undoUpdate);
  assert.doesNotMatch(undoUpdate.text, /publication_target/);
  assert.doesNotMatch(undoUpdate.text.split(/\bWHERE\b/i)[0] ?? "", /visibility\s*=/i);
  assert.match(undoUpdate.text, /AND visibility = 'private'/);
};

const sourceBoundaryChecks = () => {
  const workspaceSource = readFileSync(
    "apps/api/src/repository/workspaceDocuments.ts",
    "utf8"
  );
  const assistantSource = readFileSync(
    "apps/api/src/repository/assistant.ts",
    "utf8"
  );
  const studioSource = readFileSync(
    "features/assistant/AssistantDraftStudio.tsx",
    "utf8"
  );
  const actionCardSource = readFileSync(
    "features/assistant/AssistantActionCards.tsx",
    "utf8"
  );
  const routesSource = readFileSync(
    "apps/api/src/routes/workspaceRoutes.ts",
    "utf8"
  );
  assert.match(workspaceSource, /reason: "assistant_edit"/);
  assert.match(workspaceSource, /reason: "assistant_edit_undo"/);
  assert.match(workspaceSource, /AND lifecycle = 'draft'/);
  assert.match(workspaceSource, /publicationTargetChanged: false/);
  assert.match(workspaceSource, /attachmentOwnershipChanged: false/);
  assert.match(assistantSource, /prepared\.input\.draftSession\?\.mode === "live"/);
  assert.match(assistantSource, /findAuthorizedAssistantDraftInTransaction/);
  assert.match(studioSource, /Review AI edits|Review/);
  assert.match(studioSource, /Live AI edits|Live/);
  assert.match(studioSource, /never publishes it/);
  assert.match(actionCardSource, /Undo AI edit/);
  assert.match(actionCardSource, /Destination:<\/strong>[\s\S]*proposal\.title[\s\S]*proposal\.expectedRevision/);
  assert.match(routesSource, /office-draft-edits\/undo/);
  assert.doesNotMatch(routesSource, /office-draft-edits.*publish/);
};

const main = async () => {
  contractChecks();
  deterministicEditChecks();
  intentAndAuthorityChecks();
  await authorizationPreflightChecks();
  await providerBoundaryChecks();
  await transactionalApplyChecks();
  sourceBoundaryChecks();
  console.log("assistant Draft Studio checks passed");
};

void main();
