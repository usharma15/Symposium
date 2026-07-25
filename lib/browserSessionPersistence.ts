"use client";

export type BrowserStorageLike =
  Pick<Storage, "getItem" | "setItem"> &
  Partial<Pick<Storage, "removeItem">>;

export const browserSessionPersistenceCookieName = "symposium-browser-session-v1";
export const nonBrowserSessionPersistenceId = "non-browser-session";

const cookieValue = () => {
  if (typeof document === "undefined") return null;
  const prefix = `${browserSessionPersistenceCookieName}=`;
  const match = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(prefix.length)) || null;
  } catch {
    return null;
  }
};

const freshSessionId = () => {
  try {
    return window.crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
};

export const browserSessionPersistenceId = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return nonBrowserSessionPersistenceId;
  }
  const existing = cookieValue();
  if (existing) return existing;
  const created = freshSessionId();
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${browserSessionPersistenceCookieName}=${encodeURIComponent(created)}; Path=/; SameSite=Lax${secure}`;
  return cookieValue() ?? created;
};

export const browserSessionLocalStorage = (): BrowserStorageLike | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
