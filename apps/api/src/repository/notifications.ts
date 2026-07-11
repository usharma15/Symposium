import { TRPCError } from "@trpc/server";
import { markNotificationInputSchema } from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData } from "./foundation";

export const listNotifications = async (actor: Actor) => {
  const handle = actorHandle(actor);
  if (!hasDatabase()) return [];
  await ensureLiveData();
  const result = await getPool().query(
    `SELECT id, kind, title, body, href, read_at AS "readAt", metadata, created_at AS "createdAt"
     FROM notifications
     WHERE profile_handle = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [handle]
  );
  return result.rows;
};

export const markNotificationRead = async (rawInput: unknown, actor: Actor) => {
  const input = markNotificationInputSchema.parse(rawInput);
  const handle = actorHandle(actor);
  if (!hasDatabase()) return { notificationId: input.notificationId, read: true };
  await ensureLiveData();
  return runAtomic(async (client) => {
    const notification = await client.query<{ readAt: Date | null }>(
      `SELECT read_at AS "readAt" FROM notifications
       WHERE id = $1 AND profile_handle = $2
       FOR UPDATE`,
      [input.notificationId, handle]
    );
    const existing = notification.rows[0];
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found." });
    const value = { notificationId: input.notificationId, read: true };
    if (existing.readAt) return { value };
    await client.query("UPDATE notifications SET read_at = now() WHERE id = $1", [input.notificationId]);
    await stageAuditLog(client, {
      actorHandle: handle,
      action: "notification.read",
      subjectType: "notification",
      subjectId: input.notificationId
    });
    const event = await stageEvent(client, {
      kind: "notification.read",
      actorHandle: handle,
      subjectType: "notification",
      subjectId: input.notificationId,
      visibility: "private"
    });
    return { value, events: [event] };
  });
};
