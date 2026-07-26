"use client";

import { BookOpen, ExternalLink } from "lucide-react";
import type { AssistantMessageView } from "@/features/assistant/assistantControllerModel";
import { assistantClaimKindLabel } from "@/features/assistant/assistantPresentation";
import { useNativeCitation } from "@/features/citations/NativeCitationContext";
import { nativeSourceForAssistantCitation } from "@/features/assistant/nativeCitationSource";

export function AssistantEvidenceMap({
  message
}: {
  message: Pick<AssistantMessageView, "id" | "evidence" | "claims">;
}) {
  const nativeCitation = useNativeCitation();

  if (!message.evidence?.length) return null;

  return (
    <details className="tablet-message-evidence">
      <summary>
        <BookOpen size={12} />
        Evidence map
        <small>
          {message.claims?.length ?? 0} claim
          {message.claims?.length === 1 ? "" : "s"} ·{" "}
          {message.evidence.length} source
          {message.evidence.length === 1 ? "" : "s"}
        </small>
      </summary>
      <div className="tablet-message-evidence-body">
        <div
          className="tablet-message-evidence-sources"
          aria-label="Sources used for this answer"
        >
          {message.evidence.map((source) => (
            <a
              className={source.active ? "active" : ""}
              href={source.route || "/"}
              key={source.sourceId}
              rel="noreferrer"
              target="_blank"
            >
              <span>
                {source.active ? "Active · " : ""}
                {source.title} · saved v{source.revision}
              </span>
              <small>
                {source.revisionStatus === "changed"
                  ? `Source changed since capture${
                      source.currentEntityRevision
                        ? ` · now r${source.currentEntityRevision}`
                        : ""
                    }`
                  : source.accessStatus === "verified"
                    ? "Access verified for this answer"
                    : "Saved source snapshot"}
              </small>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
          ))}
        </div>
        {message.claims?.length ? (
          <ol
            className="tablet-message-evidence-claims"
            aria-label="Claim-level evidence"
          >
            {message.claims.map((claim, claimIndex) => (
              <li
                className={`claim-${claim.kind}`}
                key={`${message.id}:claim:${claimIndex}`}
              >
                <div className="tablet-message-evidence-claim-heading">
                  <strong>{assistantClaimKindLabel[claim.kind]}</strong>
                  <span>{claim.claim}</span>
                </div>
                {claim.citations.length ? (
                  <div className="tablet-message-evidence-citations">
                    {claim.citations.map((citation) => {
                      const nativeSource =
                        nativeSourceForAssistantCitation(citation);
                      return (
                        <div
                          className="tablet-message-evidence-citation"
                          key={`${claimIndex}:${citation.ref}`}
                        >
                          <a
                            href={citation.route || "/"}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <span>
                              <b>{citation.ref}</b>
                              {citation.label}
                              <ExternalLink
                                size={10}
                                aria-hidden="true"
                              />
                            </span>
                            <q>{citation.excerpt}</q>
                          </a>
                          {nativeSource ? (
                            <button
                              type="button"
                              title="Stage this evidence as a native citation"
                              onClick={() =>
                                nativeCitation.stageCitation(
                                  nativeSource,
                                  citation.excerpt,
                                  { kind: "text" }
                                )
                              }
                            >
                              <BookOpen size={12} />
                              Cite
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <small className="tablet-message-evidence-missing">
                    No supplied passage resolves this point.
                  </small>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="tablet-message-evidence-empty">
            This saved answer predates passage-level citations. Its source
            set is preserved above.
          </p>
        )}
      </div>
    </details>
  );
}
