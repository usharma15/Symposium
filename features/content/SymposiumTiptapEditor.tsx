"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  FilePlus2,
  Heading1,
  Heading2,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Paperclip,
  Pilcrow,
  Redo2,
  Sigma,
  Trash2,
  Underline,
  Undo2
} from "lucide-react";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { Extension, Mark, Node, getChangedRanges, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExtension from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { Plugin } from "@tiptap/pm/state";
import katex from "katex";
import type { InquiryAttachment, InquiryItem, ResearchProfile } from "@/lib/mockData";
import { postAttachmentAccept } from "@/lib/attachmentRules";
import {
  documentForContent,
  documentPlainText,
  emptySymposiumDocument,
  newDocumentBlockId,
  normalizeDocumentAttachments,
  type EditorCapability,
  type SymposiumDocument,
  type SymposiumDocumentNode,
  type SymposiumTextRun
} from "@/lib/documentModel";
import {
  AttachmentCarousel,
  AttachmentComposerField,
  AttachmentPreviewModal,
  type AttachmentUploadHandler
} from "@/features/attachments/AttachmentViews";

type EditorContextValue = {
  attachments: InquiryAttachment[];
  openAttachment: (attachmentId: string) => void;
};

const EditorContext = createContext<EditorContextValue>({ attachments: [], openAttachment: () => undefined });

const equationSymbols = [
  ["α", "\\alpha"], ["β", "\\beta"], ["γ", "\\gamma"], ["Δ", "\\Delta"],
  ["π", "\\pi"], ["Σ", "\\sum_{}^{}"], ["∫", "\\int_{}^{}"], ["√", "\\sqrt{}"],
  ["xⁿ", "^{}"], ["xₙ", "_{}"], ["a⁄b", "\\frac{}{}"], ["∞", "\\infty"],
  ["≤", "\\le"], ["≥", "\\ge"], ["≈", "\\approx"], ["→", "\\to"]
] as const;

const documentFonts = ["system", "serif", "humanist", "mono"] as const;
const documentSizes = ["small", "normal", "large", "lead"] as const;
const documentColors = ["default", "muted", "blue", "crimson", "forest", "gold"] as const;
type DocumentFont = typeof documentFonts[number];
type DocumentSize = typeof documentSizes[number];
type DocumentColor = typeof documentColors[number];
type PreferredTextStyle = { font: DocumentFont; size: DocumentSize; color: DocumentColor };
type PreferredInlineMarks = { bold: boolean; italic: boolean; underline: boolean };
type PreferredBlock = "paragraph" | "heading1" | "heading2";
type PreferredAlignment = "left" | "center" | "right";
type PersistentFormattingStorage = {
  textStyle: PreferredTextStyle | null;
  marks: PreferredInlineMarks | null;
  block: PreferredBlock | null;
  alignment: PreferredAlignment | null;
  indent: number | null;
};
const defaultPreferredTextStyle: PreferredTextStyle = { font: "system", size: "normal", color: "default" };
const defaultDocumentSettings: NonNullable<SymposiumDocument["settings"]> = { width: "standard", margin: "normal" };

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && values.includes(value as T);

const normalizeRuns = (runs: SymposiumTextRun[]) => runs.reduce<SymposiumTextRun[]>((result, run) => {
  if (!run.text) return result;
  const normalized: SymposiumTextRun = { ...run };
  if (run.marks?.length) normalized.marks = [...new Set(run.marks)];
  else delete normalized.marks;
  const previous = result.at(-1);
  const signature = (item: SymposiumTextRun) => JSON.stringify({ ...item, text: "" });
  if (previous && signature(previous) === signature(normalized)) previous.text += normalized.text;
  else result.push(normalized);
  return result;
}, []);

const runMarksToJSON = (run: SymposiumTextRun) => {
  const marks: NonNullable<JSONContent["marks"]> = [];
  for (const mark of run.marks ?? []) {
    const name = mark === "strikethrough" ? "strike" : mark;
    marks.push({ type: name });
  }
  if (run.link) marks.push({ type: "link", attrs: { href: run.link } });
  if (run.mentionHandle) marks.push({ type: "symposiumMention", attrs: { handle: run.mentionHandle } });
  if (run.font || run.size || run.color) marks.push({ type: "textStyle", attrs: { font: run.font, size: run.size, color: run.color } });
  return marks.length ? marks : undefined;
};

const runsToJSON = (runs: SymposiumTextRun[]): JSONContent[] => runs.flatMap((run) => {
  const parts = run.text.split("\n");
  return parts.flatMap((text, index) => [
    ...(text ? [{ type: "text", text, marks: runMarksToJSON(run) } satisfies JSONContent] : []),
    ...(index < parts.length - 1 ? [{ type: "hardBreak" } satisfies JSONContent] : [])
  ]);
});

const marksFromJSON = (marks: JSONContent["marks"], capability: EditorCapability): Omit<SymposiumTextRun, "text"> => {
  const documentMarks: NonNullable<SymposiumTextRun["marks"]> = [];
  let font: DocumentFont | undefined;
  let size: DocumentSize | undefined;
  let color: DocumentColor | undefined;
  let link: string | undefined;
  let mentionHandle: string | undefined;
  for (const mark of marks ?? []) {
    if (["bold", "italic", "underline", "code"].includes(mark.type)) documentMarks.push(mark.type as typeof documentMarks[number]);
    if (mark.type === "strike") documentMarks.push("strikethrough");
    if (mark.type === "link" && typeof mark.attrs?.href === "string") link = mark.attrs.href;
    if (mark.type === "symposiumMention" && typeof mark.attrs?.handle === "string") mentionHandle = mark.attrs.handle;
    if (mark.type === "textStyle") {
      if (isOneOf(mark.attrs?.font, documentFonts)) font = mark.attrs.font;
      if (isOneOf(mark.attrs?.size, documentSizes)) size = mark.attrs.size;
      if (isOneOf(mark.attrs?.color, documentColors)) color = mark.attrs.color;
    }
  }
  const allowedMarks = capability === "reduced" ? documentMarks.filter((mark) => ["bold", "italic", "underline"].includes(mark)) : documentMarks;
  return {
    ...(allowedMarks.length ? { marks: allowedMarks } : {}),
    ...(capability === "paper" && font ? { font } : {}),
    ...(capability === "paper" && size ? { size } : {}),
    ...(capability === "paper" && color ? { color } : {}),
    ...(link ? { link } : {}),
    ...(mentionHandle ? { mentionHandle } : {})
  };
};

const inlineJSONToRuns = (content: JSONContent[] = [], capability: EditorCapability = "paper") => normalizeRuns(content.reduce<SymposiumTextRun[]>((runs, child) => {
  if (child.type === "text" && child.text) runs.push({ text: child.text, ...marksFromJSON(child.marks, capability) });
  if (child.type === "hardBreak") {
    const previous = runs.at(-1);
    if (previous) previous.text += "\n";
    else runs.push({ text: "\n" });
  }
  return runs;
}, []));

const canonicalNodeToJSON = (node: SymposiumDocumentNode): JSONContent => {
  if (node.type === "paragraph") return { type: "paragraph", attrs: { blockId: node.id, textAlign: node.align, indent: node.indent }, content: runsToJSON(node.content) };
  if (node.type === "heading") return { type: "heading", attrs: { blockId: node.id, level: node.level, textAlign: node.align }, content: runsToJSON(node.content) };
  if (node.type === "quote") return { type: "blockquote", attrs: { blockId: node.id, source: node.source ?? null }, content: [{ type: "paragraph", content: runsToJSON(node.content) }] };
  if (node.type === "list") {
    const type = node.style === "decimal" || node.style.includes("alpha") ? "orderedList" : "bulletList";
    return {
      type,
      attrs: { blockId: node.id, listStyle: node.style, depth: node.depth },
      content: node.items.map((item) => ({ type: "listItem", content: [{ type: "paragraph", content: runsToJSON(item) }] }))
    };
  }
  if (node.type === "code") return { type: "codeBlock", attrs: { blockId: node.id, language: node.language ?? null }, content: node.code ? [{ type: "text", text: node.code }] : [] };
  if (node.type === "equation") return { type: "symposiumEquation", attrs: { blockId: node.id, source: node.source, display: node.display, label: node.label ?? null } };
  if (node.type === "attachment") return { type: "symposiumAttachment", attrs: { blockId: node.id, attachmentId: node.attachmentId, caption: node.caption ?? null } };
  if (node.type === "reference") return { type: "symposiumReference", attrs: { blockId: node.id, resource: node.resource } };
  return { type: "symposiumCitation", attrs: { blockId: node.id, label: node.label, href: node.href ?? null } };
};

export const symposiumDocumentToTiptap = (document: SymposiumDocument): JSONContent => ({
  type: "doc",
  content: document.nodes.map(canonicalNodeToJSON)
});

const blockId = (node: JSONContent, prefix = "block") =>
  typeof node.attrs?.blockId === "string" && node.attrs.blockId ? node.attrs.blockId : newDocumentBlockId(prefix);

export const tiptapToSymposiumDocument = (
  json: JSONContent,
  settings: SymposiumDocument["settings"] = defaultDocumentSettings,
  capability: EditorCapability = "paper"
): SymposiumDocument => {
  const nodes = (json.content ?? []).flatMap<SymposiumDocumentNode>((node) => {
    if (node.type === "paragraph") return [{ id: blockId(node), type: "paragraph", content: inlineJSONToRuns(node.content, capability), align: capability === "paper" && isOneOf(node.attrs?.textAlign, ["left", "center", "right"] as const) ? node.attrs.textAlign : "left", indent: capability === "paper" ? Math.max(0, Math.min(8, Number(node.attrs?.indent) || 0)) : 0 }];
    if (node.type === "heading") return capability === "paper" ? [{ id: blockId(node), type: "heading", level: Math.max(1, Math.min(4, Number(node.attrs?.level) || 2)), content: inlineJSONToRuns(node.content, capability), align: isOneOf(node.attrs?.textAlign, ["left", "center", "right"] as const) ? node.attrs.textAlign : "left" }] : [{ id: blockId(node), type: "paragraph", content: inlineJSONToRuns(node.content, capability), align: "left", indent: 0 }];
    if (node.type === "blockquote") {
      const content = node.content?.flatMap((child) => inlineJSONToRuns(child.content, capability)) ?? [];
      return [{ id: blockId(node, "quote"), type: "quote", content, ...(node.attrs?.source ? { source: node.attrs.source } : {}) }];
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      const fallbackStyle = node.type === "orderedList" ? "decimal" : "bullet";
      const style = isOneOf(node.attrs?.listStyle, ["bullet", "dash", "decimal", "lower-alpha", "upper-alpha"] as const) ? node.attrs.listStyle : fallbackStyle;
      const items = (node.content ?? []).filter((item) => item.type === "listItem").map((item) => {
        const paragraph = item.content?.find((child) => child.type === "paragraph");
        return inlineJSONToRuns(paragraph?.content, capability);
      });
      return capability === "paper" ? [{ id: blockId(node, "list"), type: "list", style, depth: Math.max(0, Math.min(8, Number(node.attrs?.depth) || 0)), items: items.length ? items : [[]] }] : items.map((content, index) => ({ id: `${blockId(node, "list")}-${index}`, type: "paragraph" as const, content, align: "left" as const, indent: 0 }));
    }
    if (node.type === "codeBlock") return capability === "paper" ? [{ id: blockId(node, "code"), type: "code", ...(typeof node.attrs?.language === "string" ? { language: node.attrs.language } : {}), code: node.content?.map((child) => child.text ?? "").join("") ?? "" }] : [{ id: blockId(node), type: "paragraph", content: [{ text: node.content?.map((child) => child.text ?? "").join("") ?? "" }], align: "left", indent: 0 }];
    if (node.type === "symposiumEquation") return [{ id: blockId(node, "equation"), type: "equation", source: typeof node.attrs?.source === "string" && node.attrs.source.trim() ? node.attrs.source : "x", display: node.attrs?.display !== false, ...(typeof node.attrs?.label === "string" && node.attrs.label ? { label: node.attrs.label } : {}) }];
    if (node.type === "symposiumAttachment" && typeof node.attrs?.attachmentId === "string") return [{ id: blockId(node, "asset"), type: "attachment", attachmentId: node.attrs.attachmentId, placement: "inline", ...(typeof node.attrs?.caption === "string" && node.attrs.caption ? { caption: node.attrs.caption } : {}) }];
    if (node.type === "symposiumReference" && node.attrs?.resource) return [{ id: blockId(node, "reference"), type: "reference", resource: node.attrs.resource }];
    if (node.type === "symposiumCitation" && typeof node.attrs?.label === "string") return [{ id: blockId(node, "citation"), type: "citation", label: node.attrs.label, ...(typeof node.attrs?.href === "string" && node.attrs.href ? { href: node.attrs.href } : {}) }];
    return [];
  });
  return { version: 1, nodes: nodes.length ? nodes : emptySymposiumDocument().nodes, settings };
};

const StableBlockIds = Extension.create({
  name: "stableBlockIds",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock"],
      attributes: {
        blockId: { default: null, parseHTML: (element) => element.getAttribute("data-block-id"), renderHTML: (attrs) => attrs.blockId ? { "data-block-id": attrs.blockId } : {} }
      }
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (_transactions, _oldState, newState) => {
        let transaction = newState.tr;
        let changed = false;
        const seen = new Set<string>();
        newState.doc.descendants((node, pos) => {
          if (!node.isBlock || !["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock", "symposiumEquation", "symposiumAttachment", "symposiumReference", "symposiumCitation"].includes(node.type.name)) return;
          const currentId = typeof node.attrs.blockId === "string" ? node.attrs.blockId : "";
          if (!currentId || seen.has(currentId)) {
            const nextId = newDocumentBlockId();
            transaction = transaction.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: nextId });
            seen.add(nextId);
            changed = true;
          } else seen.add(currentId);
        });
        return changed ? transaction : null;
      }
    })];
  }
});

const DocumentAttributes = Extension.create({
  name: "documentAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Math.max(0, Math.min(8, Number(element.getAttribute("data-indent")) || 0)),
            renderHTML: (attrs) => ({ "data-indent": attrs.indent ?? 0, style: `--document-indent:${Math.max(0, Math.min(8, Number(attrs.indent) || 0))}` })
          }
        }
      },
      {
        types: ["bulletList", "orderedList"],
        attributes: {
          listStyle: { default: null, parseHTML: (element) => element.getAttribute("data-list-style"), renderHTML: (attrs) => attrs.listStyle ? { "data-list-style": attrs.listStyle } : {} },
          depth: { default: 0, parseHTML: (element) => Number(element.getAttribute("data-list-depth")) || 0, renderHTML: (attrs) => ({ "data-list-depth": attrs.depth ?? 0 }) }
        }
      },
      {
        types: ["blockquote"],
        attributes: {
          source: { default: null }
        }
      },
      {
        types: ["textStyle"],
        attributes: {
          font: { default: null, parseHTML: (element) => element.getAttribute("data-document-font"), renderHTML: (attrs) => attrs.font ? { "data-document-font": attrs.font, style: `font-family:var(--document-font-${attrs.font})` } : {} },
          size: { default: null, parseHTML: (element) => element.getAttribute("data-document-size"), renderHTML: (attrs) => attrs.size ? { "data-document-size": attrs.size, style: `font-size:var(--document-size-${attrs.size})` } : {} },
          color: { default: null, parseHTML: (element) => element.getAttribute("data-document-color"), renderHTML: (attrs) => attrs.color ? { "data-document-color": attrs.color, style: `color:var(--document-color-${attrs.color})` } : {} }
        }
      }
    ];
  }
});

const PersistentFormatting = Extension.create<
  { capability: EditorCapability },
  PersistentFormattingStorage
>({
  name: "persistentFormatting",
  addOptions() {
    return { capability: "paper" };
  },
  addStorage() {
    return { textStyle: null, marks: null, block: null, alignment: null, indent: null };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const capability = this.options.capability;
    return [new Plugin({
      appendTransaction: (transactions, _oldState, newState) => {
        const preferred = (editor.storage as unknown as { persistentFormatting: PersistentFormattingStorage }).persistentFormatting;
        const textStyle = newState.schema.marks.textStyle;
        const preferredTextStyleMark = preferred.textStyle && textStyle ? textStyle.create(preferred.textStyle) : null;
        const controlledMarkTypes = {
          bold: newState.schema.marks.bold,
          italic: newState.schema.marks.italic,
          underline: newState.schema.marks.underline
        };
        let transaction = newState.tr;
        let changed = false;
        for (const sourceTransaction of transactions) {
          if (!sourceTransaction.docChanged) continue;
          for (const { newRange } of getChangedRanges(sourceTransaction)) {
            const from = Math.max(0, Math.min(newState.doc.content.size, newRange.from));
            const to = Math.max(from, Math.min(newState.doc.content.size, newRange.to));
            newState.doc.nodesBetween(from, to, (node, pos) => {
              if (!node.isText) return;
              const markFrom = Math.max(from, pos);
              const markTo = Math.min(to, pos + node.nodeSize);
              if (markTo <= markFrom) return;
              if (preferredTextStyleMark && textStyle) {
                const current = node.marks.find((mark) => mark.type === textStyle);
                if (!current || current.attrs.font !== preferred.textStyle?.font || current.attrs.size !== preferred.textStyle?.size || current.attrs.color !== preferred.textStyle?.color) {
                  transaction = transaction.removeMark(markFrom, markTo, textStyle).addMark(markFrom, markTo, preferredTextStyleMark);
                  changed = true;
                }
              }
              if (preferred.marks) {
                for (const [name, markType] of Object.entries(controlledMarkTypes) as Array<[keyof PreferredInlineMarks, typeof controlledMarkTypes.bold]>) {
                  if (!markType) continue;
                  const active = node.marks.some((mark) => mark.type === markType);
                  if (preferred.marks[name] && !active) {
                    transaction = transaction.addMark(markFrom, markTo, markType.create());
                    changed = true;
                  } else if (!preferred.marks[name] && active) {
                    transaction = transaction.removeMark(markFrom, markTo, markType);
                    changed = true;
                  }
                }
              }
            });
          }
        }

        if (capability === "paper" && newState.selection.empty && transactions.some((source) => source.docChanged)) {
          const { $from } = newState.selection;
          const insideList = Array.from({ length: $from.depth + 1 }, (_unused, depth) => $from.node(depth).type.name).includes("listItem");
          if (!insideList) {
            for (let depth = $from.depth; depth > 0; depth -= 1) {
              const node = $from.node(depth);
              if (node.type.name !== "paragraph" && node.type.name !== "heading") continue;
              const pos = $from.before(depth);
              const expectedType = preferred.block === "heading1" || preferred.block === "heading2" ? "heading" : preferred.block === "paragraph" ? "paragraph" : node.type.name;
              const expectedAlignment = preferred.alignment ?? (isOneOf(node.attrs.textAlign, ["left", "center", "right"] as const) ? node.attrs.textAlign : "left");
              const expectedIndent = expectedType === "paragraph" ? Math.max(0, Math.min(8, preferred.indent ?? (Number(node.attrs.indent) || 0))) : undefined;
              const expectedLevel = preferred.block === "heading1" ? 1 : preferred.block === "heading2" ? 2 : Number(node.attrs.level) || 1;
              const typeChanged = node.type.name !== expectedType;
              const attributesChanged = node.attrs.textAlign !== expectedAlignment
                || (expectedType === "paragraph" && Number(node.attrs.indent) !== expectedIndent)
                || (expectedType === "heading" && Number(node.attrs.level) !== expectedLevel);
              if (typeChanged || attributesChanged) {
                const nextType = newState.schema.nodes[expectedType];
                if (nextType) {
                  transaction = transaction.setNodeMarkup(pos, nextType, expectedType === "heading" ? {
                    blockId: node.attrs.blockId,
                    level: expectedLevel,
                    textAlign: expectedAlignment
                  } : {
                    blockId: node.attrs.blockId,
                    textAlign: expectedAlignment,
                    indent: expectedIndent
                  });
                  changed = true;
                }
              }
              break;
            }
          }
        }

        if (!newState.selection.empty) return changed ? transaction : null;
        const existing = newState.storedMarks ?? newState.selection.$from.marks();
        let nextMarks = [...existing];
        if (preferredTextStyleMark && textStyle) {
          nextMarks = [...nextMarks.filter((mark) => mark.type !== textStyle), preferredTextStyleMark];
        }
        if (preferred.marks) {
          const controlledTypes = Object.values(controlledMarkTypes).filter(Boolean);
          nextMarks = nextMarks.filter((mark) => !controlledTypes.includes(mark.type));
          for (const [name, markType] of Object.entries(controlledMarkTypes) as Array<[keyof PreferredInlineMarks, typeof controlledMarkTypes.bold]>) {
            if (markType && preferred.marks[name]) nextMarks.push(markType.create());
          }
        }
        const signature = (marks: readonly (typeof nextMarks)[number][]) => marks.map((mark) => `${mark.type.name}:${JSON.stringify(mark.attrs)}`).sort().join("|");
        if (signature(existing) !== signature(nextMarks)) {
          transaction = transaction.setStoredMarks(nextMarks);
          changed = true;
        }
        return changed ? transaction : null;
      }
    })];
  }
});

const SymposiumMention = Mark.create({
  name: "symposiumMention",
  inclusive: false,
  addAttributes() { return { handle: { default: null, parseHTML: (element) => element.getAttribute("data-handle") } }; },
  parseHTML() { return [{ tag: "span[data-symposium-mention]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-symposium-mention": "true", "data-handle": HTMLAttributes.handle }), 0]; }
});

function EquationNodeView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const source = typeof node.attrs.source === "string" ? node.attrs.source : "x";
  const display = node.attrs.display !== false;
  const html = useMemo(() => katex.renderToString(source || "x", { displayMode: display, throwOnError: false, strict: "warn", trust: false, output: "htmlAndMathml" }), [display, source]);
  return (
    <NodeViewWrapper className={`document-equation-editor document-atomic-node${selected ? " selected" : ""}`} data-drag-handle>
      <button type="button" className="document-atomic-delete" title="Delete equation" aria-label="Delete equation" onClick={deleteNode}><Trash2 size={15} /></button>
      <div className={`document-equation ${display ? "display" : "inline"}`} dangerouslySetInnerHTML={{ __html: html }} />
      <input value={source} onChange={(event) => updateAttributes({ source: event.target.value || "x" })} aria-label="Equation source" />
      <div className="document-equation-symbols" aria-label="Equation symbols">
        {equationSymbols.map(([label, addition]) => <button key={label} type="button" title={`Insert ${label}`} onClick={() => updateAttributes({ source: `${source}${addition}` })}>{label}</button>)}
      </div>
      <label><input type="checkbox" checked={display} onChange={(event) => updateAttributes({ display: event.target.checked })} /> Display equation</label>
    </NodeViewWrapper>
  );
}

function AttachmentNodeView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const { attachments, openAttachment } = useContext(EditorContext);
  const attachment = attachments.find((item) => item.id === node.attrs.attachmentId);
  return (
    <NodeViewWrapper className={`document-inline-attachment-editor document-atomic-node${selected ? " selected" : ""}`} data-drag-handle>
      <button type="button" className="document-atomic-delete" title="Delete inline attachment" aria-label="Delete inline attachment" onClick={deleteNode}><Trash2 size={15} /></button>
      {attachment ? <>
        <AttachmentCarousel attachments={[attachment]} label="Inline attachment" variant="detail" onOpenPreview={() => openAttachment(attachment.id)} />
        <input value={node.attrs.caption ?? ""} placeholder="Add a caption (optional)" onChange={(event) => updateAttributes({ caption: event.target.value || null })} />
      </> : <p className="document-missing-attachment">This attachment is no longer available.</p>}
    </NodeViewWrapper>
  );
}

const SymposiumEquation = Node.create({
  name: "symposiumEquation", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() { return { blockId: { default: null }, source: { default: "E = mc^2" }, display: { default: true }, label: { default: null } }; },
  parseHTML() { return [{ tag: "div[data-symposium-equation]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-symposium-equation": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(EquationNodeView); }
});

const SymposiumAttachment = Node.create({
  name: "symposiumAttachment", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() { return { blockId: { default: null }, attachmentId: { default: null }, caption: { default: null } }; },
  parseHTML() { return [{ tag: "figure[data-symposium-attachment]" }]; },
  renderHTML({ HTMLAttributes }) { return ["figure", mergeAttributes(HTMLAttributes, { "data-symposium-attachment": "true" })]; },
  addNodeView() { return ReactNodeViewRenderer(AttachmentNodeView); }
});

const SymposiumReference = Node.create({
  name: "symposiumReference", group: "block", atom: true, selectable: true,
  addAttributes() { return { blockId: { default: null }, resource: { default: null } }; },
  parseHTML() { return [{ tag: "div[data-symposium-reference]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-symposium-reference": "true", class: "document-reference" }), HTMLAttributes.resource?.label ?? HTMLAttributes.resource?.id ?? "Reference"]; }
});

const SymposiumCitation = Node.create({
  name: "symposiumCitation", group: "block", atom: true, selectable: true,
  addAttributes() { return { blockId: { default: null }, label: { default: "Citation" }, href: { default: null } }; },
  parseHTML() { return [{ tag: "div[data-symposium-citation]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-symposium-citation": "true", class: "document-citation" }), HTMLAttributes.label]; }
});

const editorExtensions = (placeholder: string, capability: EditorCapability) => [
  StarterKit.configure({
    heading: capability === "paper" ? { levels: [1, 2, 3, 4] } : false,
    bulletList: capability === "paper" ? { keepMarks: true, keepAttributes: true } : false,
    orderedList: capability === "paper" ? { keepMarks: true, keepAttributes: true } : false,
    listItem: capability === "paper" ? {} : false,
    codeBlock: capability === "paper" ? {} : false,
    link: false,
    underline: false
  }),
  TextStyle,
  UnderlineExtension,
  Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: "noopener noreferrer nofollow" } }),
  TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"], defaultAlignment: "left" }),
  Placeholder.configure({ placeholder, showOnlyCurrent: true, includeChildren: true }),
  StableBlockIds,
  DocumentAttributes,
  PersistentFormatting.configure({ capability }),
  SymposiumMention,
  SymposiumEquation,
  SymposiumAttachment,
  SymposiumReference,
  SymposiumCitation
];

const selectedParagraphEntries = (editor: Editor) => {
  const { doc, selection } = editor.state;
  const entries: Array<{ indent: number; pos: number }> = [];
  if (selection.empty) {
    for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
      const node = selection.$from.node(depth);
      if (node.type.name !== "paragraph") continue;
      entries.push({ indent: Number(node.attrs.indent) || 0, pos: selection.$from.before(depth) });
      break;
    }
    return entries;
  }
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.type.name === "paragraph") entries.push({ indent: Number(node.attrs.indent) || 0, pos });
  });
  return entries;
};

const adjustSelectedParagraphIndent = (editor: Editor, delta: -1 | 1) => {
  const entries = selectedParagraphEntries(editor);
  if (!entries.length) return false;
  let transaction = editor.state.tr;
  for (const entry of entries) {
    const node = transaction.doc.nodeAt(entry.pos);
    if (!node || node.type.name !== "paragraph") continue;
    transaction = transaction.setNodeMarkup(entry.pos, undefined, {
      ...node.attrs,
      indent: Math.max(0, Math.min(8, entry.indent + delta))
    });
  }
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction.scrollIntoView());
  editor.commands.focus();
  return true;
};

const persistentFormattingForEditor = (editor: Editor): PersistentFormattingStorage =>
  (editor.storage as unknown as { persistentFormatting: PersistentFormattingStorage }).persistentFormatting;

const applyPreferredStoredFormatting = (editor: Editor) => {
  if (!editor.state.selection.empty) return;
  const preferred = persistentFormattingForEditor(editor);
  const textStyle = editor.state.schema.marks.textStyle;
  const controlledMarkTypes = {
    bold: editor.state.schema.marks.bold,
    italic: editor.state.schema.marks.italic,
    underline: editor.state.schema.marks.underline
  };
  let nextMarks = [...(editor.state.storedMarks ?? editor.state.selection.$from.marks())];
  if (preferred.textStyle && textStyle) {
    nextMarks = [...nextMarks.filter((mark) => mark.type !== textStyle), textStyle.create(preferred.textStyle)];
  }
  if (preferred.marks) {
    const controlledTypes = Object.values(controlledMarkTypes).filter(Boolean);
    nextMarks = nextMarks.filter((mark) => !controlledTypes.includes(mark.type));
    for (const [name, markType] of Object.entries(controlledMarkTypes) as Array<[keyof PreferredInlineMarks, typeof controlledMarkTypes.bold]>) {
      if (markType && preferred.marks[name]) nextMarks.push(markType.create());
    }
  }
  editor.view.dispatch(editor.state.tr.setStoredMarks(nextMarks));
  editor.view.focus();
};

const currentParagraphAttributes = (editor: Editor) => {
  const preferred = persistentFormattingForEditor(editor);
  const paragraph = editor.getAttributes("paragraph");
  return {
    blockId: newDocumentBlockId(),
    textAlign: preferred.alignment ?? (isOneOf(paragraph.textAlign, ["left", "center", "right"] as const) ? paragraph.textAlign : "left"),
    indent: Math.max(0, Math.min(8, preferred.indent ?? (Number(paragraph.indent) || 0)))
  };
};

function ToolbarButton({ active = false, disabled = false, title, onClick, children }: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return <button type="button" title={title} aria-label={title} aria-pressed={active} className={active ? "active" : ""} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>;
}

function EditorToolbar({ editor, capability, documentValue, onSettingsChange, onInsertEquation, onInsertAttachment, uploadDisabled }: {
  editor: Editor;
  capability: EditorCapability;
  documentValue: SymposiumDocument;
  onSettingsChange: (settings: NonNullable<SymposiumDocument["settings"]>) => void;
  onInsertEquation: () => void;
  onInsertAttachment: () => void;
  uploadDisabled: boolean;
}) {
  const initialFormatting = persistentFormattingForEditor(editor);
  const initialMarks = initialFormatting.marks ?? {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline")
  };
  const initialBlock = initialFormatting.block
    ?? (editor.isActive("heading", { level: 1 }) ? "heading1" : editor.isActive("heading", { level: 2 }) ? "heading2" : "paragraph");
  const initialAlignment = initialFormatting.alignment
    ?? (editor.isActive({ textAlign: "center" }) ? "center" : editor.isActive({ textAlign: "right" }) ? "right" : "left");
  const initialIndent = initialFormatting.indent ?? Math.max(0, Math.min(8, Number(editor.getAttributes("paragraph").indent) || 0));
  initialFormatting.marks = initialMarks;
  initialFormatting.block = initialBlock;
  initialFormatting.alignment = initialAlignment;
  initialFormatting.indent = initialIndent;
  const [preferredTextStyle, setPreferredTextStyle] = useState<PreferredTextStyle>(() => initialFormatting.textStyle ?? defaultPreferredTextStyle);
  const [preferredMarks, setPreferredMarks] = useState<PreferredInlineMarks>(() => initialMarks);
  const [preferredBlock, setPreferredBlock] = useState<PreferredBlock>(() => initialBlock);
  const [preferredAlignment, setPreferredAlignment] = useState<PreferredAlignment>(() => initialAlignment);
  const [preferredIndent, setPreferredIndent] = useState(() => initialIndent);
  const preferredTextStyleRef = useRef(preferredTextStyle);
  const preferredMarksRef = useRef(preferredMarks);
  const preferredIndentRef = useRef(preferredIndent);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const paragraphs = current ? selectedParagraphEntries(current) : [];
      const canRunCommands = Boolean(current && !current.isDestroyed);
      return current ? ({
      bulletList: current.isActive("bulletList"), orderedList: current.isActive("orderedList"),
      canIndent: paragraphs.some((paragraph) => paragraph.indent < 8),
      canOutdent: paragraphs.some((paragraph) => paragraph.indent > 0),
      canUndo: canRunCommands && current.can().undo(), canRedo: canRunCommands && current.can().redo()
    }) : ({
      bulletList: false, orderedList: false,
      canIndent: false, canOutdent: false, canUndo: false, canRedo: false
    });
    }
  });
  const settings = documentValue.settings ?? defaultDocumentSettings;
  const setTextStyle = (attrs: { font?: DocumentFont; size?: DocumentSize; color?: DocumentColor }) => {
    const next = { ...preferredTextStyleRef.current, ...attrs };
    preferredTextStyleRef.current = next;
    persistentFormattingForEditor(editor).textStyle = next;
    setPreferredTextStyle(next);
    editor.chain().focus().setMark("textStyle", next).run();
    applyPreferredStoredFormatting(editor);
  };
  const toggleInlineMark = (name: keyof PreferredInlineMarks) => {
    const next = { ...preferredMarksRef.current, [name]: !preferredMarksRef.current[name] };
    preferredMarksRef.current = next;
    persistentFormattingForEditor(editor).marks = next;
    setPreferredMarks(next);
    const command = editor.chain().focus();
    if (next[name]) command.setMark(name).run();
    else command.unsetMark(name).run();
    applyPreferredStoredFormatting(editor);
  };
  const setBlock = (block: PreferredBlock) => {
    persistentFormattingForEditor(editor).block = block;
    setPreferredBlock(block);
    if (block === "paragraph") editor.chain().focus().setParagraph().run();
    else editor.chain().focus().setHeading({ level: block === "heading1" ? 1 : 2 }).run();
    applyPreferredStoredFormatting(editor);
  };
  const setAlignment = (alignment: PreferredAlignment) => {
    persistentFormattingForEditor(editor).alignment = alignment;
    setPreferredAlignment(alignment);
    editor.chain().focus().setTextAlign(alignment).run();
    applyPreferredStoredFormatting(editor);
  };
  const adjustIndent = (delta: -1 | 1) => {
    if (!adjustSelectedParagraphIndent(editor, delta)) return;
    const next = Math.max(0, Math.min(8, preferredIndentRef.current + delta));
    preferredIndentRef.current = next;
    persistentFormattingForEditor(editor).indent = next;
    setPreferredIndent(next);
    applyPreferredStoredFormatting(editor);
  };
  const runBlockCommand = (command: () => void) => {
    command();
    applyPreferredStoredFormatting(editor);
  };
  return (
    <div className="document-editor-toolbar" role="toolbar" aria-label="Text and document formatting">
      <div>
        <ToolbarButton title="Undo" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></ToolbarButton>
        <ToolbarButton title="Redo" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></ToolbarButton>
      </div>
      <div>
        <ToolbarButton title="Bold" active={preferredMarks.bold} onClick={() => toggleInlineMark("bold")}><Bold size={16} /></ToolbarButton>
        <ToolbarButton title="Italic" active={preferredMarks.italic} onClick={() => toggleInlineMark("italic")}><Italic size={16} /></ToolbarButton>
        <ToolbarButton title="Underline" active={preferredMarks.underline} onClick={() => toggleInlineMark("underline")}><Underline size={16} /></ToolbarButton>
      </div>
      {capability === "paper" ? <>
        <div>
          <ToolbarButton title="Paragraph" active={preferredBlock === "paragraph" && !state.bulletList && !state.orderedList} onClick={() => setBlock("paragraph")}><Pilcrow size={16} /></ToolbarButton>
          <ToolbarButton title="Heading 1" active={preferredBlock === "heading1"} onClick={() => setBlock("heading1")}><Heading1 size={16} /></ToolbarButton>
          <ToolbarButton title="Heading 2" active={preferredBlock === "heading2"} onClick={() => setBlock("heading2")}><Heading2 size={16} /></ToolbarButton>
          <ToolbarButton title="Bulleted list" active={state.bulletList} onClick={() => runBlockCommand(() => { editor.chain().focus().toggleBulletList().updateAttributes("bulletList", { listStyle: "bullet" }).run(); })}><List size={16} /></ToolbarButton>
          <ToolbarButton title="Numbered list" active={state.orderedList} onClick={() => runBlockCommand(() => { editor.chain().focus().toggleOrderedList().updateAttributes("orderedList", { listStyle: "decimal" }).run(); })}><ListOrdered size={16} /></ToolbarButton>
        </div>
        <div>
          <ToolbarButton title="Align left" active={preferredAlignment === "left"} onClick={() => setAlignment("left")}><AlignLeft size={16} /></ToolbarButton>
          <ToolbarButton title="Align centre" active={preferredAlignment === "center"} onClick={() => setAlignment("center")}><AlignCenter size={16} /></ToolbarButton>
          <ToolbarButton title="Align right" active={preferredAlignment === "right"} onClick={() => setAlignment("right")}><AlignRight size={16} /></ToolbarButton>
          <ToolbarButton title="Decrease indentation" disabled={!state.canOutdent && preferredIndent <= 0} onClick={() => adjustIndent(-1)}><IndentDecrease size={16} /></ToolbarButton>
          <ToolbarButton title="Increase indentation" disabled={!state.canIndent && preferredBlock !== "paragraph"} onClick={() => adjustIndent(1)}><IndentIncrease size={16} /></ToolbarButton>
        </div>
        <select title="Font" aria-label="Font" value={preferredTextStyle.font} onChange={(event) => setTextStyle({ font: event.target.value as DocumentFont })}>
          <option value="system">System</option><option value="serif">Serif</option><option value="humanist">Humanist</option><option value="mono">Mono</option>
        </select>
        <select title="Text size" aria-label="Text size" value={preferredTextStyle.size} onChange={(event) => setTextStyle({ size: event.target.value as DocumentSize })}>
          <option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option><option value="lead">Lead</option>
        </select>
        <select title="Page width" aria-label="Page width" value={settings.width} onChange={(event) => onSettingsChange({ ...settings, width: event.target.value as "standard" | "wide" })}>
          <option value="standard">Standard width</option><option value="wide">Wide page</option>
        </select>
        <select title="Page margins" aria-label="Page margins" value={settings.margin} onChange={(event) => onSettingsChange({ ...settings, margin: event.target.value as "compact" | "normal" | "generous" })}>
          <option value="compact">Compact margins</option><option value="normal">Normal margins</option><option value="generous">Generous margins</option>
        </select>
        <div className="document-color-controls" aria-label="Text colour">
          {documentColors.map((color) => <ToolbarButton key={color} title={`${color} text`} active={preferredTextStyle.color === color} onClick={() => setTextStyle({ color })}><span style={{ "--swatch": `var(--document-color-${color})` } as CSSProperties} /></ToolbarButton>)}
        </div>
      </> : null}
      <div>
        <ToolbarButton title="Insert equation" onClick={onInsertEquation}><Sigma size={17} /></ToolbarButton>
        <ToolbarButton title="Insert attachment here" disabled={uploadDisabled} onClick={onInsertAttachment}><FilePlus2 size={17} /></ToolbarButton>
      </div>
    </div>
  );
}

export function SymposiumDocumentEditor({
  value,
  bodyFallback = "",
  capability,
  attachments,
  profiles: _profiles,
  disabled = false,
  placeholder,
  onChange,
  onAttachmentsChange,
  onBusyChange,
  onUploadAttachment
}: {
  value?: SymposiumDocument;
  bodyFallback?: string;
  capability: EditorCapability;
  attachments: InquiryAttachment[];
  profiles: Record<string, ResearchProfile>;
  disabled?: boolean;
  placeholder: string;
  onChange: (document: SymposiumDocument, plainText: string) => void;
  onAttachmentsChange: (attachments: InquiryAttachment[]) => void;
  onBusyChange?: (busy: boolean) => void;
  onUploadAttachment: AttachmentUploadHandler;
}) {
  const documentValue = useMemo(() => normalizeDocumentAttachments(value ?? (bodyFallback ? documentForContent(undefined, bodyFallback) : emptySymposiumDocument()), attachments), [value, bodyFallback, attachments]);
  const settingsRef = useRef<NonNullable<SymposiumDocument["settings"]>>(documentValue.settings ?? defaultDocumentSettings);
  const lastEmittedRef = useRef("");
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const [inlineUploading, setInlineUploading] = useState(false);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [settings, setSettings] = useState(settingsRef.current);
  const attachmentsRef = useRef(attachments);
  const onChangeRef = useRef(onChange);
  const onAttachmentsChangeRef = useRef(onAttachmentsChange);
  const inlineIdsRef = useRef(new Set(documentValue.nodes.filter((node) => node.type === "attachment").map((node) => node.attachmentId)));
  attachmentsRef.current = attachments;
  onChangeRef.current = onChange;
  onAttachmentsChangeRef.current = onAttachmentsChange;

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: editorExtensions(placeholder, capability),
    content: symposiumDocumentToTiptap(documentValue),
    onUpdate: ({ editor: current }) => {
      const candidate = tiptapToSymposiumDocument(current.getJSON(), settingsRef.current, capability);
      const nextInlineIds = new Set(candidate.nodes.filter((node) => node.type === "attachment").map((node) => node.attachmentId));
      const removedInlineIds = [...inlineIdsRef.current].filter((id) => !nextInlineIds.has(id));
      const nextAttachments = removedInlineIds.length ? attachmentsRef.current.filter((attachment) => !removedInlineIds.includes(attachment.id)) : attachmentsRef.current;
      if (removedInlineIds.length) {
        attachmentsRef.current = nextAttachments;
        onAttachmentsChangeRef.current(nextAttachments);
      }
      inlineIdsRef.current = nextInlineIds;
      const next = normalizeDocumentAttachments(candidate, nextAttachments);
      lastEmittedRef.current = JSON.stringify(next);
      onChangeRef.current(next, documentPlainText(next));
    }
  }, [capability, placeholder]);

  useEffect(() => editor?.setEditable(!disabled), [disabled, editor]);

  useEffect(() => {
    settingsRef.current = documentValue.settings ?? defaultDocumentSettings;
    setSettings(settingsRef.current);
    inlineIdsRef.current = new Set(documentValue.nodes.filter((node) => node.type === "attachment").map((node) => node.attachmentId));
    if (!editor) return;
    const incoming = JSON.stringify(documentValue);
    if (incoming === lastEmittedRef.current) return;
    const current = tiptapToSymposiumDocument(editor.getJSON(), settingsRef.current, capability);
    if (JSON.stringify(current) !== incoming) editor.commands.setContent(symposiumDocumentToTiptap(documentValue), { emitUpdate: false });
  }, [documentValue, editor]);

  const emitSettings = (nextSettings: NonNullable<SymposiumDocument["settings"]>) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    if (!editor) return;
    const next = normalizeDocumentAttachments(tiptapToSymposiumDocument(editor.getJSON(), nextSettings, capability), attachments);
    lastEmittedRef.current = JSON.stringify(next);
    onChange(next, documentPlainText(next));
  };

  const insertEquation = () => {
    if (!editor) return;
    const paragraphAttributes = currentParagraphAttributes(editor);
    editor.chain().focus().insertContent([
      { type: "symposiumEquation", attrs: { blockId: newDocumentBlockId("equation"), source: "E = mc^2", display: true } },
      { type: "paragraph", attrs: paragraphAttributes }
    ]).run();
    applyPreferredStoredFormatting(editor);
  };

  const uploadInline = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || !editor) return;
    setInlineUploading(true);
    onBusyChange?.(true);
    try {
      const uploaded: InquiryAttachment[] = [];
      for (const file of files.slice(0, Math.max(0, 100 - attachments.length))) uploaded.push(await onUploadAttachment(file));
      const nextAttachments = [...attachments, ...uploaded];
      attachmentsRef.current = nextAttachments;
      onAttachmentsChange(nextAttachments);
      const paragraphAttributes = currentParagraphAttributes(editor);
      editor.chain().focus().insertContent([
        ...uploaded.map((attachment) => ({ type: "symposiumAttachment", attrs: { blockId: newDocumentBlockId("asset"), attachmentId: attachment.id } })),
        { type: "paragraph", attrs: paragraphAttributes }
      ]).run();
      applyPreferredStoredFormatting(editor);
    } finally {
      setInlineUploading(false);
      onBusyChange?.(false);
    }
  };

  const currentDocument = editor ? tiptapToSymposiumDocument(editor.getJSON(), settings, capability) : documentValue;
  const inlineIds = new Set(currentDocument.nodes.filter((node) => node.type === "attachment").map((node) => node.attachmentId));
  const appendedAttachments = attachments.filter((attachment) => !inlineIds.has(attachment.id));
  const fakePreviewItem = previewAttachmentId ? ({
    id: "composer-preview",
    kind: capability === "paper" ? "paper" : "thought",
    title: "Attachment preview",
    body: documentPlainText(currentDocument),
    attachments,
    comments: []
  } as unknown as InquiryItem) : null;

  return (
    <section className={`symposium-document-editor capability-${capability}${disabled ? " disabled" : ""}`} aria-label="Document editor">
      {editor ? <EditorToolbar
        editor={editor}
        capability={capability}
        documentValue={{ ...currentDocument, settings }}
        onSettingsChange={emitSettings}
        onInsertEquation={insertEquation}
        onInsertAttachment={() => inlineInputRef.current?.click()}
        uploadDisabled={inlineUploading || disabled || attachments.length >= 100}
      /> : null}
      <input ref={inlineInputRef} className="document-hidden-input" type="file" multiple accept={postAttachmentAccept} disabled={inlineUploading || disabled} onChange={uploadInline} />
      <EditorContext.Provider value={{ attachments, openAttachment: setPreviewAttachmentId }}>
        <div className={`document-editor-canvas document-width-${settings.width} document-margin-${settings.margin}`}>
          <EditorContent editor={editor} />
        </div>
      </EditorContext.Provider>
      <div className="document-appended-attachments">
        <div className="document-appended-label"><Paperclip size={16} /><span>Attachments after the text</span><small>These are shown first in feed previews.</small></div>
        <AttachmentComposerField
          attachments={appendedAttachments}
          maxAttachments={100 - inlineIds.size}
          disabled={disabled}
          onAttachmentsChange={(nextAppended) => {
            const inline = attachments.filter((attachment) => inlineIds.has(attachment.id));
            const nextAttachments = [...inline, ...nextAppended];
            attachmentsRef.current = nextAttachments;
            onAttachmentsChange(nextAttachments);
            if (!editor) return;
            const next = normalizeDocumentAttachments(tiptapToSymposiumDocument(editor.getJSON(), settingsRef.current, capability), nextAttachments);
            lastEmittedRef.current = JSON.stringify(next);
            onChange(next, documentPlainText(next));
          }}
          onBusyChange={onBusyChange}
          onUploadAttachment={onUploadAttachment}
        />
      </div>
      {fakePreviewItem && previewAttachmentId ? <AttachmentPreviewModal item={fakePreviewItem} attachmentId={previewAttachmentId} onClose={() => setPreviewAttachmentId(null)} /> : null}
    </section>
  );
}
