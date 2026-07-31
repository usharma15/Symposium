import {
  initialSymposiumRecoveryState,
  reduceSymposiumRecovery,
  symposiumRecoveryCanAttempt,
  type SymposiumRecoveryAction,
  type SymposiumRecoveryState
} from "@/features/recovery/symposiumRecoveryModel";

type RecoveryListener = (
  state: SymposiumRecoveryState,
  previous: SymposiumRecoveryState
) => void;

export type BrowserRecoveryEnvironment = {
  addDocumentListener: (
    type: "visibilitychange",
    listener: EventListener
  ) => void;
  addWindowListener: (
    type: "blur" | "focus" | "offline" | "online" | "pageshow",
    listener: EventListener
  ) => void;
  focused: () => boolean;
  online: () => boolean;
  removeDocumentListener: (
    type: "visibilitychange",
    listener: EventListener
  ) => void;
  removeWindowListener: (
    type: "blur" | "focus" | "offline" | "online" | "pageshow",
    listener: EventListener
  ) => void;
  visible: () => boolean;
};

const browserEnvironment = (): BrowserRecoveryEnvironment | null => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  return {
    addDocumentListener: (type, listener) =>
      document.addEventListener(type, listener),
    addWindowListener: (type, listener) =>
      window.addEventListener(type, listener),
    focused: () => document.hasFocus(),
    online: () => navigator.onLine,
    removeDocumentListener: (type, listener) =>
      document.removeEventListener(type, listener),
    removeWindowListener: (type, listener) =>
      window.removeEventListener(type, listener),
    visible: () => document.visibilityState === "visible"
  };
};

export const createBrowserRecoveryCoordinator = (
  environment: BrowserRecoveryEnvironment | null = browserEnvironment()
) => {
  let state = initialSymposiumRecoveryState;
  let started = false;
  const listeners = new Set<RecoveryListener>();
  const dispatch = (action: SymposiumRecoveryAction) => {
    const previous = state;
    state = reduceSymposiumRecovery(state, action);
    if (state === previous) return;
    for (const listener of listeners) listener(state, previous);
  };
  const events: Array<{
    target: "document" | "window";
    type: "blur" | "focus" | "offline" | "online" | "pageshow" | "visibilitychange";
    listener: EventListener;
  }> = [
    {
      target: "document",
      type: "visibilitychange",
      listener: () => dispatch({
        type: environment?.visible() ? "visible" : "hidden"
      })
    },
    { target: "window", type: "blur", listener: () => dispatch({ type: "blurred" }) },
    { target: "window", type: "focus", listener: () => dispatch({ type: "focused" }) },
    { target: "window", type: "offline", listener: () => dispatch({ type: "offline" }) },
    { target: "window", type: "online", listener: () => dispatch({ type: "online" }) },
    { target: "window", type: "pageshow", listener: () => dispatch({ type: "pageshow" }) }
  ];
  const start = () => {
    if (started || !environment) return;
    started = true;
    dispatch({
      type: "observed",
      focused: environment.focused(),
      online: environment.online(),
      visible: environment.visible()
    });
    for (const event of events) {
      if (event.target === "document") {
        environment.addDocumentListener("visibilitychange", event.listener);
      } else {
        environment.addWindowListener(
          event.type as "blur" | "focus" | "offline" | "online" | "pageshow",
          event.listener
        );
      }
    }
  };
  const stop = () => {
    if (!started || !environment) return;
    started = false;
    for (const event of events) {
      if (event.target === "document") {
        environment.removeDocumentListener("visibilitychange", event.listener);
      } else {
        environment.removeWindowListener(
          event.type as "blur" | "focus" | "offline" | "online" | "pageshow",
          event.listener
        );
      }
    }
  };

  return {
    canAttempt: () => symposiumRecoveryCanAttempt(state),
    getSnapshot: () => state,
    reportTransportFailure: () => dispatch({ type: "transport_failed" }),
    reportTransportSuccess: () => dispatch({ type: "transport_recovered" }),
    subscribe: (listener: RecoveryListener) => {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) stop();
      };
    }
  };
};

export const browserRecoveryCoordinator =
  createBrowserRecoveryCoordinator();
