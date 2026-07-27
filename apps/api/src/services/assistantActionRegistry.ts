import {
  assistantActionProposalSchema,
  assistantActionProposalDraftSchema,
  assistantActionToolSchema,
  confirmAssistantOfficeDraftEditInputSchema,
  confirmAssistantOfficeNoteDraftInputSchema,
  confirmAssistantOfficePostDraftInputSchema,
  type AssistantActionProposalContract,
  type AssistantActionProposalDraftContract,
  type AssistantActionSourceContract,
  type AssistantActionToolContract
} from "../../../../packages/contracts/src";

export const assistantActionRegistry = {
  "office.note.create_draft": {
    permission: "draft",
    requiresConfirmation: true,
    inputSchema: confirmAssistantOfficeNoteDraftInputSchema,
    destination: "private Office note draft"
  },
  "office.post.create_draft": {
    permission: "draft",
    requiresConfirmation: true,
    inputSchema: confirmAssistantOfficePostDraftInputSchema,
    destination: "private Office Thought or Paper draft"
  },
  "office.document.edit_draft": {
    permission: "draft",
    requiresConfirmation: true,
    inputSchema: confirmAssistantOfficeDraftEditInputSchema,
    destination: "the active private Office draft"
  }
} as const satisfies Record<
  AssistantActionToolContract,
  {
    permission: "draft";
    requiresConfirmation: true;
    inputSchema: {
      parse: (input: unknown) => unknown;
    };
    destination: string;
  }
>;

export const registeredAssistantAction = (tool: unknown) => {
  const parsedTool = assistantActionToolSchema.parse(tool);
  return assistantActionRegistry[parsedTool];
};

type AssistantCreationTool =
  | "office.note.create_draft"
  | "office.post.create_draft";

export type AssistantActionRequestResolution = {
  request: string;
  followup: boolean;
  tool: AssistantCreationTool | null;
};

const explicitlyRequestsOfficeDraft = (
  latestRequest: string,
  tool: AssistantActionToolContract
) => {
  const normalized = latestRequest
    .normalize("NFKC")
    .replace(/["“][\s\S]*?["”]/g, " ")
    .replace(/`[\s\S]*?`/g, " ");
  const quotedSourceBoundary = normalized.search(
    /\b(?:attachment|document|it|message|source|text)\s+(?:contains|reads|says|states)\s*:/i
  );
  const request = quotedSourceBoundary >= 0
    ? normalized.slice(0, quotedSourceBoundary)
    : normalized;
  const draftVerbWords =
    "(?:capture|convert|create|draft|make|prepare|save|take|turn|write)";
  if (
    new RegExp(
      `\\b(?:do\\s+not|don't|dont|never)\\s+(?:please\\s+)?${draftVerbWords}\\b`,
      "i"
    ).test(request)
  ) {
    return false;
  }
  if (
    tool === "office.post.create_draft" &&
    (
      /\b(?:publish|share|send)\b/i.test(request) ||
      /\bpost\s+(?:it|this|that|the\s+(?:draft|post))\b/i.test(request)
    )
  ) {
    return false;
  }
  const directRequest = new RegExp(
    `(?:^|[.!?:;,]\\s*)(?:please\\s+)?(?:(?:now|okay|ok|alright|so)(?:,\\s*|\\s+))?(?:(?:(?:can|could|will|would)\\s+you|i\\s+(?:need|want)\\s+you\\s+to|i(?:'d|\\s+would)\\s+like\\s+you\\s+to)\\s+)?(?:please\\s+)?${draftVerbWords}\\b`,
    "i"
  );
  if (!directRequest.test(request)) return false;
  if (tool === "office.note.create_draft") {
    return (
      /\bnote\s+draft\b/i.test(request) ||
      /\bdraft\s+(?:me\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}note\b/i.test(request) ||
      /\b(?:as|into|to)\s+(?:a\s+)?(?:(?:private|office)\s+){0,2}note\b/i.test(request) ||
      /\b(?:capture|create|make|prepare|save|take|write)\s+(?:me\s+)?(?:this\s+|the\s+|a\s+)?(?:(?:private|office)\s+){0,2}note\b/i.test(request)
    );
  }
  return (
    /\b(?:thought|paper)\s+(?:post\s+)?draft\b/i.test(request) ||
    /\bdraft\s+(?:me\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}(?:thought|paper)\b/i.test(request) ||
    /\b(?:as|into|to)\s+(?:a\s+)?(?:(?:private|office)\s+){0,2}(?:thought|paper)\b/i.test(request) ||
    /\b(?:make|turn)\s+this\s+(?:a\s+)?(?:(?:private|office)\s+){0,2}(?:thought|paper)\b/i.test(request) ||
    /\b(?:create|make|prepare|write)\s+(?:me\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}(?:thought|paper)\b/i.test(request) ||
    /\b(?:create|make|prepare|write)\s+(?:me\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}post\b/i.test(request) ||
    /\b(?:make|turn)\s+this\s+(?:into\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}post\b/i.test(request) ||
    /\b(?:as|into|to)\s+(?:a\s+)?(?:(?:private|office)\s+){0,2}post\b/i.test(request) ||
    /\b(?:post\s+draft|draft\s+(?:a\s+)?(?:private\s+)?post)\b/i.test(request)
  );
};

const requestedCreationTool = (request: string): AssistantCreationTool | null => {
  const tools = ([
    "office.note.create_draft",
    "office.post.create_draft"
  ] as const).filter((tool) => explicitlyRequestsOfficeDraft(request, tool));
  return tools.length === 1 ? tools[0]! : null;
};

const briefActionConfirmation = (request: string) =>
  /^(?:ok(?:ay)?(?:,?\s+please)?(?:\s+(?:do|make|create)\s+(?:it|that))?|yes(?:,?\s+please)?|(?:yeah|yep|yup)(?:,?\s+(?:please|go\s+ahead|do\s+(?:it|that)))?|go\s+(?:ahead|for\s+it)|(?:do|make|create)\s+(?:it|that)|please\s+do|sure(?:,?\s+(?:please|go\s+ahead|do\s+(?:it|that)))?|sounds\s+good)[.!]*$/i
    .test(request.normalize("NFKC").trim());

const assistantInvitedDraftFollowup = (response: string) =>
  /\b(?:office action|nothing was created|private (?:office )?(?:note|thought|paper|post)?\s*draft|draft proposal|prepare (?:a |the |that |this )?(?:note|thought|paper|post|draft))\b/i
    .test(response.normalize("NFKC"));

export const assistantActionRequestForTurn = (
  latestRequest: string,
  history: Array<{ role: "user" | "assistant"; body: string }>
): AssistantActionRequestResolution => {
  const directTool = requestedCreationTool(latestRequest);
  if (directTool) {
    return { request: latestRequest, followup: false, tool: directTool };
  }
  if (!briefActionConfirmation(latestRequest)) {
    return { request: latestRequest, followup: false, tool: null };
  }
  const priorAssistant = history.at(-1);
  const priorUser = history.at(-2);
  if (
    priorAssistant?.role !== "assistant" ||
    priorUser?.role !== "user" ||
    !assistantInvitedDraftFollowup(priorAssistant.body)
  ) {
    return { request: latestRequest, followup: false, tool: null };
  }
  const priorTool = requestedCreationTool(priorUser.body);
  return priorTool
    ? { request: priorUser.body, followup: true, tool: priorTool }
    : { request: latestRequest, followup: false, tool: null };
};

const explicitlyRequestsActiveDraftEdit = (latestRequest: string) => {
  const normalized = latestRequest
    .normalize("NFKC")
    .replace(/["“][\s\S]*?["”]/g, " ")
    .replace(/`[\s\S]*?`/g, " ")
    .trim();
  const quotedSourceBoundary = normalized.search(
    /\b(?:attachment|document|message|source|text)\s+(?:contains|reads|says|states)\s*:/i
  );
  const request = quotedSourceBoundary >= 0
    ? normalized.slice(0, quotedSourceBoundary)
    : normalized;
  if (
    /\b(?:do\s+not|don't|dont|never)\s+(?:please\s+)?(?:change|edit|revise|rewrite|shorten|expand|tighten|fix|remove|add|replace|rename|retitle|update|polish|improve|make)\b/i
      .test(request)
  ) {
    return false;
  }
  return /(?:^|[.!?:;,]\s*)(?:please\s+)?(?:(?:(?:can|could|will|would)\s+you|i\s+(?:need|want)\s+you\s+to|i(?:'d|\s+would)\s+like\s+you\s+to)\s+)?(?:please\s+)?(?:change|edit|revise|rewrite|shorten|expand|tighten|fix|remove|add|replace|rename|retitle|update|polish|improve|make)\b/i
    .test(request);
};

export const assistantActionProposalFromDraft = (
  draftInput: Omit<AssistantActionProposalDraftContract, "editOperations"> & {
    editOperations?: AssistantActionProposalDraftContract["editOperations"];
  },
  latestRequest: string,
  source?: AssistantActionSourceContract,
  draftSession?: {
    documentId: string;
    expectedRevision: number;
    title: string;
  }
): AssistantActionProposalContract | undefined => {
  const draft = assistantActionProposalDraftSchema.parse(draftInput);
  if (draft.tool === "none") return undefined;
  if (draft.tool === "office.document.edit_draft") {
    if (!draftSession || !explicitlyRequestsActiveDraftEdit(latestRequest)) return undefined;
    const action = registeredAssistantAction(draft.tool);
    return assistantActionProposalSchema.parse({
      tool: draft.tool,
      documentId: draftSession.documentId,
      expectedRevision: draftSession.expectedRevision,
      title: draftSession.title,
      body: draft.body,
      editOperations: draft.editOperations,
      requiresConfirmation: action.requiresConfirmation
    });
  }
  if (!explicitlyRequestsOfficeDraft(latestRequest, draft.tool)) return undefined;
  const action = registeredAssistantAction(draft.tool);
  const shared = {
    tool: draft.tool,
    title: draft.title,
    body: draft.body,
    requiresConfirmation: action.requiresConfirmation,
    ...(source ? { source } : {})
  };
  return assistantActionProposalSchema.parse(
    draft.tool === "office.post.create_draft"
      ? { ...shared, postKind: draft.postKind }
      : shared
  );
};
