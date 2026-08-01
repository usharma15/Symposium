import type { WorkspaceSnapshot } from "@/lib/workspaceTypes";

export const workspaceSnapshotStorageKey = (actorHandle: string) =>
  `symposium-workspace-v1:${actorHandle}`;

export const writeWorkspaceSnapshot = (
  actorHandle: string,
  snapshot: WorkspaceSnapshot,
  storage: Pick<Storage, "setItem"> = window.localStorage
) => {
  try {
    storage.setItem(workspaceSnapshotStorageKey(actorHandle), JSON.stringify(snapshot));
    return true;
  } catch {
    // The server remains authoritative when browser storage is unavailable or full.
    return false;
  }
};

export const readWorkspaceSnapshot = (
  actorHandle: string,
  storage: Pick<Storage, "getItem"> = window.localStorage
): WorkspaceSnapshot | null => {
  try {
    const raw = storage.getItem(workspaceSnapshotStorageKey(actorHandle));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
    if (!Array.isArray(parsed.documents) || !Array.isArray(parsed.notebooks)) return null;
    return parsed as WorkspaceSnapshot;
  } catch {
    return null;
  }
};
