export type SymposiumRecoveryCause =
  | "initial"
  | "focus"
  | "online"
  | "pageshow"
  | "transport"
  | "visible";

export type SymposiumRecoveryInterruption =
  | "hidden"
  | "offline"
  | "transport";

export type SymposiumRecoveryState = {
  focused: boolean;
  interruptionEpoch: number;
  lastCause: SymposiumRecoveryCause;
  lastInterruption: SymposiumRecoveryInterruption | null;
  online: boolean;
  resumeEpoch: number;
  transportHealthy: boolean;
  visible: boolean;
};

export type SymposiumRecoveryObservation = Pick<
  SymposiumRecoveryState,
  "focused" | "online" | "visible"
>;

export type SymposiumRecoveryAction =
  | ({ type: "observed" } & SymposiumRecoveryObservation)
  | { type: "blurred" }
  | { type: "focused" }
  | { type: "hidden" }
  | { type: "offline" }
  | { type: "online" }
  | { type: "pageshow" }
  | { type: "transport_failed" }
  | { type: "transport_recovered" }
  | { type: "visible" };

export type SymposiumRecoveryPhase =
  | "active"
  | "offline"
  | "recovering"
  | "suspended";

export const initialSymposiumRecoveryState: SymposiumRecoveryState = {
  focused: true,
  interruptionEpoch: 0,
  lastCause: "initial",
  lastInterruption: null,
  online: true,
  resumeEpoch: 0,
  transportHealthy: true,
  visible: true
};

export const symposiumRecoveryCanAttempt = (
  state: SymposiumRecoveryState
) => state.online && state.visible;

export const symposiumRecoveryPhase = (
  state: SymposiumRecoveryState
): SymposiumRecoveryPhase => {
  if (!state.online) return "offline";
  if (!state.visible) return "suspended";
  return state.transportHealthy ? "active" : "recovering";
};

const interrupt = (
  state: SymposiumRecoveryState,
  interruption: SymposiumRecoveryInterruption,
  patch: Partial<SymposiumRecoveryState>
) => ({
  ...state,
  ...patch,
  interruptionEpoch: state.interruptionEpoch + 1,
  lastInterruption: interruption
});

const resume = (
  state: SymposiumRecoveryState,
  cause: SymposiumRecoveryCause,
  patch: Partial<SymposiumRecoveryState> = {}
) => ({
  ...state,
  ...patch,
  lastCause: cause,
  lastInterruption: null,
  resumeEpoch: state.resumeEpoch + 1
});

export const reduceSymposiumRecovery = (
  state: SymposiumRecoveryState,
  action: SymposiumRecoveryAction
): SymposiumRecoveryState => {
  switch (action.type) {
    case "observed":
      return {
        ...state,
        focused: action.focused,
        online: action.online,
        visible: action.visible
      };
    case "blurred":
      return state.focused ? { ...state, focused: false } : state;
    case "focused":
      if (state.focused) return state;
      return symposiumRecoveryCanAttempt(state)
        ? resume(state, "focus", { focused: true })
        : { ...state, focused: true };
    case "hidden":
      return state.visible
        ? interrupt(state, "hidden", { visible: false })
        : state;
    case "offline":
      return state.online
        ? interrupt(state, "offline", { online: false })
        : state;
    case "online": {
      if (state.online) return state;
      const next = { ...state, online: true };
      return next.visible ? resume(next, "online") : next;
    }
    case "pageshow":
      return symposiumRecoveryCanAttempt(state)
        ? resume(state, "pageshow")
        : state;
    case "transport_failed":
      return state.transportHealthy
        ? interrupt(state, "transport", { transportHealthy: false })
        : state;
    case "transport_recovered":
      if (state.transportHealthy) return state;
      return symposiumRecoveryCanAttempt(state)
        ? resume(state, "transport", { transportHealthy: true })
        : { ...state, transportHealthy: true };
    case "visible": {
      if (state.visible) return state;
      const next = { ...state, visible: true };
      return next.online ? resume(next, "visible") : next;
    }
  }
};

export const symposiumRecoveryRetryDelayMs = (
  attempt: number,
  {
    baseMs = 1_000,
    maximumMs = 30_000
  }: {
    baseMs?: number;
    maximumMs?: number;
  } = {}
) =>
  Math.min(
    maximumMs,
    baseMs * 2 ** Math.max(0, Math.floor(attempt))
  );
