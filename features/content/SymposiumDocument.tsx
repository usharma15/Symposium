"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import katex from "katex";
import type { InquiryAttachment, ResearchProfile } from "@/lib/mockData";
import type { VersionedDocumentContract } from "@/packages/contracts/src";
import {
  documentForContent,
  type SymposiumTextRun
} from "@/lib/documentModel";
import { cleanHandle } from "@/lib/symposiumCore";
import { AttachmentCarousel } from "@/features/attachments/AttachmentViews";

const runStyle = (run: SymposiumTextRun): CSSProperties => ({
  ...(run.font ? { fontFamily: `var(--document-font-${run.font})` } : {}),
  ...(run.size ? { fontSize: `var(--document-size-${run.size})` } : {}),
  ...(run.color ? { color: `var(--document-color-${run.color})` } : {})
});

const runClassName = (run: SymposiumTextRun) =>
  [
    run.marks?.includes("bold") ? "document-mark-bold" : "",
    run.marks?.includes("italic") ? "document-mark-italic" : "",
    run.marks?.includes("underline") ? "document-mark-underline" : "",
    run.marks?.includes("code") ? "document-mark-code" : "",
    run.marks?.includes("strikethrough") ? "document-mark-strike" : ""
  ].filter(Boolean).join(" ");

const profileForMention = (profiles: Record<string, ResearchProfile>, rawHandle: string) => {
  const handle = cleanHandle(rawHandle);
  return profiles[handle] ?? Object.values(profiles).find((profile) => cleanHandle(profile.handle) === handle);
};

function MentionAwareText({ run, profiles }: { run: SymposiumTextRun; profiles: Record<string, ResearchProfile> }) {
  const pieces = run.mentionHandle ? [run.text] : run.text.split(/(@[a-zA-Z0-9_]{2,79})/g);
  return pieces.map((piece, index) => {
    const mention = piece.startsWith("@") ? profileForMention(profiles, run.mentionHandle ?? piece) : undefined;
    const content = mention ? (
      <a href={`/profiles/${encodeURIComponent(cleanHandle(mention.handle))}`} onClick={(event) => event.stopPropagation()}>
        {piece}
      </a>
    ) : run.link ? (
      <a href={run.link} target="_blank" rel="noopener noreferrer nofollow" onClick={(event) => event.stopPropagation()}>
        {piece}
      </a>
    ) : piece;
    return <span key={`${piece}-${index}`} className={runClassName(run)} style={runStyle(run)}>{content}</span>;
  });
}

function TextRuns({ content, profiles }: { content: SymposiumTextRun[]; profiles: Record<string, ResearchProfile> }) {
  return <>{content.map((run, index) => <MentionAwareText key={`${run.text}-${index}`} run={run} profiles={profiles} />)}</>;
}

function Equation({ source, display }: { source: string; display: boolean }) {
  const html = useMemo(() => katex.renderToString(source, {
    displayMode: display,
    throwOnError: false,
    strict: "warn",
    trust: false,
    output: "htmlAndMathml"
  }), [display, source]);
  return <div className={`document-equation ${display ? "display" : "inline"}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function SymposiumDocumentRenderer({
  document,
  body,
  attachments,
  profiles,
  mode = "detail",
  onOpenAttachment,
  onExpand
}: {
  document?: VersionedDocumentContract;
  body: string;
  attachments?: InquiryAttachment[];
  profiles: Record<string, ResearchProfile>;
  mode?: "feed" | "detail" | "comment" | "editor";
  onOpenAttachment?: (attachmentId: string) => void;
  onExpand?: () => void;
}) {
  const resolved = documentForContent(document, body);
  const attachmentById = new Map((attachments ?? []).map((attachment) => [attachment.id, attachment]));
  const collapsibleSurface = mode === "feed" || mode === "comment";
  const contentFingerprint = JSON.stringify([body, document ?? null]);
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);
  const compactContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => setExpanded(false), [contentFingerprint]);
  useLayoutEffect(() => {
    if (!collapsibleSurface || expanded) return;
    const content = compactContentRef.current;
    if (!content) return;
    const measure = () => setCollapsible(content.scrollHeight > content.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [attachments, body, collapsibleSurface, document, expanded]);

  const renderedNodes = resolved.nodes.map((node) => {
    if (node.type === "attachment") {
      if (mode === "feed") return null;
      const attachment = attachmentById.get(node.attachmentId);
      if (!attachment) return null;
      return (
        <figure key={node.id} className="document-attachment-block">
          <AttachmentCarousel
            attachments={[attachment]}
            label="Inline attachment"
            variant={mode === "comment" ? "comment" : "detail"}
            onOpenPreview={() => onOpenAttachment?.(attachment.id)}
          />
          {node.caption ? <figcaption>{node.caption}</figcaption> : null}
        </figure>
      );
    }
    if (node.type === "equation") return <Equation key={node.id} source={node.source} display={node.display} />;
    if (node.type === "code") return <pre key={node.id} className="document-code"><code>{node.code}</code></pre>;
    if (node.type === "list") {
      const Tag = node.style === "decimal" || node.style.includes("alpha") ? "ol" : "ul";
      return <Tag key={node.id} className={`document-list document-list-${node.style}`} style={{ marginLeft: `${node.depth * 1.25}rem` }}>{node.items.map((item, index) => <li key={index}><TextRuns content={item} profiles={profiles} /></li>)}</Tag>;
    }
    if (node.type === "reference") return <a key={node.id} className="document-reference" href={`/${node.resource.type}s/${encodeURIComponent(node.resource.id)}`}>{node.resource.label ?? node.resource.id}</a>;
    if (node.type === "citation") return node.href ? <a key={node.id} className="document-citation" href={node.href} target="_blank" rel="noopener noreferrer nofollow">{node.label}</a> : <span key={node.id} className="document-citation">{node.label}</span>;

    const className = `document-text-block document-align-${node.type === "quote" ? "left" : node.align}${node.type === "paragraph" ? ` document-indent-${node.indent}` : ""}`;
    if (node.type === "heading") {
      const Heading = `h${Math.min(4, Math.max(1, node.level))}` as "h1" | "h2" | "h3" | "h4";
      return <Heading key={node.id} className={className}><TextRuns content={node.content} profiles={profiles} /></Heading>;
    }
    if (node.type === "quote") return <blockquote key={node.id} className={className}><TextRuns content={node.content} profiles={profiles} /></blockquote>;
    return <p key={node.id} className={className}><TextRuns content={node.content} profiles={profiles} /></p>;
  });
  const collapseStateClass = expanded ? "expanded" : `collapsed${collapsible ? " is-collapsible" : ""}`;

  return (
    <div className={`symposium-document symposium-document-${mode} document-width-${resolved.settings?.width ?? "standard"} document-margin-${resolved.settings?.margin ?? "normal"}`}>
      {collapsibleSurface ? (
        <div ref={compactContentRef} className={`document-collapsible-content document-${mode}-content ${collapseStateClass}`}>
          {renderedNodes}
        </div>
      ) : renderedNodes}
      {collapsibleSurface && (collapsible || expanded) ? (
        <button
          type="button"
          className="inline-expand-button document-expand-button"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
            if (!expanded) onExpand?.();
          }}
        >
          {expanded ? "show less" : "show more"}
        </button>
      ) : null}
    </div>
  );
}

export { SymposiumDocumentEditor } from "@/features/content/SymposiumTiptapEditor";
