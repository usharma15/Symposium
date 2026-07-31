"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore
} from "react";
import {
  browserRecoveryCoordinator
} from "@/features/recovery/browserRecoveryCoordinator";
import {
  initialSymposiumRecoveryState,
  symposiumRecoveryCanAttempt,
  symposiumRecoveryPhase,
  type SymposiumRecoveryCause
} from "@/features/recovery/symposiumRecoveryModel";

const subscribe = (listener: () => void) =>
  browserRecoveryCoordinator.subscribe(() => listener());
const getSnapshot = () => browserRecoveryCoordinator.getSnapshot();
const getServerSnapshot = () => initialSymposiumRecoveryState;

export const useSymposiumRecovery = () => {
  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
  return {
    ...state,
    canAttempt: symposiumRecoveryCanAttempt(state),
    phase: symposiumRecoveryPhase(state)
  };
};

export const useSymposiumRecoveryRefresh = (
  refresh: (cause: SymposiumRecoveryCause) => void,
  enabled = true
) => {
  const recovery = useSymposiumRecovery();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const observedEpochRef = useRef(recovery.resumeEpoch);

  useEffect(() => {
    if (observedEpochRef.current === recovery.resumeEpoch) return;
    observedEpochRef.current = recovery.resumeEpoch;
    if (enabled && recovery.canAttempt) {
      refreshRef.current(recovery.lastCause);
    }
  }, [
    enabled,
    recovery.canAttempt,
    recovery.lastCause,
    recovery.resumeEpoch
  ]);
};
