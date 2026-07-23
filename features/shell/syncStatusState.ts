const persistentSyncStatuses = new Set([
  "Loading live data",
  "Live data connected",
  "Live updates reconnecting",
  "Live updates connected"
]);

const inProgressStatusPattern = /^(syncing|posting|saving|uploading|preparing)|\bsyncing\b/i;
const errorStatusPattern = /\b(could not|cannot|failed|unavailable|no longer)\b/i;

export const isPersistentSyncStatus = (status: string) =>
  persistentSyncStatuses.has(status);

export const syncStatusExpiryMs = (status: string) => {
  if (isPersistentSyncStatus(status)) return null;
  if (inProgressStatusPattern.test(status)) return 30_000;
  if (errorStatusPattern.test(status)) return 6_500;
  return 3_500;
};

export const syncStatusAfterNavigation = (status: string, connectionStatus: string) =>
  isPersistentSyncStatus(status) ? status : connectionStatus;
