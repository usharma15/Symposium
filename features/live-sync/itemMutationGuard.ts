export type ItemMutationGuardEntry = {
  epoch: number;
  pending: number;
};

export type ItemMutationGuard = Map<string, ItemMutationGuardEntry>;
export type ItemMutationSnapshot = Map<string, number>;

export const createItemMutationGuard = (): ItemMutationGuard => new Map();

export const beginItemMutation = (guard: ItemMutationGuard, itemId: string) => {
  const current = guard.get(itemId) ?? { epoch: 0, pending: 0 };
  guard.set(itemId, { epoch: current.epoch + 1, pending: current.pending + 1 });
};

export const completeItemMutation = (guard: ItemMutationGuard, itemId: string) => {
  const current = guard.get(itemId) ?? { epoch: 0, pending: 0 };
  guard.set(itemId, {
    epoch: current.epoch + 1,
    pending: Math.max(0, current.pending - 1)
  });
};

export const touchItemMutation = (guard: ItemMutationGuard, itemId: string) => {
  const current = guard.get(itemId) ?? { epoch: 0, pending: 0 };
  guard.set(itemId, { ...current, epoch: current.epoch + 1 });
};

export const captureItemMutationSnapshot = (guard: ItemMutationGuard): ItemMutationSnapshot =>
  new Map([...guard.entries()].map(([itemId, state]) => [itemId, state.epoch]));

export const itemMutationIsPending = (guard: ItemMutationGuard, itemId: string) =>
  (guard.get(itemId)?.pending ?? 0) > 0;

export const itemChangedSinceSnapshot = (
  guard: ItemMutationGuard,
  snapshot: ItemMutationSnapshot,
  itemId: string
) => {
  const current = guard.get(itemId);
  if ((current?.pending ?? 0) > 0) return true;
  return (current?.epoch ?? 0) !== (snapshot.get(itemId) ?? 0);
};

export const reconcileItemsAgainstMutations = <T extends { id: string }>(
  incomingItems: T[],
  currentItems: T[],
  guard: ItemMutationGuard,
  snapshot: ItemMutationSnapshot
) => {
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const incomingIds = new Set(incomingItems.map((item) => item.id));
  const reconciled = incomingItems.map((incoming) => {
    const current = currentById.get(incoming.id);
    return current && itemChangedSinceSnapshot(guard, snapshot, incoming.id) ? current : incoming;
  });

  for (const current of currentItems) {
    if (!incomingIds.has(current.id) && itemChangedSinceSnapshot(guard, snapshot, current.id)) {
      reconciled.push(current);
    }
  }

  return reconciled;
};
