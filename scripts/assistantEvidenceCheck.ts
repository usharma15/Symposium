import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import {
  assistantAnswerDraftSchema,
  assistantMessageSchema,
  type AssistantThreadSourceContract
} from "@/packages/contracts/src";
import {
  assertAssistantEvidenceReferences,
  buildAssistantEvidence,
  resolveAssistantEvidenceClaims
} from "@/apps/api/src/services/assistantEvidence";

process.env.OPENAI_API_KEY ||= "assistant-evidence-check-key";

const source = {
  id: "00000000-0000-4000-8000-000000000201",
  key: "post:evidence-check",
  revision: 3,
  included: true,
  context: {
    surface: "post",
    route: "/posts/evidence-check",
    title: "Evidence check paper",
    summary: "A saved source under review.",
    content: [
      "The intervention reduced the measured endpoint by 12 percent.",
      "[Comment comment-evidence-1 · revision 2]\n@reviewer: The sample excludes participants over 70.",
      "[Message 00000000-0000-4000-8000-000000000202 · revision 4]\n@ada: Replication is still pending."
    ].join("\n\n"),
    entityType: "post",
    entityId: "evidence-check",
    selection: "The intervention reduced the measured endpoint by 12 percent.",
    metadata: { revision: 5 }
  },
  attachedAt: "2026-07-26T10:00:00.000Z",
  supersedesSourceId: null,
  provenance: "captured"
} satisfies AssistantThreadSourceContract;

const evidence = buildAssistantEvidence([{
  source,
  accessStatus: "verified",
  currentEntityRevision: 6
}], source.id);

assert.equal(evidence.evidence.length, 1);
assert.equal(evidence.evidence[0]?.revisionStatus, "changed");
assert.equal(evidence.evidence[0]?.capturedEntityRevision, 5);
assert.equal(evidence.evidence[0]?.currentEntityRevision, 6);
assert.equal(evidence.blocks[0]?.ref, "S1.B1");
assert.equal(evidence.blocks[0]?.kind, "selection");
assert.ok(evidence.blocks.some((block) =>
  block.kind === "comment" &&
  block.route === "/posts/evidence-check?comment=comment-evidence-1"
));
assert.ok(evidence.blocks.some((block) =>
  block.kind === "message" &&
  block.route.endsWith("#message-00000000-0000-4000-8000-000000000202")
));
assert.ok(evidence.blocks.every((block) => block.excerpt.length <= 1000));
assert.ok(evidence.packets[0]?.blocks.every((block) => /^S1\.B\d+$/.test(block.ref)));

const directRef = evidence.blocks.find((block) => block.kind === "selection")!.ref;
const claims = [{
  claim: "The saved source reports a 12 percent reduction.",
  kind: "direct" as const,
  sourceRefs: [directRef]
}, {
  claim: "The result may not generalize to older adults.",
  kind: "inference" as const,
  sourceRefs: [evidence.blocks.find((block) => block.kind === "comment")!.ref]
}, {
  claim: "The source does not establish successful replication.",
  kind: "insufficient" as const,
  sourceRefs: []
}];
assert.doesNotThrow(() => assertAssistantEvidenceReferences(claims, evidence.blocks));
const resolved = resolveAssistantEvidenceClaims(claims, evidence.blocks);
assert.equal(resolved[0]?.citations[0]?.excerpt, source.context.selection);
assert.equal(resolved[1]?.citations[0]?.kind, "comment");
assert.equal(resolved[2]?.citations.length, 0);
assert.throws(
  () => assertAssistantEvidenceReferences([{
    claim: "Invented support.",
    kind: "direct",
    sourceRefs: ["S1.B16"]
  }], evidence.blocks),
  /not supplied/
);

assert.equal(assistantAnswerDraftSchema.safeParse({
  body: "Bounded answer.",
  claims,
  shouldOfferQuickNote: false,
  quickNoteTitle: "",
  quickNoteBody: ""
}).success, true);
assert.equal(assistantAnswerDraftSchema.safeParse({
  body: "Unsupported direct claim.",
  claims: [{ claim: "Unsupported.", kind: "direct", sourceRefs: [] }],
  shouldOfferQuickNote: false,
  quickNoteTitle: "",
  quickNoteBody: ""
}).success, false);
assert.equal(assistantAnswerDraftSchema.safeParse({
  body: "False uncertainty citation.",
  claims: [{ claim: "Unknown.", kind: "insufficient", sourceRefs: ["S1.B1"] }],
  shouldOfferQuickNote: false,
  quickNoteTitle: "",
  quickNoteBody: ""
}).success, false);

const legacyMessage = assistantMessageSchema.parse({
  id: "legacy-message",
  conversationId: "legacy-conversation",
  role: "assistant",
  body: "Legacy answer.",
  evidence: [{
    sourceId: source.id,
    key: source.key,
    revision: 1,
    title: source.context.title,
    surface: "post",
    route: source.context.route,
    active: true
  }]
});
assert.deepEqual(legacyMessage.claims, []);
assert.equal(legacyMessage.evidence[0]?.revisionStatus, "unversioned");
assert.equal(legacyMessage.evidence[0]?.accessStatus, "not_applicable");

const main = async () => {
  const { callAssistantModel } = await import("@/apps/api/src/services/openaiResponses");
  const {
    validateAssistantEvidenceSources
  } = await import("@/apps/api/src/repository/assistant");
  const verifiedQueries: string[] = [];
  const verifiedClient = {
    query: async (text: string) => {
      verifiedQueries.push(text);
      return { rows: [{ revision: 6 }], rowCount: 1 };
    }
  } as unknown as PoolClient;
  const validated = await validateAssistantEvidenceSources(
    verifiedClient,
    [source],
    "@evidence-check",
    "00000000-0000-4000-8000-000000000203",
    []
  );
  assert.equal(validated[0]?.accessStatus, "verified");
  assert.equal(validated[0]?.currentEntityRevision, 6);
  assert.match(verifiedQueries[0] ?? "", /community_memberships/);
  assert.match(verifiedQueries[0] ?? "", /post\.deleted_at IS NULL/);

  const unavailableClient = {
    query: async () => ({ rows: [], rowCount: 0 })
  } as unknown as PoolClient;
  await assert.rejects(
    validateAssistantEvidenceSources(
      unavailableClient,
      [source],
      "@evidence-check",
      "00000000-0000-4000-8000-000000000203",
      []
    ),
    /no longer available with your current access/
  );
  const recoveredValidation = await validateAssistantEvidenceSources(
    unavailableClient,
    [{ ...source, provenance: "recovered" }],
    "@evidence-check",
    "00000000-0000-4000-8000-000000000203",
    []
  );
  assert.equal(recoveredValidation[0]?.accessStatus, "not_applicable");

  let requestBody = "";
  const providerFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({
      id: "resp_assistant_evidence_check",
      model: "gpt-5.6-terra",
      status: "completed",
      output_text: JSON.stringify({
        body: "The saved source reports a 12 percent reduction.",
        claims: [claims[0]],
        shouldOfferQuickNote: false,
        quickNoteTitle: "",
        quickNoteBody: ""
      }),
      usage: { input_tokens: 120, output_tokens: 30 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const result = await callAssistantModel({
    ownerHandle: "evidence-check",
    history: [],
    context: source.context,
    attachedContexts: [],
    evidencePackets: evidence.packets,
    evidenceBlocks: evidence.blocks,
    message: "What does the source report?",
    intent: "answer",
    fetchImpl: providerFetch
  });
  assert.deepEqual(result.claims, [claims[0]]);
  const request = JSON.parse(requestBody) as {
    prompt_cache_key: string;
    input: Array<{ content: string }>;
    text: { format: { schema: { required: string[] } } };
  };
  assert.equal(request.prompt_cache_key, "symposium-contextual-tablet-evidence-v1");
  assert.match(request.input.at(-1)?.content ?? "", /SOURCE EVIDENCE PACKETS/);
  assert.match(request.input.at(-1)?.content ?? "", /S1\.B1/);
  assert.ok(request.text.format.schema.required.includes("claims"));

  const invalidFetch = (async () => new Response(JSON.stringify({
    id: "resp_assistant_evidence_invalid",
    model: "gpt-5.6-terra",
    status: "completed",
    output_text: JSON.stringify({
      body: "Invented citation.",
      claims: [{ claim: "Invented.", kind: "direct", sourceRefs: ["S1.B16"] }],
      shouldOfferQuickNote: false,
      quickNoteTitle: "",
      quickNoteBody: ""
    }),
    usage: { input_tokens: 120, output_tokens: 30 }
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  await assert.rejects(callAssistantModel({
    ownerHandle: "evidence-check",
    history: [],
    context: source.context,
    evidencePackets: evidence.packets,
    evidenceBlocks: evidence.blocks,
    message: "Invent support.",
    intent: "answer",
    fetchImpl: invalidFetch
  }), /unusable response/);

  const repository = readFileSync("apps/api/src/repository/assistant.ts", "utf8");
  const provider = readFileSync("apps/api/src/services/openaiResponses.ts", "utf8");
  const tablet = [
    readFileSync("features/assistant/AssistantExperience.tsx", "utf8"),
    readFileSync("features/assistant/AssistantEvidenceMap.tsx", "utf8"),
    readFileSync("features/assistant/AssistantMessageBody.tsx", "utf8"),
    readFileSync("features/assistant/AssistantMessageCard.tsx", "utf8"),
    readFileSync("features/assistant/assistantPresentation.ts", "utf8")
  ].join("\n");
  const messages = readFileSync("features/messages/MessagesSection.tsx", "utf8");
  assert.match(repository, /validateAssistantEvidenceSources/);
  assert.match(repository, /workspace_note_grants/);
  assert.match(repository, /conversation_participants/);
  assert.match(repository, /community_memberships/);
  assert.match(repository, /resolveAssistantEvidenceClaims/);
  assert.match(provider, /Never cite a source or passage reference that was not supplied/);
  assert.match(tablet, /Direct evidence/);
  assert.match(tablet, /Insufficient context/);
  assert.match(tablet, /Source changed since capture/);
  assert.match(tablet, /AssistantMessageBody/);
  assert.match(tablet, /assistantInlineContent/);
  assert.doesNotMatch(tablet, /dangerouslySetInnerHTML/);
  assert.match(messages, /id=\{`message-\$\{message\.id\}`\}/);

  console.log("Assistant evidence locators, source validation, provider references, persistence compatibility, and claim UI checks passed.");
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
