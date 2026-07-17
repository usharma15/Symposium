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
  initialIsSignedIn,
  isSignedIn,
  accountSynced,
  authError
}: {
  entryMode: EntryMode;
  clerkEnabled: boolean;
  authLoaded: boolean;
  initialIsSignedIn: boolean | null;
  isSignedIn: boolean;
  accountSynced: boolean;
  authError: string;
}): EntryMode => {
  if (!clerkEnabled || entryMode === "approach") return entryMode;
  if (authError) return "auth";
  // A completed browser session must render its canonical shell on the first
  // frame. Clerk and account synchronization continue behind that shell.
  if (entryMode === "complete") {
    if (!authLoaded) return initialIsSignedIn === false ? "auth" : "complete";
    return isSignedIn ? "complete" : "auth";
  }
  if (!authLoaded || (isSignedIn && !accountSynced)) return "loading";
  return entryMode;
};
