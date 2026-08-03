import {
  isSafeInternalRoute,
  type AssistantContextContract,
  type AssistantEvidenceClaimDraftContract,
  type AssistantMessageContract,
  type AssistantThreadSourceContract
} from "../../../../packages/contracts/src";

export type AssistantSourceValidation = {
  source: AssistantThreadSourceContract;
  accessStatus: "verified" | "not_applicable";
  currentEntityRevision: number | null;
};

export type AssistantEvidenceBlock = {
  ref: string;
  sourceId: string;
  sourceRevision: number;
  title: string;
  label: string;
  excerpt: string;
  route: string;
  kind: AssistantMessageContract["claims"][number]["citations"][number]["kind"];
  entityType?: string;
  entityId?: string;
  pageNumber: number | null;
};

export type AssistantEvidencePacket = {
  sourceRef: string;
  title: string;
  surface: AssistantContextContract["surface"];
  savedSourceRevision: number;
  capturedEntityRevision: number | null;
  currentEntityRevision: number | null;
  revisionStatus: "current" | "changed" | "unversioned";
  active: boolean;
  blocks: Array<{
    ref: string;
    label: string;
    excerpt: string;
    kind: AssistantEvidenceBlock["kind"];
  }>;
};

const maxBlocksPerSource = 16;
const maxExcerptCharacters = 900;

const positiveRevision = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

const sourceRevisionStatus = (
  capturedEntityRevision: number | null,
  currentEntityRevision: number | null
) => {
  if (!capturedEntityRevision || !currentEntityRevision) return "unversioned" as const;
  return capturedEntityRevision === currentEntityRevision ? "current" as const : "changed" as const;
};

const safeRoute = (value: string) =>
  isSafeInternalRoute(value) ? value.slice(0, 500) : "/";

const routeWithComment = (route: string, commentId: string) => {
  const url = new URL(safeRoute(route), "https://symposium.invalid");
  url.searchParams.set("comment", commentId);
  return `${url.pathname}${url.search}`.slice(0, 500);
};

const routeWithMessage = (route: string, messageId: string) => {
  const base = safeRoute(route).split("#", 1)[0]!;
  return `${base}#message-${encodeURIComponent(messageId)}`.slice(0, 500);
};

const splitLongText = (value: string) => {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxExcerptCharacters) {
    const window = remaining.slice(0, maxExcerptCharacters + 1);
    const candidates = [
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf("; "),
      window.lastIndexOf(" ")
    ];
    const boundary = Math.max(...candidates);
    const cut = boundary >= Math.floor(maxExcerptCharacters * 0.55)
      ? boundary + (window.slice(boundary, boundary + 2) === ". " ? 1 : 0)
      : maxExcerptCharacters;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};

const contextParagraphs = (context: AssistantContextContract) =>
  context.content
    .split(/\n{2,}/)
    .flatMap(splitLongText)
    .filter(Boolean);

const markerForParagraph = (paragraph: string) => {
  const comment = paragraph.match(/^\[Comment ([^\]\s·]+)(?:\s+·\s+revision\s+\d+)?\]\s*\n?/i);
  if (comment?.[1]) {
    return {
      id: comment[1],
      kind: "comment" as const,
      clean: paragraph.slice(comment[0].length).trim()
    };
  }
  const message = paragraph.match(/^\[Message ([0-9a-f-]{36})(?:\s+·\s+revision\s+\d+)?\]\s*\n?/i);
  if (message?.[1]) {
    return {
      id: message[1],
      kind: "message" as const,
      clean: paragraph.slice(message[0].length).trim()
    };
  }
  return null;
};

const evidenceBlocksForSource = (
  validation: AssistantSourceValidation,
  sourceIndex: number
): AssistantEvidenceBlock[] => {
  const { source } = validation;
  const context = source.context;
  const pageNumber = positiveRevision(context.metadata.pdfPage ?? context.metadata.page);
  const contentType = typeof context.metadata.contentType === "string"
    ? context.metadata.contentType
    : "";
  const image = context.surface === "attachment" && contentType.startsWith("image/");
  const blocks: AssistantEvidenceBlock[] = [];
  const add = (
    excerpt: string,
    label: string,
    kind: AssistantEvidenceBlock["kind"],
    route = context.route
  ) => {
    const normalized = excerpt.trim().slice(0, 1000);
    if (!normalized || blocks.length >= maxBlocksPerSource) return;
    blocks.push({
      ref: `S${sourceIndex + 1}.B${blocks.length + 1}`,
      sourceId: source.id,
      sourceRevision: source.revision,
      title: context.title,
      label,
      excerpt: normalized,
      route: safeRoute(route),
      kind,
      ...(context.entityType ? { entityType: context.entityType } : {}),
      ...(context.entityId ? { entityId: context.entityId } : {}),
      pageNumber
    });
  };

  const canonicalRoute = safeRoute(context.route);
  add(`Canonical route: ${canonicalRoute}`, "Canonical route", "source", canonicalRoute);

  if (context.selection?.trim()) {
    splitLongText(context.selection).forEach((excerpt, index) => {
      add(
        excerpt,
        pageNumber
          ? `Selected passage · page ${pageNumber}${index ? ` · part ${index + 1}` : ""}`
          : `Selected passage${index ? ` · part ${index + 1}` : ""}`,
        "selection"
      );
    });
  }

  if (image) {
    add(context.summary || context.title, "Image source", "image");
    return blocks;
  }

  const paragraphs = contextParagraphs(context);
  paragraphs.forEach((paragraph, index) => {
    const marker = markerForParagraph(paragraph);
    if (marker?.kind === "comment") {
      add(
        marker.clean || "Comment",
        `Comment · ${marker.id}`,
        "comment",
        routeWithComment(context.route, marker.id)
      );
      return;
    }
    if (marker?.kind === "message") {
      add(
        marker.clean || "Message",
        `Message · ${marker.id.slice(0, 8)}`,
        "message",
        routeWithMessage(context.route, marker.id)
      );
      return;
    }
    add(
      paragraph,
      pageNumber ? `Page ${pageNumber} · passage ${index + 1}` : `Passage ${index + 1}`,
      pageNumber ? "page" : context.surface === "attachment" ? "attachment" : "paragraph"
    );
  });

  if (!blocks.length) {
    add(context.summary || context.title, "Source summary", "source");
  }
  return blocks;
};

export const buildAssistantEvidence = (
  validations: AssistantSourceValidation[],
  activeSourceId: string | null,
  sourceOffset = 0
): {
  evidence: AssistantMessageContract["evidence"];
  blocks: AssistantEvidenceBlock[];
  packets: AssistantEvidencePacket[];
} => {
  const evidence: AssistantMessageContract["evidence"] = [];
  const blocks: AssistantEvidenceBlock[] = [];
  const packets: AssistantEvidencePacket[] = [];

  validations.forEach((validation, index) => {
    const capturedEntityRevision = positiveRevision(validation.source.context.metadata.revision);
    const revisionStatus = sourceRevisionStatus(
      capturedEntityRevision,
      validation.currentEntityRevision
    );
    const sourceBlocks = evidenceBlocksForSource(validation, index + sourceOffset);
    evidence.push({
      sourceId: validation.source.id,
      key: validation.source.key,
      revision: validation.source.revision,
      title: validation.source.context.title,
      surface: validation.source.context.surface,
      route: safeRoute(validation.source.context.route),
      active: validation.source.id === activeSourceId,
      accessStatus: validation.accessStatus,
      capturedEntityRevision,
      currentEntityRevision: validation.currentEntityRevision,
      revisionStatus
    });
    blocks.push(...sourceBlocks);
    packets.push({
      sourceRef: `S${index + sourceOffset + 1}`,
      title: validation.source.context.title,
      surface: validation.source.context.surface,
      savedSourceRevision: validation.source.revision,
      capturedEntityRevision,
      currentEntityRevision: validation.currentEntityRevision,
      revisionStatus,
      active: validation.source.id === activeSourceId,
      blocks: sourceBlocks.map((block) => ({
        ref: block.ref,
        label: block.label,
        excerpt: block.excerpt,
        kind: block.kind
      }))
    });
  });

  return { evidence, blocks, packets };
};

export const resolveAssistantEvidenceClaims = (
  claims: AssistantEvidenceClaimDraftContract[],
  blocks: AssistantEvidenceBlock[]
): AssistantMessageContract["claims"] => {
  const byRef = new Map(blocks.map((block) => [block.ref, block]));
  return claims.map((claim) => {
    const uniqueRefs = Array.from(new Set(claim.sourceRefs));
    const citations = uniqueRefs.flatMap((ref) => {
      const block = byRef.get(ref);
      return block ? [block] : [];
    });
    return {
      claim: claim.claim,
      kind: claim.kind,
      citations
    };
  });
};

export const assertAssistantEvidenceReferences = (
  claims: AssistantEvidenceClaimDraftContract[],
  blocks: AssistantEvidenceBlock[]
) => {
  const allowed = new Set(blocks.map((block) => block.ref));
  for (const claim of claims) {
    if (claim.sourceRefs.some((ref) => !allowed.has(ref))) {
      throw new Error("The model cited a source passage that was not supplied.");
    }
    if (claim.kind === "direct" && claim.sourceRefs.length === 0) {
      throw new Error("A direct evidence claim omitted its source passage.");
    }
    if (claim.kind === "insufficient" && claim.sourceRefs.length > 0) {
      throw new Error("An insufficient-context claim cited a source passage.");
    }
  }
};
