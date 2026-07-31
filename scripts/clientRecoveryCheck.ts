import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  createBrowserRecoveryCoordinator,
  type BrowserRecoveryEnvironment
} from "@/features/recovery/browserRecoveryCoordinator";
import {
  symposiumRecoveryCanAttempt,
  symposiumRecoveryPhase,
  symposiumRecoveryRetryDelayMs
} from "@/features/recovery/symposiumRecoveryModel";
import { reportCheck } from "@/scripts/checkReport";

type WindowRecoveryEvent =
  | "blur"
  | "focus"
  | "offline"
  | "online"
  | "pageshow";

const main = async () => {
  let focused = true;
  let online = true;
  let visible = true;
  const documentListeners = new Set<EventListener>();
  const windowListeners = new Map<
    WindowRecoveryEvent,
    Set<EventListener>
  >();
  const listenersFor = (type: WindowRecoveryEvent) => {
    const existing = windowListeners.get(type);
    if (existing) return existing;
    const listeners = new Set<EventListener>();
    windowListeners.set(type, listeners);
    return listeners;
  };
  const environment: BrowserRecoveryEnvironment = {
    addDocumentListener: (_type, listener) => {
      documentListeners.add(listener);
    },
    addWindowListener: (type, listener) => {
      listenersFor(type).add(listener);
    },
    focused: () => focused,
    online: () => online,
    removeDocumentListener: (_type, listener) => {
      documentListeners.delete(listener);
    },
    removeWindowListener: (type, listener) => {
      listenersFor(type).delete(listener);
    },
    visible: () => visible
  };
  const coordinator = createBrowserRecoveryCoordinator(environment);
  const observed: Array<{
    interruptionEpoch: number;
    resumeEpoch: number;
  }> = [];
  const unsubscribe = coordinator.subscribe((state) => {
    observed.push({
      interruptionEpoch: state.interruptionEpoch,
      resumeEpoch: state.resumeEpoch
    });
  });
  const unsubscribeSecond = coordinator.subscribe(() => undefined);
  assert.equal(documentListeners.size, 1);
  for (const type of [
    "blur",
    "focus",
    "offline",
    "online",
    "pageshow"
  ] as const) {
    assert.equal(listenersFor(type).size, 1, type);
  }
  const emitWindow = (type: WindowRecoveryEvent) => {
    for (const listener of listenersFor(type)) {
      listener(new Event(type));
    }
  };
  const emitVisibility = () => {
    for (const listener of documentListeners) {
      listener(new Event("visibilitychange"));
    }
  };

  online = false;
  emitWindow("offline");
  assert.equal(symposiumRecoveryPhase(coordinator.getSnapshot()), "offline");
  assert.equal(symposiumRecoveryCanAttempt(coordinator.getSnapshot()), false);
  assert.equal(coordinator.canAttempt(), false);
  const offlineNotifications = observed.length;
  emitWindow("offline");
  assert.equal(
    observed.length,
    offlineNotifications,
    "duplicate interruptions must not create retry storms"
  );

  visible = false;
  emitVisibility();
  online = true;
  emitWindow("online");
  assert.equal(coordinator.getSnapshot().resumeEpoch, 0);
  assert.equal(symposiumRecoveryPhase(coordinator.getSnapshot()), "suspended");
  visible = true;
  emitVisibility();
  assert.equal(coordinator.getSnapshot().resumeEpoch, 1);
  assert.equal(coordinator.getSnapshot().lastCause, "visible");
  assert.equal(coordinator.canAttempt(), true);

  coordinator.reportTransportFailure();
  assert.equal(symposiumRecoveryPhase(coordinator.getSnapshot()), "recovering");
  const transportFailureNotifications = observed.length;
  coordinator.reportTransportFailure();
  assert.equal(observed.length, transportFailureNotifications);
  coordinator.reportTransportSuccess();
  assert.equal(symposiumRecoveryPhase(coordinator.getSnapshot()), "active");
  assert.equal(coordinator.getSnapshot().resumeEpoch, 2);
  assert.equal(coordinator.getSnapshot().lastCause, "transport");

  focused = false;
  emitWindow("blur");
  focused = true;
  emitWindow("focus");
  assert.equal(coordinator.getSnapshot().resumeEpoch, 3);
  assert.equal(coordinator.getSnapshot().lastCause, "focus");
  emitWindow("pageshow");
  assert.equal(coordinator.getSnapshot().resumeEpoch, 4);
  assert.equal(coordinator.getSnapshot().lastCause, "pageshow");

  assert.equal(symposiumRecoveryRetryDelayMs(0), 1_000);
  assert.equal(symposiumRecoveryRetryDelayMs(4), 16_000);
  assert.equal(symposiumRecoveryRetryDelayMs(99), 30_000);
  assert.equal(
    symposiumRecoveryRetryDelayMs(2, { baseMs: 2_000, maximumMs: 5_000 }),
    5_000
  );

  unsubscribe();
  assert.equal(
    documentListeners.size,
    1,
    "one remaining subscriber must retain the single observation authority"
  );
  unsubscribeSecond();
  assert.equal(documentListeners.size, 0);
  for (const type of [
    "blur",
    "focus",
    "offline",
    "online",
    "pageshow"
  ] as const) {
    assert.equal(listenersFor(type).size, 0, type);
  }

  const root = process.cwd();
  const sourcePaths: string[] = [];
  const collect = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(absolute);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) sourcePaths.push(absolute);
    }
  };
  await collect(path.join(root, "features"));
  sourcePaths.push(path.join(root, "components/SymposiumV0.tsx"));
  const directRecoveryListener = /addEventListener\(\s*["'](?:focus|online|offline|visibilitychange)["']/;
  for (const sourcePath of sourcePaths) {
    const source = await readFile(sourcePath, "utf8");
    assert.doesNotMatch(
      source,
      directRecoveryListener,
      `${path.relative(root, sourcePath)} installs a competing browser recovery listener`
    );
  }

  const [
    apiClient,
    liveStream,
    sessionController,
    shell,
    recoveryHook,
    notifications,
    messagesUnread,
    messages,
    assistant,
    analytics,
    scribble
  ] = await Promise.all([
    readFile(path.join(root, "features/api/symposiumApiClient.ts"), "utf8"),
    readFile(path.join(root, "features/live-sync/useLiveEventStream.ts"), "utf8"),
    readFile(path.join(root, "features/session/useSymposiumSessionController.ts"), "utf8"),
    readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8"),
    readFile(path.join(root, "features/recovery/useSymposiumRecovery.ts"), "utf8"),
    readFile(path.join(root, "features/notifications/NotificationsPanel.tsx"), "utf8"),
    readFile(path.join(root, "features/messages/MessagesUnreadButton.tsx"), "utf8"),
    readFile(path.join(root, "features/messages/MessagesSection.tsx"), "utf8"),
    readFile(path.join(root, "features/assistant/useAssistantController.ts"), "utf8"),
    readFile(path.join(root, "features/analytics/ContentAnalyticsDialog.tsx"), "utf8"),
    readFile(path.join(root, "features/scribble/ScribbleContext.tsx"), "utf8")
  ]);
  assert.match(apiClient, /accessTokenRequired/);
  assert.match(apiClient, /Authentication is temporarily unavailable/);
  assert.match(apiClient, /onRecoverableFailure/);
  assert.match(apiClient, /onTransportSuccess/);
  assert.match(liveStream, /browserRecoveryCoordinator\.subscribe/);
  assert.match(liveStream, /Live authentication token unavailable/);
  assert.match(sessionController, /symposiumRecoveryRetryDelayMs\(attempt\)/);
  assert.match(sessionController, /recovery\.resumeEpoch/);
  assert.match(shell, /accessTokenRequired: clerkEnabled && auth\.isSignedIn/);
  assert.match(recoveryHook, /useSyncExternalStore/);
  for (const [label, source] of [
    ["notifications", notifications],
    ["message unread", messagesUnread],
    ["messages", messages],
    ["assistant", assistant],
    ["analytics", analytics],
    ["scribble", scribble]
  ] as const) {
    assert.match(
      source,
      /useSymposiumRecoveryRefresh/,
      `${label} must consume the shared recovery epoch`
    );
  }
  for (const [label, source] of [
    ["notifications", notifications],
    ["message unread", messagesUnread],
    ["messages", messages],
    ["analytics", analytics],
    ["scribble", scribble]
  ] as const) {
    assert.match(
      source,
      /browserRecoveryCoordinator\.canAttempt\(\)/,
      `${label} retry work must suspend while the browser cannot attempt recovery`
    );
  }

  reportCheck([
    "single browser recovery event authority",
    "server-stable browser observation",
    "offline interruption deduplication",
    "hidden-tab suspension without premature retry",
    "visible and online recovery epochs",
    "transport degradation and recovery",
    "focus and page-restore recovery",
    "bounded shared exponential backoff",
    "one listener set across multiple consumers",
    "listener teardown without leaks",
    "domain retry suspension while hidden or offline",
    "fail-closed authenticated API recovery",
    "fail-closed authenticated live recovery",
    "session bootstrap recovery",
    "shared notification, messaging, Assistant, analytics, and Scribble recovery"
  ]);
};

void main();
