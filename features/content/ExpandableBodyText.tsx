"use client";

import { useEffect, useState } from "react";

const collapsedBodyLength = 500;
const bodyExpansionStep = 2000;

export function ExpandableBodyText({
  text,
  className,
  onExpand
}: {
  text: string;
  className?: string;
  onExpand?: () => void;
}) {
  const [visibleLength, setVisibleLength] = useState(() =>
    text.length > collapsedBodyLength ? collapsedBodyLength : text.length
  );
  const hasMore = visibleLength < text.length;
  const isExpanded = text.length > collapsedBodyLength && !hasMore;
  const visibleText = text.slice(0, visibleLength);

  useEffect(() => {
    setVisibleLength(text.length > collapsedBodyLength ? collapsedBodyLength : text.length);
  }, [text]);

  const showMore = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setVisibleLength((current) => Math.min(text.length, current + bodyExpansionStep));
    onExpand?.();
  };

  const showLess = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setVisibleLength(Math.min(collapsedBodyLength, text.length));
  };

  return (
    <p className={`expandable-text ${className ?? ""}`.trim()}>
      {visibleText}
      {hasMore ? (
        <>
          <span> ... </span>
          <button type="button" className="inline-expand-button" onClick={showMore}>
            show more
          </button>
        </>
      ) : isExpanded ? (
        <>
          <span> </span>
          <button type="button" className="inline-expand-button" onClick={showLess}>
            show less
          </button>
        </>
      ) : null}
    </p>
  );
}
