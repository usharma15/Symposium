import assert from "node:assert/strict";
import type { PoolClient } from "pg";

process.env.OPENAI_API_KEY ||= "provider-boundary-test-key";

const main = async () => {
  const {
    assistantProviderFailure,
    callContentTranslationModel,
    callDocumentTranslationModel
  } = await import("@/apps/api/src/services/openaiResponses");
  const {
    completeAssistantUsage,
    reserveAssistantUsage
  } = await import("@/apps/api/src/services/assistantUsage");

  const usageQueries: string[] = [];
  const usageClient = {
    query: async (text: string) => {
      usageQueries.push(text);
      if (text.includes("WITH quota_reset")) {
        return {
          rows: [{
            userDaily: 2,
            globalDaily: 5,
            inFlight: 0,
            dailyCostMicros: "1000",
            monthlyCostMicros: "5000",
            usageDay: "2026-07-24"
          }]
        };
      }
      if (text.includes("INSERT INTO ai_usage")) {
        return { rows: [{ id: "provider-check-usage" }] };
      }
      return { rows: [] };
    }
  } as unknown as PoolClient;
  const reservation = await reserveAssistantUsage(usageClient, {
    owner: "provider-check",
    conversationId: "00000000-0000-4000-8000-000000000001",
    renderedInput: "bounded provider check",
    maxOutputTokens: 100
  });
  const quotaQuery = usageQueries.find((query) => query.includes("WITH quota_reset")) ?? "";
  assert.equal(reservation.remainingToday, 7);
  assert.match(quotaQuery, /status IN \('reserved', 'completed'\)/);
  assert.doesNotMatch(quotaQuery, /userMinute|60 seconds/);
  assert.match(quotaQuery, /CASE WHEN status = 'reserved' THEN reserved_cost_micros ELSE actual_cost_micros END/);

  let completionValues: unknown[] = [];
  const completionClient = {
    query: async (_text: string, values?: unknown[]) => {
      completionValues = values ?? [];
      return { rows: [] };
    }
  } as unknown as PoolClient;
  await completeAssistantUsage(completionClient, {
    usageId: "provider-check-usage",
    owner: "provider-check",
    providerError: true,
    actualCostMicros: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    errorCode: "invalid_json_schema"
  });
  assert.equal(completionValues[1], "failed");
  assert.equal(completionValues[2], 0);
  assert.equal(completionValues[8], "invalid_json_schema");

  const contentRequest = {
    sourceType: "post" as const,
    sourceId: "provider-check-post",
    sourceRevision: 1,
    sourceTitle: "A bounded claim",
    sourceBody: "Evidence precedes the conclusion.",
    sourceDocument: {
      version: 1 as const,
      nodes: [{
        id: "claim",
        type: "paragraph" as const,
        content: [{ text: "Evidence precedes the conclusion." }],
        align: "left" as const,
        indent: 0
      }],
      settings: { width: "standard" as const, margin: "normal" as const }
    },
    sourceSegments: [{ id: "claim:r0", text: "Evidence precedes the conclusion." }],
    languageInstruction: "Spanish"
  };
  let contentPayloadJson = "";
  const contentFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    contentPayloadJson = String(init?.body);
    return new Response(JSON.stringify({
      id: "resp_content_provider_check",
      model: "gpt-5.6-terra",
      status: "completed",
      output_text: JSON.stringify({
        targetLanguage: "spanish",
        targetLanguageLabel: "Spanish",
        translatedTitle: "Una afirmación delimitada",
        translatedSegments: [{ id: "claim:r0", text: "La evidencia precede a la conclusión." }],
        message: "Spanish translation ready."
      }),
      usage: {
        input_tokens: 120,
        output_tokens: 35,
        input_tokens_details: { cached_tokens: 40 }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const contentResult = await callContentTranslationModel({
    ownerHandle: "provider-check",
    request: contentRequest,
    fetchImpl: contentFetch
  });
  assert.equal(contentResult.output.targetLanguage, "spanish");
  assert.equal(contentResult.output.translatedSegments[0]?.id, "claim:r0");
  assert.equal(contentResult.inputTokens, 120);
  const contentPayload = JSON.parse(contentPayloadJson) as { text?: { format?: unknown } };
  assert.doesNotMatch(
    JSON.stringify(contentPayload.text?.format),
    /minItems|maxItems|minimum|maximum/
  );

  const documentRequest = {
    attachmentId: "provider-check-scan",
    sourceTitle: "Scanned paper.pdf",
    sourceKind: "pdf" as const,
    sourcePages: [{
      pageNumber: 3,
      body: "",
      segments: [{ id: "document-page-3-visual", text: "" }],
      imageDataUrl: "data:image/jpeg;base64,YWJj"
    }],
    sourceComplete: false,
    languageInstruction: "English"
  };
  let documentPayloadJson = "";
  const documentFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    documentPayloadJson = String(init?.body);
    return new Response(JSON.stringify({
      id: "resp_document_provider_check",
      model: "gpt-5.6-terra",
      status: "completed",
      output_text: JSON.stringify({
        targetLanguage: "english",
        targetLanguageLabel: "English",
        translatedTitle: "Scanned paper",
        pages: [{
          pageNumber: 3,
          segments: [{ id: "document-page-3-visual", text: "Translated page text." }],
          layoutBlocks: [{
            id: "provider-layout",
            role: "paragraph",
            text: "Translated page text.",
            x: 100,
            y: 200,
            width: 800,
            height: 140,
            fontScale: "md",
            align: "left"
          }],
          preservedArtifacts: [{
            id: "provider-image",
            role: "image",
            x: 250,
            y: 400,
            width: 500,
            height: 300
          }]
        }],
        message: "English translation ready."
      }),
      usage: { input_tokens: 400, output_tokens: 120 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const documentResult = await callDocumentTranslationModel({
    ownerHandle: "provider-check",
    request: documentRequest,
    fetchImpl: documentFetch
  });
  assert.equal(documentResult.output.pages[0]?.layoutBlocks[0]?.id, "page-3-layout-0");
  assert.equal(documentResult.output.pages[0]?.preservedArtifacts[0]?.id, "page-3-artifact-0");
  const documentPayload = JSON.parse(documentPayloadJson) as { text?: { format?: unknown } };
  assert.doesNotMatch(
    JSON.stringify(documentPayload.text?.format),
    /minItems|maxItems|minimum|maximum/
  );

  const structuredDocumentRequest = {
    attachmentId: "provider-check-structured-pdf",
    sourceTitle: "Formatted comments.pdf",
    sourceKind: "pdf" as const,
    sourcePages: [{
      pageNumber: 4,
      body: "A complete text-bearing PDF page with figures and formatting.",
      segments: Array.from({ length: 8 }, (_, index) => ({
        id: `pdf-4-line-${index}`,
        text: `Source paragraph ${index + 1} contains enough extracted text for deterministic PDF geometry.`
      })),
      imageDataUrl: "data:image/jpeg;base64,YWJj"
    }],
    sourceComplete: true,
    languageInstruction: "Spanish"
  };
  let structuredDocumentPayloadJson = "";
  const structuredDocumentFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    structuredDocumentPayloadJson = String(init?.body);
    return new Response(JSON.stringify({
      id: "resp_structured_document_provider_check",
      model: "gpt-5.6-terra",
      status: "completed",
      output_text: JSON.stringify({
        targetLanguage: "spanish",
        targetLanguageLabel: "Spanish",
        translatedTitle: "Comentarios formateados",
        pages: [{
          pageNumber: 4,
          segments: structuredDocumentRequest.sourcePages[0].segments.map((segment, index) => ({
            id: segment.id,
            text: `El párrafo de origen ${index + 1} conserva la geometría determinista del PDF.`
          })),
          layoutBlocks: [{
            id: "unneeded-model-layout",
            role: "paragraph",
            text: "This model-generated layout must not override exact PDF geometry.",
            x: 10,
            y: 10,
            width: 300,
            height: 50,
            fontScale: "md",
            align: "left"
          }],
          preservedArtifacts: [{
            id: "unneeded-model-artifact",
            role: "image",
            x: 400,
            y: 400,
            width: 200,
            height: 200
          }]
        }],
        message: "Spanish translation ready."
      }),
      usage: { input_tokens: 900, output_tokens: 260 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const structuredDocumentResult = await callDocumentTranslationModel({
    ownerHandle: "provider-check",
    request: structuredDocumentRequest,
    fetchImpl: structuredDocumentFetch
  });
  assert.equal(structuredDocumentResult.output.pages[0]?.segments.length, 8);
  assert.deepEqual(structuredDocumentResult.output.pages[0]?.layoutBlocks, []);
  assert.deepEqual(structuredDocumentResult.output.pages[0]?.preservedArtifacts, []);
  assert.match(structuredDocumentPayloadJson, /structured_text_overlay/);

  const rejectedFetch = (async () => new Response(JSON.stringify({
    error: {
      code: "invalid_json_schema",
      type: "invalid_request_error",
      message: "Unsupported schema keyword."
    }
  }), { status: 400, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  let rejectedFailure: ReturnType<typeof assistantProviderFailure> | null = null;
  try {
    await callContentTranslationModel({
      ownerHandle: "provider-check",
      request: contentRequest,
      fetchImpl: rejectedFetch
    });
  } catch (error) {
    rejectedFailure = assistantProviderFailure(error);
  }
  assert.ok(rejectedFailure);
  assert.equal(rejectedFailure.code, "invalid_json_schema");
  assert.equal(rejectedFailure.mayHaveBeenBilled, false);
  assert.equal(rejectedFailure.inputTokens, 0);
  assert.match(rejectedFailure.body, /No daily answer was used/);

  const incompleteFetch = (async () => new Response(JSON.stringify({
    id: "resp_incomplete_provider_check",
    model: "gpt-5.6-terra",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    usage: {
      input_tokens: 1800,
      output_tokens: 1177,
      input_tokens_details: { cached_tokens: 0 }
    }
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  let incompleteFailure: ReturnType<typeof assistantProviderFailure> | null = null;
  try {
    await callContentTranslationModel({
      ownerHandle: "provider-check",
      request: contentRequest,
      fetchImpl: incompleteFetch
    });
  } catch (error) {
    incompleteFailure = assistantProviderFailure(error);
  }
  assert.ok(incompleteFailure);
  assert.equal(incompleteFailure.code, "incomplete_max_output_tokens");
  assert.equal(incompleteFailure.mayHaveBeenBilled, true);
  assert.equal(incompleteFailure.inputTokens, 1800);
  assert.equal(incompleteFailure.outputTokens, 1177);
  assert.match(incompleteFailure.body, /response limit/);

  console.log("AI provider request, schema, usage, and failure checks passed.");
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
