import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";

export type MutationContext = {
  idempotencyKey: string;
  requestHash: string;
  scope: string;
};

type MutationReceiptRow = {
  requestHash: string;
  response: unknown;
  status: "pending" | "completed";
};

const headerValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
};

export const hashMutationPayload = (payload: unknown) =>
  createHash("sha256").update(JSON.stringify(canonicalize(payload)) ?? "null").digest("hex");

export const validateIdempotencyKey = (value: string) => {
  const key = value.trim();
  if (key.length < 8 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Idempotency-Key must be 8-200 URL-safe characters."
    });
  }
  return key;
};

export const mutationContextFromRequest = (
  request: FastifyRequest,
  scope: string,
  payload: unknown
): MutationContext | undefined => {
  const rawKey = headerValue(request.headers["idempotency-key"]);
  if (!rawKey) return undefined;
  return {
    idempotencyKey: validateIdempotencyKey(rawKey),
    requestHash: hashMutationPayload(payload),
    scope
  };
};

export type MutationClaim<T> =
  | { replayed: false }
  | { replayed: true; response: T };

export const claimMutation = async <T>(
  client: PoolClient,
  actorHandle: string,
  context?: MutationContext
): Promise<MutationClaim<T>> => {
  if (!context) return { replayed: false };

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO mutation_receipts (
       actor_handle, scope, idempotency_key, request_hash, status
     )
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (actor_handle, scope, idempotency_key) DO NOTHING
     RETURNING id::text`,
    [actorHandle, context.scope, context.idempotencyKey, context.requestHash]
  );
  if (inserted.rowCount) return { replayed: false };

  const existingResult = await client.query<MutationReceiptRow>(
    `SELECT
       request_hash AS "requestHash",
       status,
       response
     FROM mutation_receipts
     WHERE actor_handle = $1 AND scope = $2 AND idempotency_key = $3
     FOR UPDATE`,
    [actorHandle, context.scope, context.idempotencyKey]
  );
  const existing = existingResult.rows[0];
  if (!existing) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Mutation receipt could not be resolved." });
  }
  if (existing.requestHash !== context.requestHash) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This Idempotency-Key was already used for a different mutation payload."
    });
  }
  if (existing.status !== "completed" || existing.response === null || existing.response === undefined) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "The matching mutation is still being processed."
    });
  }
  return { replayed: true, response: existing.response as T };
};

export const completeMutation = async <T>(
  client: PoolClient,
  actorHandle: string,
  context: MutationContext | undefined,
  response: T
) => {
  if (!context) return;
  const result = await client.query(
    `UPDATE mutation_receipts
     SET status = 'completed', response = $4, updated_at = now()
     WHERE actor_handle = $1
       AND scope = $2
       AND idempotency_key = $3
       AND request_hash = $5
       AND status = 'pending'`,
    [
      actorHandle,
      context.scope,
      context.idempotencyKey,
      JSON.stringify(response),
      context.requestHash
    ]
  );
  if ((result.rowCount ?? 0) !== 1) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Mutation receipt could not be completed." });
  }
};
