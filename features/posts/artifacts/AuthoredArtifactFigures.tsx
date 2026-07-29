import type { CSSProperties } from "react";
import type {
  BottomCaricatureIdContract,
  ThoughtMuseIdContract
} from "@/packages/contracts/src";
import {
  AUTHORED_ARTIFACT_FOUNDATION,
  BOTTOM_CARICATURE_REGISTRY,
  THOUGHT_MUSE_REGISTRY
} from "@/features/posts/artifacts/authoredArtifactRegistry";

export function ThoughtOpeningMuse({ museId }: { museId: ThoughtMuseIdContract }) {
  const muse = THOUGHT_MUSE_REGISTRY[museId];
  return (
    <div
      className="authored-thought-opening-muse"
      data-thought-muse={muse.id}
      data-thought-muse-status={muse.status}
      data-thought-muse-approval-scope={muse.approvalScope}
      style={{
        "--authored-thought-muse-height-desktop": `${muse.displayHeights.desktop}px`,
        "--authored-thought-muse-height-compact": `${muse.displayHeights.compact}px`,
        "--authored-thought-muse-height-tablet": `${muse.displayHeights.tablet}px`,
        "--authored-thought-muse-height-mobile": `${muse.displayHeights.mobile}px`,
        "--authored-thought-muse-margin-top-desktop": `${muse.margins.desktop.top}px`,
        "--authored-thought-muse-margin-bottom-desktop": `${muse.margins.desktop.bottom}px`,
        "--authored-thought-muse-margin-top-compact": `${muse.margins.compact.top}px`,
        "--authored-thought-muse-margin-bottom-compact": `${muse.margins.compact.bottom}px`,
        "--authored-thought-muse-margin-top-tablet": `${muse.margins.tablet.top}px`,
        "--authored-thought-muse-margin-bottom-tablet": `${muse.margins.tablet.bottom}px`,
        "--authored-thought-muse-margin-top-mobile": `${muse.margins.mobile.top}px`,
        "--authored-thought-muse-margin-bottom-mobile": `${muse.margins.mobile.bottom}px`
      } as CSSProperties}
      aria-hidden="true"
    >
      <div className="authored-thought-opening-muse-frame">
        <img className="authored-artifact-day" src={muse.assets.day} alt="" draggable={false} />
        <img className="authored-artifact-night" src={muse.assets.night} alt="" draggable={false} />
      </div>
    </div>
  );
}

export function AuthoredBottomCaricature({
  bottomCaricatureId,
  postType
}: {
  bottomCaricatureId: BottomCaricatureIdContract;
  postType: "paper" | "thought";
}) {
  const bottom = BOTTOM_CARICATURE_REGISTRY[bottomCaricatureId];
  const assets = postType === "thought" ? bottom.thoughtSurfaceAssets : bottom.assets;
  return (
    <div
      className="authored-bottom-caricature"
      data-bottom-caricature-id={bottom.id}
      data-bottom-fill-contract={postType === "thought" ? "surface-through" : "paper-surface"}
      style={{
        "--authored-bottom-height": `${bottom.placement.desktop.height}px`,
        "--authored-bottom-translate-y": `${bottom.placement.desktop.translateY}px`,
        "--authored-bottom-max-width": `${bottom.placement.desktop.maxWidthPercent}%`,
        "--authored-bottom-mobile-height": `${bottom.placement.mobile.height}px`,
        "--authored-bottom-mobile-translate-y": `${bottom.placement.mobile.translateY}px`,
        "--authored-bottom-mobile-max-width": `${bottom.placement.mobile.maxWidthPercent}%`,
        "--authored-bottom-optical-x": `${bottom.placement.opticalOffsetX}px`
      } as CSSProperties}
      aria-hidden="true"
    >
      <img className="authored-artifact-day" src={assets.day} alt="" draggable={false} />
      <img className="authored-artifact-night" src={assets.night} alt="" draggable={false} />
    </div>
  );
}

export function PostTypeEmblem({ postType }: { postType: "paper" | "thought" }) {
  const source = postType === "paper"
    ? AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.cornerDay
    : AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.cornerDay;
  const nightSource = postType === "paper"
    ? AUTHORED_ARTIFACT_FOUNDATION.paper.perimeter.cornerNight
    : AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.cornerNight;
  return (
    <span className={`authored-post-type-emblem authored-post-type-emblem-${postType}`} aria-hidden="true">
      <img className="authored-artifact-day" src={source} alt="" draggable={false} />
      <img className="authored-artifact-night" src={nightSource} alt="" draggable={false} />
    </span>
  );
}

export function AuthoredArtifactAssetPreload({ postType }: { postType: "paper" | "thought" }) {
  const foundation = AUTHORED_ARTIFACT_FOUNDATION;
  const sources = postType === "paper"
    ? [
        foundation.paper.surface.day,
        foundation.paper.surface.night,
        foundation.paper.grain.day,
        foundation.paper.grain.night,
        foundation.paper.perimeter.day,
        foundation.paper.perimeter.night
      ]
    : [
        foundation.thought.surface.dayTexture,
        foundation.thought.surface.nightTexture,
        foundation.paper.grain.day,
        foundation.paper.grain.night,
        foundation.thought.perimeter.outerDay,
        foundation.thought.perimeter.outerNight,
        foundation.thought.perimeter.waveDay,
        foundation.thought.perimeter.waveNight
      ];
  return (
    <span className="authored-artifact-preload" aria-hidden="true">
      {sources.map((source) => <img key={source} src={source} alt="" draggable={false} />)}
    </span>
  );
}
