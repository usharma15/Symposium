"use client";

import { useCallback, useEffect, useState } from "react";
import { entranceSessionCookieName } from "@/features/entrance/browserSession";

const entranceSeenStorageKey = "symposium-entrance-seen-v2";
const fallbackPresenceChannel = "symposium-browser-presence-v2";
const fallbackProbeMs = 80;

const readSessionMarker = () => {
  try {
    return window.sessionStorage.getItem(entranceSeenStorageKey) === "true";
  } catch {
    return false;
  }
};

const writeSessionMarker = (key: string, value: string) => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // The cookie and in-memory decision remain authoritative.
  }
};

const removeSessionMarker = (key: string) => {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Entrance replay still proceeds in memory.
  }
};

const hasBrowserSessionMarker = () =>
  document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .some((entry) => entry === `${entranceSessionCookieName}=1`);

const markBrowserSession = () => {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  try {
    document.cookie = `${entranceSessionCookieName}=1; Path=/; SameSite=Lax${secure}`;
    return hasBrowserSessionMarker();
  } catch {
    return false;
  }
};

type PresenceMessage = { kind: "probe" | "present"; senderId: string; targetId?: string };

export const useBrowserSessionEntrance = (initialDecision: boolean | null = null) => {
  const [shouldPlayEntrance, setShouldPlayEntrance] = useState<boolean | null>(initialDecision);

  const replayEntrance = useCallback(() => {
    removeSessionMarker("symposium-entry-complete");
    writeSessionMarker(entranceSeenStorageKey, "true");
    markBrowserSession();
    setShouldPlayEntrance(true);
  }, []);

  useEffect(() => {
    if (initialDecision === false) {
      writeSessionMarker(entranceSeenStorageKey, "true");
      return;
    }
    const seenInThisTab = readSessionMarker();
    if (seenInThisTab || hasBrowserSessionMarker()) {
      writeSessionMarker(entranceSeenStorageKey, "true");
      setShouldPlayEntrance(false);
      return;
    }

    if (markBrowserSession()) {
      writeSessionMarker(entranceSeenStorageKey, "true");
      setShouldPlayEntrance(true);
      return;
    }

    if (typeof BroadcastChannel === "undefined") {
      writeSessionMarker(entranceSeenStorageKey, "true");
      setShouldPlayEntrance(true);
      return;
    }

    const senderId = window.crypto.randomUUID();
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(fallbackPresenceChannel);
    } catch {
      writeSessionMarker(entranceSeenStorageKey, "true");
      setShouldPlayEntrance(true);
      return;
    }
    let peerPresent = false;
    const receivePresence = (event: MessageEvent<PresenceMessage>) => {
      const message = event.data;
      if (!message || message.senderId === senderId) return;
      if (message.kind === "probe") {
        channel.postMessage({ kind: "present", senderId, targetId: message.senderId } satisfies PresenceMessage);
      } else if (message.targetId === senderId) {
        peerPresent = true;
      }
    };
    channel.addEventListener("message", receivePresence);
    channel.postMessage({ kind: "probe", senderId } satisfies PresenceMessage);
    const decisionTimer = window.setTimeout(() => {
      writeSessionMarker(entranceSeenStorageKey, "true");
      setShouldPlayEntrance(!peerPresent);
    }, fallbackProbeMs);

    return () => {
      window.clearTimeout(decisionTimer);
      channel.removeEventListener("message", receivePresence);
      channel.close();
    };
  }, [initialDecision]);

  return { replayEntrance, shouldPlayEntrance };
};
