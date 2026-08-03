"use client";

import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  FileClock,
  Link2,
  Minimize2,
  RefreshCw,
  SlidersHorizontal,
  X
} from "lucide-react";
import type {
  AssistantContextConfigurationContract,
  AssistantThreadSourceContract,
  AssistantThreadStateContract
} from "@/packages/contracts/src";
import type { AssistantContext } from "@/features/assistant/assistantControllerModel";
import { assistantContextKey } from "@/lib/assistantContext";

export function AssistantContextDock({
  context,
  configuration,
  activeContext,
  thread,
  open,
  busy,
  onCollapse,
  onToggle,
  onUseCurrentView,
  onClearContext,
  onConfigurationChange,
  onContextChange,
  onSourceChange
}: {
  context: AssistantContext;
  configuration: AssistantContextConfigurationContract;
  activeContext: AssistantContext | null;
  thread: AssistantThreadStateContract | null;
  open: boolean;
  busy: boolean;
  onCollapse?: () => void;
  onToggle: () => void;
  onUseCurrentView: () => void;
  onClearContext: () => void;
  onConfigurationChange: (
    configuration: AssistantContextConfigurationContract
  ) => void;
  onContextChange: (
    mode: "use" | "attach" | "refresh" | "clear"
  ) => void;
  onSourceChange: (
    source: AssistantThreadSourceContract,
    action: "use" | "include" | "exclude"
  ) => void;
}) {
  const contextKey = assistantContextKey(context);
  const latestCurrent =
    thread?.sources.filter((source) => source.key === contextKey).at(-1) ??
    null;
  const activeSource =
    thread?.sources.find((source) => source.id === thread.activeSourceId) ??
    null;
  const currentChanged = Boolean(
    latestCurrent &&
      JSON.stringify(latestCurrent.context) !== JSON.stringify(context)
  );
  const includedCount =
    thread?.sources.filter((source) => source.included).length ?? 0;
  const orderedSources = [...(thread?.sources ?? [])].reverse();
  const updateConfiguration = (
    change: Partial<AssistantContextConfigurationContract>
  ) => onConfigurationChange({ ...configuration, ...change });

  return (
    <section
      className={`tablet-context-dock${open ? " open" : ""}`}
      aria-label="Context Dock"
    >
      <div className="tablet-context-dock-header">
        <button
          type="button"
          className="tablet-context-dock-heading"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span>
            <BookOpen size={14} />
            <strong>Context Dock</strong>
            <small>
              {thread
                ? activeContext
                  ? `${includedCount} active · ${thread.sourceRevisionCount} saved`
                  : `${thread.sourceRevisionCount} saved · none active`
                : activeContext
                  ? "Current view ready"
                  : "No context attached"}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        {onCollapse ? (
          <button
            type="button"
            className="assistant-collapse-control"
            title="Collapse to AI Tablet"
            aria-label="Collapse to AI Tablet"
            onClick={onCollapse}
          >
            <Minimize2 size={15} />
            <span>Tablet</span>
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="tablet-context-dock-body">
          <section className="tablet-context-recipe" aria-label="Chat context recipe">
            <header>
              <span><SlidersHorizontal size={13} /></span>
              <div>
                <strong>Context recipe</strong>
                <small>Choose what each answer is allowed to carry and use.</small>
              </div>
            </header>
            <fieldset disabled={busy}>
              <legend>Conversation memory</legend>
              <div className="tablet-context-options tablet-context-options-three">
                {([
                  ["focused", "Focused", "Last exchange"],
                  ["recent", "Recent", "3 exchanges"],
                  ["extended", "Extended", "6 exchanges"]
                ] as const).map(([value, label, detail]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={configuration.historyScope === value}
                    onClick={() => updateConfiguration({ historyScope: value })}
                  >
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Knowledge boundary</legend>
              <div className="tablet-context-options">
                <button
                  type="button"
                  aria-pressed={configuration.knowledgeScope === "sources_only"}
                  onClick={() => updateConfiguration({ knowledgeScope: "sources_only" })}
                >
                  <strong>Sources only</strong>
                  <small>Say when evidence is missing</small>
                </button>
                <button
                  type="button"
                  aria-pressed={configuration.knowledgeScope === "sources_and_general"}
                  onClick={() => updateConfiguration({ knowledgeScope: "sources_and_general" })}
                >
                  <strong>Sources + knowledge</strong>
                  <small>Label what comes from where</small>
                </button>
              </div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Symposium search</legend>
              <div className="tablet-context-options">
                <button
                  type="button"
                  aria-pressed={configuration.siteSearch === "when_requested"}
                  onClick={() => updateConfiguration({ siteSearch: "when_requested" })}
                >
                  <strong>When I ask</strong>
                  <small>Authorized, bounded results</small>
                </button>
                <button
                  type="button"
                  aria-pressed={configuration.siteSearch === "off"}
                  onClick={() => updateConfiguration({ siteSearch: "off" })}
                >
                  <strong>Off</strong>
                  <small>Never search this chat</small>
                </button>
              </div>
            </fieldset>
          </section>
          {!thread ? (
            <div
              className={`tablet-context-start${
                activeContext ? " attached" : ""
              }`}
            >
              <div>
                <span>
                  {activeContext ? "Starting context" : "Blank chat"}
                </span>
                <strong>
                  {activeContext?.title ?? "No context attached"}
                </strong>
                <small>
                  {activeContext
                    ? "This view will be captured when you send your first message."
                    : "Start with a question. You can attach this page whenever it becomes useful."}
                </small>
              </div>
              {activeContext ? (
                <button
                  type="button"
                  aria-label="Remove current view context"
                  title="Remove current view context"
                  disabled={busy}
                  onClick={onClearContext}
                >
                  <X size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onUseCurrentView}
                >
                  <Link2 size={13} />
                  Use current view
                </button>
              )}
            </div>
          ) : (
            <>
              <div
                className={`tablet-context-status${
                  activeSource ? " attached" : ""
                }`}
              >
                <div>
                  <span>
                    {activeSource ? "Working context" : "Plain chat"}
                  </span>
                  <strong>
                    {activeSource?.context.title ?? "No context attached"}
                  </strong>
                  <small>
                    {activeSource
                      ? "Answers can use this source and the included material below."
                      : "Answers use only this conversation and general knowledge."}
                  </small>
                </div>
                {activeSource ? (
                  <button
                    type="button"
                    aria-label="Clear active chat context"
                    title="Continue without explicit context"
                    disabled={busy}
                    onClick={onClearContext}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              <div
                className={`tablet-live-context${
                  thread.activeContextKey !== contextKey ? " changed" : ""
                }`}
              >
                <span>
                  <RefreshCw size={13} />
                  <strong>This page</strong>
                  <small>{context.title}</small>
                </span>
                <p>
                  {!latestCurrent
                    ? "This page is not saved in this chat."
                    : currentChanged
                      ? `This page changed since saved revision ${latestCurrent.revision}.`
                      : latestCurrent.id === thread.activeSourceId
                        ? `Using saved revision ${latestCurrent.revision}.`
                        : `Saved as revision ${latestCurrent.revision}, but not currently in use.`}
                </p>
                <div>
                  {!latestCurrent ? (
                    <>
                      {activeSource ? (
                        <button
                          type="button"
                          disabled={busy || includedCount >= 5}
                          onClick={() => onContextChange("attach")}
                        >
                          <Link2 size={12} />
                          Add page
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onContextChange("use")}
                      >
                        Use this page
                      </button>
                    </>
                  ) : currentChanged ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onContextChange("refresh")}
                    >
                      <FileClock size={12} />
                      Capture update
                    </button>
                  ) : latestCurrent.id !== thread.activeSourceId ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onContextChange("use")}
                    >
                      Use this page
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onContextChange("refresh")}
                    >
                      <FileClock size={12} />
                      Save new revision
                    </button>
                  )}
                </div>
              </div>
              {orderedSources.length ? (
                <div
                  className="tablet-source-list"
                  aria-label="Saved source revisions"
                >
                  {orderedSources.map((source) => {
                    const active = source.id === thread.activeSourceId;
                    const origin = source.id === thread.originSourceId;
                    const storedMetadata = Object.entries(
                      source.context.metadata
                    );
                    const sourceRoute = source.context.route.startsWith("/")
                      ? source.context.route
                      : "/";
                    return (
                      <article
                        className={`${active ? "active " : ""}${
                          source.included ? "included" : "excluded"
                        }`}
                        key={source.id}
                      >
                        <div>
                          <span>
                            {active ? <strong>Active</strong> : null}
                            {origin ? <em>Origin</em> : null}
                            {source.provenance === "recovered" ? (
                              <em>Recovered</em>
                            ) : null}
                            <small>
                              {source.context.surface} · v{source.revision}
                            </small>
                          </span>
                          <h4>{source.context.title}</h4>
                          <p>
                            {source.context.summary ||
                              source.context.route}
                          </p>
                          <div className="tablet-source-links">
                            <a
                              href={sourceRoute}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink size={11} />
                              Open source
                            </a>
                            <time dateTime={source.attachedAt}>
                              Captured{" "}
                              {new Date(
                                source.attachedAt
                              ).toLocaleString()}
                            </time>
                          </div>
                          <details className="tablet-source-inspector">
                            <summary>Inspect saved context</summary>
                            <dl>
                              <div>
                                <dt>Surface</dt>
                                <dd>{source.context.surface}</dd>
                              </div>
                              <div>
                                <dt>Route</dt>
                                <dd>{source.context.route || "/"}</dd>
                              </div>
                              {source.context.entityType ? (
                                <div>
                                  <dt>Entity type</dt>
                                  <dd>{source.context.entityType}</dd>
                                </div>
                              ) : null}
                              {source.context.entityId ? (
                                <div>
                                  <dt>Entity ID</dt>
                                  <dd>{source.context.entityId}</dd>
                                </div>
                              ) : null}
                            </dl>
                            {source.context.summary ? (
                              <section>
                                <strong>Stored summary</strong>
                                <p>{source.context.summary}</p>
                              </section>
                            ) : null}
                            {source.context.selection ? (
                              <section>
                                <strong>Stored selection</strong>
                                <pre>{source.context.selection}</pre>
                              </section>
                            ) : null}
                            {source.context.content ? (
                              <section>
                                <strong>Stored source text</strong>
                                <pre>{source.context.content}</pre>
                              </section>
                            ) : null}
                            {storedMetadata.length ? (
                              <section>
                                <strong>Stored metadata</strong>
                                <dl>
                                  {storedMetadata.map(([key, value]) => (
                                    <div key={key}>
                                      <dt>{key}</dt>
                                      <dd>
                                        {value === null
                                          ? "null"
                                          : String(value)}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              </section>
                            ) : null}
                          </details>
                        </div>
                        <div className="tablet-source-actions">
                          {!active ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                onSourceChange(source, "use")
                              }
                            >
                              Use
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={
                              source.included ? "included" : ""
                            }
                            disabled={
                              busy ||
                              active ||
                              (!source.included && includedCount >= 5)
                            }
                            title={
                              active
                                ? "The active source is always included"
                                : source.included
                                  ? "Exclude from future answers"
                                  : "Include in future answers"
                            }
                            aria-pressed={source.included}
                            onClick={() =>
                              onSourceChange(
                                source,
                                source.included
                                  ? "exclude"
                                  : "include"
                              )
                            }
                          >
                            {source.included ? (
                              <Eye size={12} />
                            ) : (
                              <EyeOff size={12} />
                            )}
                            {source.included ? "Included" : "Excluded"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
