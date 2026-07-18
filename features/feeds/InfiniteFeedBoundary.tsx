"use client";

import { useEffect, useRef, useState } from "react";

export function InfiniteFeedBoundary({
  hasMore,
  loading,
  onLoadMore,
  label = "posts"
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void | Promise<void>;
  label?: string;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestPendingRef = useRef(false);
  const [observerAvailable, setObserverAvailable] = useState(true);

  useEffect(() => {
    if (!loading) requestPendingRef.current = false;
  }, [loading]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setObserverAvailable(false);
      return undefined;
    }

    setObserverAvailable(true);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || loading || requestPendingRef.current) return;
      requestPendingRef.current = true;
      void onLoadMore();
    }, { rootMargin: "0px 0px 900px 0px", threshold: 0.01 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (!hasMore && !loading) return null;

  return (
    <div
      ref={sentinelRef}
      className="infinite-feed-boundary"
      role="status"
      aria-live="polite"
      aria-label={loading ? `Loading more ${label}` : `More ${label} loads as you scroll`}
    >
      {loading ? <span>Loading more {label}…</span> : null}
      {!observerAvailable && hasMore ? (
        <button className="feed-load-more" type="button" onClick={() => void onLoadMore()}>
          Load more {label}
        </button>
      ) : null}
    </div>
  );
}
