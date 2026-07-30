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
  consumeCitation: (citationId: string) => void;
  dismissCitation: () => void;
};

const noopContext: NativeCitationContextValue = {
  pendingCitation: null,
  stageCitation: () => null,
  consumeCitation: () => undefined,
  dismissCitation: () => undefined
};

const NativeCitationContext = createContext<NativeCitationContextValue | null>(null);

let fallbackCitationSequence = 0;

const citationId = () => {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  fallbackCitationSequence += 1;
  const entropy = `${Date.now().toString(16)}${fallbackCitationSequence.toString(16).padStart(8, "0")}${Math.random().toString(16).slice(2)}`
    .padEnd(32, "0")
    .slice(0, 32);
  return `${entropy.slice(0, 8)}-${entropy.slice(8, 12)}-4${entropy.slice(13, 16)}-8${entropy.slice(17, 20)}-${entropy.slice(20)}`;
};

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

  const consumeCitation = useCallback((citationIdToConsume: string) => {
    setPendingCitation((current) => current?.id === citationIdToConsume ? null : current);
  }, []);

  const dismissCitation = useCallback(() => setPendingCitation(null), []);

  const value = useMemo<NativeCitationContextValue>(() => ({
    pendingCitation,
    stageCitation,
    consumeCitation,
    dismissCitation
  }), [consumeCitation, dismissCitation, pendingCitation, stageCitation]);

  return (
    <NativeCitationContext.Provider value={value}>
      {children}
      {pendingCitation ? (
        <aside
          className="native-citation-capture-toast"
          aria-label="Citation ready to insert"
          aria-live="polite"
          role="status"
        >
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
