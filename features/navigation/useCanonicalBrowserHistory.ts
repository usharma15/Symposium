"use client";

import { useEffect, useRef, useState } from "react";
import {
  canonicalRouteHref,
  parseCanonicalRoute,
  type CanonicalRoute
} from "@/features/navigation/canonicalRoute";
import { snapshotForCanonicalRoute, type ViewSnapshot } from "@/features/navigation/viewState";

const symposiumHistoryStateVersion = 1;
const persistedViewStackLimit = 50;

const isStoredViewSnapshot = (value: unknown): value is ViewSnapshot => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ViewSnapshot>;
  return typeof candidate.activeRoom === "string"
    && typeof candidate.profileTab === "string"
    && Boolean(candidate.workspaceView && typeof candidate.workspaceView === "object")
    && Boolean(candidate.commentSegmentStacks && typeof candidate.commentSegmentStacks === "object")
    && typeof candidate.scrollY === "number"
    && Number.isFinite(candidate.scrollY);
};

const storedSnapshots = (value: unknown) =>
  Array.isArray(value) ? value.filter(isStoredViewSnapshot) : [];

type HistoryOptions = {
  snapshotView: () => ViewSnapshot;
  restoreView: (snapshot: ViewSnapshot) => void;
  routeForView: (snapshot: ViewSnapshot) => CanonicalRoute;
};

export function useCanonicalBrowserHistory({ snapshotView, restoreView, routeForView }: HistoryOptions) {
  const [viewHistory, setViewHistory] = useState<ViewSnapshot[]>([]);
  const [viewFuture, setViewFuture] = useState<ViewSnapshot[]>([]);
  const viewHistoryRef = useRef<ViewSnapshot[]>([]);
  const viewFutureRef = useRef<ViewSnapshot[]>([]);
  const browserHistoryIndexRef = useRef(0);
  const browserHistoryInitializedRef = useRef(false);
  const snapshotViewRef = useRef(snapshotView);
  const restoreViewRef = useRef(restoreView);
  const routeForViewRef = useRef(routeForView);

  snapshotViewRef.current = snapshotView;
  restoreViewRef.current = restoreView;
  routeForViewRef.current = routeForView;

  const replaceHistory = (history: ViewSnapshot[]) => {
    viewHistoryRef.current = history;
    setViewHistory(history);
  };

  const replaceFuture = (future: ViewSnapshot[]) => {
    viewFutureRef.current = future;
    setViewFuture(future);
  };

  const replaceCurrentBrowserView = (
    snapshot: ViewSnapshot,
    history = viewHistoryRef.current,
    future = viewFutureRef.current
  ) => {
    const state = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
    window.history.replaceState(
      {
        ...state,
        symposiumHistoryStateVersion,
        symposiumHistoryIndex: browserHistoryIndexRef.current,
        symposiumView: snapshot,
        symposiumViewHistory: history.slice(-persistedViewStackLimit),
        symposiumViewFuture: future.slice(0, persistedViewStackLimit)
      },
      "",
      window.location.href
    );
  };

  const replaceCanonicalRoute = (route: CanonicalRoute) => {
    const state = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
    window.history.replaceState(
      { ...state, symposiumHistoryIndex: browserHistoryIndexRef.current },
      "",
      canonicalRouteHref(route)
    );
  };

  const recordNavigation = (currentSnapshot: ViewSnapshot, nextSnapshot: ViewSnapshot) => {
    const nextHistory = [...viewHistoryRef.current, currentSnapshot];
    replaceCurrentBrowserView(currentSnapshot, viewHistoryRef.current, []);
    replaceHistory(nextHistory);
    replaceFuture([]);
    browserHistoryIndexRef.current += 1;
    window.history.pushState(
      {
        symposiumHistoryStateVersion,
        symposiumHistoryIndex: browserHistoryIndexRef.current,
        symposiumView: nextSnapshot,
        symposiumViewHistory: nextHistory.slice(-persistedViewStackLimit),
        symposiumViewFuture: []
      },
      "",
      canonicalRouteHref(routeForViewRef.current(nextSnapshot))
    );
  };

  const resetHistory = () => {
    replaceHistory([]);
    replaceFuture([]);
  };

  const goBack = () => {
    if (!viewHistoryRef.current.length) {
      const hallSnapshot = snapshotForCanonicalRoute({ kind: "hall" });
      browserHistoryIndexRef.current = 0;
      window.history.replaceState(
        { symposiumHistoryIndex: 0, symposiumView: hallSnapshot },
        "",
        canonicalRouteHref({ kind: "hall" })
      );
      resetHistory();
      restoreViewRef.current(hallSnapshot);
      return;
    }
    replaceCurrentBrowserView(snapshotViewRef.current());
    window.history.back();
  };

  const goForward = () => {
    if (!viewFutureRef.current.length) return;
    replaceCurrentBrowserView(snapshotViewRef.current());
    window.history.forward();
  };

  useEffect(() => {
    if (!browserHistoryInitializedRef.current) {
      const state = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
      browserHistoryIndexRef.current =
        typeof state.symposiumHistoryIndex === "number" ? state.symposiumHistoryIndex : 0;
      browserHistoryInitializedRef.current = true;
      const storedView = state.symposiumHistoryStateVersion === symposiumHistoryStateVersion
        && isStoredViewSnapshot(state.symposiumView)
        ? state.symposiumView
        : null;
      const storedViewMatchesLocation = storedView
        ? canonicalRouteHref(routeForViewRef.current(storedView)) === canonicalRouteHref(
            parseCanonicalRoute(window.location.pathname, window.location.search)
          )
        : false;
      if (storedView && storedViewMatchesLocation) {
        replaceHistory(storedSnapshots(state.symposiumViewHistory));
        replaceFuture(storedSnapshots(state.symposiumViewFuture));
        restoreViewRef.current(storedView);
        replaceCurrentBrowserView(storedView);
      } else {
        resetHistory();
        replaceCurrentBrowserView(snapshotViewRef.current());
      }
    }

    const persistCurrentView = () => replaceCurrentBrowserView(snapshotViewRef.current());

    const handlePopState = (event: PopStateEvent) => {
      const currentSnapshot = snapshotViewRef.current();
      const state = event.state && typeof event.state === "object" ? event.state : {};
      const nextIndex =
        typeof state.symposiumHistoryIndex === "number"
          ? state.symposiumHistoryIndex
          : browserHistoryIndexRef.current - 1;
      const movingBack = nextIndex < browserHistoryIndexRef.current;
      browserHistoryIndexRef.current = nextIndex;

      if (movingBack) {
        replaceHistory(viewHistoryRef.current.slice(0, -1));
        replaceFuture([currentSnapshot, ...viewFutureRef.current]);
      } else {
        replaceHistory([...viewHistoryRef.current, currentSnapshot]);
        replaceFuture(viewFutureRef.current.slice(1));
      }

      const storedView = state.symposiumView as ViewSnapshot | undefined;
      restoreViewRef.current(
        storedView ?? snapshotForCanonicalRoute(parseCanonicalRoute(window.location.pathname, window.location.search))
      );
    };

    window.addEventListener("pagehide", persistCurrentView);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("pagehide", persistCurrentView);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return {
    canGoBack: viewHistory.length > 0,
    canGoForward: viewFuture.length > 0,
    goBack,
    goForward,
    recordNavigation,
    replaceCanonicalRoute,
    resetHistory
  };
}
