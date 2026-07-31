export type SessionEntryMode = "loading" | "approach" | "complete";
export type EntryMode = SessionEntryMode | "auth";

export type SymposiumSessionLifecycleState = {
  accountSynced: boolean;
  authError: string;
  browserReadStateHydrated: boolean;
  entryMode: EntryMode;
  identityUserId: string | null;
  pendingUserId: string | null;
};

export type SymposiumSessionLifecycleAction =
  | { type: "browser_decided"; shouldPlayEntrance: boolean | null }
  | { type: "browser_read_state_hydrated" }
  | {
      type: "approach_elapsed";
      accountSynced: boolean;
      browserSignedIn: boolean;
    }
  | { type: "identity_cleared" }
  | { type: "identity_sync_started"; userId: string }
  | { type: "cached_identity_committed"; userId: string }
  | { type: "identity_sync_succeeded"; userId: string }
  | { type: "identity_sync_failed"; userId: string; error: string }
  | { type: "force_auth" }
  | { type: "local_preview_entered" }
  | { type: "signed_out" };

export const entryModeForBrowserSession = (
  shouldPlayEntrance: boolean | null
): SessionEntryMode =>
  shouldPlayEntrance === null
    ? "loading"
    : shouldPlayEntrance
      ? "approach"
      : "complete";

export const createSymposiumSessionLifecycle = (
  initialShouldPlayEntrance: boolean | null
): SymposiumSessionLifecycleState => ({
  accountSynced: false,
  authError: "",
  browserReadStateHydrated: false,
  entryMode: entryModeForBrowserSession(initialShouldPlayEntrance),
  identityUserId: null,
  pendingUserId: null
});

export const shouldCompleteEntryAfterAccountSync = (entryMode: EntryMode) =>
  entryMode !== "complete" && entryMode !== "approach";

export const resolveApproachElapsedMode = ({
  accountSynced,
  browserSignedIn
}: {
  accountSynced: boolean;
  browserSignedIn: boolean;
}): EntryMode => accountSynced || browserSignedIn ? "complete" : "auth";

export const reduceSymposiumSessionLifecycle = (
  state: SymposiumSessionLifecycleState,
  action: SymposiumSessionLifecycleAction
): SymposiumSessionLifecycleState => {
  switch (action.type) {
    case "browser_decided":
      return {
        ...state,
        entryMode: entryModeForBrowserSession(action.shouldPlayEntrance)
      };
    case "browser_read_state_hydrated":
      return state.browserReadStateHydrated
        ? state
        : { ...state, browserReadStateHydrated: true };
    case "approach_elapsed":
      return {
        ...state,
        entryMode: resolveApproachElapsedMode(action)
      };
    case "identity_cleared":
      return {
        ...state,
        accountSynced: false,
        authError: "",
        identityUserId: null,
        pendingUserId: null
      };
    case "identity_sync_started":
      return {
        ...state,
        accountSynced:
          state.identityUserId === action.userId && state.accountSynced,
        authError: "",
        pendingUserId: action.userId
      };
    case "cached_identity_committed":
      if (state.pendingUserId !== action.userId) return state;
      return {
        ...state,
        accountSynced: true,
        identityUserId: action.userId
      };
    case "identity_sync_succeeded":
      if (state.pendingUserId !== action.userId) return state;
      return {
        ...state,
        accountSynced: true,
        authError: "",
        identityUserId: action.userId,
        pendingUserId: null
      };
    case "identity_sync_failed":
      if (state.pendingUserId !== action.userId) return state;
      return {
        ...state,
        authError: action.error,
        pendingUserId: null
      };
    case "force_auth":
      return state.entryMode === "auth"
        ? state
        : { ...state, entryMode: "auth" };
    case "local_preview_entered":
      return {
        ...state,
        accountSynced: true,
        authError: "",
        entryMode: "complete",
        identityUserId: null,
        pendingUserId: null
      };
    case "signed_out":
      return {
        ...state,
        accountSynced: false,
        authError: "",
        entryMode: "approach",
        identityUserId: null,
        pendingUserId: null
      };
  }
};

export const currentAccountIsSynced = ({
  state,
  clerkEnabled,
  isSignedIn,
  userId
}: {
  state: SymposiumSessionLifecycleState;
  clerkEnabled: boolean;
  isSignedIn: boolean;
  userId: string | null;
}) => {
  if (!clerkEnabled) return state.accountSynced;
  return Boolean(
    isSignedIn &&
      userId &&
      state.accountSynced &&
      state.identityUserId === userId
  );
};

export const authenticatedIdentityTransitionIsPending = ({
  state,
  isSignedIn,
  userId
}: {
  state: SymposiumSessionLifecycleState;
  isSignedIn: boolean;
  userId: string | null;
}) =>
  Boolean(
    isSignedIn &&
      state.identityUserId &&
      state.identityUserId !== userId
  );

export const sessionReadStateIsReady = ({
  state,
  clerkEnabled,
  authLoaded,
  isSignedIn,
  userId
}: {
  state: SymposiumSessionLifecycleState;
  clerkEnabled: boolean;
  authLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
}) =>
  state.browserReadStateHydrated &&
  (
    !clerkEnabled ||
    (
      authLoaded &&
      (
        !isSignedIn ||
        currentAccountIsSynced({
          state,
          clerkEnabled,
          isSignedIn,
          userId
        })
      )
    )
  );

export const authSessionScopeKey = ({
  authLoaded,
  isSignedIn,
  userId
}: {
  authLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
}) =>
  authLoaded
    ? (isSignedIn ? userId ?? "signed-in" : "anonymous")
    : "loading";

export const resolvePresentedEntryMode = ({
  entryMode,
  clerkEnabled,
  authLoaded,
  initialIsSignedIn,
  isSignedIn,
  accountSynced,
  authError,
  identityTransitionPending = false
}: {
  entryMode: EntryMode;
  clerkEnabled: boolean;
  authLoaded: boolean;
  initialIsSignedIn: boolean | null;
  isSignedIn: boolean;
  accountSynced: boolean;
  authError: string;
  identityTransitionPending?: boolean;
}): EntryMode => {
  if (!clerkEnabled || entryMode === "approach") return entryMode;
  if (authError) return "auth";
  if (identityTransitionPending) return "loading";
  // A completed browser session must render its canonical shell on the first
  // frame. Clerk and account synchronization continue behind that shell.
  if (entryMode === "complete") {
    if (!authLoaded) return initialIsSignedIn === false ? "auth" : "complete";
    return isSignedIn ? "complete" : "auth";
  }
  if (!authLoaded || (isSignedIn && !accountSynced)) return "loading";
  return entryMode;
};
