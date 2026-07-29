"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type { PaperMuseIdContract } from "@/packages/contracts/src";
import { PAPER_MUSE_REGISTRY } from "@/features/posts/artifacts/authoredArtifactRegistry";
import { paperTitleEntry } from "@/features/posts/artifacts/paperTitleEntry";

type InkGeometry = {
  width: number;
  height: number;
  museLeft: number;
  rivuletPath: string;
};

export function PaperTitleCeremony({
  museId,
  title
}: {
  museId: PaperMuseIdContract;
  title: string;
}) {
  const muse = PAPER_MUSE_REGISTRY[museId];
  const ceremonyRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const titleTextRef = useRef<HTMLSpanElement | null>(null);
  const baselineRef = useRef<HTMLElement | null>(null);
  const museRef = useRef<HTMLDivElement | null>(null);
  const [ink, setInk] = useState<InkGeometry | null>(null);

  useLayoutEffect(() => {
    const ceremony = ceremonyRef.current;
    const heading = headingRef.current;
    const titleText = titleTextRef.current;
    const baseline = baselineRef.current;
    const museElement = museRef.current;
    if (!ceremony || !heading || !titleText || !baseline || !museElement) return;

    let cancelled = false;
    let frame = 0;

    const measure = () => {
      if (cancelled) return;
      const ceremonyRect = ceremony.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      const baselineRect = baseline.getBoundingClientRect();
      const museRect = museElement.getBoundingClientRect();
      const textNode = titleText.firstChild;
      const entry = paperTitleEntry(title);
      if (
        !ceremonyRect.width ||
        !headingRect.width ||
        !museRect.width ||
        !textNode ||
        textNode.nodeType !== Node.TEXT_NODE ||
        !entry.grapheme
      ) {
        setInk(null);
        return;
      }

      const entryRange = document.createRange();
      entryRange.setStart(textNode, entry.start);
      entryRange.setEnd(textNode, entry.end);
      const entryRect = entryRange.getBoundingClientRect();
      if (!entryRect.width || !entryRect.height) {
        setInk(null);
        return;
      }

      const style = window.getComputedStyle(titleText);
      const direction = style.direction === "rtl" ? "rtl" : entry.direction;
      const scale = 4;
      const padding = 12;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil((headingRect.width + padding * 2) * scale);
      canvas.height = Math.ceil((headingRect.height + padding * 2) * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });

      const entryLeft = entryRect.left - headingRect.left;
      const entryTop = entryRect.top - headingRect.top;
      const entryRight = entryRect.right - headingRect.left;
      const entryBottom = entryRect.bottom - headingRect.top;
      let glyphX = direction === "rtl" ? entryLeft : entryRight;
      let glyphY = entryTop + entryRect.height * 0.32;
      let minimumGlyphInkX = entryLeft;
      let maximumGlyphInkX = entryRight;
      const glyphInkPoints: Array<{ x: number; y: number }> = [];

      if (context) {
        context.scale(scale, scale);
        context.clearRect(0, 0, canvas.width / scale, canvas.height / scale);
        context.fillStyle = "#000";
        context.font =
          style.font ||
          `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        context.direction = direction;
        context.textAlign = direction === "rtl" ? "right" : "left";
        context.textBaseline = "alphabetic";
        const extended = context as CanvasRenderingContext2D & {
          fontKerning?: string;
          letterSpacing?: string;
          fontStretch?: string;
          fontVariantCaps?: string;
          textRendering?: string;
        };
        if ("fontKerning" in extended) extended.fontKerning = style.fontKerning as CanvasFontKerning;
        if ("letterSpacing" in extended) extended.letterSpacing = style.letterSpacing;
        if ("fontStretch" in extended) extended.fontStretch = style.fontStretch as CanvasFontStretch;
        if ("fontVariantCaps" in extended) {
          extended.fontVariantCaps = style.fontVariantCaps as CanvasFontVariantCaps;
        }
        if ("textRendering" in extended) {
          extended.textRendering = style.textRendering as CanvasTextRendering;
        }
        const textOriginX = direction === "rtl" ? headingRect.width + padding : padding;
        const baselineY = baselineRect.top - headingRect.top;
        context.fillText(title, textOriginX, baselineY + padding);

        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let sampledMinimumX = Number.POSITIVE_INFINITY;
        let sampledMaximumX = Number.NEGATIVE_INFINITY;
        const clipInset = 0.35;
        for (let y = 0; y < canvas.height; y += 1) {
          const pointY = y / scale - padding;
          if (pointY < entryTop - clipInset || pointY > entryBottom + clipInset) continue;
          for (let x = 0; x < canvas.width; x += 1) {
            const pointX = x / scale - padding;
            if (pointX < entryLeft - clipInset || pointX > entryRight + clipInset) continue;
            const alpha = pixels[(y * canvas.width + x) * 4 + 3];
            if (alpha < 180) continue;
            sampledMinimumX = Math.min(sampledMinimumX, pointX);
            sampledMaximumX = Math.max(sampledMaximumX, pointX);
            if (alpha >= 235) glyphInkPoints.push({ x: pointX, y: pointY });
          }
        }
        if (Number.isFinite(sampledMinimumX)) minimumGlyphInkX = sampledMinimumX;
        if (Number.isFinite(sampledMaximumX)) maximumGlyphInkX = sampledMaximumX;
      }

      const headingLeft = headingRect.left - ceremonyRect.left;
      const headingTop = headingRect.top - ceremonyRect.top;
      const visibleMuseLeftInset = museRect.width * (muse.visibleInsets.left / muse.canvas.width);
      const visibleMuseRightInset = museRect.width * (muse.visibleInsets.right / muse.canvas.width);
      const museLeft = Number((
        direction === "rtl"
          ? headingLeft + maximumGlyphInkX - museRect.width + visibleMuseRightInset
          : headingLeft + minimumGlyphInkX - visibleMuseLeftInset
      ).toFixed(2));
      const museTop = museRect.top - ceremonyRect.top;
      const streamStartX = museLeft + museRect.width * (muse.runoffAnchor.x / muse.canvas.width);
      const streamStartY = museTop + museRect.height * (muse.runoffAnchor.y / muse.canvas.height);

      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const point of glyphInkPoints) {
        const pointX = headingLeft + point.x;
        const pointY = headingTop + point.y;
        const distance = Math.hypot(pointX - streamStartX, pointY - streamStartY);
        if (distance >= nearestDistance) continue;
        nearestDistance = distance;
        glyphX = point.x;
        glyphY = point.y;
      }

      const anchorX = headingLeft + glyphX;
      const anchorY = headingTop + glyphY;
      const horizontalTravel = anchorX - streamStartX;
      const verticalTravel = anchorY - streamStartY;
      const travelLength = Math.max(1, Math.hypot(horizontalTravel, verticalTravel));
      const bend = Math.max(1.8, Math.min(3.6, travelLength * 0.085));
      const perpendicularX = -verticalTravel / travelLength;
      const perpendicularY = horizontalTravel / travelLength;
      const approach = {
        x: streamStartX + horizontalTravel * 0.87,
        y: streamStartY + verticalTravel * 0.87
      };
      const rivuletPath = [
        `M ${streamStartX.toFixed(2)} ${streamStartY.toFixed(2)}`,
        [
          `C ${(streamStartX + horizontalTravel * 0.16 + perpendicularX * bend * 0.18).toFixed(2)}`,
          `${(streamStartY + verticalTravel * 0.16 + perpendicularY * bend * 0.18).toFixed(2)},`,
          `${(streamStartX + horizontalTravel * 0.34 + perpendicularX * bend * 0.78).toFixed(2)}`,
          `${(streamStartY + verticalTravel * 0.34 + perpendicularY * bend * 0.78).toFixed(2)},`,
          `${(streamStartX + horizontalTravel * 0.5 + perpendicularX * bend * 0.22).toFixed(2)}`,
          `${(streamStartY + verticalTravel * 0.5 + perpendicularY * bend * 0.22).toFixed(2)}`
        ].join(" "),
        [
          `C ${(streamStartX + horizontalTravel * 0.64 - perpendicularX * bend * 0.58).toFixed(2)}`,
          `${(streamStartY + verticalTravel * 0.64 - perpendicularY * bend * 0.58).toFixed(2)},`,
          `${(streamStartX + horizontalTravel * 0.77 - perpendicularX * bend * 0.28).toFixed(2)}`,
          `${(streamStartY + verticalTravel * 0.77 - perpendicularY * bend * 0.28).toFixed(2)},`,
          `${approach.x.toFixed(2)} ${approach.y.toFixed(2)}`
        ].join(" "),
        `L ${anchorX.toFixed(2)} ${anchorY.toFixed(2)}`
      ].join(" ");

      setInk({
        width: ceremonyRect.width,
        height: ceremonyRect.height,
        museLeft,
        rivuletPath
      });
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(ceremony);
    observer.observe(heading);
    observer.observe(titleText);
    observer.observe(museElement);
    scheduleMeasure();
    void document.fonts.ready.then(scheduleMeasure);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [muse, title]);

  return (
    <div
      className="authored-paper-title-ceremony"
      data-paper-muse={muse.id}
      ref={ceremonyRef}
    >
      {ink ? (
        <svg
          className="authored-paper-title-stream"
          viewBox={`0 0 ${ink.width} ${ink.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="authored-paper-ink-rivulet" d={ink.rivuletPath} />
        </svg>
      ) : null}
      <div
        ref={museRef}
        className="authored-paper-title-muse"
        data-paper-muse={muse.id}
        style={{
          ...(ink ? { marginLeft: `${ink.museLeft}px` } : {}),
          "--authored-paper-muse-scale-x": muse.scaleX,
          "--authored-paper-muse-translate-y": `${muse.translateY}px`,
          "--authored-paper-muse-height-desktop": `${muse.displayHeights.desktop}px`,
          "--authored-paper-muse-height-compact": `${muse.displayHeights.compact}px`,
          "--authored-paper-muse-height-tablet": `${muse.displayHeights.tablet}px`,
          "--authored-paper-muse-height-mobile": `${muse.displayHeights.mobile}px`,
          aspectRatio: `${muse.canvas.width} / ${muse.canvas.height}`
        } as CSSProperties}
        aria-hidden="true"
      >
        <img className="authored-artifact-day" src={muse.assets.day} alt="" draggable={false} />
        <img className="authored-artifact-night" src={muse.assets.night} alt="" draggable={false} />
      </div>
      <h1 ref={headingRef} dir="auto">
        <i className="authored-paper-title-baseline" ref={baselineRef} aria-hidden="true" />
        <span ref={titleTextRef}>{title}</span>
      </h1>
    </div>
  );
}
