export type MessageDraftRecovery = {
  body: string;
  updatedAt: string | null;
};

export type StoredMessageDraft = {
  version: 1;
  body: string;
  clientVersion: string;
  baseRevision: number;
  updatedAt: string;
  recovery: MessageDraftRecovery | null;
};

export type MessageDraftState = {
  body: string;
  conversationId: string | null;
  dirty: boolean;
  clientVersion: string | null;
  localUpdatedAt: string | null;
  recovery: MessageDraftRecovery | null;
  serverBody: string;
  serverRevision: number;
  serverClientVersion: string | null;
  serverUpdatedAt: string | null;
};

export type MessageDraftAction =
  | {
      type: "select";
      conversationId: string | null;
      localDraft: StoredMessageDraft | null;
      serverBody: string;
      serverRevision: number;
      serverClientVersion: string | null;
      serverUpdatedAt: string | null;
    }
  | { type: "edit"; conversationId: string; body: string; clientVersion: string; updatedAt: string }
  | {
      type: "server";
      conversationId: string;
      body: string;
      revision: number;
      clientVersion: string | null;
      preserveLocal: boolean;
      updatedAt: string | null;
    }
  | {
      type: "saved";
      conversationId: string;
      body: string;
      revision: number;
      clientVersion: string;
      updatedAt: string | null;
    }
  | { type: "restore"; conversationId: string; clientVersion: string; updatedAt: string }
  | { type: "discard-recovery"; conversationId: string }
  | { type: "clear"; conversationId: string };

export const emptyMessageDraftState: MessageDraftState = {
  body: "",
  conversationId: null,
  dirty: false,
  clientVersion: null,
  localUpdatedAt: null,
  recovery: null,
  serverBody: "",
  serverRevision: 1,
  serverClientVersion: null,
  serverUpdatedAt: null
};

export const createMessageDraftClientVersion = () =>
  globalThis.crypto?.randomUUID?.() ??
  `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const validStoredMessageDraft = (value: unknown): value is StoredMessageDraft => {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<StoredMessageDraft>;
  return draft.version === 1 &&
    typeof draft.body === "string" &&
    draft.body.length <= 8000 &&
    typeof draft.clientVersion === "string" &&
    draft.clientVersion.length > 0 &&
    draft.clientVersion.length <= 160 &&
    Number.isSafeInteger(draft.baseRevision) &&
    Number(draft.baseRevision) >= 1 &&
    typeof draft.updatedAt === "string" &&
    !Number.isNaN(Date.parse(draft.updatedAt)) &&
    (draft.recovery === null || (
      typeof draft.recovery === "object" &&
      typeof draft.recovery?.body === "string" &&
      draft.recovery.body.length <= 8000 &&
      (draft.recovery.updatedAt === null || (
        typeof draft.recovery.updatedAt === "string" && !Number.isNaN(Date.parse(draft.recovery.updatedAt))
      ))
    ));
};

export const parseStoredMessageDraft = (raw: string | null): StoredMessageDraft | null => {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (validStoredMessageDraft(parsed)) return parsed;
  } catch {
    // Plain strings are the pre-revision local draft format.
  }
  if (raw.length > 8000) return null;
  return {
    version: 1,
    body: raw,
    clientVersion: createMessageDraftClientVersion(),
    baseRevision: 1,
    updatedAt: new Date(0).toISOString(),
    recovery: null
  };
};

export const storedMessageDraftFromState = (state: MessageDraftState): StoredMessageDraft | null => {
  if (!state.conversationId || (!state.dirty && !state.recovery)) return null;
  return {
    version: 1,
    body: state.body,
    clientVersion: state.clientVersion ?? createMessageDraftClientVersion(),
    baseRevision: state.serverRevision,
    updatedAt: state.localUpdatedAt ?? new Date().toISOString(),
    recovery: state.recovery
  };
};

const selectDraft = (action: Extract<MessageDraftAction, { type: "select" }>): MessageDraftState => {
  if (!action.conversationId) return emptyMessageDraftState;
  const local = action.localDraft;
  const serverRevision = Math.max(1, action.serverRevision);
  const serverState: MessageDraftState = {
    body: action.serverBody,
    conversationId: action.conversationId,
    dirty: false,
    clientVersion: action.serverClientVersion,
    localUpdatedAt: action.serverUpdatedAt,
    recovery: local?.recovery ?? null,
    serverBody: action.serverBody,
    serverRevision,
    serverClientVersion: action.serverClientVersion,
    serverUpdatedAt: action.serverUpdatedAt
  };
  if (!local || local.body === action.serverBody) return serverState;

  const legacyLocal = local.updatedAt === new Date(0).toISOString();
  const serverSupersedesLocal = local.baseRevision < serverRevision || (legacyLocal && Boolean(action.serverUpdatedAt));
  if (serverSupersedesLocal) {
    return {
      ...serverState,
      recovery: { body: local.body, updatedAt: local.updatedAt }
    };
  }

  return {
    ...serverState,
    body: local.body,
    dirty: true,
    clientVersion: local.clientVersion,
    localUpdatedAt: local.updatedAt
  };
};

export const reduceMessageDraft = (
  state: MessageDraftState,
  action: MessageDraftAction
): MessageDraftState => {
  if (action.type === "select") return selectDraft(action);
  if (state.conversationId !== action.conversationId) return state;

  if (action.type === "edit") {
    return {
      ...state,
      body: action.body,
      dirty: action.body !== state.serverBody,
      clientVersion: action.clientVersion,
      localUpdatedAt: action.updatedAt
    };
  }

  if (action.type === "server") {
    if (action.revision < state.serverRevision) return state;
    if (action.preserveLocal || state.dirty) {
      return {
        ...state,
        dirty: state.body !== action.body,
        serverBody: action.body,
        serverRevision: action.revision,
        serverClientVersion: action.clientVersion,
        serverUpdatedAt: action.updatedAt
      };
    }
    return {
      ...state,
      body: action.body,
      dirty: false,
      clientVersion: action.clientVersion,
      localUpdatedAt: action.updatedAt,
      serverBody: action.body,
      serverRevision: action.revision,
      serverClientVersion: action.clientVersion,
      serverUpdatedAt: action.updatedAt
    };
  }

  if (action.type === "saved") {
    if (action.revision < state.serverRevision) return state;
    const savedCurrentGeneration = state.clientVersion === action.clientVersion && state.body === action.body;
    return {
      ...state,
      dirty: savedCurrentGeneration ? false : state.body !== action.body,
      clientVersion: savedCurrentGeneration ? action.clientVersion : state.clientVersion,
      localUpdatedAt: savedCurrentGeneration ? action.updatedAt : state.localUpdatedAt,
      serverBody: action.body,
      serverRevision: action.revision,
      serverClientVersion: action.clientVersion,
      serverUpdatedAt: action.updatedAt
    };
  }

  if (action.type === "restore") {
    if (!state.recovery) return state;
    return {
      ...state,
      body: state.recovery.body,
      dirty: state.recovery.body !== state.serverBody,
      clientVersion: action.clientVersion,
      localUpdatedAt: action.updatedAt,
      recovery: null
    };
  }

  if (action.type === "discard-recovery") {
    return { ...state, recovery: null };
  }

  return {
    ...state,
    body: "",
    dirty: false,
    clientVersion: null,
    localUpdatedAt: null,
    recovery: null
  };
};
