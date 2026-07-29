"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";
import {
  AUTHORED_ARTIFACT_FOUNDATION
} from "@/features/posts/artifacts/authoredArtifactRegistry";

type FrameCorner = "top-left" | "top-right" | "bottom-right" | "bottom-left";
const FRAME_CORNERS: readonly FrameCorner[] = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left"
];

type FrameMetrics = {
  width: number;
  height: number;
  inset: number;
  bandWidth: number;
  innerPerimeterOffset: number;
  perimeterWidth: number;
  outerInsideFold: number;
  innerOutsideFold: number;
  cornerSquareSize: number;
};

const closeEnough = (left: number, right: number) => Math.abs(left - right) < 0.01;
const sameMetrics = (current: FrameMetrics | null, next: FrameMetrics) =>
  current !== null &&
  closeEnough(current.width, next.width) &&
  closeEnough(current.height, next.height) &&
  closeEnough(current.inset, next.inset) &&
  closeEnough(current.bandWidth, next.bandWidth) &&
  closeEnough(current.innerPerimeterOffset, next.innerPerimeterOffset);

const cornerStyle = (corner: FrameCorner, metrics: FrameMetrics): CSSProperties => {
  const isTop = corner.startsWith("top");
  const isLeft = corner.endsWith("left");
  const x = isLeft
    ? metrics.outerInsideFold
    : metrics.width - metrics.outerInsideFold - metrics.cornerSquareSize;
  const y = isTop
    ? metrics.outerInsideFold
    : metrics.height - metrics.outerInsideFold - metrics.cornerSquareSize;
  return {
    width: metrics.cornerSquareSize,
    height: metrics.cornerSquareSize,
    ...(isTop ? { top: metrics.outerInsideFold } : { bottom: metrics.outerInsideFold }),
    ...(isLeft ? { left: metrics.outerInsideFold } : { right: metrics.outerInsideFold }),
    backgroundPosition: `${-x}px ${-y}px`
  };
};

const useFrameMetrics = ({
  bandVariable,
  defaultBand,
  defaultInnerOffset,
  frameRef,
  innerOffsetVariable,
  insetVariable,
  sourceCornerSize,
  sourcePerimeterWidth
}: {
  bandVariable: string;
  defaultBand: number;
  defaultInnerOffset?: number;
  frameRef: React.RefObject<HTMLDivElement | null>;
  innerOffsetVariable?: string;
  insetVariable: string;
  sourceCornerSize: number;
  sourcePerimeterWidth: number;
}) => {
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let cancelled = false;
    let animationFrame = 0;

    const measure = () => {
      if (cancelled) return;
      const rect = frame.getBoundingClientRect();
      const style = window.getComputedStyle(frame);
      const inset = Number.parseFloat(style.getPropertyValue(insetVariable)) || 14;
      const bandWidth = Number.parseFloat(style.getPropertyValue(bandVariable)) || defaultBand;
      const innerPerimeterOffset = innerOffsetVariable
        ? Number.parseFloat(style.getPropertyValue(innerOffsetVariable)) || defaultInnerOffset || 0
        : bandWidth - bandWidth * (sourcePerimeterWidth / sourceCornerSize);
      const perimeterWidth = bandWidth * (sourcePerimeterWidth / sourceCornerSize);
      const outerInsideFold = inset + perimeterWidth;
      const innerOutsideFold = inset + innerPerimeterOffset;
      const next = {
        width: rect.width,
        height: rect.height,
        inset,
        bandWidth,
        innerPerimeterOffset,
        perimeterWidth,
        outerInsideFold,
        innerOutsideFold,
        cornerSquareSize: innerOutsideFold - outerInsideFold
      };
      setMetrics((current) => sameMetrics(current, next) ? current : next);
    };
    const schedule = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(frame);
    measure();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [
    bandVariable,
    defaultBand,
    defaultInnerOffset,
    frameRef,
    innerOffsetVariable,
    insetVariable,
    sourceCornerSize,
    sourcePerimeterWidth
  ]);

  return metrics;
};

export function PaperPerimeterFrame() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const foundation = AUTHORED_ARTIFACT_FOUNDATION.paper;
  const metrics = useFrameMetrics({
    bandVariable: "--authored-paper-frame-band-width",
    defaultBand: 30,
    frameRef,
    insetVariable: "--authored-paper-frame-inset",
    sourceCornerSize: foundation.perimeter.sourceCornerSize,
    sourcePerimeterWidth: foundation.perimeter.sourcePerimeterWidth
  });

  return (
    <div
      ref={frameRef}
      className="authored-paper-perimeter-frame"
      aria-hidden="true"
      data-motif-frame="paper-original-running-key"
      data-corner-square-size={metrics?.cornerSquareSize.toFixed(4)}
      data-perimeter-width={metrics?.perimeterWidth.toFixed(4)}
      style={{
        "--authored-paper-surface-day": `url("${foundation.surface.day}")`,
        "--authored-paper-surface-night": `url("${foundation.surface.night}")`
      } as CSSProperties}
    >
      {metrics ? (
        <>
          <div
            className="authored-paper-running-frame authored-artifact-day"
            style={{
              inset: metrics.inset,
              borderWidth: metrics.bandWidth,
              borderImageSource: `url("${foundation.perimeter.day}")`
            }}
          />
          <div
            className="authored-paper-running-frame authored-artifact-night"
            style={{
              inset: metrics.inset,
              borderWidth: metrics.bandWidth,
              borderImageSource: `url("${foundation.perimeter.night}")`
            }}
          />
          {FRAME_CORNERS.map((corner) => (
            <div
              key={corner}
              className={`authored-paper-corner-square authored-paper-corner-${corner}`}
              style={cornerStyle(corner, metrics)}
              data-frame-corner={corner}
            >
              <img className="authored-artifact-day" src={foundation.perimeter.cornerDay} alt="" draggable={false} />
              <img className="authored-artifact-night" src={foundation.perimeter.cornerNight} alt="" draggable={false} />
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

const thoughtCornerArmStyle = (
  corner: FrameCorner,
  axis: "x" | "y",
  metrics: FrameMetrics
): CSSProperties => {
  const arm = AUTHORED_ARTIFACT_FOUNDATION.thought.perimeter.backgroundArm;
  const isTop = corner.startsWith("top");
  const isLeft = corner.endsWith("left");
  const squareX = isLeft
    ? metrics.outerInsideFold
    : metrics.width - metrics.outerInsideFold - metrics.cornerSquareSize;
  const squareY = isTop
    ? metrics.outerInsideFold
    : metrics.height - metrics.outerInsideFold - metrics.cornerSquareSize;

  if (axis === "x") {
    const armX = isLeft ? squareX + metrics.cornerSquareSize : squareX - arm;
    return {
      width: arm,
      height: metrics.cornerSquareSize,
      top: 0,
      left: isLeft ? metrics.cornerSquareSize : -arm,
      backgroundPosition: `${-armX}px ${-squareY}px`
    };
  }
  const armY = isTop ? squareY + metrics.cornerSquareSize : squareY - arm;
  return {
    width: metrics.cornerSquareSize,
    height: arm,
    top: isTop ? metrics.cornerSquareSize : -arm,
    left: 0,
    backgroundPosition: `${-squareX}px ${-armY}px`
  };
};

export function ThoughtPerimeterFrame() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const foundation = AUTHORED_ARTIFACT_FOUNDATION.thought;
  const metrics = useFrameMetrics({
    bandVariable: "--authored-thought-frame-band-width",
    defaultBand: 28,
    defaultInnerOffset: 26.7033,
    frameRef,
    innerOffsetVariable: "--authored-thought-inner-perimeter-offset",
    insetVariable: "--authored-thought-frame-inset",
    sourceCornerSize: foundation.perimeter.sourceCornerSize,
    sourcePerimeterWidth: foundation.perimeter.sourcePerimeterWidth
  });

  return (
    <div
      ref={frameRef}
      className="authored-thought-perimeter-frame"
      aria-hidden="true"
      data-motif-frame="thought-clockwise-wave-pegasus"
      data-thought-design={foundation.id}
      data-thought-design-status={foundation.status}
      data-corner-square-size={metrics?.cornerSquareSize.toFixed(4)}
      data-perimeter-width={metrics?.perimeterWidth.toFixed(4)}
      style={{
        "--authored-thought-surface-day": `url("${foundation.surface.dayTexture}")`,
        "--authored-thought-surface-night": `url("${foundation.surface.nightTexture}")`
      } as CSSProperties}
    >
      <div className="authored-thought-running-frame authored-artifact-day" style={{ borderImageSource: `url("${foundation.perimeter.outerDay}")` }} />
      <div className="authored-thought-running-frame authored-artifact-night" style={{ borderImageSource: `url("${foundation.perimeter.outerNight}")` }} />
      <div className="authored-thought-wave-frame authored-artifact-day" style={{ borderImageSource: `url("${foundation.perimeter.waveDay}")` }} />
      <div className="authored-thought-wave-frame authored-artifact-night" style={{ borderImageSource: `url("${foundation.perimeter.waveNight}")` }} />
      <div className="authored-thought-inner-perimeter" />
      {metrics ? FRAME_CORNERS.map((corner) => (
        <div
          key={corner}
          className={`authored-thought-corner-square authored-thought-corner-${corner}`}
          style={cornerStyle(corner, metrics)}
          data-frame-corner={corner}
        >
          <span className="authored-thought-corner-arm" style={thoughtCornerArmStyle(corner, "x", metrics)} />
          <span className="authored-thought-corner-arm" style={thoughtCornerArmStyle(corner, "y", metrics)} />
          <img className="authored-thought-corner-artwork authored-artifact-day" src={foundation.perimeter.cornerDay} alt="" draggable={false} />
          <img className="authored-thought-corner-artwork authored-artifact-night" src={foundation.perimeter.cornerNight} alt="" draggable={false} />
        </div>
      )) : null}
    </div>
  );
}
