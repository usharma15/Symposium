import type { AssistantMessageInputContract } from "@/packages/contracts/src";
import type { InquiryItem } from "@/lib/mockData";
import type { AttachmentViewerTarget } from "@/features/attachments/useDedicatedAttachmentViewer";
import type { QuoteSelection } from "@/features/quotes/quoteTypes";

export type AssistantSurfaceContext =
  NonNullable<AssistantMessageInputContract["context"]>;

export type EditingCommentTarget = {
  itemId: string;
  commentId: string;
};

type ComposerSurface = {
  communityId: string | null;
};

type QuickMessagesSurface = {
  conversationId: string | null;
};

export type SymposiumSurfaceState = {
  assistantOriginContext: AssistantSurfaceContext | null;
  attachmentPreview: AttachmentViewerTarget | null;
  composer: ComposerSurface | null;
  editingComment: EditingCommentTarget | null;
  editingPost: InquiryItem | null;
  messagesQuick: QuickMessagesSurface | null;
  quoteSelection: QuoteSelection | null;
  settingsOpen: boolean;
  tabletOpen: boolean;
};

export type SymposiumSurfaceAction =
  | { type: "initial-route-applied" }
  | { type: "navigation-restored" }
  | { type: "navigation-committed"; assistantOpen: boolean }
  | { type: "assistant-collapsed" }
  | { type: "assistant-expanded"; context: AssistantSurfaceContext }
  | { type: "tablet-opened" }
  | { type: "tablet-closed" }
  | { type: "search-opened" }
  | { type: "composer-opened"; communityId: string | null }
  | { type: "global-composer-opened"; communityId: string | null }
  | { type: "composer-community-changed"; communityId: string | null }
  | { type: "composer-closed" }
  | { type: "quote-opened"; selection: QuoteSelection }
  | { type: "quote-closed" }
  | { type: "settings-opened" }
  | { type: "settings-closed" }
  | { type: "quick-messages-opened" }
  | { type: "quick-conversation-selected"; conversationId: string | null }
  | { type: "quick-messages-closed" }
  | { type: "post-editor-opened"; item: InquiryItem }
  | { type: "post-editor-closed"; itemId?: string }
  | { type: "comment-editor-opened"; target: EditingCommentTarget }
  | { type: "comment-editor-closed"; itemId?: string; commentId?: string }
  | { type: "attachment-preview-changed"; target: AttachmentViewerTarget | null };

export const initialSymposiumSurfaceState = (
  assistantRoute: boolean
): SymposiumSurfaceState => ({
  assistantOriginContext: null,
  attachmentPreview: null,
  composer: null,
  editingComment: null,
  editingPost: null,
  messagesQuick: null,
  quoteSelection: null,
  settingsOpen: false,
  tabletOpen: assistantRoute
});

const closeNavigationSurfaces = (
  state: SymposiumSurfaceState
): SymposiumSurfaceState => ({
  ...state,
  composer: null,
  messagesQuick: null,
  settingsOpen: false
});

export const symposiumSurfaceReducer = (
  state: SymposiumSurfaceState,
  action: SymposiumSurfaceAction
): SymposiumSurfaceState => {
  switch (action.type) {
    case "initial-route-applied":
      return {
        ...state,
        assistantOriginContext: null
      };
    case "navigation-restored":
      return {
        ...closeNavigationSurfaces(state),
        assistantOriginContext: null
      };
    case "navigation-committed":
      return {
        ...closeNavigationSurfaces(state),
        assistantOriginContext: action.assistantOpen
          ? state.assistantOriginContext
          : null
      };
    case "assistant-collapsed":
      return {
        ...state,
        assistantOriginContext: null,
        tabletOpen: true
      };
    case "assistant-expanded":
      return {
        ...state,
        assistantOriginContext: action.context,
        tabletOpen: true
      };
    case "tablet-opened":
      return {
        ...closeNavigationSurfaces(state),
        tabletOpen: true
      };
    case "tablet-closed":
      return { ...state, tabletOpen: false };
    case "search-opened":
      return {
        ...closeNavigationSurfaces(state),
        tabletOpen: false
      };
    case "composer-opened":
      return {
        ...state,
        composer: { communityId: action.communityId }
      };
    case "global-composer-opened":
      return {
        ...state,
        composer: { communityId: action.communityId },
        settingsOpen: false,
        tabletOpen: false
      };
    case "composer-community-changed":
      return state.composer
        ? {
            ...state,
            composer: { communityId: action.communityId }
          }
        : state;
    case "composer-closed":
      return { ...state, composer: null };
    case "quote-opened":
      return {
        ...state,
        composer: null,
        quoteSelection: action.selection,
        settingsOpen: false,
        tabletOpen: false
      };
    case "quote-closed":
      return { ...state, quoteSelection: null };
    case "settings-opened":
      return {
        ...state,
        composer: null,
        settingsOpen: true,
        tabletOpen: false
      };
    case "settings-closed":
      return { ...state, settingsOpen: false };
    case "quick-messages-opened":
      return {
        ...state,
        messagesQuick: { conversationId: null }
      };
    case "quick-conversation-selected":
      return state.messagesQuick
        ? {
            ...state,
            messagesQuick: {
              conversationId: action.conversationId
            }
          }
        : state;
    case "quick-messages-closed":
      return { ...state, messagesQuick: null };
    case "post-editor-opened":
      return { ...state, editingPost: action.item };
    case "post-editor-closed":
      return !action.itemId || state.editingPost?.id === action.itemId
        ? { ...state, editingPost: null }
        : state;
    case "comment-editor-opened":
      return { ...state, editingComment: action.target };
    case "comment-editor-closed":
      return (
        (!action.itemId || state.editingComment?.itemId === action.itemId) &&
        (!action.commentId ||
          state.editingComment?.commentId === action.commentId)
      )
        ? { ...state, editingComment: null }
        : state;
    case "attachment-preview-changed":
      return { ...state, attachmentPreview: action.target };
  }
};
