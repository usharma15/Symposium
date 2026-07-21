import type { VersionedDocumentContract } from "@/packages/contracts/src";

type DocumentNode = VersionedDocumentContract["nodes"][number];
type TextNode = Extract<DocumentNode, { type: "paragraph" | "heading" | "quote" }>;
export type TextRun = TextNode["content"][number];
export type TextPart = string | TextRun;

const runs = (parts: TextPart[]): TextRun[] => parts.map((part) =>
  typeof part === "string" ? { text: part } : part
);

export const strong = (text: string): TextRun => ({ text, marks: ["bold"] });
export const emphasis = (text: string): TextRun => ({ text, marks: ["italic"] });
export const underline = (text: string): TextRun => ({ text, marks: ["underline"] });
export const externalLink = (text: string, link: string): TextRun => ({ text, link });

export const paragraph = (...content: TextPart[]): Omit<Extract<DocumentNode, { type: "paragraph" }>, "id"> => ({
  type: "paragraph",
  content: runs(content),
  align: "left",
  indent: 0
});

export const heading = (text: string, level: 2 | 3 = 2): Omit<Extract<DocumentNode, { type: "heading" }>, "id"> => ({
  type: "heading",
  level,
  content: [{ text }],
  align: "left"
});

export const quotation = (...content: TextPart[]): Omit<Extract<DocumentNode, { type: "quote" }>, "id"> => ({
  type: "quote",
  content: runs(content)
});

export const citation = (
  label: string,
  href: string,
  excerpt?: string
): Omit<Extract<DocumentNode, { type: "citation" }>, "id"> => ({
  type: "citation",
  label,
  href,
  ...(excerpt ? { excerpt } : {})
});

export const attachmentBlock = (
  attachmentId: string,
  caption: string
): Omit<Extract<DocumentNode, { type: "attachment" }>, "id"> => ({
  type: "attachment",
  attachmentId,
  placement: "inline",
  caption
});

export const equation = (source: string, label?: string): Omit<Extract<DocumentNode, { type: "equation" }>, "id"> => ({
  type: "equation",
  source,
  display: true,
  ...(label ? { label } : {})
});

export const document = (
  prefix: string,
  nodes: Array<Omit<DocumentNode, "id">>,
  settings: NonNullable<VersionedDocumentContract["settings"]> = { width: "standard", margin: "normal" }
): VersionedDocumentContract => ({
  version: 1,
  nodes: nodes.map((node, index) => ({ ...node, id: `${prefix}-${index + 1}` } as DocumentNode)),
  settings
});
