"use client";

import { useCallback, useReducer } from "react";
import type { InquiryItem } from "@/lib/mockData";
import type { AttachmentViewerTarget } from "@/features/attachments/useDedicatedAttachmentViewer";
import type { QuoteSelection } from "@/features/quotes/quoteTypes";
import {
  initialSymposiumSurfaceState,
  symposiumSurfaceReducer,
  type AssistantSurfaceContext,
  type EditingCommentTarget
} from "@/features/shell/symposiumSurfaceState";

export const useSymposiumSurfaceController = (
  assistantRoute: boolean
) => {
  const [state, dispatch] = useReducer(
    symposiumSurfaceReducer,
    assistantRoute,
    initialSymposiumSurfaceState
  );

  const initialRouteApplied = useCallback(() => {
    dispatch({ type: "initial-route-applied" });
  }, []);
  const navigationRestored = useCallback(() => {
    dispatch({ type: "navigation-restored" });
  }, []);
  const navigationCommitted = useCallback((assistantOpen: boolean) => {
    dispatch({ type: "navigation-committed", assistantOpen });
  }, []);
  const collapseAssistant = useCallback(() => {
    dispatch({ type: "assistant-collapsed" });
  }, []);
  const expandAssistant = useCallback((context: AssistantSurfaceContext) => {
    dispatch({ type: "assistant-expanded", context });
  }, []);
  const openTablet = useCallback(() => {
    dispatch({ type: "tablet-opened" });
  }, []);
  const closeTablet = useCallback(() => {
    dispatch({ type: "tablet-closed" });
  }, []);
  const prepareSearch = useCallback(() => {
    dispatch({ type: "search-opened" });
  }, []);
  const openComposer = useCallback((communityId: string | null) => {
    dispatch({ type: "composer-opened", communityId });
  }, []);
  const openGlobalComposer = useCallback((communityId: string | null) => {
    dispatch({ type: "global-composer-opened", communityId });
  }, []);
  const setComposerCommunityId = useCallback(
    (communityId: string | null) => {
      dispatch({ type: "composer-community-changed", communityId });
    },
    []
  );
  const closeComposer = useCallback(() => {
    dispatch({ type: "composer-closed" });
  }, []);
  const openQuote = useCallback((selection: QuoteSelection) => {
    dispatch({ type: "quote-opened", selection });
  }, []);
  const closeQuote = useCallback(() => {
    dispatch({ type: "quote-closed" });
  }, []);
  const openSettings = useCallback(() => {
    dispatch({ type: "settings-opened" });
  }, []);
  const closeSettings = useCallback(() => {
    dispatch({ type: "settings-closed" });
  }, []);
  const openQuickMessages = useCallback(() => {
    dispatch({ type: "quick-messages-opened" });
  }, []);
  const selectQuickConversation = useCallback(
    (conversationId: string | null) => {
      dispatch({ type: "quick-conversation-selected", conversationId });
    },
    []
  );
  const closeQuickMessages = useCallback(() => {
    dispatch({ type: "quick-messages-closed" });
  }, []);
  const openPostEditor = useCallback((item: InquiryItem) => {
    dispatch({ type: "post-editor-opened", item });
  }, []);
  const closePostEditor = useCallback((itemId?: string) => {
    dispatch({ type: "post-editor-closed", itemId });
  }, []);
  const openCommentEditor = useCallback((target: EditingCommentTarget) => {
    dispatch({ type: "comment-editor-opened", target });
  }, []);
  const closeCommentEditor = useCallback(
    (target: Partial<EditingCommentTarget> = {}) => {
      dispatch({
        type: "comment-editor-closed",
        itemId: target.itemId,
        commentId: target.commentId
      });
    },
    []
  );
  const setAttachmentPreview = useCallback(
    (target: AttachmentViewerTarget | null) => {
      dispatch({ type: "attachment-preview-changed", target });
    },
    []
  );

  return {
    assistantOriginContext: state.assistantOriginContext,
    attachmentPreview: state.attachmentPreview,
    closeCommentEditor,
    closeComposer,
    closePostEditor,
    closeQuickMessages,
    closeQuote,
    closeSettings,
    closeTablet,
    collapseAssistant,
    composerCommunityId: state.composer?.communityId ?? null,
    composerOpen: state.composer !== null,
    editingComment: state.editingComment,
    editingPost: state.editingPost,
    expandAssistant,
    initialRouteApplied,
    messagesQuickOpen: state.messagesQuick !== null,
    navigationCommitted,
    navigationRestored,
    openCommentEditor,
    openComposer,
    openGlobalComposer,
    openPostEditor,
    openQuickMessages,
    openQuote,
    openSettings,
    openTablet,
    prepareSearch,
    quickConversationId: state.messagesQuick?.conversationId ?? null,
    quoteSelection: state.quoteSelection,
    selectQuickConversation,
    setAttachmentPreview,
    setComposerCommunityId,
    settingsOpen: state.settingsOpen,
    tabletOpen: state.tabletOpen
  };
};
