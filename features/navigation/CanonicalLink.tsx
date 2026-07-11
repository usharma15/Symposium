"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { canonicalRouteHref, type CanonicalRoute } from "@/features/navigation/canonicalRoute";

const shouldUseClientNavigation = (event: MouseEvent<HTMLAnchorElement>, target?: string) =>
  event.button === 0 &&
  !event.defaultPrevented &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey &&
  (!target || target === "_self");

export function CanonicalLink({
  route,
  onNavigate,
  children,
  onClick,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  route: CanonicalRoute;
  onNavigate: () => void;
  children: ReactNode;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!shouldUseClientNavigation(event, props.target)) return;
    event.preventDefault();
    onNavigate();
  };

  return (
    <a {...props} href={canonicalRouteHref(route)} onClick={handleClick}>
      {children}
    </a>
  );
}
