"use client";

import { useEffect, useState } from "react";
import { entranceSessionCookieName } from "@/features/entrance/browserSession";

const entranceSeenStorageKey = "symposium-entrance-seen-v2";
const fallbackPresenceChannel = "symposium-browser-presence-v2";
const fallbackProbeMs = 80;

const hasBrowserSessionMarker = () =>
  document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .some((entry) => entry === `${entranceSessionCookieName}=1`);

const markBrowserSession = () => {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${entranceSessionCookieName}=1; Path=/; SameSite=Lax${secure}`;
  return hasBrowserSessionMarker();
};

type PresenceMessage = { kind: "probe" | "present"; senderId: string; targetId?: string };

export const useBrowserSessionEntrance = (initialDecision: boolean | null = null) => {
  const [shouldPlayEntrance, setShouldPlayEntrance] = useState<boolean | null>(initialDecision);

  useEffect(() => {
    if (initialDecision === false) {
      window.sessionStorage.setItem(entranceSeenStorageKey, "true");
      return;
    }
    const seenInThisTab = window.sessionStorage.getItem(entranceSeenStorageKey) === "true";
    if (seenInThisTab || hasBrowserSessionMarker()) {
      window.sessionStorage.setItem(entranceSeenStorageKey, "true");
      setShouldPlayEntrance(false);
      return;
    }

    if (markBrowserSession()) {
      window.sessionStorage.setItem(entranceSeenStorageKey, "true");
      setShouldPlayEntrance(true);
      return;
    }

    if (typeof BroadcastChannel === "undefined") {
      window.sessionStorage.setItem(entranceSeenStorageKey, "true");
      setShouldPlayEntrance(true);
      return;
    }

    const senderId = window.crypto.randomUUID();
    const channel = new BroadcastChannel(fallbackPresenceChannel);
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
      window.sessionStorage.setItem(entranceSeenStorageKey, "true");
      setShouldPlayEntrance(!peerPresent);
    }, fallbackProbeMs);

    return () => {
      window.clearTimeout(decisionTimer);
      channel.removeEventListener("message", receivePresence);
      channel.close();
    };
  }, [initialDecision]);

  return shouldPlayEntrance;
};
