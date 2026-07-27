import {
  assistantActionProposalSchema,
  assistantActionToolSchema,
  confirmAssistantOfficeNoteDraftInputSchema,
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
  }
} as const satisfies Record<
  AssistantActionToolContract,
  {
    permission: "draft";
    requiresConfirmation: true;
    inputSchema: typeof confirmAssistantOfficeNoteDraftInputSchema;
    destination: string;
  }
>;

export const registeredAssistantAction = (tool: unknown) => {
  const parsedTool = assistantActionToolSchema.parse(tool);
  return assistantActionRegistry[parsedTool];
};

export const assistantActionProposalFromDraft = (
  draft: AssistantActionProposalDraftContract,
  source?: AssistantActionSourceContract
): AssistantActionProposalContract | undefined => {
  if (draft.tool === "none") return undefined;
  const action = registeredAssistantAction(draft.tool);
  return assistantActionProposalSchema.parse({
    tool: draft.tool,
    title: draft.title,
    body: draft.body,
    requiresConfirmation: action.requiresConfirmation,
    ...(source ? { source } : {})
  });
};
