"use client";

import { useEffect, useRef, type RefObject } from "react";

const qualifiedViewVisibleRatio = 0.6;
const qualifiedViewDelayMs = 5000;

export function useQualifiedView<T extends Element>(
  targetRef: RefObject<T | null>,
  {
    disabled = false,
    targetKey,
    onView
  }: {
    disabled?: boolean;
    targetKey?: string | null;
    onView: () => void;
  }
) {
  const onViewRef = useRef(onView);

  useEffect(() => {
    onViewRef.current = onView;
  }, [onView]);

  useEffect(() => {
    if (disabled || !targetKey || typeof IntersectionObserver === "undefined") return;

    const element = targetRef.current;
    if (!element) return;

    let viewTimer: number | null = null;
    const clearViewTimer = () => {
      if (viewTimer === null) return;
      window.clearTimeout(viewTimer);
      viewTimer = null;
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= qualifiedViewVisibleRatio) {
          if (viewTimer === null) {
            viewTimer = window.setTimeout(() => {
              viewTimer = null;
              onViewRef.current();
            }, qualifiedViewDelayMs);
          }
          return;
        }

        clearViewTimer();
      },
      { threshold: [0, qualifiedViewVisibleRatio, 1] }
    );

    observer.observe(element);
    return () => {
      clearViewTimer();
      observer.disconnect();
    };
  }, [disabled, targetKey, targetRef]);
}
