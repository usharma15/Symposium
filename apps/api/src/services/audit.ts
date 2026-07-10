import type { PoolClient } from "pg";
import type { MutationContext } from "./mutations";

export type AuditEntry = {
  action: string;
  actorHandle?: string;
  metadata?: Record<string, unknown>;
  subjectId: string;
  subjectType: string;
};

export const mutationAuditMetadata = (
  mutation?: MutationContext,
  metadata: Record<string, unknown> = {}
) => ({
  ...metadata,
  ...(mutation
    ? {
        idempotencyKey: mutation.idempotencyKey,
        mutationScope: mutation.scope,
        requestHash: mutation.requestHash
      }
    : {})
});

export const stageAuditLog = (client: PoolClient, entry: AuditEntry) =>
  client.query(
    `INSERT INTO audit_logs (actor_handle, action, subject_type, subject_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.actorHandle ?? null,
      entry.action,
      entry.subjectType,
      entry.subjectId,
      JSON.stringify(entry.metadata ?? {})
    ]
  );
