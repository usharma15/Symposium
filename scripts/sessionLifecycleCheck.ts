import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { reportCheck } from "@/scripts/checkReport";
import {
  authSessionScopeKey,
  authenticatedIdentityTransitionIsPending,
  createSymposiumSessionLifecycle,
  currentAccountIsSynced,
  reduceSymposiumSessionLifecycle,
  resolveApproachElapsedMode,
  resolvePresentedEntryMode,
  sessionReadStateIsReady
} from "@/features/session/symposiumSessionLifecycle";

const reduce = (
  state: ReturnType<typeof createSymposiumSessionLifecycle>,
  ...actions: Parameters<typeof reduceSymposiumSessionLifecycle>[1][]
) =>
  actions.reduce(reduceSymposiumSessionLifecycle, state);

const loading = createSymposiumSessionLifecycle(null);
const approaching = createSymposiumSessionLifecycle(true);
const returning = createSymposiumSessionLifecycle(false);

assert.equal(loading.entryMode, "loading");
assert.equal(approaching.entryMode, "approach");
assert.equal(returning.entryMode, "complete");
assert.equal(
  reduce(loading, {
    type: "browser_decided",
    shouldPlayEntrance: false
  }).entryMode,
  "complete"
);
assert.equal(
  reduce(returning, { type: "browser_read_state_hydrated" })
    .browserReadStateHydrated,
  true
);
assert.equal(
  resolveApproachElapsedMode({
    accountSynced: false,
    browserSignedIn: false
  }),
  "auth"
);
assert.equal(
  resolveApproachElapsedMode({
    accountSynced: true,
    browserSignedIn: false
  }),
  "complete"
);
assert.equal(
  resolveApproachElapsedMode({
    accountSynced: false,
    browserSignedIn: true
  }),
  "complete"
);

const syncingA = reduce(returning, {
  type: "identity_sync_started",
  userId: "user-a"
});
assert.deepEqual(
  {
    accountSynced: syncingA.accountSynced,
    authError: syncingA.authError,
    identityUserId: syncingA.identityUserId,
    pendingUserId: syncingA.pendingUserId
  },
  {
    accountSynced: false,
    authError: "",
    identityUserId: null,
    pendingUserId: "user-a"
  }
);
const cachedA = reduce(syncingA, {
  type: "cached_identity_committed",
  userId: "user-a"
});
assert.equal(cachedA.accountSynced, true);
assert.equal(cachedA.identityUserId, "user-a");
assert.equal(cachedA.pendingUserId, "user-a");
assert.equal(
  currentAccountIsSynced({
    state: cachedA,
    clerkEnabled: true,
    isSignedIn: true,
    userId: "user-a"
  }),
  true
);
assert.equal(
  currentAccountIsSynced({
    state: cachedA,
    clerkEnabled: true,
    isSignedIn: true,
    userId: "user-b"
  }),
  false
);

const canonicalA = reduce(cachedA, {
  type: "identity_sync_succeeded",
  userId: "user-a"
});
assert.equal(canonicalA.pendingUserId, null);
const switchingToB = reduce(canonicalA, {
  type: "identity_sync_started",
  userId: "user-b"
});
assert.equal(switchingToB.accountSynced, false);
assert.equal(switchingToB.identityUserId, "user-a");
assert.equal(switchingToB.pendingUserId, "user-b");
assert.equal(
  authenticatedIdentityTransitionIsPending({
    state: switchingToB,
    isSignedIn: true,
    userId: "user-b"
  }),
  true
);
assert.equal(
  resolvePresentedEntryMode({
    accountSynced: false,
    authError: "",
    authLoaded: true,
    clerkEnabled: true,
    entryMode: "complete",
    identityTransitionPending: true,
    initialIsSignedIn: true,
    isSignedIn: true
  }),
  "loading",
  "a new Clerk viewer must never see the previous viewer while identity sync is pending"
);
assert.equal(
  reduce(switchingToB, {
    type: "identity_sync_succeeded",
    userId: "user-a"
  }),
  switchingToB,
  "a delayed completion from the previous viewer must be ignored"
);
assert.equal(
  reduce(switchingToB, {
    type: "cached_identity_committed",
    userId: "user-a"
  }),
  switchingToB,
  "a delayed cached identity from the previous viewer must be ignored"
);
const failedSwitchToB = reduce(switchingToB, {
  type: "identity_sync_failed",
  userId: "user-b",
  error: "B bootstrap failed"
});
assert.equal(failedSwitchToB.accountSynced, false);
assert.equal(failedSwitchToB.identityUserId, "user-a");
assert.equal(failedSwitchToB.pendingUserId, null);
assert.equal(
  sessionReadStateIsReady({
    state: {
      ...failedSwitchToB,
      browserReadStateHydrated: true
    },
    clerkEnabled: true,
    authLoaded: true,
    isSignedIn: true,
    userId: "user-b"
  }),
  false,
  "a failed B bootstrap must never admit A's read model"
);

const cachedB = reduce(switchingToB, {
  type: "cached_identity_committed",
  userId: "user-b"
});
assert.equal(cachedB.identityUserId, "user-b");
assert.equal(
  authenticatedIdentityTransitionIsPending({
    state: cachedB,
    isSignedIn: true,
    userId: "user-b"
  }),
  false
);
const failedCanonicalB = reduce(cachedB, {
  type: "identity_sync_failed",
  userId: "user-b",
  error: "Sync failed"
});
assert.equal(failedCanonicalB.accountSynced, true);
assert.equal(failedCanonicalB.authError, "Sync failed");
assert.equal(
  reduce(failedCanonicalB, {
    type: "identity_sync_succeeded",
    userId: "user-b"
  }),
  failedCanonicalB,
  "a completion arriving after the sync was closed must be ignored"
);
assert.equal(
  resolvePresentedEntryMode({
    accountSynced: true,
    authError: failedCanonicalB.authError,
    authLoaded: true,
    clerkEnabled: true,
    entryMode: "complete",
    initialIsSignedIn: true,
    isSignedIn: true
  }),
  "auth",
  "canonical sync failure must retain the explicit authentication error surface"
);

const hydratedReturning = reduce(returning, {
  type: "browser_read_state_hydrated"
});
assert.equal(
  sessionReadStateIsReady({
    state: hydratedReturning,
    clerkEnabled: true,
    authLoaded: true,
    isSignedIn: true,
    userId: "user-a"
  }),
  false
);
assert.equal(
  sessionReadStateIsReady({
    state: reduce(canonicalA, {
      type: "browser_read_state_hydrated"
    }),
    clerkEnabled: true,
    authLoaded: true,
    isSignedIn: true,
    userId: "user-a"
  }),
  true
);
assert.equal(
  sessionReadStateIsReady({
    state: reduce(canonicalA, {
      type: "browser_read_state_hydrated"
    }),
    clerkEnabled: true,
    authLoaded: true,
    isSignedIn: true,
    userId: "user-b"
  }),
  false
);
assert.equal(
  sessionReadStateIsReady({
    state: hydratedReturning,
    clerkEnabled: true,
    authLoaded: true,
    isSignedIn: false,
    userId: null
  }),
  true
);

const localPreview = reduce(
  createSymposiumSessionLifecycle(true),
  { type: "browser_read_state_hydrated" },
  { type: "local_preview_entered" }
);
assert.equal(localPreview.entryMode, "complete");
assert.equal(localPreview.accountSynced, true);
assert.equal(
  currentAccountIsSynced({
    state: localPreview,
    clerkEnabled: false,
    isSignedIn: false,
    userId: null
  }),
  true
);
const signedOut = reduce(canonicalA, { type: "signed_out" });
assert.equal(signedOut.entryMode, "approach");
assert.equal(signedOut.accountSynced, false);
assert.equal(signedOut.identityUserId, null);
assert.equal(signedOut.authError, "");
const externallyCleared = reduce(
  {
    ...canonicalA,
    authError: "Old authentication failure"
  },
  { type: "identity_cleared" }
);
assert.equal(
  externallyCleared.authError,
  "",
  "provider-side sign-out must retire a stale authentication error"
);

assert.equal(
  authSessionScopeKey({
    authLoaded: false,
    isSignedIn: false,
    userId: null
  }),
  "loading"
);
assert.equal(
  authSessionScopeKey({
    authLoaded: true,
    isSignedIn: false,
    userId: null
  }),
  "anonymous"
);
assert.equal(
  authSessionScopeKey({
    authLoaded: true,
    isSignedIn: true,
    userId: "user-b"
  }),
  "user-b"
);

const root = process.cwd();
const shell = readFileSync(
  path.join(root, "components/SymposiumV0.tsx"),
  "utf8"
);
const controller = readFileSync(
  path.join(root, "features/session/useSymposiumSessionController.ts"),
  "utf8"
);
const profileController = readFileSync(
  path.join(root, "features/profiles/useProfileController.ts"),
  "utf8"
);
const lifecycle = readFileSync(
  path.join(root, "features/session/symposiumSessionLifecycle.ts"),
  "utf8"
);

assert.match(shell, /useSymposiumSessionController\(\{/);
assert.match(shell, /readsEnabled: sessionController\.readsEnabled/);
assert.match(
  shell,
  /authSessionKey: sessionController\.authSessionKey/
);
assert.doesNotMatch(
  shell,
  /useBrowserSessionEntrance|entryModeForBrowserSession|resolvePresentedEntryMode/
);
assert.doesNotMatch(
  shell,
  /setSignedIn|setSyncedClerkUserId|entryAuthStateRef|entranceStartedAtRef/
);
assert.doesNotMatch(
  shell,
  /symposium-auth-handle|symposium-auth-records|symposium-entry-complete/
);
assert.match(controller, /useReducer\(\s+reduceSymposiumSessionLifecycle/);
assert.match(controller, /activeSyncControllerRef\.current\?\.abort\(\)/);
assert.match(controller, /latest\.userId === userId/);
assert.match(controller, /clearCachedBootstrap\(window\.localStorage\)/);
assert.match(
  controller,
  /try \{\s+await auth\.signOut\(\);\s+\} catch \{\s+onStatus\("Sign out failed"\);\s+return;/
);
assert.doesNotMatch(controller, /auth\.signOut\(\)\.catch\(\(\) => undefined\)/);
assert.match(
  controller,
  /bootstrapCacheScopeKey:\s+!clerkEnabled\s+\? localPreviewBootstrapScopeKey/
);
assert.match(
  controller,
  /identity\.syncAuthenticatedAccount\(userId, \{\s+signal: controller\.signal,\s+shouldCommit/
);
assert.match(
  controller,
  /identity\.refreshData\(syncedProfile\.handle, \{\s+signal: controller\.signal,\s+shouldCommit/
);
assert.match(
  controller,
  /if \(cachedIdentity && !crossUserTransition\) \{\s+dispatch\(\{ type: "cached_identity_committed", userId \}\);/
);
assert.ok(
  controller.indexOf("if (crossUserTransition) {") <
    controller.indexOf('dispatch({ type: "identity_sync_succeeded", userId });'),
  "cross-user bootstrap refresh must complete before the new viewer is admitted"
);
assert.match(
  profileController,
  /if \(request\?\.shouldCommit && !request\.shouldCommit\(\)\) return null;/
);
assert.match(profileController, /signal: request\?\.signal/);
assert.match(
  profileController,
  /const scheduleLiveRefresh = useCoalescedRefresh\(\(\) => \{\s+if \(!inputRef\.current\.readsEnabled\) return \[\];/
);
assert.match(
  lifecycle,
  /if \(identityTransitionPending\) return "loading";/
);
assert.match(
  shell,
  /enabled:\s+sessionController\.readsEnabled &&\s+\(tabletOpen \|\| assistantOpen\)/
);
assert.match(
  shell,
  /cacheScopeKey: sessionController\.bootstrapCacheScopeKey/
);

reportCheck([
  "single typed authentication and entrance lifecycle authority",
  "pure reducer-governed session transitions",
  "first and returning browser-session decisions",
  "approach timeout authentication admission",
    "exact-user cached identity commitment",
    "exact-user bootstrap cache admission",
    "cross-user presentation isolation",
  "stale identity completion rejection",
  "abortable authenticated sync and bootstrap refresh",
  "viewer-scoped read admission",
  "live-event authentication scope projection",
    "local preview admission",
    "provider-confirmed sign-out retirement",
    "sign-out cleanup and entrance replay",
  "shell authentication-policy retirement"
]);
