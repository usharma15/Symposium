import { Buffer } from "node:buffer";

export type SupportedAssistantModel = "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";

const microsPerToken: Record<SupportedAssistantModel, { input: number; cacheWrite: number; output: number }> = {
  "gpt-5.6-luna": { input: 1, cacheWrite: 1.25, output: 6 },
  "gpt-5.6-terra": { input: 2.5, cacheWrite: 3.125, output: 15 },
  "gpt-5.6-sol": { input: 5, cacheWrite: 6.25, output: 30 }
};

export const usdToMicros = (usd: number) => Math.floor(usd * 1_000_000);
export const microsToUsd = (micros: number) => Number((micros / 1_000_000).toFixed(6));

export const conservativeInputTokenCeiling = (text: string) => Buffer.byteLength(text, "utf8");

export const reserveCostMicros = (
  model: SupportedAssistantModel,
  renderedInput: string,
  maxOutputTokens: number,
  additionalInputTokens = 0
) => {
  const price = microsPerToken[model];
  return Math.ceil(
    (conservativeInputTokenCeiling(renderedInput) + Math.max(0, Math.floor(additionalInputTokens))) *
    price.cacheWrite +
    maxOutputTokens *
    price.output
  );
};

export const actualCostMicros = (model: SupportedAssistantModel, inputTokens: number, outputTokens: number) => {
  const price = microsPerToken[model];
  // Count every input token at the higher cache-write price. This intentionally
  // overstates provider cost so the application budget can never be optimistic.
  return Math.ceil(Math.max(0, inputTokens) * price.cacheWrite + Math.max(0, outputTokens) * price.output);
};
