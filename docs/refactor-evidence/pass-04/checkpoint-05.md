# Pass 04 checkpoint 05 — schema and seed authority retirement

## Control record

| Field | Value |
| --- | --- |
| Status | Local release matrix passed; material reduction checkpoint; Pass 04 remains incomplete |
| Exact starting release | `75042324d2328061280cac3a02131f934042bd1d` |
| Starting inventory | 479 files / 127,805 physical / 119,667 nonblank |
| Candidate inventory | 476 files / 125,725 physical / 117,682 nonblank |
| Candidate delta | -3 files / -2,080 physical / -1,985 nonblank |
| Candidate categories | 87,285 production / 16,200 styles / 22,240 checks and tools |
| Category delta | -2,045 production / 0 styles / -35 checks and tools |
| Program ceiling | 99,999 physical |
| Pass 04 ceiling | 114,999 physical |
| Remaining distance to program ceiling | 25,726 physical |
| Remaining distance to Pass 04 ceiling | 10,726 physical |
| Product/schema impact | No product behavior or database-schema change; all 65 existing migrations are exercised |
| Design Lab and AI Tablet | Untouched |
| Preserved unrelated paths | `output/`; `scripts/browserCanaryServer 2.ts` |

Documentation is excluded from the source inventory. The user-owned untracked
canary copy remains outside the candidate and byte-for-byte unchanged at
SHA-256
`9ca3d8239ffb43186453d70feb5b5d8e4f023d9dc3ec411abc82c687197e2b4a`.

This checkpoint does not complete Pass 04. It remains 10,726 physical lines
above the explicit 114,999 ceiling and 25,726 above the program ceiling.
`sourcePolicy.passMaximum` is nevertheless ratcheted from 127,805 to the exact
125,725 candidate so no later change can silently regain this reduction.

## Single schema authority

The executable, ordered, checksummed migration manifest in
`apps/api/src/db/migrate.ts` was already the runtime schema authority. The
1,473-line `apps/api/src/db/schema.ts` was a second hand-maintained Drizzle
description: the API imported it only from construction checks, while startup,
readiness, recovery, repositories, and deployments used the migration
manifest and SQL directly.

The duplicate path is now retired:

- `apps/api/src/db/schema.ts` is deleted;
- `drizzle.config.ts` is deleted;
- `db:generate` and `db:push` are removed;
- `drizzle-orm` and `drizzle-kit` are removed from the package and lock
  manifests;
- TypeScript and Render inputs no longer reference the deleted configuration;
  and
- construction checks prove their schema invariants against the executable
  migration ledger rather than a parallel TypeScript description.

`infrastructureBoundaryCheck.ts` now fails if the deleted schema, commands, or
dependencies return. It asserts all 65 ordered migration IDs, the current
`0065_comment_deletion_reconciliation` head, and the previously covered
column/table invariants directly against migration SQL. This removes drift
without weakening the release contract.

There is no migration in this checkpoint and no data transformation to roll
back. Reverting the commit restores only obsolete development descriptions
and tools; it does not reverse or reinterpret production data.

## Single historical seed authority

The strict unused-code compiler audit exposed a second unreachable seed
implementation inside `apps/api/src/repository/foundation.ts`.
`legacySeedDatabase` and its private comment-tree, community-activity, and
community-content helper chain could not be reached from startup.

Canonical startup already calls `syncHistoricalWorldFixtures` and
`syncHistoricalWorldAssetFixtures`. Those transactions own profiles,
communities, posts, comments, actions, fixture revisions, and historical
assets. The 483-line legacy pipeline is deleted and
`communityConstructionCheck.ts` now locks the canonical historical-world
transaction, its inserts, and its revision guard.

No seed data or fixture contract was removed. The real isolated integration
starts an empty PostgreSQL database, applies every migration, runs canonical
seeding, exercises bootstrap and writes, restarts the API, and confirms
persistence.

## Compiler-enforced dead-code boundary

Both frontend and API typecheck commands now enable
`noUnusedLocals` and `noUnusedParameters`. The first full audit removed only
compiler-proved residue:

- stale imports and destructured values across repositories, UI, local
  stores, and verification scripts;
- one 59-line `ExpandableBodyText` component with no remaining import; and
- unused local action-metadata parameter names are explicitly marked without
  changing their positional compatibility contract.

An exhaustive all-project TypeScript audit, excluding generated output and the
preserved user-owned untracked canary copy, reports no remaining unused local
or parameter errors. The checks make that state a permanent release
condition.

## Repository-wide reduction audit

The pass did not stop at compiler diagnostics:

- Knip reported no additional safely deletable tracked production file. Its
  only tracked unused-file result is the intentionally retained frozen-art
  generation script; the other result is the preserved untracked canary copy.
- The exported-symbol report was reviewed as a lead list, not treated as
  deletion authority: many reported symbols are internal, construction-test,
  script, or public-contract surfaces.
- JSCPD analyzed 465 files and found 1,086 duplicated lines out of 141,967
  total analyzed lines, or 0.76%. The small matches span domain-specific
  authorization, transaction, UI, and test semantics; collapsing them
  generically would not supply the remaining 10,726-line reduction safely.
- The tracked source inventory identifies no unclassified or invalid source.

This is evidence against another indiscriminate sweep, not evidence that the
remaining system is irreducible. The next material reduction requires
replacing a supported authority or responsibility behind proved contracts,
then retiring the superseded implementation.

## Complete local verification

Final candidate evidence:

- `npm run verify` — passed all 61 ordered stages, including both strict
  unused-code typechecks, optimized Next build, and hydration;
- `npm run proof:check` — passed;
- `npm run typecheck:all` — passed;
- `npm run historical-world:check` — passed;
- `npm run migration:check` — passed;
- `npm run recovery:check` — passed;
- `npm run infrastructure:check` and all updated construction checks — passed;
- `npm run storage-filesystem:integration` — passed against isolated
  PostgreSQL 17, all 65 migrations, canonical seed/bootstrap, comprehensive
  reads and writes, public/private filesystem delivery, authorization,
  receipts, audit/events/ranges, API restart persistence, durable deletion,
  and zero remaining object files;
- `npm run browser:canary` — passed 6/6;
- exact browser report validation — passed;
- `npm audit --audit-level=high` — zero vulnerabilities;
- strict repository-wide unused-code audit — completed;
- repository-wide duplication audit — 0.76%;
- `git diff --check` — passed; and
- candidate LOC policy — 476 / 125,725 / 117,682.

The first browser attempt was blocked before page creation by the macOS
Mach-port sandbox; the exact same candidate passed outside that OS
restriction. The first database-harness attempt selected an older
non-SSL-linked PostgreSQL server and failed while loading `pgcrypto`; the
previously built compatible PostgreSQL 17 server then ran the complete
integration successfully. Neither failure was an application assertion
failure.

Passing this matrix does not claim every theoretically possible production
state was visited. Exact-SHA CI, Render/Vercel release identity, strict deep
readiness, and public smoke remain separate post-push evidence.

## Rejected shortcuts and next safe boundary

The pass rejected:

- deleting local JSON preview or compatibility routes;
- weakening, deleting, or compressing checks for a line-count result;
- counting formatting or export-keyword edits as architectural reduction;
- collapsing low-volume, domain-specific duplicate snippets into a broad
  abstraction;
- deleting the frozen-art generation script without reopening that design
  authority; and
- touching the siloed Design Lab or paused AI Tablet capability boundary.

The remaining 10,726 lines cannot be retired by another dead-code sweep. The
next pass must select one supported production responsibility with two current
implementations, prove one canonical replacement for local preview and live
operation, then remove the superseded authority. Until that replacement is
specified and verified, Pass 04 remains explicitly incomplete.
