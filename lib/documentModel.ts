import type {
  ContentKindContract,
  InquiryAttachmentContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";
import { documentPlainTextProjection } from "@/packages/contracts/src";

export type SymposiumDocument = VersionedDocumentContract;
export type SymposiumDocumentNode = SymposiumDocument["nodes"][number];
export type SymposiumTextRun = Extract<SymposiumDocumentNode, { type: "paragraph" }>["content"][number];
export type EditorCapability = "reduced" | "paper" | "scribble";

const makeId = (prefix = "block") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const stableTextBlockId = (text: string, index: number) => {
  let hash = 2166136261;
  for (let offset = 0; offset < text.length; offset += 1) {
    hash ^= text.charCodeAt(offset);
    hash = Math.imul(hash, 16777619);
  }
  return `plain-${index}-${(hash >>> 0).toString(36)}`;
};

export const newDocumentBlockId = makeId;

export const emptySymposiumDocument = (): SymposiumDocument => ({
  version: 1,
  nodes: [{ id: makeId(), type: "paragraph", content: [], align: "left", indent: 0 }],
  settings: { width: "standard", margin: "normal" }
});

export const plainTextDocument = (body: string): SymposiumDocument => {
  const paragraphs = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return {
    version: 1,
    nodes: (paragraphs.length ? paragraphs : [""]).map((paragraph, index) => ({
      id: stableTextBlockId(paragraph, index),
      type: "paragraph" as const,
      content: paragraph ? [{ text: paragraph }] : [],
      align: "left" as const,
      indent: 0
    })),
    settings: { width: "standard", margin: "normal" }
  };
};

export const documentPlainText = (document: SymposiumDocument | undefined, fallback = "") => {
  if (!document) return fallback;
  return documentPlainTextProjection(document);
};

export const documentForContent = (document: SymposiumDocument | undefined, body: string) =>
  document ?? plainTextDocument(body);

const translatedNodeForSource = (
  sourceNode: SymposiumDocumentNode,
  translatedNode: SymposiumDocumentNode | undefined
): SymposiumDocumentNode => {
  if (!translatedNode || translatedNode.type !== sourceNode.type) return sourceNode;

  if (
    sourceNode.type === "paragraph" ||
    sourceNode.type === "heading" ||
    sourceNode.type === "quote"
  ) {
    if (
      translatedNode.type !== "paragraph" &&
      translatedNode.type !== "heading" &&
      translatedNode.type !== "quote"
    ) return sourceNode;
    return {
      ...sourceNode,
      content: sourceNode.content.map((run, index) => ({
        ...run,
        text: translatedNode.content[index]?.text ?? run.text
      }))
    };
  }

  if (sourceNode.type === "list") {
    if (translatedNode.type !== "list") return sourceNode;
    return {
      ...sourceNode,
      items: sourceNode.items.map((item, itemIndex) =>
        item.map((run, runIndex) => ({
          ...run,
          text: translatedNode.items[itemIndex]?.[runIndex]?.text ?? run.text
        }))
      )
    };
  }

  if (sourceNode.type === "attachment") {
    if (translatedNode.type !== "attachment") return sourceNode;
    return { ...sourceNode, caption: translatedNode.caption ?? sourceNode.caption };
  }

  if (sourceNode.type === "drawing") {
    if (translatedNode.type !== "drawing") return sourceNode;
    return { ...sourceNode, caption: translatedNode.caption ?? sourceNode.caption };
  }

  if (sourceNode.type === "reference") {
    if (translatedNode.type !== "reference") return sourceNode;
    return {
      ...sourceNode,
      resource: {
        ...sourceNode.resource,
        label: translatedNode.resource.label ?? sourceNode.resource.label
      }
    };
  }

  if (sourceNode.type === "citation") {
    if (translatedNode.type !== "citation") return sourceNode;
    return {
      ...sourceNode,
      label: translatedNode.label,
      excerpt: translatedNode.excerpt
    };
  }

  return sourceNode;
};

export const translatedDocumentForSource = ({
  sourceDocument,
  sourceBody,
  translatedDocument,
  translatedBody
}: {
  sourceDocument: SymposiumDocument | undefined;
  sourceBody: string;
  translatedDocument: SymposiumDocument | undefined;
  translatedBody: string;
}): SymposiumDocument => {
  const source = documentForContent(sourceDocument, sourceBody);
  const translated = documentForContent(translatedDocument, translatedBody);
  const translatedById = new Map(translated.nodes.map((node) => [node.id, node]));

  return {
    ...source,
    nodes: source.nodes.map((sourceNode, index) => {
      const idMatch = translatedById.get(sourceNode.id);
      const positionalMatch = translated.nodes[index];
      return translatedNodeForSource(
        sourceNode,
        idMatch?.type === sourceNode.type ? idMatch : positionalMatch
      );
    }),
    settings: source.settings ? { ...source.settings } : undefined
  };
};

export const editorCapabilityForKind = (kind: ContentKindContract): EditorCapability =>
  kind === "paper" ? "paper" : "reduced";

export const inlineAttachmentIds = (document: SymposiumDocument | undefined) =>
  document?.nodes
    .filter((node): node is Extract<SymposiumDocumentNode, { type: "attachment" }> => node.type === "attachment")
    .map((node) => node.attachmentId) ?? [];

export const orderedContentAttachments = (
  document: SymposiumDocument | undefined,
  attachments: InquiryAttachmentContract[]
) => {
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const inlineIds = inlineAttachmentIds(document);
  const inlineSet = new Set(inlineIds);
  const appended = attachments.filter((attachment) => !inlineSet.has(attachment.id));
  const inline = inlineIds.flatMap((id) => {
    const attachment = byId.get(id);
    return attachment ? [attachment] : [];
  });
  return { appended, inline };
};

export const feedPreviewAttachments = (
  document: SymposiumDocument | undefined,
  attachments: InquiryAttachmentContract[],
  limit = 10
) => {
  const eligible = (attachment: InquiryAttachmentContract) =>
    attachment.kind === "image" ||
    attachment.kind === "video" ||
    attachment.kind === "pdf" ||
    attachment.kind === "text" ||
    attachment.kind === "document" ||
    attachment.kind === "code" ||
    attachment.kind === "spreadsheet" ||
    attachment.kind === "presentation";
  const { appended, inline } = orderedContentAttachments(document, attachments);
  const seen = new Set<string>();
  return [...appended, ...inline].filter((attachment) => {
    if (!eligible(attachment) || seen.has(attachment.id)) return false;
    seen.add(attachment.id);
    return true;
  }).slice(0, limit);
};

export const appendedContentAttachments = (
  document: SymposiumDocument | undefined,
  attachments: InquiryAttachmentContract[]
) => orderedContentAttachments(document, attachments).appended;

export const normalizeDocumentAttachments = (
  document: SymposiumDocument,
  attachments: InquiryAttachmentContract[]
) => {
  const available = new Set(attachments.map((attachment) => attachment.id));
  const seenBlocks = new Set<string>();
  const seenAttachments = new Set<string>();
  const nodes = document.nodes.filter((node) => {
    if (seenBlocks.has(node.id)) return false;
    seenBlocks.add(node.id);
    if (node.type !== "attachment") return true;
    if (!available.has(node.attachmentId) || seenAttachments.has(node.attachmentId)) return false;
    seenAttachments.add(node.attachmentId);
    return true;
  });
  return { ...document, nodes: nodes.length ? nodes : emptySymposiumDocument().nodes };
};
