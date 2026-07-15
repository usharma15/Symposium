export type ScribbleSnapshotDecision = "apply-server" | "preserve-local" | "conflict";

export const decideScribbleSnapshot = ({
  dirty,
  knownServerRevision,
  localFingerprint,
  pendingSaveFingerprint,
  serverFingerprint,
  snapshotRevision
}: {
  dirty: boolean;
  knownServerRevision: number;
  localFingerprint: string;
  pendingSaveFingerprint?: string;
  serverFingerprint: string;
  snapshotRevision: number;
}): ScribbleSnapshotDecision => {
  if (!dirty || localFingerprint === serverFingerprint) return "apply-server";
  if (snapshotRevision <= knownServerRevision) return "preserve-local";
  if (pendingSaveFingerprint === serverFingerprint) return "preserve-local";
  return "conflict";
};
