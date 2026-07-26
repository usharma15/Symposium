import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import sharp from "sharp";

process.env.OPENAI_API_KEY ||= "assistant-vision-check-key";

const main = async () => {
  const {
    assistantVisionMaxDimension,
    assistantVisionMaxInputPixels,
    assistantVisionPatchTokens,
    assistantVisionTokenCeiling,
    isAssistantVisionContentType,
    maxAssistantVisionAttachments,
    maxAssistantVisionInputsPerDay,
    maxAssistantVisionTokensPerImage
  } = await import("@/lib/assistantVisionRules");
  const {
    prepareAssistantVisionInput
  } = await import("@/apps/api/src/services/assistantVision");
  const {
    reserveCostMicros
  } = await import("@/apps/api/src/services/aiBudget");
  const {
    reserveAssistantUsage
  } = await import("@/apps/api/src/services/assistantUsage");
  const {
    callAssistantModel
  } = await import("@/apps/api/src/services/openaiResponses");

  assert.equal(isAssistantVisionContentType("image/jpg"), true);
  assert.equal(isAssistantVisionContentType("image/png; charset=binary"), true);
  assert.equal(isAssistantVisionContentType("image/gif"), false);
  assert.equal(isAssistantVisionContentType("image/avif"), false);
  assert.equal(maxAssistantVisionAttachments, 2);
  assert.equal(maxAssistantVisionInputsPerDay, 10);
  assert.equal(assistantVisionMaxDimension, 1600);
  assert.equal(assistantVisionMaxInputPixels, 40_000_000);
  assert.equal(maxAssistantVisionTokensPerImage, 2500);
  assert.equal(assistantVisionTokenCeiling(2), 5000);
  assert.equal(assistantVisionTokenCeiling(20), 5000);
  assert.equal(assistantVisionPatchTokens(1600, 400), 650);

  const widePng = await sharp({
    create: {
      width: 3200,
      height: 800,
      channels: 4,
      background: { r: 20, g: 60, b: 120, alpha: 0.4 }
    }
  }).png().toBuffer();
  const preparedWide = await prepareAssistantVisionInput({
    id: "00000000-0000-4000-8000-000000000111",
    fileName: "wide-chart.png",
    contentType: "image/png",
    byteSize: widePng.byteLength,
    objectKey: "assistant_message/wide-chart.png"
  }, async () => ({
    body: new Uint8Array(widePng),
    byteSize: widePng.byteLength,
    contentType: "image/png",
    prefix: new Uint8Array(widePng.subarray(0, 65_536))
  }));
  assert.equal(preparedWide.width, 1600);
  assert.equal(preparedWide.height, 400);
  assert.equal(preparedWide.tokenCeiling, 650);
  assert.match(preparedWide.imageDataUrl, /^data:image\/jpeg;base64,/);
  const normalizedWide = Buffer.from(preparedWide.imageDataUrl.split(",", 2)[1]!, "base64");
  const normalizedMetadata = await sharp(normalizedWide).metadata();
  assert.equal(normalizedMetadata.format, "jpeg");
  assert.equal(normalizedMetadata.width, 1600);
  assert.equal(normalizedMetadata.height, 400);

  const orientedJpeg = await sharp({
    create: {
      width: 120,
      height: 240,
      channels: 3,
      background: { r: 240, g: 220, b: 180 }
    }
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const preparedOriented = await prepareAssistantVisionInput({
    id: "00000000-0000-4000-8000-000000000112",
    fileName: "rotated.jpg",
    contentType: "image/jpeg",
    byteSize: orientedJpeg.byteLength,
    objectKey: "assistant_message/rotated.jpg"
  }, async () => ({
    body: new Uint8Array(orientedJpeg),
    byteSize: orientedJpeg.byteLength,
    contentType: "image/jpeg",
    prefix: new Uint8Array(orientedJpeg)
  }));
  assert.equal(preparedOriented.width, 240);
  assert.equal(preparedOriented.height, 120);

  await assert.rejects(
    prepareAssistantVisionInput({
      id: "00000000-0000-4000-8000-000000000113",
      fileName: "mismatch.webp",
      contentType: "image/webp",
      byteSize: widePng.byteLength + 1,
      objectKey: "assistant_message/mismatch.webp"
    }, async () => ({
      body: new Uint8Array(widePng),
      byteSize: widePng.byteLength,
      contentType: "image/png",
      prefix: new Uint8Array(widePng)
    })),
    /could not be safely prepared/
  );
  await assert.rejects(
    prepareAssistantVisionInput({
      id: "00000000-0000-4000-8000-000000000114",
      fileName: "animated.gif",
      contentType: "image/gif",
      byteSize: 16,
      objectKey: "assistant_message/animated.gif"
    }),
    /valid PNG, JPEG, or WebP/
  );

  assert.equal(
    reserveCostMicros("gpt-5.6-terra", "", 0, 5000),
    15_625
  );

  const usageQueries: Array<{ text: string; values?: unknown[] }> = [];
  const usageClient = {
    query: async (text: string, values?: unknown[]) => {
      usageQueries.push({ text, values });
      if (text.includes("WITH quota_reset")) {
        return {
          rows: [{
            userDaily: 0,
            globalDaily: 0,
            inFlight: 0,
            visionDaily: 3,
            dailyCostMicros: "0",
            monthlyCostMicros: "0",
            usageDay: "2026-07-25"
          }]
        };
      }
      if (text.includes("INSERT INTO ai_usage")) {
        return { rows: [{ id: "assistant-vision-usage" }] };
      }
      return { rows: [] };
    }
  } as unknown as PoolClient;
  const reservation = await reserveAssistantUsage(usageClient, {
    owner: "vision-check",
    conversationId: "00000000-0000-4000-8000-000000000115",
    renderedInput: "bounded image question",
    maxOutputTokens: 700,
    additionalInputTokens: assistantVisionTokenCeiling(2),
    visionInputCount: 2
  });
  assert.equal(reservation.remainingToday, 9);
  const insertUsage = usageQueries.find((entry) => entry.text.includes("INSERT INTO ai_usage"));
  assert.equal(insertUsage?.values?.[4], 2);
  assert.match(insertUsage?.text ?? "", /vision_input_count/);

  const exhaustedVisionClient = {
    query: async (text: string) => {
      if (text.includes("WITH quota_reset")) {
        return {
          rows: [{
            userDaily: 2,
            globalDaily: 2,
            inFlight: 0,
            visionDaily: maxAssistantVisionInputsPerDay,
            dailyCostMicros: "0",
            monthlyCostMicros: "0",
            usageDay: "2026-07-25"
          }]
        };
      }
      if (text.includes("INSERT INTO ai_usage")) {
        throw new Error("A vision-exhausted request must not reserve provider usage.");
      }
      return { rows: [] };
    }
  } as unknown as PoolClient;
  await assert.rejects(
    reserveAssistantUsage(exhaustedVisionClient, {
      owner: "vision-check",
      conversationId: "00000000-0000-4000-8000-000000000115",
      renderedInput: "inspect another image",
      maxOutputTokens: 700,
      additionalInputTokens: maxAssistantVisionTokensPerImage,
      visionInputCount: 1
    }),
    /daily AI image-processing limit/
  );

  let providerPayloadJson = "";
  const providerFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    providerPayloadJson = String(init?.body);
    return new Response(JSON.stringify({
      id: "resp_assistant_vision_check",
      model: "gpt-5.6-terra",
      status: "completed",
      output_text: JSON.stringify({
        body: "The image contains a blue scientific chart.",
        claims: [],
        shouldOfferQuickNote: false,
        quickNoteTitle: "",
        quickNoteBody: ""
      }),
      usage: { input_tokens: 800, output_tokens: 30 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  await callAssistantModel({
    ownerHandle: "vision-check",
    history: [],
    context: {
      surface: "attachment",
      route: "/api/assistant-attachments/00000000-0000-4000-8000-000000000111",
      title: "wide-chart.png",
      summary: "Ready for bounded AI image inspection.",
      content: "This image is available to the model.",
      entityType: "assistant_attachment",
      entityId: "00000000-0000-4000-8000-000000000111"
    },
    message: "What is shown?",
    intent: "answer",
    visionInputs: [preparedWide],
    fetchImpl: providerFetch
  });
  const providerPayload = JSON.parse(providerPayloadJson) as {
    instructions: string;
    input: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
    prompt_cache_key: string;
  };
  assert.equal(providerPayload.prompt_cache_key, "symposium-contextual-tablet-vision-v1");
  assert.match(providerPayload.instructions, /inspect their actual visible content/i);
  const content = providerPayload.input.at(-1)?.content;
  assert.ok(Array.isArray(content));
  assert.equal(content.filter((part) => part.type === "input_image").length, 1);
  assert.equal(content.find((part) => part.type === "input_image")?.detail, "high");
  assert.match(String(content.find((part) => part.type === "input_image")?.image_url), /^data:image\/jpeg;base64,/);
  assert.match(String(content.find((part) => part.type === "input_text" && String(part.text).startsWith("IMAGE SOURCE"))?.text), /wide-chart\.png/);

  const repository = readFileSync("apps/api/src/repository/assistant.ts", "utf8");
  const attachments = readFileSync("apps/api/src/repository/attachments.ts", "utf8");
  const provider = readFileSync("apps/api/src/services/openaiResponses.ts", "utf8");
  const usage = readFileSync("apps/api/src/services/assistantUsage.ts", "utf8");
  const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
  const tablet = readFileSync("features/assistant/AssistantExperience.tsx", "utf8");
  const controller = readFileSync("features/assistant/useAssistantController.ts", "utf8");
  const roadmap = readFileSync("docs/ai-tablet-roadmap.md", "utf8");

  assert.match(repository, /FOR UPDATE OF attachment/);
  assert.match(repository, /message\.conversation_id = \$3/);
  assert.match(repository, /additionalInputTokens: assistantVisionTokenCeiling/);
  assert.match(repository, /visionAttachmentIds/);
  assert.match(attachments, /maxDailyAssistantUploadsPerActor = 20/);
  assert.match(attachments, /maxDailyAssistantUploadBytesPerActor = 50 \* 1024 \* 1024/);
  assert.match(provider, /detail: "high"/);
  assert.match(usage, /vision_input_count/);
  assert.match(usage, /SYMPOSIUM_AI_MAX_REQUEST_COST_USD/);
  assert.match(migration, /0059_bounded_assistant_vision/);
  assert.match(migration, /ai_usage_vision_input_count_check/);
  assert.match(tablet, /Image ready for AI/);
  assert.match(tablet, /at most 2 images per answer/);
  assert.match(controller, /maxAssistantVisionAttachments/);
  assert.match(roadmap, /whole-document action deferred/);

  console.log("Bounded assistant image preparation, provider, cost, rate, authorization, and UI checks passed.");
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
