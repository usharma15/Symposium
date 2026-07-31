"use client";

import {
  useCallback,
  useState,
  type SetStateAction
} from "react";
import type { CanonicalRoute } from "@/features/navigation/canonicalRoute";
import {
  snapshotForCanonicalRoute,
  type ViewSnapshot
} from "@/features/navigation/viewState";
import type { RoomId } from "@/lib/mockData";

type StoredViewState = Omit<ViewSnapshot, "scrollAnchor" | "scrollY">;

const storedViewState = ({
  scrollAnchor: _scrollAnchor,
  scrollY: _scrollY,
  ...state
}: ViewSnapshot): StoredViewState => state;

export const useSymposiumViewController = (
  initialRoute: CanonicalRoute,
  resolvePostRoom: (postId: string) => RoomId | undefined
) => {
  const [state, setState] = useState(() =>
    storedViewState(snapshotForCanonicalRoute(initialRoute, resolvePostRoom))
  );
  const setField = useCallback(<Key extends keyof StoredViewState>(
    key: Key,
    value: SetStateAction<StoredViewState[Key]>
  ) => {
    setState((current) => ({
      ...current,
      [key]: typeof value === "function"
        ? (value as (previous: StoredViewState[Key]) => StoredViewState[Key])(current[key])
        : value
    }));
  }, []);
  const replaceSnapshot = useCallback((snapshot: ViewSnapshot) => {
    setState(storedViewState(snapshot));
  }, []);
  const setWorkspaceView = useCallback(
    (value: SetStateAction<StoredViewState["workspaceView"]>) =>
      setField("workspaceView", value),
    [setField]
  );

  return { state, replaceSnapshot, setField, setWorkspaceView };
};
