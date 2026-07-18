export type MessageDraftState = {
  body: string;
  conversationId: string | null;
  dirty: boolean;
  serverBody: string;
  serverUpdatedAt: string | null;
};

export type MessageDraftAction =
  | {
      type: "select";
      conversationId: string | null;
      localBody: string | null;
      serverBody: string;
      serverUpdatedAt: string | null;
    }
  | { type: "edit"; conversationId: string; body: string }
  | { type: "server"; conversationId: string; body: string; preserveLocal: boolean; updatedAt: string | null }
  | { type: "saved"; conversationId: string; body: string; updatedAt: string | null }
  | { type: "clear"; conversationId: string };

export const emptyMessageDraftState: MessageDraftState = {
  body: "",
  conversationId: null,
  dirty: false,
  serverBody: "",
  serverUpdatedAt: null
};

export const reduceMessageDraft = (
  state: MessageDraftState,
  action: MessageDraftAction
): MessageDraftState => {
  if (action.type === "select") {
    if (!action.conversationId) return emptyMessageDraftState;
    const body = action.localBody ?? action.serverBody;
    return {
      body,
      conversationId: action.conversationId,
      dirty: body !== action.serverBody,
      serverBody: action.serverBody,
      serverUpdatedAt: action.serverUpdatedAt
    };
  }

  if (state.conversationId !== action.conversationId) return state;

  if (action.type === "edit") {
    return {
      ...state,
      body: action.body,
      dirty: action.body !== state.serverBody
    };
  }

  if (action.type === "server") {
    if (
      state.serverUpdatedAt &&
      action.updatedAt &&
      Date.parse(action.updatedAt) < Date.parse(state.serverUpdatedAt)
    ) {
      return state;
    }
    if (action.preserveLocal || state.dirty) {
      return {
        ...state,
        dirty: state.body !== action.body,
        serverBody: action.body,
        serverUpdatedAt: action.updatedAt
      };
    }
    return {
      ...state,
      body: action.body,
      dirty: false,
      serverBody: action.body,
      serverUpdatedAt: action.updatedAt
    };
  }

  if (action.type === "saved") {
    return {
      ...state,
      dirty: state.body !== action.body,
      serverBody: action.body,
      serverUpdatedAt: action.updatedAt
    };
  }

  return {
    ...state,
    body: "",
    dirty: false,
    serverBody: "",
    serverUpdatedAt: null
  };
};
