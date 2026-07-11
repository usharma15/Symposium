export const entranceSessionCookieName = "symposium_entrance_session";

export type SessionEntryMode = "loading" | "approach" | "complete";

export const entryModeForBrowserSession = (shouldPlayEntrance: boolean | null): SessionEntryMode =>
  shouldPlayEntrance === null ? "loading" : shouldPlayEntrance ? "approach" : "complete";
