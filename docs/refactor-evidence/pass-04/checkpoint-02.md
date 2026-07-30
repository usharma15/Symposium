# Pass 04 checkpoint 02 — migration and concurrency hardening

## Control record

| Field | Value |
| --- | --- |
| Status | Local candidate; release and production migration not authorized or performed |
| Exact baseline | `1a571beb2a5c51ac53641522e5a7a1d7f9cf5f43` |
| Baseline inventory | 469 files / 125,849 physical / 117,856 nonblank |
| Candidate inventory | 472 files / 126,350 physical / 118,325 nonblank |
| Candidate delta | +501 physical / +469 nonblank |
| Candidate categories | 90,012 production / 16,200 styles / 20,138 checks and tools |
| Category deltas | +163 production / 0 styles / +338 checks and tools |
| Program ceiling | 99,999 physical |
| Remaining distance to program ceiling | 26,351 physical |
| Product schema impact | None |
| Migration-control impact | Adds checksum and position metadata plus a unique partial position index to `symposium_migrations` on the next API startup |
| Product capability impact | None intended or accepted |
| Design impact | None |
| Unrelated material preserved | `output/`; `scripts/browserCanaryServer 2.ts` |

Documentation is excluded from the source inventory. The candidate includes
three new tracked source files that the unstaged worktree inventory reports
separately; the candidate total is the exact tracked total plus those files.
The source ceiling is ratcheted to 126,350 so this safety increase does not
create hidden future growth allowance.

## Outcome

This checkpoint closes three concrete failure modes without changing a route,
payload, product record, visual surface, or supported runtime mode:

1. Two API instances can no longer race the startup migration runner.
2. Released migration SQL and order can no longer drift silently after the
   first checksum metadata backfill.
3. A first local-preview read can no longer seed over a concurrent successful
   mutation, and the live event bus no longer warns below its advertised
   process capacity.

The direct-Postgres development authority in `lib/dataStore.ts` remains. A
canonical in-process API replacement was investigated, but deleting the branch
would currently withdraw provider-free local attachment behavior unless a
deliberate attachment adapter is added. That would violate the zero-loss rule,
so no authority or LOC saving is claimed here.

## Migration runner

`apps/api/src/db/migrationRunner.ts` now owns:

- deterministic SHA-256 checksums over exact migration SQL;
- unique and syntactically valid migration-plan enforcement;
- a transaction-scoped `pg_advisory_xact_lock`;
- additive `checksum` and one-based `position` ledger metadata;
- legacy ID-only metadata backfill without historical SQL replay;
- fail-closed known-history checksum and order verification;
- exactly-once pending SQL plus ledger insertion; and
- commit, rollback, and rollback-failure behavior.

`getMigrationStatus` reads and validates the same metadata, so an explicit deep
readiness probe detects later database-history tampering rather than merely
counting IDs.

## Concurrency and persistence

The SSE route and local event bus share one 500-stream process limit. The
focused check subscribes all 500 listeners, requires exact delivery to every
listener, unsubscribes all of them, and verifies that no listener remains.

All file-backed `getSnapshot` reads now enter the same local operation queue as
mutations. The focused cold-start check runs twelve isolated rounds; in each
round twelve creates and twelve reads begin together against an absent data
file. All 144 created Thoughts must survive with distinct identifiers and exact
bodies. Corrupt JSON must still reject without seed replacement.

## Verification evidence

Focused candidate checks passed:

- `npm run migration:check`;
- `npm run infrastructure:check`;
- `npm run live-transport:check`;
- `npm run local-persistence:check`;
- `npm run verify:test`;
- `npm run typecheck:all`;
- `npm run build`, including optimized production build and hydration.

The first complete `npm run verify` attempt correctly failed at the final Next
build because Next typechecks check scripts outside the two standalone
TypeScript programs. The fake advisory-lock resolver's inferred callback type
was corrected. The final clean rerun then passed 58/58 stages, including the
optimized production build and hydration.

`npm run proof:check` passed all inventory, runner, browser-report,
canary-server, and proof-typecheck self-tests. `npm audit --audit-level=high`
and the clean isolated browser install both reported zero vulnerabilities.

The first browser launch was denied by the macOS execution sandbox before page
creation (`MachPortRendezvousServer ... Permission denied`); the API-only
concurrent-write case still passed. The same exact candidate was rerun outside
that browser restriction and passed 6/6 in 42.6 seconds. The exact report
validator passed with no skip, retry, flake, or unexpected result. The browser
matrix covered first entry, canonical route/history behavior, Paper and
titleless Thought design identity across theme and reload, desktop/mobile
containment, twelve simultaneous writes without loss, and titleless Thought
create/edit/fresh-session persistence.

## Explicit limits and release gate

No local Postgres service or database credential is present. The deterministic
runner tests cover lock ordering, existing history, tampering, rollback, retry,
and concurrent startup, but they are not a substitute for:

- recreating all 64 migrations in a fresh isolated Postgres database;
- running the metadata backfill against an isolated current-schema clone;
- verifying the unique position index and deep readiness against both;
- a Neon point-in-time restore drill and Postgres-to-R2 coherence check; or
- exact-SHA deployment and production smoke after explicit release authority.

No production migration, deploy, commit, push, or provider mutation was
performed in this checkpoint.
