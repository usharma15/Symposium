export type CrossTabRevision = {
  issuedAt: number;
  sequence: number;
  sourceId: string;
};

export type CrossTabItemMessage<T> = {
  kind: "symposium.item.v1";
  item: T;
  revision: CrossTabRevision;
};

type ProtectedItem<T> = {
  item: T;
  revision: CrossTabRevision;
  protectedUntil: number;
};

const compareRevisions = (left: CrossTabRevision, right: CrossTabRevision) => {
  if (left.issuedAt !== right.issuedAt) return left.issuedAt - right.issuedAt;
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  return left.sourceId.localeCompare(right.sourceId);
};

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export const isCrossTabItemMessage = <T extends { id: string }>(value: unknown): value is CrossTabItemMessage<T> => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CrossTabItemMessage<T>>;
  return (
    candidate.kind === "symposium.item.v1" &&
    Boolean(candidate.item && typeof candidate.item === "object" && typeof candidate.item.id === "string") &&
    Boolean(
      candidate.revision &&
        Number.isFinite(candidate.revision.issuedAt) &&
        Number.isFinite(candidate.revision.sequence) &&
        typeof candidate.revision.sourceId === "string"
    )
  );
};

export const createCrossTabItemSync = <T extends { id: string }>(options?: {
  now?: () => number;
  protectionWindowMs?: number;
  sourceId?: string;
}) => {
  const now = options?.now ?? Date.now;
  const protectionWindowMs = options?.protectionWindowMs ?? 8_000;
  const sourceId =
    options?.sourceId ??
    globalThis.crypto?.randomUUID?.() ??
    `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const protectedItems = new Map<string, ProtectedItem<T>>();
  const latestRevisions = new Map<string, CrossTabRevision>();
  let sequence = 0;
  let lastIssuedAt = 0;

  const nextRevision = (): CrossTabRevision => {
    const issuedAt = Math.max(now(), lastIssuedAt);
    lastIssuedAt = issuedAt;
    sequence += 1;
    return { issuedAt, sequence, sourceId };
  };

  const protect = (item: T, revision: CrossTabRevision) => {
    latestRevisions.set(item.id, revision);
    protectedItems.set(item.id, {
      item,
      revision,
      protectedUntil: now() + protectionWindowMs
    });
  };

  const publish = (item: T): CrossTabItemMessage<T> => {
    const revision = nextRevision();
    protect(item, revision);
    return { kind: "symposium.item.v1", item, revision };
  };

  const accept = (message: CrossTabItemMessage<T>) => {
    const latest = latestRevisions.get(message.item.id);
    if (latest && compareRevisions(message.revision, latest) <= 0) return false;
    lastIssuedAt = Math.max(lastIssuedAt, message.revision.issuedAt);
    sequence = Math.max(sequence, message.revision.sequence);
    protect(message.item, message.revision);
    return true;
  };

  const protectIncomingItem = (incoming: T, current: T | undefined) => {
    const protection = protectedItems.get(incoming.id);
    if (!protection) return incoming;
    if (sameValue(incoming, protection.item)) {
      protectedItems.delete(incoming.id);
      return incoming;
    }
    if (now() >= protection.protectedUntil) {
      protectedItems.delete(incoming.id);
      return incoming;
    }
    return current ?? protection.item;
  };

  const protectIncomingItems = (incomingItems: T[], currentItems: T[]) => {
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const incomingIds = new Set(incomingItems.map((item) => item.id));
    const next = incomingItems.map((incoming) => protectIncomingItem(incoming, currentById.get(incoming.id)));

    for (const [itemId, protection] of protectedItems) {
      if (incomingIds.has(itemId)) continue;
      if (now() >= protection.protectedUntil) {
        protectedItems.delete(itemId);
        continue;
      }
      const current = currentById.get(itemId);
      next.push(current ?? protection.item);
    }
    return next;
  };

  return {
    accept,
    protectIncomingItem,
    protectIncomingItems,
    publish
  };
};
