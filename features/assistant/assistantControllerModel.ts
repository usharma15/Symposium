import type {
  AssistantMessageContract,
  AssistantMessageInputContract,
  AssistantActionProposalContract,
  AssistantActionReceiptContract,
  AssistantContextConfigurationContract,
  AssistantQuickNoteContract,
  AssistantQuickNoteResultContract,
  AssistantThreadStateContract,
  AssistantThreadSummaryContract,
  AssistantTranslationContract,
  InquiryAttachmentContract
} from "@/packages/contracts/src";
import { assistantContextKey } from "@/lib/assistantContext";

export type AssistantContext = NonNullable<
  AssistantMessageInputContract["context"]
>;

export type AssistantNewThreadContextMode = "current" | "blank";

export const defaultAssistantContextConfiguration: AssistantContextConfigurationContract = {
  historyScope: "recent",
  knowledgeScope: "sources_and_general",
  siteSearch: "when_requested"
};

export type AssistantMessageView = {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  conversationId?: string;
  createdAt?: string;
  evidence?: AssistantMessageContract["evidence"];
  claims?: AssistantMessageContract["claims"];
  translation?: AssistantTranslationContract;
  quickNote?: AssistantQuickNoteContract;
  quickNoteResult?: AssistantQuickNoteResultContract;
  actionProposal?: AssistantActionProposalContract;
  actionReceipt?: AssistantActionReceiptContract;
  attachments?: InquiryAttachmentContract[];
};

export type AssistantThreadLibraryView =
  | "all"
  | "projects"
  | "archived";

export const nextAssistantProjectSelection = (
  selectedProjectId: string | null,
  toggledProjectId: string
) => selectedProjectId === toggledProjectId ? null : toggledProjectId;

export type AssistantThreadLiveEvent = {
  id?: string;
  cursor?: string;
  kind: string;
  subjectId: string;
};

export const initialAssistantMessageFor = (
  context: AssistantContext | null
): AssistantMessageView => ({
  id: context ? `intro:${assistantContextKey(context)}` : "intro:blank",
  role: "assistant",
  body: context
    ? `You’re on ${context.title}. Ask about this view, or remove it to start without context.`
    : "What’s on your mind?"
});

export const assistantThreadSummary = (
  thread: AssistantThreadStateContract
): AssistantThreadSummaryContract => {
  const { sources: _sources, ...summary } = thread;
  return summary;
};
