import {
  beginItemMutation,
  captureItemMutationSnapshot,
  completeItemMutation,
  createItemMutationGuard,
  itemChangedSinceSnapshot,
  itemMutationIsPending,
  reconcileItemsAgainstMutations,
  touchItemMutation,
  type ItemMutationSnapshot
} from "@/features/live-sync/itemMutationGuard";
import {
  createCrossTabItemSync,
  type CrossTabItemMessage
} from "@/features/live-sync/crossTabItemSync";
import {
  compareEntityRevisions,
  incomingEntityIsStale,
  type RevisionedEntity
} from "@/features/live-sync/entityRevision";

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export const createItemMutationCoordinator = <T extends { id: string } & RevisionedEntity>(options?: {
  equalRevisionProjectionChanged?: (incoming: T, current: T) => boolean;
}) => {
  const guard = createItemMutationGuard();
  const crossTab = createCrossTabItemSync<T>();

  const publishChanges = (nextItems: T[], previousItems: T[], explicitItemIds: string[] = []) => {
    const previousById = new Map(previousItems.map((item) => [item.id, item]));
    const explicitIds = new Set(explicitItemIds);
    return nextItems
      .filter((item) => {
        const previous = previousById.get(item.id);
        if (incomingEntityIsStale(item, previous)) return false;
        if (explicitIds.has(item.id)) return true;
        return itemMutationIsPending(guard, item.id) && previous !== item;
      })
      .map((item) => crossTab.publish(item));
  };

  const receive = (message: CrossTabItemMessage<T>, currentItems: T[]) => {
    const current = currentItems.find((item) => item.id === message.item.id);
    if (incomingEntityIsStale(message.item, current) || !crossTab.accept(message)) {
      return { accepted: false as const, items: currentItems };
    }
    touchItemMutation(guard, message.item.id);
    const exists = Boolean(current);
    return {
      accepted: true as const,
      itemId: message.item.id,
      items: exists
        ? currentItems.map((item) => (item.id === message.item.id ? message.item : item))
        : [message.item, ...currentItems]
    };
  };

  const reconcileRefresh = (
    incomingItems: T[],
    currentItems: T[],
    snapshot: ItemMutationSnapshot
  ) => {
    const incomingById = new Map(incomingItems.map((item) => [item.id, item]));
    const currentById = new Map(currentItems.map((item) => [item.id, item]));
    const mutationSafe = reconcileItemsAgainstMutations(incomingItems, currentItems, guard, snapshot).map(
      (item) => {
        const incoming = incomingById.get(item.id);
        const current = currentById.get(item.id);
        return incoming && (compareEntityRevisions(incoming, current) ?? 0) > 0 ? incoming : item;
      }
    );
    return crossTab.protectIncomingItems(mutationSafe, currentItems).map((item) => {
      const current = currentById.get(item.id);
      if (!current) return item;
      const comparison = compareEntityRevisions(item, current);
      if (comparison === 0 && !options?.equalRevisionProjectionChanged?.(item, current)) return current;
      if (comparison === null && sameValue(item, current)) return current;
      return item;
    });
  };

  return {
    begin: (itemId: string) => beginItemMutation(guard, itemId),
    capture: () => captureItemMutationSnapshot(guard),
    changedSince: (snapshot: ItemMutationSnapshot, itemId: string) =>
      itemChangedSinceSnapshot(guard, snapshot, itemId),
    complete: (itemId: string) => completeItemMutation(guard, itemId),
    isPending: (itemId: string) => itemMutationIsPending(guard, itemId),
    protectIncomingItem: (incoming: T, current?: T) => crossTab.protectIncomingItem(incoming, current),
    publishChanges,
    receive,
    reconcileRefresh,
    touch: (itemId: string) => touchItemMutation(guard, itemId)
  };
};
