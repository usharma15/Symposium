import assert from "node:assert/strict";
import {
  normalizeEntities,
  removeEntity,
  selectEntityList,
  upsertEntity
} from "@/features/entities/entityStore";

type Entity = { id: string; value: number };

const normalized = normalizeEntities<Entity>([
  { id: "post-2", value: 2 },
  { id: "post-1", value: 1 },
  { id: "post-2", value: 99 }
]);
assert.deepEqual(normalized.order, ["post-2", "post-1"]);
assert.equal(normalized.byId["post-2"]?.value, 2);
assert.deepEqual(selectEntityList(normalized), [
  { id: "post-2", value: 2 },
  { id: "post-1", value: 1 }
]);

const updated = upsertEntity(normalized, { id: "post-1", value: 10 });
assert.deepEqual(updated.order, normalized.order);
assert.equal(updated.byId["post-1"]?.value, 10);

const inserted = upsertEntity(updated, { id: "post-3", value: 3 });
assert.deepEqual(inserted.order, ["post-3", "post-2", "post-1"]);
assert.deepEqual(selectEntityList(removeEntity(inserted, "post-2")), [
  { id: "post-3", value: 3 },
  { id: "post-1", value: 10 }
]);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: ["stable normalized order", "duplicate rejection", "identity-preserving update", "insert and remove"]
    },
    null,
    2
  )
);
