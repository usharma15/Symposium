import { cleanHandle } from "@/lib/symposiumCore";
import {
  createMessageDraftClientVersion,
  parseStoredMessageDraft,
  type StoredMessageDraft
} from "@/features/messages/messageDraftState";

export type FailedSendDraft = {
  sequence: number;
  body: string;
  baseRevision: number;
  updatedAt: string;
};

type DraftRevision = { revision: number };

export const messageDraftStorageKey = (actorHandle: string, conversationId: string) =>
  `symposium:message-draft:${cleanHandle(actorHandle)}:${conversationId}`;

export const readLocalMessageDraft = (actorHandle: string, conversationId: string) => {
  try {
    return parseStoredMessageDraft(window.localStorage.getItem(messageDraftStorageKey(actorHandle, conversationId)));
  } catch {
    return null;
  }
};

export const writeLocalMessageDraft = (
  actorHandle: string,
  conversationId: string,
  draft: StoredMessageDraft | null
) => {
  try {
    const key = messageDraftStorageKey(actorHandle, conversationId);
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft));
    else window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const removeLocalMessageDraft = (actorHandle: string, conversationId: string) =>
  writeLocalMessageDraft(actorHandle, conversationId, null);

export const persistFailedMessageDraft = ({
  actorHandle,
  conversationId,
  failures,
  latestDraft
}: {
  actorHandle: string;
  conversationId: string;
  failures: FailedSendDraft[];
  latestDraft?: DraftRevision;
}) => {
  const orderedFailures = [...failures].sort((left, right) => left.sequence - right.sequence);
  const failedBody = orderedFailures.map((failure) => failure.body).filter(Boolean).join("\n");
  if (!failedBody) return true;
  const existing = readLocalMessageDraft(actorHandle, conversationId);
  return writeLocalMessageDraft(actorHandle, conversationId, {
    version: 1,
    body: [failedBody, existing?.body ?? ""].filter(Boolean).join("\n"),
    clientVersion: createMessageDraftClientVersion(),
    baseRevision: latestDraft?.revision ?? existing?.baseRevision ?? Math.max(1, ...orderedFailures.map((failure) => failure.baseRevision)),
    updatedAt: new Date().toISOString(),
    recovery: existing?.recovery ?? null
  });
};
