import { useEffect, useRef } from "react";
import type { RoomId } from "@/lib/mockData";

export type Theme = "day" | "night";

export const entranceRenders: Record<Theme, string> = {
  day: "/symposium-renders/entrance-v1.avif",
  night: "/symposium-renders/entrance-night-v1.avif"
};

export const roomRenders: Record<Theme, Record<RoomId, string>> = {
  day: {
    hall: "/symposium-renders/main-hall-updated-v1.avif",
    office: "/symposium-renders/office-v1.avif",
    symposium: "/symposium-renders/symposium-v1.avif",
    library: "/symposium-renders/library-1-v1.avif",
    amphitheater: "/symposium-renders/amphitheatre-2-v1.avif",
    funding: "/symposium-renders/patronage-civic-v1.avif",
    communities: "/symposium-renders/communities-v1.avif",
    opportunities: "/symposium-renders/opportunities-v1.avif"
  },
  night: {
    hall: "/symposium-renders/main-hall-night-v1.avif",
    office: "/symposium-renders/office-night-v1.avif",
    symposium: "/symposium-renders/symposium-night-v1.avif",
    library: "/symposium-renders/library-night-v1.avif",
    amphitheater: "/symposium-renders/amphitheatre-night-v1.avif",
    funding: "/symposium-renders/patronage-civic-night-v1.avif",
    communities: "/symposium-renders/communities-night-v1.avif",
    opportunities: "/symposium-renders/opportunities-night-v1.avif"
  }
};

export const communityRenders: Record<Theme, { directory: string; selected: string }> = {
  day: {
    directory: "/symposium-renders/communities-v1.avif",
    selected: "/symposium-renders/community-selected-v1.avif"
  },
  night: {
    directory: "/symposium-renders/communities-night-v1.avif",
    selected: "/symposium-renders/community-selected-night-v1.avif"
  }
};

const likelyDestination: Record<RoomId, RoomId> = {
  hall: "symposium",
  office: "hall",
  symposium: "hall",
  library: "hall",
  amphitheater: "hall",
  funding: "hall",
  communities: "hall",
  opportunities: "hall"
};

export const getThemePreloadRenders = (theme: Theme, activeRoom: RoomId) =>
  [roomRenders[theme][likelyDestination[activeRoom]]];

export const useSymposiumRenderPreload = (primaryRenders: string[], activeRender: string) => {
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    const cache = imageCacheRef.current;
    const preloadSource = (source: string, priority: "high" | "low") => {
      if (cache[source]) return;
      const image = new window.Image();
      image.decoding = "async";
      image.setAttribute("fetchpriority", priority);
      image.src = source;
      cache[source] = image;
    };
    preloadSource(activeRender, "high");
    const likelyRenders = Array.from(new Set(primaryRenders)).filter((source) => source !== activeRender);
    const preloadLikelyRenders = () => likelyRenders.forEach((source) => preloadSource(source, "low"));
    const idleWindow = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      };

    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(preloadLikelyRenders, { timeout: 1200 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }
    const timeoutId = window.setTimeout(preloadLikelyRenders, 350);
    return () => window.clearTimeout(timeoutId);
  }, [activeRender, primaryRenders]);
};
