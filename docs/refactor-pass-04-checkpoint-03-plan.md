# Pass 04 checkpoint 03 — recovery proof and authority-replacement preparation

## Control record

| Field | Value |
| --- | --- |
| Status | Gate A executed and passed across local PostgreSQL, Neon recovery, R2, and static-object coherence; authority retirement has not started |
| Prepared | July 30, 2026 |
| Exact released baseline | `2b28a88d9adc83750d6f553a58c82e537566f2f5` |
| Incoming local candidate | Pass 04 checkpoint 02; 472 files / 126,350 physical / 118,325 nonblank |
| Current local candidate | 475 files / 127,768 physical / 119,670 nonblank |
| Immediate objective | Complete: provider-restored Postgres and R2/static coherence passed after migration `0065` reconciliation |
| Following objective | Characterize and add the provider-free attachment adapter required before the direct-Postgres `dataStore` authority can be retired |
| Product/schema/design change | None authorized by this preparation |
| Production mutation | Prohibited |
| Design Lab and AI Tablet | Out of scope and untouched |
| Preserved unrelated paths | `output/`; `scripts/browserCanaryServer 2.ts` |

This checkpoint has two gates. Gate A is the next executable pass. Gate B is
prepared here so Gate A does not accidentally grow into an authority rewrite.
Gate B does not open until Gate A is complete and checkpoint 02 has an explicit
release decision.

## 1. Why Gate A is next

Checkpoint 02 now proves migration locking, checksum and order validation,
legacy metadata backfill, rollback, retry, and concurrent startup through a
deterministic database double. That is necessary but not sufficient evidence
for a release that will alter the live `symposium_migrations` ledger.

The remaining release-critical questions require a real, isolated PostgreSQL
target:

1. Can all 65 candidate migrations reconstruct the current schema from zero?
2. Can the current ID-only production ledger acquire checksum and position
   metadata without replaying historical SQL?
3. Do two real PostgreSQL sessions serialize startup and apply a pending
   migration exactly once?
4. Does a failed transaction leave neither schema residue nor a ledger row?
5. Can the current Neon state be restored to an isolated branch within a
   measured recovery window?
6. Does the restored database still point coherently to available R2 objects?

No source reduction is credited for this operational pass.

## 2. Absolute safety boundary

### 2.1 Required isolation sentinels

The drill runner must refuse to connect unless all of these are true:

- the connection is supplied through `SYMPOSIUM_DRILL_DATABASE_URL`, never a
  generic production variable;
- `SYMPOSIUM_DRILL_ACK=isolated-disposable-database` is exact;
- PostgreSQL `current_database()` contains a generated drill identifier;
- `DATABASE_APPLICATION_NAME` begins with `symposium-recovery-drill-`;
- the server is not the hostname fingerprint recorded for production;
- the connected role is not the production application role;
- the target contains a drill marker table created specifically for that run;
- destructive cases operate only inside a generated schema or disposable
  database owned by the drill role.

The runner must print safe fingerprints only: database name, server version,
application name, migration counts, durations, and hashes. It must never print
connection strings, credentials, private attachment keys, user content, Clerk
identities, or Assistant evidence.

### 2.2 Prohibited actions

- no migration, DDL, fixture write, restore, or cleanup against production;
- no production branch reset, replacement, promotion, or connection-string
  swap;
- no R2 write, copy, lifecycle change, or deletion;
- no whole-database rollback over newer user writes;
- no `db:push`, destructive down migration, or edited historical migration;
- no commit, push, deployment, or provider mutation without explicit
  authorization;
- no opening Gate B to compensate for a failed recovery proof.

The original restored branch remains immutable during comparison. Mutation
tests use a separate disposable database or schema derived from it.

## 3. Gate A prerequisites

Provider preparation must create or supply:

1. A fresh empty isolated PostgreSQL database for reconstruction.
2. A second isolated current-schema clone with the pre-checkpoint ID-only
   migration ledger.
3. A Neon point-in-time or retained-snapshot restore branch whose name embeds
   the drill identifier and restore timestamp.
4. A drill-only database role scoped to those targets.
5. Read-only R2 credentials limited to object metadata and reads for the
   Symposium bucket.
6. The production database and R2 fingerprints supplied separately for
   fail-closed comparison, without exposing secrets.
7. A recorded restore point chosen before the provider operation.

At preparation time the repository contained neither database/R2 credentials
nor local `psql`, `pg_dump`, or `pg_restore` binaries. The executed local drill
built a disposable PostgreSQL 17.10 toolchain outside the repository and used
the installed `pg` and AWS SDK libraries. Neon restore itself remains a
provider operation and an explicit authorization boundary.

## 4. Gate A implementation package

### 4.1 Checked-in runner

Add one bounded runner, provisionally
`scripts/databaseRecoveryDrill.ts`, with these modes:

| Mode | Target | Mutation |
| --- | --- | --- |
| `preflight` | Every drill database and read-only R2 | None beyond an isolated marker transaction that rolls back |
| `fresh` | Empty disposable database | Apply all candidate migrations and controlled fixtures |
| `backfill` | Isolated current-schema clone | Add ledger metadata; do not replay historical SQL |
| `concurrency` | Disposable migrated target | Run two independent clients/processes against one pending test migration |
| `rollback` | Disposable migrated target | Inject a failing test migration and prove complete transaction rollback |
| `restore-audit` | Immutable restored branch | Read-only relational and attachment-coherence audit |
| `report` | Local artifacts only | Validate and summarize exact evidence |

The runner should import the real migration plan and runner. It must not copy
the 64 SQL bodies or maintain a second expected-order list.

### 4.2 Fresh reconstruction proof

Against the empty isolated target:

1. Assert that the target has no Symposium tables.
2. Run the exact candidate migration runner.
3. Require every candidate migration ID in exact canonical order.
4. Require every checksum and position to match the in-repository plan.
5. Run the migration status/deep-readiness query.
6. Compare the resulting table, column, constraint, index, trigger, function,
   and enum manifest with the isolated current-schema clone.
7. Run seed/bootstrap twice and prove idempotence.
8. Exercise one transactionally complete representative chain:
   profile → Paper → titleless Thought → comment → action → Workspace draft →
   publication → attachment metadata → tombstone/deletion job.
9. Verify receipts, audit rows, durable events, revisions, design assignments,
   privacy projection, and attachment ownership for that chain.

Manifest comparison must normalize provider-generated names and ordering while
retaining semantic definitions. Unknown differences fail the drill.

### 4.3 Existing-ledger backfill proof

Against the isolated current-schema clone:

1. Record schema-manifest hash, table row counts, migration IDs, and selected
   invariant counts.
2. Confirm that known ledger rows have null checksum/position metadata.
3. Run the candidate migration runner.
4. Require no historical migration SQL execution.
5. Require exact checksum and one-based position metadata for every applied row.
6. Require unchanged product-table row counts and unchanged schema-manifest
   hash except for the migration-ledger columns/index.
7. Run a second time and require a no-op.
8. Tamper with one checksum and one position in disposable transactions and
   require deep readiness to fail closed; roll each transaction back.

### 4.4 Real concurrency and rollback proof

- Hold two independent PostgreSQL connections, not two calls sharing one fake
  client.
- Start the same pending test migration concurrently.
- Require one SQL application, one ledger insertion, deterministic waiting,
  and clean completion for both callers.
- Record advisory-lock wait duration without relying on a timing race for
  correctness.
- Inject a statement failure after an earlier DDL/DML statement in a test-only
  migration.
- Require no partial object, row, checksum, or position after rollback.
- Retry the corrected migration and require one complete application.

No test-only migration ID may enter the production migration array.

### 4.5 Neon recovery proof

The provider operation must:

1. Record the requested restore timestamp and the latest known production
   release/migration identity before starting.
2. Restore into a new isolated branch; never replace the production branch.
3. Record provider request acceptance, branch identity, first successful
   connection, and completed audit time.
4. Calculate:
   - requested and effective recovery point;
   - data-loss window against the chosen marker;
   - provider restore duration;
   - time to database readiness;
   - time to complete the relational/R2 coherence audit.
5. Verify release `1a571beb...`, migration `0064`, fixture revision, and the
   newest safe timestamp/marker visible at the restore point.
6. Keep the restore branch until the evidence report is reviewed; cleanup is a
   separately authorized destructive action.

The drill records observed RPO/RTO. It does not convert one observation into an
unsupported SLA.

### 4.6 Postgres/R2 coherence audit

Using the immutable restored branch and read-only R2 credentials:

- every active `uploaded` or `previewed` attachment must have a canonical
  object whose size and normalized content type agree with its row;
- public URLs must correspond to the canonical object key and configured
  public base;
- private objects must remain private and use the protected-delivery path;
- a distinct staging key must either exist or have a matching durable deletion
  job/confirmed deleted-state marker;
- rows in a deletion-pending or failed state must reconcile with their durable
  deletion jobs and metadata;
- every deletion job must reference an attachment or a documented orphan
  reason;
- duplicate canonical `(bucket, object_key)` ownership fails;
- missing active objects, unowned reachable private objects, and contradictory
  state fail the gate.

The evidence contains aggregate counts and salted key-set hashes only. It does
not contain raw keys, filenames, signed URLs, bodies, or user identifiers.

## 5. Gate A evidence and stop conditions

The machine-readable report belongs under the ignored
`.artifacts/refactor/recovery/` directory and must include:

- exact Git SHA and dirty-worktree digest;
- target-safe fingerprints and isolation assertions;
- canonical migration count/order/checksum digest;
- schema-manifest hashes before and after;
- row/invariant count digests;
- concurrency and rollback traces;
- restore timestamps and measured durations;
- R2 state-category totals and coherence digest;
- each named case with `passed`, `failed`, or `not-run`;
- explicit provider actions and cleanup state.

Stop immediately if:

- any isolation sentinel is absent or production cannot be ruled out;
- reconstruction and current-clone manifests differ unexpectedly;
- historical SQL would replay during metadata backfill;
- a migration leaves partial state;
- readiness does not reject drift;
- the restore point cannot be identified;
- any active attachment object is missing or has contradictory ownership;
- the drill would require writing to production or R2;
- a secret or private object identity would enter logs/artifacts.

Gate A closes only after focused drill validation, `npm run verify`,
`npm run proof:check`, `npm run browser:canary`, dependency audit, source
inventory reconciliation, and an exact evidence review all pass.

## 6. Gate B preparation — canonical runtime replacement

Gate B addresses the remaining `lib/dataStore.ts` direct-Postgres authority.
It is not part of the credentialed recovery drill.

### 6.1 Preserved modes

| Mode | Required outcome |
| --- | --- |
| Production | Next delegates to Fastify/Render and fails closed when unavailable |
| Credential-free local preview | JSON/local stores and filesystem attachments remain fully functional |
| Database-backed development | Canonical Fastify repositories/contracts operate against Postgres while attachment bytes use a provider-free filesystem adapter |

The third mode is the missing prerequisite. The canonical API currently
assumes Postgres plus R2 for attachment lifecycle operations, while local
preview uses `.data/attachments/index.json` and local files for posts,
comments, notes, note comments, and opportunity applications.

### 6.2 Additive adapter seam

Introduce a narrow canonical object-storage port with two implementations:

- R2, preserving the current staging, inspection, promotion, signed/private
  delivery, and durable deletion behavior;
- local filesystem, preserving validation, atomic file writes, protected
  access decisions, publication promotion, and deterministic cleanup without
  pretending to provide distributed durability.

Canonical Postgres attachment rows remain metadata/ownership authority in
database-backed development. The local filesystem implementation must not
create another JSON metadata authority. Credential-free JSON preview continues
to use `lib/localAttachmentStore.ts` until a later, separately proved
convergence can preserve its coupled local-store graph.

### 6.3 Required characterization before implementation

Lock named cases for:

- prepare, content upload, signature/Office validation, confirm, and discard;
- post/comment create, edit, removal, deletion, and reply ownership;
- Workspace note/comment attachment ownership and publication promotion;
- opportunity-application access;
- Assistant/message/private attachment fail-closed boundaries;
- public versus protected delivery;
- actor mismatch, duplicate claim, stale owner, size/MIME mismatch, missing
  file, unsafe archive, and traversal-resistant filenames;
- restart persistence and failed-write cleanup;
- production never selecting filesystem storage;
- database-backed development producing canonical receipts, audits, events,
  revisions, ownership rows, and deletion jobs where semantically required.

### 6.4 Authority-retirement sequence

1. Characterize all 15 current `dataStore` importers (13 Next route files,
   one client type consumer, and one local opportunity-store dependency) and
   the coupled local-store graph.
2. Add the storage port and filesystem implementation without changing the
   active production path.
3. Run canonical Fastify against an isolated local Postgres target and the
   filesystem object adapter.
4. Prove route/payload/error/persistence equivalence for database-backed
   development.
5. Switch only that development mode to the canonical API.
6. Observe the full local, database-development, and production-fail-closed
   matrix.
7. Delete the direct-Postgres schema initializer, seed/read projections, and
   SQL mutation branches from `lib/dataStore.ts`.
8. Retain the JSON preview implementation and local coupled stores.
9. Reconcile real net LOC and coverage; do not pre-credit a saving.

Any provider-free attachment regression, production filesystem reachability,
receipt/audit/event loss, or local-preview loss rejects the cutover.

## 7. Expected file boundary

Gate A is expected to touch only:

- the recovery-drill runner and its self-test;
- package/verification manifests;
- recovery evidence and operational documentation;
- migration runner defects proven by real PostgreSQL, if any.

Gate B may later touch:

- `apps/api/src/services/storage.ts`;
- attachment routes/repositories and their dependency wiring;
- a new narrow storage-port module and local filesystem implementation;
- server startup/configuration for the explicit development mode;
- `lib/dataStore.ts` only at final, proved cutover;
- focused attachment/runtime-mode checks and evidence.

Unexpected product, design, Assistant, client-state, or broad repository
changes stop the pass for re-scoping.

## 8. Prepared execution order

1. Review this plan and explicitly authorize the isolated provider drill.
2. Create the drill databases/restore branch and read-only R2 credential.
3. Implement the fail-closed runner and self-tests without credentials.
4. Run `preflight`; review its safe fingerprint.
5. Run fresh reconstruction, legacy backfill, real concurrency, and rollback.
6. Perform the isolated Neon restore.
7. Run the read-only restored-database/R2 coherence audit.
8. Run the complete local release matrix and review exact evidence.
9. Decide checkpoint 02/03 commit and release separately.
10. Open Gate B only after that decision.

The complete Gate A order is recorded in
`docs/refactor-evidence/pass-04/checkpoint-03.md`. The isolated Neon restore,
derived-child backfill, PostgreSQL 18 reconstruction, migration `0065`
reconciliation, normalized manifest comparison, and live read-only R2/static
coherence audit have run and passed. The audit used the existing Render
application credential exclusively through `HeadObject`; its provider-side
permission scope was not independently narrowed. Authority replacement has not
started.
