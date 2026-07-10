import { getPool, hasDatabase } from "../db/client";

const maintenanceIntervalMs = 6 * 60 * 60 * 1000;
let maintenanceTimer: NodeJS.Timeout | null = null;
let lastCompletedAt: string | null = null;
let lastErrorAt: string | null = null;
let lastStartedAt: string | null = null;

export const getMaintenanceStatus = () => ({
  active: Boolean(maintenanceTimer),
  lastCompletedAt,
  lastErrorAt,
  lastStartedAt
});

export const runDatabaseMaintenance = async () => {
  if (!hasDatabase()) return;
  lastStartedAt = new Date().toISOString();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM mutation_receipts
       WHERE id IN (
         SELECT id FROM mutation_receipts
         WHERE status = 'completed' AND created_at < now() - interval '7 days'
         ORDER BY created_at ASC
         LIMIT 5000
       )`
    );
    await client.query(
      `DELETE FROM events
       WHERE id IN (
         SELECT id FROM events
         WHERE created_at < now() - interval '14 days'
         ORDER BY created_at ASC
         LIMIT 5000
       )`
    );
    await client.query(
      `DELETE FROM content_views
       WHERE id IN (
         SELECT id FROM content_views
         WHERE created_at < now() - interval '2 days'
         ORDER BY created_at ASC
         LIMIT 5000
       )`
    );
    await client.query(
      `UPDATE attachments
       SET status = 'failed',
           metadata = metadata || jsonb_build_object('verificationError', 'Upload window expired.'),
           updated_at = now()
       WHERE status IN ('pending', 'verifying')
         AND updated_at < now() - interval '1 day'`
    );
    await client.query("COMMIT");
    lastCompletedAt = new Date().toISOString();
    lastErrorAt = null;
  } catch (error) {
    await client.query("ROLLBACK");
    lastErrorAt = new Date().toISOString();
    throw error;
  } finally {
    client.release();
  }
};

export const startDatabaseMaintenance = () => {
  if (maintenanceTimer || !hasDatabase()) return;
  const execute = () => {
    void runDatabaseMaintenance().catch((error) => {
      console.warn("SYMPOSIUM database maintenance failed.", error);
    });
  };
  execute();
  maintenanceTimer = setInterval(execute, maintenanceIntervalMs);
  maintenanceTimer.unref();
};

export const stopDatabaseMaintenance = () => {
  if (!maintenanceTimer) return;
  clearInterval(maintenanceTimer);
  maintenanceTimer = null;
};
