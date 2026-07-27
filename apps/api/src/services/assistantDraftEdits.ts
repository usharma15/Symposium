import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  assistantDraftEditOperationsSchema,
  documentPlainTextProjection,
  type AssistantDraftEditOperationContract,
  type VersionedDocumentContract
} from "../../../../packages/contracts/src";

export type AssistantDraftModelBlock = {
  id: string;
  type: VersionedDocumentContract["nodes"][number]["type"];
  text: string;
  editable: boolean;
};

export type AssistantDraftModelContext = {
  documentId: string;
  title: string;
  revision: number;
  kind: string;
  blocks: AssistantDraftModelBlock[];
  truncated: boolean;
};

const textForNode = (node: VersionedDocumentContract["nodes"][number]) => {
  if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") {
    return node.content.map((run) => run.text).join("");
  }
  if (node.type === "list") {
    return node.items.map((item) => item.map((run) => run.text).join("")).join("\n");
  }
  if (node.type === "code") return node.code;
  if (node.type === "equation") return node.source;
  if (node.type === "citation") return node.label;
  if (node.type === "reference") return node.resource.label ?? "";
  return node.caption ?? "";
};

const nodeContainsNativeCitation = (
  node: VersionedDocumentContract["nodes"][number]
) => {
  if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") {
    return node.content.some((run) => Boolean(run.citation));
  }
  if (node.type === "list") {
    return node.items.some((item) => item.some((run) => Boolean(run.citation)));
  }
  return false;
};

const editableNode = (node: VersionedDocumentContract["nodes"][number]) =>
  (node.type === "paragraph" || node.type === "heading" || node.type === "quote") &&
  !nodeContainsNativeCitation(node);

export const assistantDraftModelBlocks = (
  document: VersionedDocumentContract,
  limits: { blocks?: number; characters?: number } = {}
) => {
  const blockLimit = limits.blocks ?? 100;
  const characterLimit = limits.characters ?? 20_000;
  const blocks: AssistantDraftModelBlock[] = [];
  let characters = 0;
  let truncated = false;
  for (const node of document.nodes) {
    const text = textForNode(node);
    if (blocks.length >= blockLimit || characters + text.length > characterLimit) {
      truncated = true;
      break;
    }
    blocks.push({
      id: node.id,
      type: node.type,
      text,
      editable: editableNode(node)
    });
    characters += text.length;
  }
  if (blocks.length < document.nodes.length) truncated = true;
  return { blocks, truncated };
};

const editFailure = (message: string) => new TRPCError({
  code: "PRECONDITION_FAILED",
  message
});

export const applyAssistantDraftEditOperations = (
  document: VersionedDocumentContract,
  rawOperations: AssistantDraftEditOperationContract[],
  idFactory: () => string = () => `assistant-edit-${randomUUID()}`
) => {
  const operations = assistantDraftEditOperationsSchema.parse(rawOperations);
  let nodes = [...document.nodes];
  let title: string | null = null;

  for (const operation of operations) {
    if (operation.operation === "replace_title") {
      title = operation.text.trim();
      continue;
    }
    if (operation.operation === "insert_paragraph_after") {
      const index = operation.afterBlockId === "__start__"
        ? -1
        : nodes.findIndex((node) => node.id === operation.afterBlockId);
      if (index < -1 || (index === -1 && operation.afterBlockId !== "__start__")) {
        throw editFailure("The AI edit refers to a draft block that no longer exists.");
      }
      nodes.splice(index + 1, 0, {
        id: idFactory(),
        type: "paragraph",
        content: [{ text: operation.text.trim() }],
        align: "left",
        indent: 0
      });
      continue;
    }

    const index = nodes.findIndex((node) => node.id === operation.blockId);
    if (index < 0) {
      throw editFailure("The AI edit refers to a draft block that no longer exists.");
    }
    const current = nodes[index]!;
    if (!editableNode(current)) {
      throw editFailure(
        "The AI edit targeted a protected citation, attachment, reference, equation, list, code, or drawing block."
      );
    }
    if (
      current.type !== "paragraph" &&
      current.type !== "heading" &&
      current.type !== "quote"
    ) {
      throw editFailure("The AI edit targeted an unsupported draft block.");
    }
    if (operation.operation === "delete_block") {
      nodes.splice(index, 1);
      continue;
    }
    const content = [{ text: operation.text.trim() }];
    if (current.type === "heading") {
      nodes[index] = { ...current, content };
    } else if (current.type === "quote") {
      nodes[index] = { ...current, content };
    } else {
      nodes[index] = { ...current, content };
    }
  }

  if (!nodes.length) {
    nodes = [{
      id: idFactory(),
      type: "paragraph",
      content: [],
      align: "left",
      indent: 0
    }];
  }
  const nextDocument = { ...document, nodes };
  return {
    document: nextDocument,
    body: documentPlainTextProjection(nextDocument),
    title,
    operationCount: operations.length
  };
};
