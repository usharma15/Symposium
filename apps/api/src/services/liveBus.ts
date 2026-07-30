import { EventEmitter } from "node:events";
import type { StoredLiveEvent } from "./events";

export const maxLiveStreamsPerProcess = 500;

const bus = new EventEmitter();
bus.setMaxListeners(maxLiveStreamsPerProcess);

export const getLocalLiveBusStatus = () => ({
  listenerCount: bus.listenerCount("event"),
  maxListeners: bus.getMaxListeners()
});

export const publishLocalLiveEvent = (event: StoredLiveEvent) => {
  bus.emit("event", event);
};

export const subscribeLocalLiveEvents = (listener: (event: StoredLiveEvent) => void) => {
  bus.on("event", listener);
  return () => {
    bus.off("event", listener);
  };
};
