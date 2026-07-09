import type { InquiryItem, ResearchProfile } from "@/lib/mockData";
import { hasHandle, isDeletedPost, isSavedBy } from "@/lib/symposiumCore";

export type ProfilePostActionKind = "fork" | "signal" | "save";

export const itemMatchesProfilePostAction = (
  item: InquiryItem,
  person: ResearchProfile,
  action: ProfilePostActionKind,
  defaultSavedHandle?: string
) => {
  if (isDeletedPost(item)) return false;
  if (action === "fork") return hasHandle(item.forkedBy, person.handle);
  if (action === "signal") return hasHandle(item.signaledBy, person.handle);
  return isSavedBy(item, person.handle, defaultSavedHandle);
};

export const uniqueProfileActivityEntries = <T extends { recency: number }>(
  entries: T[],
  contentKey: (entry: T) => string
) => {
  const unique = new Map<string, T>();

  for (const entry of entries) {
    const key = contentKey(entry);
    const current = unique.get(key);
    if (!current || entry.recency > current.recency) unique.set(key, entry);
  }

  return [...unique.values()].sort((a, b) => b.recency - a.recency);
};

export const reconcileProfileActivitySlots = <T extends { id: string }>(current: T[], next: T[]) => {
  const nextById = new Map(next.map((slot) => [slot.id, slot]));
  const currentIds = new Set(current.map((slot) => slot.id));
  const added = next.filter((slot) => !currentIds.has(slot.id));
  const retained = current.flatMap((slot) => {
    const updated = nextById.get(slot.id);
    return updated ? [updated] : [];
  });

  return [...added, ...retained];
};
