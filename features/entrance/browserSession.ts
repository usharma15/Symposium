export const entranceSessionCookieName = "symposium_entrance_session";

export type SessionEntryMode = "loading" | "approach" | "complete";
export type EntryMode = SessionEntryMode | "auth";

export const entryModeForBrowserSession = (shouldPlayEntrance: boolean | null): SessionEntryMode =>
  shouldPlayEntrance === null ? "loading" : shouldPlayEntrance ? "approach" : "complete";

export const shouldCompleteEntryAfterAccountSync = (entryMode: EntryMode) =>
  entryMode !== "complete" && entryMode !== "approach";

export const resolvePresentedEntryMode = ({
  entryMode,
  clerkEnabled,
  authLoaded,
  isSignedIn,
  accountSynced,
  authError
}: {
  entryMode: EntryMode;
  clerkEnabled: boolean;
  authLoaded: boolean;
  isSignedIn: boolean;
  accountSynced: boolean;
  authError: string;
}): EntryMode => {
  if (!clerkEnabled || entryMode === "approach") return entryMode;
  if (authError) return "auth";
  if (!authLoaded || (isSignedIn && !accountSynced)) return "loading";
  if (entryMode === "complete" && !isSignedIn) return "auth";
  return entryMode;
};
