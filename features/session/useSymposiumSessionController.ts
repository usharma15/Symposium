"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type MutableRefObject
} from "react";
import type { ResearchProfile } from "@/lib/mockData";
import {
  clearCachedBootstrap,
  localPreviewBootstrapScopeKey
} from "@/features/bootstrap/cachedBootstrap";
import { useBrowserSessionEntrance } from "@/features/entrance/useBrowserSessionEntrance";
import {
  authSessionScopeKey,
  authenticatedIdentityTransitionIsPending,
  createSymposiumSessionLifecycle,
  currentAccountIsSynced,
  entryModeForBrowserSession,
  reduceSymposiumSessionLifecycle,
  resolvePresentedEntryMode,
  sessionDataAccessIsEnabled,
  sessionReadStateIsReady,
  shouldCompleteEntryAfterAccountSync
} from "@/features/session/symposiumSessionLifecycle";

export type SymposiumAuthState = {
  clerkEnabled: boolean;
  authLoaded: boolean;
  getAccessToken: () => Promise<string | null>;
  isSignedIn: boolean;
  userId: string | null;
  signOut: () => Promise<void>;
};

export type SessionScopedRequest = {
  signal: AbortSignal;
  shouldCommit: () => boolean;
};

export type SymposiumSessionIdentityPort = {
  clearAuthenticatedIdentity: () => void;
  enterLocalPreview: () => ResearchProfile;
  hydrateCachedBootstrap: (
    storedProfileHandle: string | null,
    cacheScopeKey: string | null,
    authenticatedProfile?: ResearchProfile | null
  ) => ResearchProfile | null;
  hydrateCachedIdentity: (userId: string) => ResearchProfile | null;
  refreshData: (
    preferredHandle?: string,
    request?: SessionScopedRequest
  ) => Promise<ResearchProfile | null>;
  syncAuthenticatedAccount: (
    userId: string,
    request: SessionScopedRequest
  ) => Promise<ResearchProfile | null>;
};

export type SymposiumSessionEnvironmentPort = {
  applyInitialRouteState: () => void;
  hydrateBrowserAppearance: () => void;
  hydrateLocalRecency: () => void;
};

type SymposiumSessionControllerInput = {
  auth: SymposiumAuthState;
  environmentRef: MutableRefObject<SymposiumSessionEnvironmentPort | null>;
  identityRef: MutableRefObject<SymposiumSessionIdentityPort | null>;
  initialIsSignedIn: boolean | null;
  initialShouldPlayEntrance: boolean | null;
  onStatus: (status: string) => void;
};

const authenticatedStorageKeys = [
  "symposium-auth-handle",
  "symposium-auth-records"
] as const;
const entryCompleteStorageKey = "symposium-entry-complete";

const readBrowserValue = (storage: Storage, key: string) => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const setBrowserValue = (storage: Storage, key: string, value: string) => {
  try {
    storage.setItem(key, value);
  } catch {
    // Browser persistence accelerates the session but never owns it.
  }
};

const removeBrowserValue = (storage: Storage, key: string) => {
  try {
    storage.removeItem(key);
  } catch {
    // In-memory session state remains authoritative.
  }
};

const clearAuthenticatedBrowserState = () => {
  for (const key of authenticatedStorageKeys) {
    removeBrowserValue(window.localStorage, key);
  }
  clearCachedBootstrap(window.localStorage);
};

const markEntryComplete = () => {
  setBrowserValue(window.sessionStorage, entryCompleteStorageKey, "true");
};

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

export const useSymposiumSessionController = ({
  auth,
  environmentRef,
  identityRef,
  initialIsSignedIn,
  initialShouldPlayEntrance,
  onStatus
}: SymposiumSessionControllerInput) => {
  const {
    authLoaded,
    clerkEnabled,
    isSignedIn,
    userId
  } = auth;
  const [lifecycle, dispatch] = useReducer(
    reduceSymposiumSessionLifecycle,
    initialShouldPlayEntrance,
    createSymposiumSessionLifecycle
  );
  const {
    replayEntrance,
    shouldPlayEntrance
  } = useBrowserSessionEntrance(initialShouldPlayEntrance);
  const entranceStartedAtRef = useRef<number | null>(null);
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;
  const authRef = useRef({ authLoaded, isSignedIn, userId });
  authRef.current = { authLoaded, isSignedIn, userId };
  const syncEpochRef = useRef(0);
  const activeSyncControllerRef = useRef<AbortController | null>(null);

  const invalidateActiveSync = useCallback(() => {
    syncEpochRef.current += 1;
    activeSyncControllerRef.current?.abort();
    activeSyncControllerRef.current = null;
  }, []);

  const requireIdentity = () => {
    const identity = identityRef.current;
    if (!identity) {
      throw new Error("Symposium session identity port is unavailable.");
    }
    return identity;
  };

  const requireEnvironment = () => {
    const environment = environmentRef.current;
    if (!environment) {
      throw new Error("Symposium session environment port is unavailable.");
    }
    return environment;
  };

  useLayoutEffect(() => {
    if (shouldPlayEntrance === null) return;
    const identity = requireIdentity();
    const environment = requireEnvironment();
    const storedProfileHandle = !clerkEnabled
      ? readBrowserValue(window.localStorage, "symposium-profile-handle")
      : null;

    environment.hydrateBrowserAppearance();
    environment.hydrateLocalRecency();
    if (!clerkEnabled) {
      identity.hydrateCachedBootstrap(
        storedProfileHandle,
        localPreviewBootstrapScopeKey
      );
    }
    const sessionEntryMode = entryModeForBrowserSession(shouldPlayEntrance);
    dispatch({
      type: "browser_decided",
      shouldPlayEntrance
    });
    if (sessionEntryMode === "approach") {
      entranceStartedAtRef.current = Date.now();
    }
    if (sessionEntryMode === "complete") {
      environment.applyInitialRouteState();
      markEntryComplete();
    }
    dispatch({ type: "browser_read_state_hydrated" });

    if (!clerkEnabled) {
      identity.refreshData(storedProfileHandle ?? undefined).catch(() => {
        onStatus("Using seed data");
      });
    }
  }, [clerkEnabled, shouldPlayEntrance]);

  useEffect(() => {
    if (
      lifecycle.entryMode !== "approach" ||
      shouldPlayEntrance !== true
    ) {
      return undefined;
    }

    const startedAt = entranceStartedAtRef.current ?? Date.now();
    entranceStartedAtRef.current = startedAt;
    const timer = window.setTimeout(() => {
      const latestLifecycle = lifecycleRef.current;
      const latestAuth = authRef.current;
      const accountSynced = currentAccountIsSynced({
        state: latestLifecycle,
        clerkEnabled,
        isSignedIn: latestAuth.isSignedIn,
        userId: latestAuth.userId
      });
      dispatch({
        type: "approach_elapsed",
        accountSynced,
        browserSignedIn: latestAuth.isSignedIn
      });
      if (accountSynced || latestAuth.isSignedIn) {
        markEntryComplete();
        requireEnvironment().applyInitialRouteState();
      }
    }, Math.max(0, startedAt + 5000 - Date.now()));

    return () => window.clearTimeout(timer);
  }, [clerkEnabled, lifecycle.entryMode, shouldPlayEntrance]);

  useEffect(() => {
    if (!clerkEnabled || !authLoaded) return undefined;
    const identity = requireIdentity();

    if (!isSignedIn) {
      invalidateActiveSync();
      identity.clearAuthenticatedIdentity();
      clearAuthenticatedBrowserState();
      dispatch({ type: "identity_cleared" });
      if (lifecycleRef.current.entryMode === "complete") {
        removeBrowserValue(window.sessionStorage, entryCompleteStorageKey);
        dispatch({ type: "force_auth" });
      }
      return undefined;
    }

    if (!userId) return undefined;
    const committedUserId = lifecycleRef.current.identityUserId;
    if (
      committedUserId === userId &&
      lifecycleRef.current.accountSynced &&
      lifecycleRef.current.pendingUserId === null
    ) {
      return undefined;
    }

    invalidateActiveSync();
    const controller = new AbortController();
    activeSyncControllerRef.current = controller;
    const epoch = syncEpochRef.current;
    const shouldCommit = () => {
      const latest = authRef.current;
      return (
        !controller.signal.aborted &&
        syncEpochRef.current === epoch &&
        latest.authLoaded &&
        latest.isSignedIn &&
        latest.userId === userId
      );
    };

    if (committedUserId && committedUserId !== userId) {
      identity.clearAuthenticatedIdentity();
      clearAuthenticatedBrowserState();
    }
    const crossUserTransition = Boolean(
      committedUserId && committedUserId !== userId
    );
    dispatch({ type: "identity_sync_started", userId });
    const cachedIdentity = identity.hydrateCachedIdentity(userId);
    identity.hydrateCachedBootstrap(
      cachedIdentity?.handle ?? null,
      userId,
      cachedIdentity
    );
    if (cachedIdentity && !crossUserTransition) {
      dispatch({ type: "cached_identity_committed", userId });
    }

    let syncStage: "account" | "read-model" = "account";
    const syncAccount = async () => {
      onStatus("Syncing account");
      const syncedProfile = await identity.syncAuthenticatedAccount(userId, {
        signal: controller.signal,
        shouldCommit
      });
      if (!syncedProfile || !shouldCommit()) return;

      if (crossUserTransition) {
        syncStage = "read-model";
        const refreshedProfile = await identity.refreshData(
          syncedProfile.handle,
          {
            signal: controller.signal,
            shouldCommit
          }
        );
        if (!refreshedProfile || !shouldCommit()) return;
      }
      dispatch({ type: "identity_sync_succeeded", userId });
      if (
        shouldCompleteEntryAfterAccountSync(
          lifecycleRef.current.entryMode
        )
      ) {
        dispatch({
          type: "browser_decided",
          shouldPlayEntrance: false
        });
        requireEnvironment().applyInitialRouteState();
      }
      markEntryComplete();
      onStatus("Signed in");
      if (!crossUserTransition) {
        void identity.refreshData(syncedProfile.handle, {
          signal: controller.signal,
          shouldCommit
        }).catch((error) => {
          if (shouldCommit() && !isAbortError(error)) {
            onStatus("Using cached data");
          }
        });
      }
    };

    syncAccount().catch((error) => {
      if (!shouldCommit() || isAbortError(error)) return;
      dispatch({
        type: "identity_sync_failed",
        userId,
        error:
          error instanceof Error
            ? error.message
            : syncStage === "read-model"
              ? "Could not load the new account's data."
              : "Could not sync your account."
      });
      onStatus(
        syncStage === "read-model"
          ? "Account data sync failed"
          : "Account sync failed"
      );
    });

    return () => {
      controller.abort();
      if (activeSyncControllerRef.current === controller) {
        activeSyncControllerRef.current = null;
      }
    };
  }, [authLoaded, clerkEnabled, invalidateActiveSync, isSignedIn, userId]);

  useEffect(
    () => () => {
      invalidateActiveSync();
    },
    [invalidateActiveSync]
  );

  const enterLocalPreview = () => {
    invalidateActiveSync();
    const previewProfile = requireIdentity().enterLocalPreview();
    dispatch({ type: "local_preview_entered" });
    requireEnvironment().applyInitialRouteState();
    markEntryComplete();
    setBrowserValue(
      window.localStorage,
      "symposium-profile-handle",
      previewProfile.handle
    );
    onStatus("Local preview");
  };

  const signOut = async () => {
    try {
      await auth.signOut();
    } catch {
      onStatus("Sign out failed");
      return;
    }
    invalidateActiveSync();
    requireIdentity().clearAuthenticatedIdentity();
    clearAuthenticatedBrowserState();
    removeBrowserValue(window.sessionStorage, entryCompleteStorageKey);
    dispatch({ type: "signed_out" });
    entranceStartedAtRef.current = Date.now();
    replayEntrance();
  };

  const accountSynced = currentAccountIsSynced({
    state: lifecycle,
    clerkEnabled,
    isSignedIn,
    userId
  });
  const identityTransitionPending =
    authenticatedIdentityTransitionIsPending({
      state: lifecycle,
      isSignedIn,
      userId
    });
  const readSessionReady = sessionReadStateIsReady({
    state: lifecycle,
    clerkEnabled,
    authLoaded,
    isSignedIn,
    userId
  });
  const presentedEntryMode = resolvePresentedEntryMode({
    entryMode: lifecycle.entryMode,
    clerkEnabled,
    authLoaded,
    initialIsSignedIn,
    isSignedIn,
    accountSynced,
    authError: lifecycle.authError,
    identityTransitionPending
  });
  const dataAccessEnabled = sessionDataAccessIsEnabled({
    presentedEntryMode,
    readSessionReady
  });

  return {
    accountSynced,
    authError: lifecycle.authError,
    authSessionKey: authSessionScopeKey({
      authLoaded,
      isSignedIn,
      userId
    }),
    bootstrapCacheScopeKey:
      !clerkEnabled
        ? localPreviewBootstrapScopeKey
        : authLoaded
          ? (isSignedIn ? userId : "anonymous")
          : null,
    enterLocalPreview,
    entryMode: lifecycle.entryMode,
    identityTransitionPending,
    liveEventsEnabled: dataAccessEnabled,
    playApproach: shouldPlayEntrance === true,
    presentedEntryMode,
    readSessionReady,
    readsEnabled: dataAccessEnabled,
    signOut,
    socialHydrationEnabled:
      accountSynced ||
      (
        !clerkEnabled &&
        lifecycle.entryMode === "complete" &&
        readSessionReady
      )
  };
};
