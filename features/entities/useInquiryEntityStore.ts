"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { InquiryItem } from "@/lib/mockData";
import { normalizeEntities, selectEntityList } from "@/features/entities/entityStore";

export const useInquiryEntityStore = (initialItems: InquiryItem[]) => {
  const [store, setStore] = useState(() => normalizeEntities(initialItems));
  const items = useMemo(() => selectEntityList(store), [store]);
  const itemsRef = useRef(items);

  const replaceItems = useCallback((nextItems: InquiryItem[]) => {
    itemsRef.current = nextItems;
    setStore(normalizeEntities(nextItems));
  }, []);

  return { items, itemsRef, replaceItems, store };
};
