import { useCallback, useEffect, useRef } from "react";

type BroadcastTarget = { postMessage: (message: unknown) => void };
type StorageTarget = Pick<Storage, "removeItem" | "setItem">;

export const publishCrossTabMessage = <T>({
  channel,
  message,
  storage,
  storageKey
}: {
  channel: BroadcastTarget | null;
  message: T;
  storage: StorageTarget;
  storageKey: string;
}) => {
  if (channel) {
    try {
      channel.postMessage(message);
      return "broadcast" as const;
    } catch {
      // Fall through to the storage-event compatibility path.
    }
  }

  const serialized = JSON.stringify(message);
  try {
    storage.setItem(storageKey, serialized);
    return "storage" as const;
  } catch {
    try {
      storage.removeItem(storageKey);
      storage.setItem(storageKey, serialized);
      return "storage" as const;
    } catch {
      return "unavailable" as const;
    }
  }
};

export const useCrossTabItemTransport = <T>({
  channelName,
  isMessage,
  onMessage,
  storageKey
}: {
  channelName: string;
  isMessage: (value: unknown) => value is T;
  onMessage: (message: T) => void;
  storageKey: string;
}) => {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const receive = (value: unknown) => {
      if (isMessage(value)) onMessageRef.current(value);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        receive(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed or legacy cross-tab payloads.
      }
    };

    const channel = "BroadcastChannel" in window ? new BroadcastChannel(channelName) : null;
    channelRef.current = channel;
    if (channel) channel.onmessage = (event) => receive(event.data);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [channelName, isMessage, storageKey]);

  return useCallback(
    (message: T) => {
      publishCrossTabMessage({
        channel: channelRef.current,
        message,
        storage: window.localStorage,
        storageKey
      });
    },
    [storageKey]
  );
};
