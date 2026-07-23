"use client";

import { BarChart3, LoaderCircle, Search, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const requestEpoch = useRef(0);

  const load = useCallback(async (cursor?: string | null) => {
    const append = Boolean(cursor);
    const epoch = requestEpoch.current + 1;
    requestEpoch.current = epoch;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
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
      setPage((current) => append && current ? {
        ...result,
        actors: [...current.actors, ...result.actors],
        quotes: [...current.quotes, ...result.quotes]
      } : result);
    } catch (reason) {
      if (epoch !== requestEpoch.current) return;
      setError(reason instanceof Error ? reason.message : "Analytics could not be loaded.");
    } finally {
      if (epoch === requestEpoch.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [actorHandle, commentId, postId, query, subjectType, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query, view]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      requestEpoch.current += 1;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

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
        className="content-analytics-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${subjectType === "post" ? "Post" : "Comment"} analytics`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <span>
            <BarChart3 size={19} />
            <span>
              <strong>{subjectType === "post" ? "Post analytics" : "Comment analytics"}</strong>
              <small>{page?.title ?? "Private author view"}</small>
            </span>
          </span>
          <button type="button" title="Close analytics" aria-label="Close analytics" onClick={onClose}>
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
                setPage(null);
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
          {loading && !page ? <LoaderCircle className="spin content-analytics-loader" size={20} /> : null}
          {error ? (
            <div className="content-analytics-error">
              <p>{error}</p>
              <button type="button" onClick={() => void load()}>Try again</button>
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
