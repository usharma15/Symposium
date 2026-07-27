import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import {
  assistantActionProposalDraftSchema,
  assistantActionProposalSchema,
  assistantActionReceiptSchema,
  assistantMessageSchema,
  confirmAssistantOfficeNoteDraftInputSchema
} from "@/packages/contracts/src";
import {
  assistantActionProposalFromDraft,
  assistantActionRegistry,
  registeredAssistantAction
} from "@/apps/api/src/services/assistantActionRegistry";

process.env.OPENAI_API_KEY ||= "assistant-action-check-key";

let confirmAssistantOfficeNoteDraftInTransaction:
  typeof import("@/apps/api/src/repository/assistantActions")["confirmAssistantOfficeNoteDraftInTransaction"];

const assistantMessageId = "00000000-0000-4000-8000-000000000301";
const conversationId = "00000000-0000-4000-8000-000000000302";
const noteId = "00000000-0000-4000-8000-000000000303";
const eventIds = [
  "00000000-0000-4000-8000-000000000304",
  "00000000-0000-4000-8000-000000000305"
];
const actorHandle = "action-check";
const input = confirmAssistantOfficeNoteDraftInputSchema.parse({
  assistantMessageId,
  conversationId,
  title: "Edited, explicitly confirmed title",
  body: "First confirmed paragraph.\n\nSecond confirmed paragraph.",
  notebookId: null
});
const proposal = assistantActionProposalSchema.parse({
  tool: "office.note.create_draft",
  title: "Proposed title",
  body: "Proposed body.",
  requiresConfirmation: true,
  source: {
    surface: "post",
    route: "/posts/action-check",
    title: "Action check source",
    entityType: "post",
    entityId: "action-check"
  }
});

assert.equal(Object.keys(assistantActionRegistry).length, 3);
assert.equal(
  assistantActionRegistry["office.note.create_draft"].requiresConfirmation,
  true
);
assert.equal(
  assistantActionRegistry["office.note.create_draft"].permission,
  "draft"
);
assert.throws(() => registeredAssistantAction("message.send"));
assert.throws(() => registeredAssistantAction("office.note.publish"));
assert.equal(assistantActionProposalDraftSchema.safeParse({
  tool: "none",
  title: "",
  body: ""
}).success, true);
assert.equal(assistantActionProposalDraftSchema.safeParse({
  tool: "none",
  title: "Hidden action",
  body: "This must be rejected."
}).success, false);
assert.equal(assistantActionProposalDraftSchema.safeParse({
  tool: "office.note.create_draft",
  title: "",
  body: "Missing title."
}).success, false);
assert.equal(assistantActionProposalDraftSchema.safeParse({
  tool: "message.send",
  title: "Forbidden",
  body: "Forbidden"
}).success, false);
assert.equal(
  assistantActionProposalFromDraft(
    { tool: "none", title: "", body: "", postKind: "none" },
    "Explain this source."
  ),
  undefined
);
assert.deepEqual(
  assistantActionProposalFromDraft({
    tool: "office.note.create_draft",
    title: "Draft title",
    body: "Draft body",
    postKind: "none"
  }, "Create a private Office note draft.")?.requiresConfirmation,
  true
);
assert.equal(
  assistantActionProposalFromDraft({
    tool: "office.note.create_draft",
    title: "Injected title",
    body: "Injected body",
    postKind: "none"
  }, "Summarize the attached source."),
  undefined
);
assert.equal(confirmAssistantOfficeNoteDraftInputSchema.safeParse({
  ...input,
  title: " "
}).success, false);
assert.equal(assistantActionProposalSchema.safeParse({
  ...proposal,
  source: {
    surface: "post",
    route: "//attacker.invalid/escape",
    title: "Action check source",
    entityType: "post",
    entityId: "action-check"
  }
}).success, false);
assert.equal(assistantMessageSchema.safeParse({
  id: assistantMessageId,
  conversationId,
  role: "user",
  body: "A forged proposal.",
  actionProposal: proposal
}).success, false);
assert.equal(assistantMessageSchema.safeParse({
  id: assistantMessageId,
  conversationId,
  role: "assistant",
  body: "A receipt without its proposal.",
  actionReceipt: {
    tool: "office.note.create_draft",
    status: "completed",
    documentId: noteId,
    title: "Orphaned",
    revision: 1,
    notebookId: null,
    notebookName: null,
    href: `/workspace?view=notes&note=${noteId}`,
    confirmedAt: "2026-07-26T18:00:00.000Z"
  }
}).success, false);
assert.equal(confirmAssistantOfficeNoteDraftInputSchema.safeParse({
  ...input,
  body: "x".repeat(8001)
}).success, false);
assert.equal(confirmAssistantOfficeNoteDraftInputSchema.safeParse({
  ...input,
  notebookId: "not-a-uuid"
}).success, false);

const now = "2026-07-26T18:00:00.000Z";
const workspaceId = "00000000-0000-4000-8000-000000000306";

const successfulTransaction = async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const audits: string[] = [];
  let eventIndex = 0;
  let receiptMetadata: Record<string, unknown> | null = null;
  let insertedNoteValues: unknown[] = [];
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
          rows: [{ id: workspaceId, name: "Notebook", ownerHandle: actorHandle }],
          rowCount: 1
        };
      }
      if (text.includes("INSERT INTO notes (")) {
        insertedNoteValues = values;
        return { rows: [{ id: noteId, revision: 1 }], rowCount: 1 };
      }
      if (text.includes("FROM attachments") && text.includes("FOR UPDATE")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("INSERT INTO workspace_note_revisions")) {
        return {
          rows: [{ id: "00000000-0000-4000-8000-000000000307" }],
          rowCount: 1
        };
      }
      if (text.includes("FROM notes note") && text.includes("WHERE note.id = $3")) {
        return {
          rows: [{
            id: noteId,
            workspaceId,
            notebookId: null,
            notebookName: null,
            ownerHandle: actorHandle,
            ownerName: "Action Check",
            kind: "note",
            publicationTarget: "undecided",
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
        audits.push(String(values[1]));
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("INSERT INTO events")) {
        const id = eventIds[eventIndex++]!;
        return {
          rows: [{
            id,
            kind: values[0],
            actorHandle: values[1],
            audienceHandles: JSON.parse(String(values[2])),
            subjectType: values[3],
            subjectId: values[4],
            visibility: values[5],
            payload: JSON.parse(String(values[6])),
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
      throw new Error(`Unexpected action-check query: ${text}`);
    }
  } as unknown as PoolClient;

  const result = await confirmAssistantOfficeNoteDraftInTransaction(
    client,
    input,
    actorHandle
  );
  assert.equal(result.value.documentId, noteId);
  assert.equal(result.value.title, input.title);
  assert.equal(result.value.status, "completed");
  assert.equal(result.value.notebookId, null);
  assert.equal(result.value.href, `/workspace?view=notes&note=${noteId}`);
  assert.equal(result.events?.length, 2);
  assert.deepEqual(
    result.events?.map((event) => [event.kind, event.subjectId]),
    [
      ["note.document.created", noteId],
      ["assistant.action.completed", conversationId]
    ]
  );
  assert.deepEqual(
    audits,
    ["workspace.document.create", "assistant.action.office_note.create_draft"]
  );
  const persistedMetadata = receiptMetadata as Record<string, unknown> | null;
  assert.ok(persistedMetadata);
  assert.equal(
    assistantActionReceiptSchema.parse(persistedMetadata.actionReceipt).documentId,
    noteId
  );
  assert.equal(
    (persistedMetadata.actionProposal as { title: string }).title,
    input.title
  );
  assert.equal(insertedNoteValues[3], input.title);
  assert.equal(insertedNoteValues[4], input.body);
  assert.equal(insertedNoteValues[6], "note");
  assert.equal(insertedNoteValues[7], "undecided");
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
    ["First confirmed paragraph.", "Second confirmed paragraph."]
  );
  assert.deepEqual(savedDocument.nodes.at(-1)?.resource, {
    type: "post",
    id: "action-check",
    label: "Action check source"
  });
  assert.match(
    queries.find((query) => query.text.includes("FROM ai_messages message"))?.text ?? "",
    /conversation\.archived_at IS NULL[\s\S]*conversation\.deleted_at IS NULL/
  );
  assert.match(
    queries.find((query) => query.text.includes("INSERT INTO notes ("))?.text ?? "",
    /'draft', 'private'/
  );
};

const persistentReceiptReplay = async () => {
  const receipt = assistantActionReceiptSchema.parse({
    tool: "office.note.create_draft",
    status: "completed",
    documentId: noteId,
    title: input.title,
    revision: 1,
    notebookId: null,
    notebookName: null,
    href: `/workspace?view=notes&note=${noteId}`,
    confirmedAt: now
  });
  let queryCount = 0;
  const client = {
    query: async (text: string) => {
      queryCount += 1;
      assert.match(text, /FROM ai_messages message/);
      return {
        rows: [{
          id: assistantMessageId,
          metadata: { actionProposal: proposal, actionReceipt: receipt }
        }],
        rowCount: 1
      };
    }
  } as unknown as PoolClient;
  const result = await confirmAssistantOfficeNoteDraftInTransaction(
    client,
    input,
    actorHandle
  );
  assert.deepEqual(result.value, receipt);
  assert.equal(queryCount, 1);
  assert.equal(result.events, undefined);
};

const mutationLedgerReplay = async () => {
  const receipt = assistantActionReceiptSchema.parse({
    tool: "office.note.create_draft",
    status: "completed",
    documentId: noteId,
    title: input.title,
    revision: 1,
    notebookId: null,
    notebookName: null,
    href: `/workspace?view=notes&note=${noteId}`,
    confirmedAt: now
  });
  const queries: string[] = [];
  const client = {
    query: async (text: string) => {
      queries.push(text);
      if (text.includes("INSERT INTO mutation_receipts")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("FROM mutation_receipts")) {
        return {
          rows: [{
            requestHash: "action-check-request-hash",
            status: "completed",
            response: receipt
          }],
          rowCount: 1
        };
      }
      throw new Error(`Unexpected ledger replay query: ${text}`);
    }
  } as unknown as PoolClient;
  const result = await confirmAssistantOfficeNoteDraftInTransaction(
    client,
    input,
    actorHandle,
    {
      idempotencyKey: "assistant-action-replay",
      requestHash: "action-check-request-hash",
      scope: "assistant.action.office-note.create-draft"
    }
  );
  assert.deepEqual(result.value, receipt);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => !query.includes("FROM ai_messages message")));
  assert.ok(queries.every((query) => !query.includes("INSERT INTO notes")));
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
          rows: [{ id: workspaceId, name: "Notebook", ownerHandle: actorHandle }],
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
    confirmAssistantOfficeNoteDraftInTransaction(
      client,
      {
        ...input,
        notebookId: "00000000-0000-4000-8000-000000000399"
      },
      actorHandle
    ),
    /Notebook not found/
  );
  assert.equal(insertedNote, false);
};

const staleAndInvalidProposalsFailClosed = async () => {
  const noMessageClient = {
    query: async () => ({ rows: [], rowCount: 0 })
  } as unknown as PoolClient;
  await assert.rejects(
    confirmAssistantOfficeNoteDraftInTransaction(
      noMessageClient,
      input,
      actorHandle
    ),
    /no longer available/
  );

  const invalidProposalClient = {
    query: async () => ({
      rows: [{
        id: assistantMessageId,
        metadata: {
          actionProposal: {
            tool: "message.send",
            title: "Send this",
            body: "This must never execute.",
            requiresConfirmation: true
          }
        }
      }],
      rowCount: 1
    })
  } as unknown as PoolClient;
  await assert.rejects(
    confirmAssistantOfficeNoteDraftInTransaction(
      invalidProposalClient,
      input,
      actorHandle
    ),
    /invalid or unsupported/
  );
};

const providerChecks = async () => {
  const { callAssistantModel } = await import("@/apps/api/src/services/openaiResponses");
  let providerPayload = "";
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    providerPayload = String(init?.body);
    return new Response(JSON.stringify({
      id: "resp_assistant_action_check",
      model: "gpt-5.6-terra",
      status: "completed",
      output_text: JSON.stringify({
        body: "I prepared a private Office note proposal for your review.",
        claims: [],
        shouldOfferQuickNote: false,
        quickNoteTitle: "",
        quickNoteBody: "",
        action: {
          tool: "office.note.create_draft",
          title: "Provider proposal",
          body: "Editable provider proposal.",
          postKind: "none",
          editOperations: []
        }
      }),
      usage: { input_tokens: 80, output_tokens: 30 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const result = await callAssistantModel({
    ownerHandle: actorHandle,
    history: [],
    context: null,
    message: "Create a private Office note draft.",
    intent: "answer",
    fetchImpl
  });
  assert.equal(result.action?.tool, "office.note.create_draft");
  const payload = JSON.parse(providerPayload) as {
    instructions: string;
    text: {
      format: {
        schema: {
          properties: {
            action: {
              properties: {
                tool: { enum: string[] };
                postKind: { enum: string[] };
              };
              required: string[];
              additionalProperties: boolean;
            };
          };
          required: string[];
        };
      };
    };
  };
  assert.deepEqual(
    payload.text.format.schema.properties.action.properties.tool.enum,
    [
      "none",
      "office.note.create_draft",
      "office.post.create_draft",
      "office.document.edit_draft"
    ]
  );
  assert.deepEqual(
    payload.text.format.schema.properties.action.required,
    ["tool", "title", "body", "postKind", "editOperations"]
  );
  assert.deepEqual(
    payload.text.format.schema.properties.action.properties.postKind.enum,
    ["none", "thought", "paper"]
  );
  assert.equal(
    payload.text.format.schema.properties.action.additionalProperties,
    false
  );
  assert.ok(payload.text.format.schema.required.includes("action"));
  assert.match(payload.instructions, /latest question explicitly asks/i);
  assert.match(payload.instructions, /make a post about this/i);
  assert.match(payload.instructions, /reviewable private Thought draft/i);
  assert.match(payload.instructions, /proposal only/i);
  assert.match(payload.instructions, /Never claim it ran/i);
  assert.match(payload.instructions, /never propose sending, publishing, sharing/i);

  const unsupportedFetch = (async () => new Response(JSON.stringify({
    id: "resp_assistant_action_unsupported",
    model: "gpt-5.6-terra",
    status: "completed",
    output_text: JSON.stringify({
      body: "Unsupported action.",
      claims: [],
      shouldOfferQuickNote: false,
      quickNoteTitle: "",
      quickNoteBody: "",
      action: {
        tool: "message.send",
        title: "Forbidden",
        body: "Forbidden"
      }
    }),
    usage: { input_tokens: 50, output_tokens: 20 }
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  await assert.rejects(
    callAssistantModel({
      ownerHandle: actorHandle,
      history: [],
      context: null,
      message: "Send this.",
      intent: "answer",
      fetchImpl: unsupportedFetch
    }),
    /unusable response/
  );

  const hiddenFetch = (async () => new Response(JSON.stringify({
    id: "resp_assistant_action_hidden",
    model: "gpt-5.6-terra",
    status: "completed",
    output_text: JSON.stringify({
      body: "Ordinary answer.",
      claims: [],
      shouldOfferQuickNote: false,
      quickNoteTitle: "",
      quickNoteBody: "",
      action: {
        tool: "none",
        title: "Hidden",
        body: "Hidden"
      }
    }),
    usage: { input_tokens: 50, output_tokens: 20 }
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  await assert.rejects(
    callAssistantModel({
      ownerHandle: actorHandle,
      history: [],
      context: null,
      message: "Explain the scientific method.",
      intent: "answer",
      fetchImpl: hiddenFetch
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
    "app/api/assistant/actions/office-note-drafts/route.ts",
    "utf8"
  );
  const card = readFileSync(
    "features/assistant/AssistantActionCards.tsx",
    "utf8"
  );
  const messageCard = readFileSync(
    "features/assistant/AssistantMessageCard.tsx",
    "utf8"
  );
  const controller = readFileSync(
    "features/assistant/useAssistantController.ts",
    "utf8"
  );
  const assistantRepository = readFileSync(
    "apps/api/src/repository/assistant.ts",
    "utf8"
  );
  assert.match(repository, /FOR UPDATE OF message, conversation/);
  assert.match(repository, /conversation\.owner_handle = \$3/);
  assert.match(repository, /conversation\.archived_at IS NULL/);
  assert.match(repository, /conversation\.deleted_at IS NULL/);
  assert.match(repository, /claimMutation<AssistantActionReceiptContract>/);
  assert.match(repository, /completeMutation\(client, handle, mutation, receipt\)/);
  assert.match(repository, /assistant\.action\.office_note\.create_draft/);
  assert.match(repository, /assistant\.action\.completed/);
  assert.match(route, /withWriteActor\(request, \{[\s\S]*scope: "assistant-action"/);
  assert.match(proxy, /proxyLiveBackend/);
  assert.match(proxy, /AI Assistant actions require the live workspace/);
  assert.doesNotMatch(proxy, /localStorage|fallback/i);
  assert.match(card, /Not saved yet/);
  assert.match(card, /Nothing is created until/);
  assert.match(card, /Confirm & create private draft/);
  assert.match(card, /role="alert"/);
  assert.match(messageCard, /actionReceipt/);
  assert.match(assistantRepository, /actionProposal: actionProposal \?\? null/);
  assert.match(assistantRepository, /metadata\.actionReceipt/);
  assert.match(assistantRepository, /assistantActionProposalFromDraft/);
  assert.match(controller, /synchronizeThreadMutation/);
  assert.match(controller, /event\.kind\.startsWith\("assistant\."\)/);
};

const main = async () => {
  ({ confirmAssistantOfficeNoteDraftInTransaction } = await import(
    "@/apps/api/src/repository/assistantActions"
  ));
  await successfulTransaction();
  await persistentReceiptReplay();
  await mutationLedgerReplay();
  await foreignNotebookFailsClosed();
  await staleAndInvalidProposalsFailClosed();
  await providerChecks();
  staticBoundaryChecks();
  console.log(
    "Assistant action registry, explicit confirmation, authorization, private Office creation, replay safety, receipts, audit, events, provider restrictions, and UI boundaries passed."
  );
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
