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
  postKind?: "thought" | "paper";
};

const consequentialActionLanguage = (request: string) =>
  /\b(?:publish|share|send|email|message)\s+(?:it|this|that|the\s+(?:draft|post|note|thought|paper))\b/i
    .test(request) ||
  /\b(?:publish|share|send|email|message)\s+(?:to|with)\s+\S/i.test(request) ||
  /\band\s+(?:then\s+)?(?:publish|share|send|email|message)\b/i.test(request) ||
  /\bpost\s+(?:it|this|that|the\s+(?:draft|post))\b/i.test(request) ||
  /\b(?:make|set)\s+(?:it|this|that|the\s+(?:draft|post))\s+public\b/i.test(request) ||
  /\b(?:change|grant|remove)\s+(?:its?\s+|the\s+)?access\b/i.test(request);

const explicitlyRequestsOfficeDraft = (
  latestRequest: string,
  tool: AssistantActionToolContract
) => {
  const normalized = latestRequest
    .normalize("NFKC")
    .replace(/["“][\s\S]*?["”]/g, " ")
    .replace(/`[\s\S]*?`/g, " ");
  const quotedSourceBoundary = normalized.search(
    /\b(?:attachment|document|it|message|source|text)\s+(?:contains|reads|says|states)\b\s*:?\s*/i
  );
  const request = quotedSourceBoundary >= 0
    ? normalized.slice(0, quotedSourceBoundary)
    : normalized;
  const draftVerbWords =
    "(?:capture|convert|create|draft|file|make|prepare|put|save|take|turn|use|write)";
  if (
    new RegExp(
      `\\b(?:do\\s+not|don't|dont|never)\\s+(?:please\\s+)?${draftVerbWords}\\b`,
      "i"
    ).test(request)
  ) {
    return false;
  }
  if (consequentialActionLanguage(request)) {
    return false;
  }
  const directRequest = new RegExp(
    `(?:^|[.!?:;,]\\s*)(?:please\\s+)?(?:(?:now|okay|ok|alright|so|yes|yeah|yep|yup|sure|right|great)(?:,\\s*|\\s+)(?:(?:like|just)\\s+)?)?(?:(?:(?:can|could|will|would)\\s+you|let'?s|i\\s+(?:need|want)\\s+you\\s+to|i(?:'d|\\s+would)\\s+like\\s+you\\s+to)\\s+)?(?:please\\s+)?${draftVerbWords}\\b`,
    "i"
  );
  if (!directRequest.test(request)) return false;
  if (tool === "office.note.create_draft") {
    return (
      /\bnote\s+draft\b/i.test(request) ||
      /\bdraft\s+(?:me\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}note\b/i.test(request) ||
      /\b(?:as|into|to)\s+(?:a\s+)?(?:(?:private|office)\s+){0,2}note\b/i.test(request) ||
      /\b(?:capture|create|file|make|prepare|save|take|use|write)\s+(?:me\s+)?(?:(?:this|it|that|the|a)\s+)?(?:(?:private|office)\s+){0,2}note\b/i.test(request) ||
      /\b(?:file|put|use)\s+(?:this|it|that)\s+(?:as|for|in|into)\s+(?:a\s+)?(?:(?:private|office)\s+){0,2}note\b/i.test(request)
    );
  }
  return (
    /\b(?:thought|paper)\s+(?:post\s+)?draft\b/i.test(request) ||
    /\bdraft\s+(?:me\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}(?:thought|paper)\b/i.test(request) ||
    /\b(?:as|into|to)\s+(?:a\s+)?(?:(?:private|office)\s+){0,2}(?:thought|paper)\b/i.test(request) ||
    /\b(?:make|turn)\s+(?:this|it|that)\s+(?:into\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}(?:thought|paper)\b/i.test(request) ||
    /\b(?:create|file|make|prepare|write)\s+(?:me\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}(?:thought|paper)\b/i.test(request) ||
    /\b(?:create|file|make|prepare|write)\s+(?:me\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}post\b/i.test(request) ||
    /\b(?:make|turn)\s+(?:this|it|that)\s+(?:into\s+)?(?:a\s+)?(?:(?:private|office)\s+){0,2}post\b/i.test(request) ||
    /\b(?:file|put|use)\s+(?:this|it|that)\s+(?:as|for|in|into)\s+(?:a\s+)?(?:(?:private|office)\s+){0,2}(?:thought|paper|post)\b/i.test(request) ||
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

const clarifiedCreationSelection = (
  request: string
): Pick<AssistantActionRequestResolution, "request" | "tool" | "postKind"> | null => {
  const match = request.normalize("NFKC").trim().match(
    /^(?:(?:ok(?:ay)?|yes|yeah|yep|yup|sure|alright|right|great|perfect)[,.\s-]*)?(?:(?:i\s+think|just)\s+)?(?:(?:go\s+with|let'?s\s+go\s+with|let'?s\s+(?:do|make|use)|make\s+it|use|choose|pick)\s+)?(?:(?:a|the)\s+)?(?:private\s+)?(?:office\s+)?(note|thought|paper|post)(?:\s+draft)?(?:\s+(?:please|pls))?(?:\s+(?:works|is\s+(?:good|fine)|would\s+(?:be|work|do)\s+(?:good|better|fine)))?[.!]*$/i
  );
  const selection = match?.[1]?.toLowerCase();
  if (selection === "note") {
    return {
      request: "Create a private Office note draft from the recent conversation.",
      tool: "office.note.create_draft"
    };
  }
  if (selection === "thought" || selection === "post") {
    return {
      request: "Create a private Office Thought draft from the recent conversation.",
      tool: "office.post.create_draft",
      postKind: "thought"
    };
  }
  if (selection === "paper") {
    return {
      request: "Create a private Office Paper draft from the recent conversation.",
      tool: "office.post.create_draft",
      postKind: "paper"
    };
  }
  return null;
};

const ambiguousSupportedActionRequest = (request: string) => {
  const normalized = request
    .normalize("NFKC")
    .replace(/["“][\s\S]*?["”]/g, " ")
    .replace(/`[\s\S]*?`/g, " ")
    .trim();
  const quotedSourceBoundary = normalized.search(
    /\b(?:attachment|document|message|source|text)\s+(?:contains|reads|says|states)\b\s*:?\s*/i
  );
  const actionText = quotedSourceBoundary >= 0
    ? normalized.slice(0, quotedSourceBoundary).trim()
    : normalized;
  if (
    !actionText ||
    actionText.length > 600 ||
    /\b(?:do\s+not|don't|dont|never)\b/i.test(actionText) ||
    /\b(?:share|send|email|message|delete)\b/i.test(actionText) ||
    /\b(?:change|grant|remove)\s+(?:its?\s+|the\s+)?access\b/i.test(actionText)
  ) {
    return false;
  }
  return /^(?:please\s+)?(?:(?:(?:can|could|will|would)\s+you|let'?s)\s+)?(?:please\s+)?(?:capture|convert|create|draft|file|make|post|prepare|publish|put|save|take|turn|write)\b/i
    .test(actionText);
};

const assistantRequestedPrivateDraftClarification = (response: string) => {
  const normalized = response.normalize("NFKC");
  const kinds = ["note", "thought", "paper", "post"]
    .filter((kind) => new RegExp(`\\b${kind}\\b`, "i").test(normalized));
  return (
    /\bprivate\b/i.test(normalized) &&
    /\bdraft\b/i.test(normalized) &&
    kinds.length >= 2 &&
    /\b(?:or|which|what|want|prefer|choose|pick|tell me)\b/i.test(normalized)
  );
};

const clarifiedActionRequestForTurn = (
  latestRequest: string,
  history: Array<{ role: "user" | "assistant"; body: string }>
): AssistantActionRequestResolution | null => {
  const selection = clarifiedCreationSelection(latestRequest);
  if (!selection) return null;
  const priorAssistant = history.at(-1);
  const priorUser = history.at(-2);
  if (
    priorAssistant?.role !== "assistant" ||
    priorUser?.role !== "user" ||
    !assistantRequestedPrivateDraftClarification(priorAssistant.body) ||
    !ambiguousSupportedActionRequest(priorUser.body)
  ) {
    return null;
  }
  return {
    request: selection.request,
    followup: true,
    tool: selection.tool,
    ...(selection.postKind ? { postKind: selection.postKind } : {})
  };
};

const briefActionConfirmation = (request: string) =>
  /^(?:ok(?:ay)?(?:,?\s+please)?(?:\s+(?:do|make|create)\s+(?:it|that))?|yes(?:,?\s+please)?|(?:yeah|yep|yup)(?:,?\s+(?:please|go\s+ahead|do\s+(?:it|that)))?|go\s+(?:ahead|for\s+it)|(?:do|make|create)\s+(?:it|that)|please\s+do|sure(?:,?\s+(?:please|go\s+ahead|do\s+(?:it|that)))?|sounds\s+good|that\s+works)[.!]*$/i
    .test(request.normalize("NFKC").trim());

const conversationalActionFollowup = (request: string) => {
  const normalized = request.normalize("NFKC").trim();
  if (
    !normalized ||
    normalized.length > 600 ||
    consequentialActionLanguage(normalized)
  ) {
    return false;
  }
  if (briefActionConfirmation(normalized)) return true;
  return /^(?:(?:ok(?:ay)?|yes|yeah|yep|yup|sure|alright|right|great|perfect)(?:[,!.\s-]+|$))?(?:(?:like|just)\s+)?(?:(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:go\s+(?:ahead|for\s+it|with\s+(?:it|that|this))|(?:do|make|create|draft|write|prepare|turn|convert|use|keep|change|revise|rewrite|shorten|expand|tighten|fix|polish|improve)\s+(?:it|that|this|one)\b)|let'?s\s+(?:(?:go\s+with)|do|make|create|draft|write|prepare|revise|rewrite)\s*(?:it|that|this)?\b|(?:that|this)\s+(?:works|is\s+(?:good|fine)|sounds\s+good)\b|(?:a\s+)?(?:note|thought|paper|post)\s+(?:would|will)\s+(?:be|work|do)\s+(?:good|better|fine)\b|(?:(?:but|and)\s+)?(?:make\s+)?(?:it\s+)?(?:a\s+bit\s+)?(?:more|less|shorter|longer|warmer|casual|formal|relaxed|conversational|concise|detailed|skeptical|critical|academic|friendly)\b)/i
    .test(normalized);
};

const assistantSupportsActionContext = (response: string) =>
  /\b(?:office action|nothing was created|nothing is created|private (?:office )?(?:note|thought|paper|post)?\s*draft|draft proposal|(?:prepare|prepared|create|created|made|drafted?|write|wrote)\s+(?:you\s+)?(?:(?:a|the|your|this|that)\s+)?(?:(?:private|office)\s+){0,2}(?:draft|note|thought|paper|post)|(?:note|thought|paper|post)\s+(?:draft|proposal)|here (?:you go|it is)(?:\s*[:,]\s*|\s+)(?:a|the|your)?\s*(?:draft|note|thought|paper|post)|can(?:not|'t)\s+(?:post|publish|share|send))\b/i
    .test(response.normalize("NFKC"));

const assistantRetryableActionBridge = (response: string) =>
  /\b(?:could not finish|couldn't finish|could not complete|couldn't complete|response limit|you can retry|try again|service could not complete)\b/i
    .test(response.normalize("NFKC"));

export const assistantActionRequestForTurn = (
  latestRequest: string,
  history: Array<{ role: "user" | "assistant"; body: string }>
): AssistantActionRequestResolution => {
  const directTool = requestedCreationTool(latestRequest);
  if (directTool) {
    return { request: latestRequest, followup: false, tool: directTool };
  }
  const clarifiedRequest = clarifiedActionRequestForTurn(latestRequest, history);
  if (clarifiedRequest) return clarifiedRequest;
  if (!conversationalActionFollowup(latestRequest)) {
    return { request: latestRequest, followup: false, tool: null };
  }
  let hasRelevantAssistantContext = false;
  for (const entry of history.slice(-6).reverse()) {
    if (entry.role === "assistant") {
      if (assistantSupportsActionContext(entry.body)) {
        hasRelevantAssistantContext = true;
        continue;
      }
      if (assistantRetryableActionBridge(entry.body)) continue;
      break;
    }
    const priorTool = requestedCreationTool(entry.body);
    if (priorTool) {
      return hasRelevantAssistantContext
        ? { request: entry.body, followup: true, tool: priorTool }
        : { request: latestRequest, followup: false, tool: null };
    }
    if (!conversationalActionFollowup(entry.body)) break;
  }
  return { request: latestRequest, followup: false, tool: null };
};

const explicitlyRequestsActiveDraftEdit = (latestRequest: string) => {
  const normalized = latestRequest
    .normalize("NFKC")
    .replace(/["“][\s\S]*?["”]/g, " ")
    .replace(/`[\s\S]*?`/g, " ")
    .trim();
  const quotedSourceBoundary = normalized.search(
    /\b(?:attachment|document|message|source|text)\s+(?:contains|reads|says|states)\b\s*:?\s*/i
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
  return (
    /(?:^|[.!?:;,]\s*)(?:please\s+)?(?:(?:now|okay|ok|alright|so|yes|yeah|yep|yup|sure|right|great)(?:,\s*|\s+)(?:(?:like|just)\s+)?)?(?:(?:(?:can|could|will|would)\s+you|let'?s|i\s+(?:need|want)\s+you\s+to|i(?:'d|\s+would)\s+like\s+you\s+to)\s+)?(?:please\s+)?(?:change|edit|revise|rewrite|shorten|expand|tighten|fix|remove|add|replace|rename|retitle|update|polish|improve|make)\b/i
      .test(request) ||
    /^(?:(?:ok(?:ay)?|yes|yeah|yep|yup|sure|alright|right|great|perfect)(?:[,!.\s-]+|$))?(?:(?:that|this)\s+(?:works|is\s+(?:good|fine)|sounds\s+good)[,;:\s-]*(?:(?:but|and)\s+)?)?(?:a\s+bit\s+)?(?:more|less|shorter|longer|warmer|casual|formal|relaxed|conversational|concise|detailed|skeptical|critical|academic|friendly)\b/i
      .test(request)
  );
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
