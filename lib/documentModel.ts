import type {
  ContentKindContract,
  InquiryAttachmentContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";

export type SymposiumDocument = VersionedDocumentContract;
export type SymposiumDocumentNode = SymposiumDocument["nodes"][number];
export type SymposiumTextRun = Extract<SymposiumDocumentNode, { type: "paragraph" }>["content"][number];
export type EditorCapability = "reduced" | "paper";

const makeId = (prefix = "block") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

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
    nodes: (paragraphs.length ? paragraphs : [""]).map((paragraph) => ({
      id: makeId(),
      type: "paragraph" as const,
      content: paragraph ? [{ text: paragraph }] : [],
      align: "left" as const,
      indent: 0
    })),
    settings: { width: "standard", margin: "normal" }
  };
};

const runText = (content: SymposiumTextRun[]) => content.map((run) => run.text).join("");

export const documentPlainText = (document: SymposiumDocument | undefined, fallback = "") => {
  if (!document) return fallback;
  return document.nodes
    .map((node) => {
      if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") return runText(node.content);
      if (node.type === "list") return node.items.map((item) => runText(item)).join("\n");
      if (node.type === "code") return node.code;
      if (node.type === "equation") return node.source;
      if (node.type === "citation") return node.label;
      if (node.type === "reference") return node.resource.label ?? "";
      return node.caption ?? "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
};

export const documentForContent = (document: SymposiumDocument | undefined, body: string) =>
  document ?? plainTextDocument(body);

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
