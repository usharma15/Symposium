import { useEffect, useRef } from "react";
import type { RoomId } from "@/lib/mockData";

export type Theme = "day" | "night";

export const entranceRenders: Record<Theme, string> = {
  day: "/symposium-renders/entrance.png",
  night: "/symposium-renders/entrance-night.png"
};

export const roomRenders: Record<Theme, Record<RoomId, string>> = {
  day: {
    hall: "/symposium-renders/main-hall-updated.png",
    office: "/symposium-renders/office.png",
    symposium: "/symposium-renders/symposium.png",
    library: "/symposium-renders/library-1.png",
    amphitheater: "/symposium-renders/amphitheatre-2.png",
    funding: "/symposium-renders/patronage-civic.png",
    communities: "/symposium-renders/communities.png",
    opportunities: "/symposium-renders/opportunities.png"
  },
  night: {
    hall: "/symposium-renders/main-hall-night.png",
    office: "/symposium-renders/office-night.png",
    symposium: "/symposium-renders/symposium-night.png",
    library: "/symposium-renders/library-night.png",
    amphitheater: "/symposium-renders/amphitheatre-night.png",
    funding: "/symposium-renders/patronage-civic-night.png",
    communities: "/symposium-renders/communities-night.png",
    opportunities: "/symposium-renders/opportunities-night.png"
  }
};

export const communityRenders: Record<Theme, { directory: string; selected: string }> = {
  day: {
    directory: "/symposium-renders/communities.png",
    selected: "/symposium-renders/community-selected.png"
  },
  night: {
    directory: "/symposium-renders/communities-night.png",
    selected: "/symposium-renders/community-selected-night.png"
  }
};

const preloadRenders = Array.from(
  new Set([
    ...Object.values(entranceRenders),
    ...Object.values(roomRenders.day),
    ...Object.values(roomRenders.night),
    ...Object.values(communityRenders.day),
    ...Object.values(communityRenders.night)
  ])
);

export const getThemePreloadRenders = (theme: Theme) =>
  Array.from(
    new Set([
      entranceRenders[theme],
      ...Object.values(roomRenders[theme]),
      ...Object.values(communityRenders[theme])
    ])
  );

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
    const urgentRenders = Array.from(new Set([activeRender, ...primaryRenders]));
    urgentRenders.forEach((source) => preloadSource(source, "high"));
    const remainingRenders = preloadRenders.filter((source) => !urgentRenders.includes(source));
    const preloadRemainingRenders = () => remainingRenders.forEach((source) => preloadSource(source, "low"));
    const idleWindow = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      };

    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(preloadRemainingRenders, { timeout: 2500 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }
    const timeoutId = window.setTimeout(preloadRemainingRenders, 900);
    return () => window.clearTimeout(timeoutId);
  }, [activeRender, primaryRenders]);
};
