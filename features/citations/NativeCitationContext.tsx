"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { BookOpen, X } from "lucide-react";
import {
  documentCitationMarkerText,
  type DocumentCitationLocatorContract,
  type DocumentNativeCitationContract,
  type DocumentSourceSnapshotContract
} from "@/packages/contracts/src";

type NativeCitationContextValue = {
  pendingCitation: DocumentNativeCitationContract | null;
  stageCitation: (
    source: DocumentSourceSnapshotContract,
    excerpt: string,
    locator: DocumentCitationLocatorContract
  ) => DocumentNativeCitationContract | null;
  stageRecord: (citation: DocumentNativeCitationContract) => void;
  consumeCitation: (citationId: string) => void;
  dismissCitation: () => void;
};

const noopContext: NativeCitationContextValue = {
  pendingCitation: null,
  stageCitation: () => null,
  stageRecord: () => undefined,
  consumeCitation: () => undefined,
  dismissCitation: () => undefined
};

const NativeCitationContext = createContext<NativeCitationContextValue | null>(null);

const citationId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-000000000000";
};

export const nativeCitationMarkerRun = (citation: DocumentNativeCitationContract) => ({
  text: documentCitationMarkerText,
  citation
});

export const useNativeCitation = () => useContext(NativeCitationContext) ?? noopContext;

export function NativeCitationProvider({ children }: { children: ReactNode }) {
  const [pendingCitation, setPendingCitation] = useState<DocumentNativeCitationContract | null>(null);

  const stageCitation = useCallback((
    source: DocumentSourceSnapshotContract,
    excerpt: string,
    locator: DocumentCitationLocatorContract
  ) => {
    const normalized = excerpt.replace(/\s+/g, " ").trim().slice(0, 4000);
    if (!normalized) return null;
    const citation: DocumentNativeCitationContract = {
      id: citationId(),
      source,
      locator,
      excerpt: normalized
    };
    setPendingCitation(citation);
    return citation;
  }, []);

  const stageRecord = useCallback((citation: DocumentNativeCitationContract) => {
    setPendingCitation(citation);
  }, []);

  const consumeCitation = useCallback((citationIdToConsume: string) => {
    setPendingCitation((current) => current?.id === citationIdToConsume ? null : current);
  }, []);

  const dismissCitation = useCallback(() => setPendingCitation(null), []);

  const value = useMemo<NativeCitationContextValue>(() => ({
    pendingCitation,
    stageCitation,
    stageRecord,
    consumeCitation,
    dismissCitation
  }), [consumeCitation, dismissCitation, pendingCitation, stageCitation, stageRecord]);

  return (
    <NativeCitationContext.Provider value={value}>
      {children}
      {pendingCitation ? (
        <aside className="native-citation-capture-toast" aria-label="Citation ready to insert">
          <BookOpen size={16} aria-hidden="true" />
          <span>
            <strong>Citation ready</strong>
            <small>{pendingCitation.source.title ?? pendingCitation.source.author ?? "Selected Symposium source"}</small>
          </span>
          <button type="button" title="Dismiss citation" aria-label="Dismiss citation" onClick={dismissCitation}>
            <X size={15} />
          </button>
        </aside>
      ) : null}
    </NativeCitationContext.Provider>
  );
}
