export type EntityStore<T extends { id: string }> = {
  byId: Record<string, T>;
  order: string[];
};

export const normalizeEntities = <T extends { id: string }>(entities: T[]): EntityStore<T> => {
  const byId: Record<string, T> = {};
  const order: string[] = [];
  for (const entity of entities) {
    if (!entity.id || byId[entity.id]) continue;
    byId[entity.id] = entity;
    order.push(entity.id);
  }
  return { byId, order };
};

export const selectEntityList = <T extends { id: string }>(store: EntityStore<T>): T[] =>
  store.order.flatMap((id) => {
    const entity = store.byId[id];
    return entity ? [entity] : [];
  });

export const upsertEntity = <T extends { id: string }>(store: EntityStore<T>, entity: T): EntityStore<T> => ({
  byId: { ...store.byId, [entity.id]: entity },
  order: store.byId[entity.id] ? store.order : [entity.id, ...store.order]
});

export const removeEntity = <T extends { id: string }>(store: EntityStore<T>, id: string): EntityStore<T> => {
  if (!store.byId[id]) return store;
  const byId = { ...store.byId };
  delete byId[id];
  return { byId, order: store.order.filter((entityId) => entityId !== id) };
};
