import { useCallback, useEffect, useRef } from "react";

type BroadcastTarget = { postMessage: (message: unknown) => void };
type StorageTarget = Pick<Storage, "removeItem" | "setItem">;

export const scopedCrossTabTransportName = (
  name: string,
  scopeKey?: string | null
) =>
  scopeKey === null
    ? null
    : scopeKey === undefined
      ? name
      : `${name}:${encodeURIComponent(scopeKey)}`;

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
  scopeKey,
  storageKey
}: {
  channelName: string;
  isMessage: (value: unknown) => value is T;
  onMessage: (message: T) => void;
  scopeKey?: string | null;
  storageKey: string;
}) => {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const scopedChannelName = scopedCrossTabTransportName(
    channelName,
    scopeKey
  );
  const scopedStorageKey = scopedCrossTabTransportName(
    storageKey,
    scopeKey
  );

  useEffect(() => {
    if (!scopedChannelName || !scopedStorageKey) {
      channelRef.current = null;
      return undefined;
    }
    const receive = (value: unknown) => {
      if (isMessage(value)) onMessageRef.current(value);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== scopedStorageKey || !event.newValue) return;
      try {
        receive(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed or legacy cross-tab payloads.
      }
    };

    const channel =
      "BroadcastChannel" in window
        ? new BroadcastChannel(scopedChannelName)
        : null;
    channelRef.current = channel;
    if (channel) channel.onmessage = (event) => receive(event.data);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [isMessage, scopedChannelName, scopedStorageKey]);

  return useCallback(
    (message: T) => {
      if (!scopedStorageKey) return "unavailable" as const;
      publishCrossTabMessage({
        channel: channelRef.current,
        message,
        storage: window.localStorage,
        storageKey: scopedStorageKey
      });
    },
    [scopedStorageKey]
  );
};
