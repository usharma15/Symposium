import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { reportCheck } from "@/scripts/checkReport";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const ignoredDirectories = new Set([".git", ".next", "node_modules"]);

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (ignoredDirectories.has(entry.name)) return [];
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(fullPath);
      return sourceExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
    })
  );
  return nested.flat();
};

const root = process.cwd();
const relative = (file: string) => path.relative(root, file).replaceAll(path.sep, "/");
const imports = async (file: string) => {
  const source = await readFile(file, "utf8");
  return [...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)].map((match) => match[2]);
};

const apiRouteBaseline = "10fdc8fd2952a61ad3b47a86988926c8825c74b6";
const routeSignature = (source: string) => {
  const methods = [...source.matchAll(
    /export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g
  )].map((match) => match[1]).sort();
  const config = (name: string) =>
    source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*["']([^"']+)["']`))?.[1] ?? "";
  return `${methods.join(",")}|runtime=${config("runtime")}|dynamic=${config("dynamic")}`;
};

const main = async () => {
  const files = await sourceFiles(root);
  const fileNames = new Set(files.map(relative));
  const apiRoutes = files
    .map((file) => ({ file, name: relative(file) }))
    .filter(({ name }) => name.startsWith("app/api/") && name.endsWith("/route.ts"));
  let routeMethodCount = 0;
  for (const { file, name } of apiRoutes) {
    const signature = routeSignature(await readFile(file, "utf8"));
    assert.equal(
      signature,
      routeSignature(execFileSync("git", ["show", `${apiRouteBaseline}:${name}`], { encoding: "utf8" })),
      `${name} changed its public method, runtime, or dynamic contract.`
    );
    routeMethodCount += signature.split("|")[0]?.split(",").filter(Boolean).length ?? 0;
  }
  assert.equal(apiRoutes.length, 85);
  assert.equal(routeMethodCount, 116);
  const symposiumImporters: string[] = [];
  const featureGraph = new Map<string, string[]>();
  for (const file of files) {
    const fileName = relative(file);
    const fileImports = await imports(file);

    if (fileImports.some((specifier) => specifier.includes("components/SymposiumV0"))) {
      symposiumImporters.push(fileName);
    }

    if (fileName.startsWith("apps/api/src/")) {
      assert.equal(
        fileImports.some((specifier) => specifier.includes("components/") || specifier.includes("app/api/")),
        false,
        `${fileName} must not depend on frontend components or Next bridge routes.`
      );
    }

    if (fileName.startsWith("features/")) {
      assert.equal(
        fileImports.some((specifier) => specifier.includes("components/SymposiumV0") || specifier.includes("app/")),
        false,
        `${fileName} must not depend on the legacy application shell.`
      );
      featureGraph.set(
        fileName,
        fileImports.flatMap((specifier) => {
          if (!specifier.startsWith("@/features/")) return [];
          const base = specifier.replace("@/", "");
          return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].filter((candidate) =>
            fileNames.has(candidate)
          );
        })
      );
    }
  }

  assert.deepEqual(symposiumImporters.sort(), ["app/SymposiumPage.tsx"]);
  const symposiumSource = await readFile(path.join(root, "components/SymposiumV0.tsx"), "utf8");
  const inquiryControllerSource = await readFile(
    path.join(root, "features/inquiry/useInquiryController.ts"),
    "utf8"
  );
  const profileControllerSource = await readFile(
    path.join(root, "features/profiles/useProfileController.ts"),
    "utf8"
  );
  const profileActivityControllerSource = await readFile(
    path.join(root, "features/profiles/useProfileActivityController.ts"),
    "utf8"
  );
  const discoveryControllerSource = await readFile(
    path.join(root, "features/discovery/useDiscoveryController.ts"),
    "utf8"
  );
  const discoveryModelSource = await readFile(
    path.join(root, "features/discovery/discoveryModel.ts"),
    "utf8"
  );
  const liveControllerSource = await readFile(
    path.join(root, "features/live-sync/useSymposiumLiveController.ts"),
    "utf8"
  );
  const liveRouterSource = await readFile(
    path.join(root, "features/live-sync/symposiumLiveEventRouter.ts"),
    "utf8"
  );
  const sessionControllerSource = await readFile(
    path.join(root, "features/session/useSymposiumSessionController.ts"),
    "utf8"
  );
  const sessionLifecycleSource = await readFile(
    path.join(root, "features/session/symposiumSessionLifecycle.ts"),
    "utf8"
  );
  const recoveryCoordinatorSource = await readFile(
    path.join(root, "features/recovery/browserRecoveryCoordinator.ts"),
    "utf8"
  );
  const recoveryModelSource = await readFile(
    path.join(root, "features/recovery/symposiumRecoveryModel.ts"),
    "utf8"
  );
  const surfaceControllerSource = await readFile(
    path.join(root, "features/shell/useSymposiumSurfaceController.ts"),
    "utf8"
  );
  const surfaceStateSource = await readFile(
    path.join(root, "features/shell/symposiumSurfaceState.ts"),
    "utf8"
  );
  const communityStateSource = await readFile(
    path.join(root, "features/communities/useCommunityState.ts"),
    "utf8"
  );
  const cachedBootstrapSource = await readFile(
    path.join(root, "features/bootstrap/cachedBootstrap.ts"),
    "utf8"
  );
  const crossTabTransportSource = await readFile(
    path.join(root, "features/live-sync/useCrossTabItemTransport.ts"),
    "utf8"
  );
  assert.match(
    symposiumSource,
    /useSymposiumViewController/,
    "Symposium view state must remain owned by the navigation controller."
  );
  assert.doesNotMatch(
    symposiumSource,
    /const \[(?:activeRoom|selectedItemId|selectedProfileName|messagesOpen|assistantOpen),/,
    "Legacy independent view state must not return to SymposiumV0.tsx."
  );
  assert.doesNotMatch(
    symposiumSource,
    /new\s+(?:EventSource|BroadcastChannel)\s*\(/,
    "Browser live and cross-tab transport must remain outside SymposiumV0.tsx."
  );
  assert.equal(
    symposiumSource.match(/useSymposiumSurfaceController\(/g)?.length ?? 0,
    1,
    "Symposium transient surfaces must have one controller authority."
  );
  assert.match(
    surfaceControllerSource,
    /useReducer\(\s*symposiumSurfaceReducer/,
    "The surface controller must delegate transition policy to its pure reducer."
  );
  assert.match(
    surfaceStateSource,
    /const closeNavigationSurfaces/,
    "Navigation surface cleanup must remain owned by the surface model."
  );
  assert.doesNotMatch(
    symposiumSource,
    /const \[(?:tabletOpen|composerOpen|quoteSelection|settingsOpen|messagesQuickOpen|quickConversationId|editingPost|editingComment|attachmentPreview),/,
    "Independent transient-surface state must not return to SymposiumV0.tsx."
  );
  assert.doesNotMatch(
    communityStateSource,
    /composerCommunityId|setComposerCommunityId/,
    "Composer lifecycle and destination must not return to community domain state."
  );
  assert.doesNotMatch(
    symposiumSource,
    /fetch\(\s*["'`]\/api\//,
    "Same-origin API request semantics must remain owned by features/api."
  );
  assert.match(
    symposiumSource,
    /useInquiryController/,
    "Symposium inquiry state must remain owned by the inquiry controller."
  );
  assert.equal(
    symposiumSource.match(/useProfileController\(\{/g)?.length ?? 0,
    1,
    "Symposium profile and social state must have one controller authority."
  );
  for (const retiredShellAuthority of [
    /\/api\/posts(?:[/?`"]|\$\{)/,
    /itemMutationCoordinatorRef/,
    /createInquiryActionReconciler/,
    /persistLocalSnapshot/,
    /publishCrossTabItem/,
    /recordPassiveView/
  ]) {
    assert.doesNotMatch(
      symposiumSource,
      retiredShellAuthority,
      `Retired inquiry authority returned to SymposiumV0.tsx: ${retiredShellAuthority}.`
    );
  }
  for (const controllerAuthority of [
    "useInquiryEntityStore",
    "createItemMutationCoordinator",
    "createInquiryActionReconciler",
    "useCrossTabItemTransport",
    "persistCachedBootstrap",
    "recordPassiveView",
    "createContentDeletionController"
  ]) {
    assert.ok(
      inquiryControllerSource.includes(controllerAuthority),
      `${controllerAuthority} must remain composed by the inquiry controller.`
    );
  }
  for (const retiredProfileShellAuthority of [
    /\/api\/bootstrap/,
    /\/api\/auth\/sync/,
    /\/api\/follows/,
    /\/api\/profiles/,
    /profileMutationCoordinatorRef/,
    /followMutationCoordinatorRef/,
    /profileActivityByHandle/,
    /setFollowingHandles/,
    /setSocialLists/,
    /persistCachedProfileSocial/,
    /readCachedProfileSocial/
  ]) {
    assert.doesNotMatch(
      symposiumSource,
      retiredProfileShellAuthority,
      `Retired profile authority returned to SymposiumV0.tsx: ${retiredProfileShellAuthority}.`
    );
  }
  assert.equal(
    symposiumSource.match(/symposiumApi\.request</g)?.length ?? 0,
    0,
    "The shell must not own direct feature requests after C4."
  );
  assert.equal(
    symposiumSource.match(/useDiscoveryController\(\{/g)?.length ?? 0,
    1,
    "Symposium discovery state must have one controller authority."
  );
  assert.equal(
    symposiumSource.match(/useSymposiumLiveController\(\{/g)?.length ?? 0,
    1,
    "Symposium global live-event routing must have one controller authority."
  );
  assert.equal(
    symposiumSource.match(/useSymposiumSessionController\(\{/g)?.length ?? 0,
    1,
    "Symposium authentication and entrance lifecycle must have one controller authority."
  );
  for (const retiredDiscoveryShellAuthority of [
    /\/api\/search/,
    /setRemoteSearchResults/,
    /setCommunitySearchResultIds/,
    /localSearchResults/,
    /SearchResponseContract/
  ]) {
    assert.doesNotMatch(
      symposiumSource,
      retiredDiscoveryShellAuthority,
      `Retired discovery authority returned to SymposiumV0.tsx: ${retiredDiscoveryShellAuthority}.`
    );
  }
  for (const profileAuthority of [
    "createItemMutationCoordinator",
    "createFollowMutationCoordinator",
    "useCrossTabItemTransport",
    "persistCachedProfileSocial",
    "readCachedProfileSocial",
    '"/api/profiles"',
    '"/api/auth/sync"',
    "`/api/bootstrap?",
    "`/api/follows?",
    "`/api/profiles/${encodeURIComponent(normalizedHandle)}/follows`",
    "`/api/profiles/${encodeURIComponent(normalizedTarget)}/follow`"
  ]) {
    assert.ok(
      profileControllerSource.includes(profileAuthority),
      `${profileAuthority} must remain owned by the profile controller.`
    );
  }
  for (const activityAuthority of [
    "persistCachedProfileActivity",
    "readCachedProfileActivity",
    "const requestKey = `${clean}:${scope}`",
    "`/api/profiles/${encodeURIComponent(clean)}/activity?"
  ]) {
    assert.ok(
      profileActivityControllerSource.includes(activityAuthority),
      `${activityAuthority} must remain owned by the profile activity controller.`
    );
  }
  for (const discoveryAuthority of [
    "localDiscoverySearch",
    "remoteDiscoverySearch",
    "reprojectDiscoveryProfiles",
    "new AbortController()",
    "abortController.abort()",
    'limit: "16"',
    'limit: "50"',
    "inputRef.current.mergeBoundedRead",
    "`/api/search?${parameters.toString()}`"
  ]) {
    assert.ok(
      discoveryControllerSource.includes(discoveryAuthority),
      `${discoveryAuthority} must remain owned by the discovery controller.`
    );
  }
  for (const discoveryPolicy of [
    "communityPostIsExternallyDiscoverable",
    "searchableContentText",
    "itemTimestampScore",
    "reprojectDiscoveryProfiles"
  ]) {
    assert.ok(
      discoveryModelSource.includes(discoveryPolicy),
      `${discoveryPolicy} must remain owned by the discovery model.`
    );
  }
  for (const retiredLiveShellAuthority of [
    /useLiveEventStream/,
    /useCrossTabItemTransport/,
    /setMessagingEvents/,
    /setNotificationEvents/,
    /setAssistantEvents/,
    /event\.kind\.startsWith\("(?:notification|assistant|message|conversation|post|comment|profile|community|note|scribble)\./
  ]) {
    assert.doesNotMatch(
      symposiumSource,
      retiredLiveShellAuthority,
      `Retired live-event routing authority returned to SymposiumV0.tsx: ${retiredLiveShellAuthority}.`
    );
  }
  for (const liveControllerAuthority of [
    "useLiveEventStream<SymposiumLiveEvent>",
    "useCrossTabItemTransport<ContentAnalyticsInvalidation>",
    "contentAnalyticsInvalidationFromLiveEvent",
    "routeSymposiumLiveEvent",
    "appendScopedLiveEvent(current, authSessionKey, incoming, 1000)",
    "scopedLiveEvents(messagingBuffer, authSessionKey)",
    "eventScopeKey !== transportScopeKey"
  ]) {
    assert.ok(
      liveControllerSource.includes(liveControllerAuthority),
      `${liveControllerAuthority} must remain owned by the global live controller.`
    );
  }
  for (const liveRouterAuthority of [
    "ports.acceptLiveActionProjection",
    "ports.invalidateQuotedSource",
    "ports.mergeLiveMetricPatch",
    "ports.mergeLiveFollow",
    "appendScopedLiveEvent",
    "resetScopedLiveEventBuffer",
    "ports.dispatchWorkspaceChange",
    "ports.dispatchScribbleChange",
    "ports.dispatchOpportunityApplicationsChange"
  ]) {
    assert.ok(
      liveRouterSource.includes(liveRouterAuthority),
      `${liveRouterAuthority} must remain owned by the global live-event router.`
    );
  }
  for (const retiredSessionShellAuthority of [
    /useBrowserSessionEntrance/,
    /entryModeForBrowserSession/,
    /resolvePresentedEntryMode/,
    /setSignedIn/,
    /setSyncedClerkUserId/,
    /entryAuthStateRef/,
    /entranceStartedAtRef/,
    /symposium-auth-handle/,
    /symposium-auth-records/,
    /symposium-entry-complete/
  ]) {
    assert.doesNotMatch(
      symposiumSource,
      retiredSessionShellAuthority,
      `Retired session authority returned to SymposiumV0.tsx: ${retiredSessionShellAuthority}.`
    );
  }
  for (const sessionControllerAuthority of [
    "useReducer(",
    "reduceSymposiumSessionLifecycle",
    "useBrowserSessionEntrance",
    "activeSyncControllerRef.current?.abort()",
    "latest.userId === userId",
    "identity.syncAuthenticatedAccount(userId",
    "identity.refreshData(syncedProfile.handle",
    "clearCachedBootstrap(window.localStorage)",
    "bootstrapCacheScopeKey:",
    "resolvePresentedEntryMode",
    "authSessionScopeKey",
    "sessionDataAccessIsEnabled",
    "sessionReadStateIsReady"
  ]) {
    assert.ok(
      sessionControllerSource.includes(sessionControllerAuthority),
      `${sessionControllerAuthority} must remain owned by the session controller.`
    );
  }
  for (const sessionLifecycleAuthority of [
    "reduceSymposiumSessionLifecycle",
    "authenticatedIdentityTransitionIsPending",
    "currentAccountIsSynced",
    "resolveApproachElapsedMode",
    'if (identityTransitionPending) return "loading";'
  ]) {
    assert.ok(
      sessionLifecycleSource.includes(sessionLifecycleAuthority),
      `${sessionLifecycleAuthority} must remain owned by the session lifecycle model.`
    );
  }
  for (const recoveryAuthority of [
    "createBrowserRecoveryCoordinator",
    "reportTransportFailure",
    "reportTransportSuccess",
    "visibilitychange",
    "pageshow"
  ]) {
    assert.ok(
      recoveryCoordinatorSource.includes(recoveryAuthority),
      `${recoveryAuthority} must remain owned by the browser recovery coordinator.`
    );
  }
  for (const recoveryPolicy of [
    "reduceSymposiumRecovery",
    "symposiumRecoveryCanAttempt",
    "symposiumRecoveryPhase",
    "symposiumRecoveryRetryDelayMs"
  ]) {
    assert.ok(
      recoveryModelSource.includes(recoveryPolicy),
      `${recoveryPolicy} must remain owned by the recovery model.`
    );
  }
  assert.match(
    symposiumSource,
    /accessTokenRequired: clerkEnabled && auth\.isSignedIn/,
    "The shell must configure authenticated requests to fail closed."
  );
  assert.match(
    profileControllerSource,
    /if \(request\?\.shouldCommit && !request\.shouldCommit\(\)\) return null;/,
    "Profile session reads must reject stale viewer commits before mutating state."
  );
  assert.match(
    cachedBootstrapSource,
    /if \(storedScopeKey !== cacheScopeKey\) return null;/,
    "Authenticated bootstrap caches must reject a different viewer scope."
  );
  assert.match(
    crossTabTransportSource,
    /scopeKey === null[\s\S]*encodeURIComponent\(scopeKey\)/,
    "Cross-tab transport must suspend unresolved identity and namespace exact viewers."
  );
  assert.match(
    inquiryControllerSource,
    /scopeKey: input\.cacheScopeKey/,
    "Inquiry cross-tab entities must remain scoped to the current viewer."
  );
  assert.match(
    profileControllerSource,
    /scopeKey: input\.cacheScopeKey/,
    "Profile cross-tab entities must remain scoped to the current viewer."
  );
  for (const infrastructureImport of [
    "features/api/symposiumApiClient",
    "features/recovery/browserRecoveryCoordinator"
  ]) {
    assert.ok(
      symposiumSource.includes(infrastructureImport),
      `${infrastructureImport} must remain the controller infrastructure boundary.`
    );
  }
  for (const extractedComponent of [
    "AttachmentPreviewModal",
    "CommentThread",
    "CommunitiesDirectoryView",
    "FeedPost",
    "MessagesStage",
    "MessagesQuickAccess",
    "ProfileView",
    "RoomView",
    "SearchModal"
  ]) {
    assert.equal(
      symposiumSource.includes(`function ${extractedComponent}(`),
      false,
      `${extractedComponent} must remain owned by its feature module.`
    );
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visitFeature = (fileName: string, pathStack: string[]) => {
    if (visited.has(fileName)) return;
    assert.equal(
      visiting.has(fileName),
      false,
      `Feature dependency cycle: ${[...pathStack, fileName].join(" -> ")}`
    );
    visiting.add(fileName);
    for (const dependency of featureGraph.get(fileName) ?? []) visitFeature(dependency, [...pathStack, fileName]);
    visiting.delete(fileName);
    visited.add(fileName);
  };
  for (const fileName of featureGraph.keys()) visitFeature(fileName, []);

  reportCheck([
    "single legacy shell entrypoint",
    "exact 85-route and 116-method API surface preservation",
    "backend to frontend dependency isolation",
    "feature module independence",
    "shell and feature dependency boundaries",
    "controller transport and API isolation",
    "single inquiry read, mutation, reconciliation, cross-tab, and persistence authority",
    "single profile, social, follow, activity, cross-tab, and persistence authority",
    "single global and community discovery authority",
    "single global live-event routing and delivery authority",
    "single authentication and entrance lifecycle authority",
    "single browser and transport recovery authority",
    "single transient-surface lifecycle authority",
    "extracted feature ownership",
    "acyclic feature dependencies"
  ]);
};

void main();
