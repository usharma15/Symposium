"use client";

import { BarChart3, LoaderCircle, Search, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  contentAnalyticsInvalidationEvent,
  contentAnalyticsTargetMatches,
  isContentAnalyticsInvalidation,
  rememberContentAnalyticsInvalidationKey,
  type ContentAnalyticsTarget
} from "@/features/analytics/contentAnalyticsSync";
import type {
  ContentAnalyticsPageContract,
  ContentAnalyticsViewContract
} from "@/packages/contracts/src";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import { formatMetric, metricNumber } from "@/lib/symposiumCore";

const tabs: { id: ContentAnalyticsViewContract; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "likes", label: "Likes" },
  { id: "reshares", label: "Reshares" },
  { id: "quotes", label: "Quotes" }
];

const metricLabels = {
  likes: "Likes",
  reshares: "Reshares",
  quotes: "Quotes",
  saves: "Saves",
  views: "Views"
} as const;

const profileHref = (handle: string) =>
  `/profiles/${encodeURIComponent(handle.replace(/^@/, ""))}`;

type AnalyticsLoadOptions = {
  background?: boolean;
};

export function ContentAnalyticsDialog({
  actorHandle,
  postId,
  subjectType,
  commentId,
  initialView = "overview",
  onClose
}: {
  actorHandle: string;
  postId: string;
  subjectType: "post" | "comment";
  commentId?: string;
  initialView?: ContentAnalyticsViewContract;
  onClose: () => void;
}) {
  const [view, setView] = useState<ContentAnalyticsViewContract>(initialView);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<ContentAnalyticsPageContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const requestEpoch = useRef(0);
  const pageRef = useRef<ContentAnalyticsPageContract | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const processedInvalidationKeysRef = useRef<string[]>([]);
  const loadRef = useRef<(
    cursor?: string | null,
    options?: AnalyticsLoadOptions
  ) => Promise<void>>(async () => {});

  const load = useCallback(async (
    cursor?: string | null,
    options: AnalyticsLoadOptions = {}
  ) => {
    const append = Boolean(cursor);
    const background = Boolean(options.background && pageRef.current);
    const epoch = requestEpoch.current + 1;
    requestEpoch.current = epoch;
    if (append) setLoadingMore(true);
    else setLoading(true);
    if (background || append) setRefreshError("");
    else setError("");
    try {
      const parameters = new URLSearchParams({
        actorHandle,
        subjectType,
        view,
        limit: "24"
      });
      if (commentId) parameters.set("commentId", commentId);
      if (query.trim()) parameters.set("query", query.trim());
      if (cursor) parameters.set("cursor", cursor);
      const result = await symposiumApi.request<ContentAnalyticsPageContract>(
        `/api/posts/${encodeURIComponent(postId)}/analytics?${parameters}`,
        { cache: "no-store" }
      );
      if (epoch !== requestEpoch.current) return;
      setPage((current) => {
        const nextPage = append && current ? {
          ...result,
          actors: [...current.actors, ...result.actors],
          quotes: [...current.quotes, ...result.quotes]
        } : result;
        pageRef.current = nextPage;
        return nextPage;
      });
      setError("");
      setRefreshError("");
    } catch (reason) {
      if (epoch !== requestEpoch.current) return;
      if (pageRef.current) {
        setRefreshError(
          append
            ? "More results could not load. Your current results are still available."
            : "Analytics could not refresh. Showing the latest available results."
        );
      } else {
        setError(reason instanceof Error ? reason.message : "Analytics could not be loaded.");
      }
    } finally {
      if (epoch === requestEpoch.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [actorHandle, commentId, postId, query, subjectType, view]);
  loadRef.current = load;

  useEffect(() => {
    requestEpoch.current += 1;
    pageRef.current = null;
    setPage(null);
    setQuery("");
    setError("");
    setRefreshError("");
    setView(initialView);
  }, [commentId, initialView, postId, subjectType]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query, view]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      requestEpoch.current += 1;
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const target: ContentAnalyticsTarget = {
      subjectType,
      postId,
      ...(subjectType === "comment" && commentId ? { commentId } : {})
    };
    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void loadRef.current(null, { background: true });
      }, 120);
    };
    const onInvalidation = (event: Event) => {
      const message = (event as CustomEvent<unknown>).detail;
      if (!isContentAnalyticsInvalidation(message)) return;
      if (
        !message.all
        && !message.targets.some((candidate) => contentAnalyticsTargetMatches(candidate, target))
      ) {
        return;
      }
      const remembered = rememberContentAnalyticsInvalidationKey(
        processedInvalidationKeysRef.current,
        message.eventKey
      );
      processedInvalidationKeysRef.current = remembered.keys;
      if (remembered.seen) return;
      scheduleRefresh();
    };
    const onResume = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    window.addEventListener(contentAnalyticsInvalidationEvent, onInvalidation);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      window.removeEventListener(contentAnalyticsInvalidationEvent, onInvalidation);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onResume);
      document.removeEventListener("visibilitychange", onResume);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [commentId, postId, subjectType]);

  const listEmpty = !loading && !error && page && (
    view === "quotes" ? !page.quotes.length : view !== "overview" && !page.actors.length
  );

  return createPortal(
    <div
      className="content-analytics-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="content-analytics-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${subjectType === "post" ? "Post" : "Comment"} analytics`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <span>
            <BarChart3 size={19} />
            <span>
              <strong>{subjectType === "post" ? "Post analytics" : "Comment analytics"}</strong>
              <small aria-live="polite">
                {page?.title ?? "Private author view"}
                {loading && page ? " · Updating…" : ""}
              </small>
            </span>
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            title="Close analytics"
            aria-label="Close analytics"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <nav aria-label="Analytics sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={view === tab.id ? "active" : ""}
              aria-current={view === tab.id ? "page" : undefined}
              onClick={() => {
                setView(tab.id);
                setQuery("");
                pageRef.current = null;
                setPage(null);
                setRefreshError("");
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {view !== "overview" ? (
          <label className="content-analytics-search">
            <Search size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={view === "quotes" ? "Search people or quoted posts" : `Search ${view}`}
              aria-label={`Search ${view}`}
            />
          </label>
        ) : null}

        <div className="content-analytics-body" aria-busy={loading}>
          {loading && !page ? (
            <div className="content-analytics-loader" role="status">
              <LoaderCircle className="spin" size={20} />
              <span>Loading analytics…</span>
            </div>
          ) : null}
          {error ? (
            <div className="content-analytics-error">
              <p>{error}</p>
              <button type="button" onClick={() => void load()}>Try again</button>
            </div>
          ) : null}
          {refreshError ? (
            <div className="content-analytics-refresh-error" role="status">
              <span>{refreshError}</span>
              <button
                type="button"
                onClick={() => void load(null, { background: true })}
              >
                Retry
              </button>
            </div>
          ) : null}
          {view === "overview" && page ? (
            <>
              <div className="content-analytics-metrics">
                {(Object.keys(metricLabels) as (keyof typeof metricLabels)[]).map((key) => (
                  <article key={key}>
                    <strong>{formatMetric(metricNumber(String(page.overview[key])))}</strong>
                    <span>{metricLabels[key]}</span>
                  </article>
                ))}
              </div>
              <div className="content-analytics-privacy">
                <strong>Private author analytics</strong>
                <p>
                  Likes include everyone who liked your work, even when they keep likes off their public profile.
                  Saves and viewer identities are never shown.
                </p>
              </div>
            </>
          ) : null}
          {(view === "likes" || view === "reshares") && page ? (
            <div className="content-analytics-people">
              {page.actors.map((actor) => (
                <a key={actor.handle} href={profileHref(actor.handle)}>
                  <span className="avatar">
                    {actor.avatarUrl ? <img src={actor.avatarUrl} alt="" /> : actor.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{actor.name}</strong>
                    <small>{actor.handle}</small>
                  </span>
                  <time dateTime={actor.occurredAt}>
                    {new Date(actor.occurredAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </time>
                </a>
              ))}
            </div>
          ) : null}
          {view === "quotes" && page ? (
            <div className="content-analytics-quotes">
              {page.quotes.map((quote) => (
                <a key={quote.id} href={quote.href}>
                  <span className="avatar">
                    {quote.avatarUrl ? <img src={quote.avatarUrl} alt="" /> : quote.authorName.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{quote.authorName}</strong>
                    <p>{quote.title}</p>
                  </span>
                  <time dateTime={quote.occurredAt}>
                    {new Date(quote.occurredAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </time>
                </a>
              ))}
            </div>
          ) : null}
          {listEmpty ? (
            <p className="content-analytics-empty">
              {query ? `No ${view} match “${query}”.` : `No ${view} yet.`}
            </p>
          ) : null}
          {page?.nextCursor ? (
            <button
              className="content-analytics-more"
              type="button"
              disabled={loadingMore}
              onClick={() => void load(page.nextCursor)}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
}
