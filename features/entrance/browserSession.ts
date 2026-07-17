export const entranceSessionCookieName = "symposium_entrance_session";

export type SessionEntryMode = "loading" | "approach" | "complete";
export type EntryMode = SessionEntryMode | "auth";

export const entryModeForBrowserSession = (shouldPlayEntrance: boolean | null): SessionEntryMode =>
  shouldPlayEntrance === null ? "loading" : shouldPlayEntrance ? "approach" : "complete";

export const shouldCompleteEntryAfterAccountSync = (entryMode: EntryMode) => entryMode !== "complete";
