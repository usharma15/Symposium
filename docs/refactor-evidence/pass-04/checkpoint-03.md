# Pass 04 checkpoint 03 — isolated recovery proof

## Control record

| Field | Value |
| --- | --- |
| Status | Local and Neon relational recovery passed; live R2 object audit remains blocked by missing read-only credentials; no deployment performed |
| Exact baseline | `1a571beb2a5c51ac53641522e5a7a1d7f9cf5f43` |
| Candidate inventory | 475 files / 127,637 physical / 119,540 nonblank |
| Candidate delta versus exact post-integration baseline | +23 files / +486 physical / +540 nonblank |
| Candidate delta versus current main | +6 files / +1,788 physical / +1,684 nonblank |
| Candidate categories | 90,034 production / 16,200 styles / 21,403 checks and tools |
| Program ceiling | 99,999 physical |
| Remaining distance to program ceiling | 27,638 physical |
| Product/schema impact | Fixes note ownership and adds forward-only migration `0065` to reconcile a production-only legacy comment deletion flag without losing tombstones |
| Production mutation | None |
| Provider mutation | New point-in-time recovery branch, derived audit child, and disposable child databases only; production branch untouched |
| Commit, push, deploy | Checkpoint source committed and pushed after final verification; no deployment |
| Design Lab and AI Tablet | Untouched; the disabled Assistant boundary remained disabled during smoke |
| Preserved unrelated paths | `output/`; `scripts/browserCanaryServer 2.ts` |

Documentation is excluded from the source inventory. The six intended new
source files were added to the index so the canonical inventory measured the
actual candidate. The unrelated untracked canary copy was moved out only for
the LOC policy invocation, restored immediately, and verified against its
original SHA-256
`9ca3d8239ffb43186453d70feb5b5d8e4f023d9dc3ec411abc82c687197e2b4a`.

This checkpoint does not satisfy the program LOC exit gate and is not a
release. The source ceiling is ratcheted to the exact safety candidate; it
creates no future growth allowance.

## Implemented recovery boundary

The candidate adds a fail-closed recovery runner with:

- an exact acknowledgement sentinel and generated drill identity;
- exact database, role, and application-name matching;
- mandatory production-fingerprint exclusion for remote targets;
- secret-free target fingerprints and drill-salted attachment evidence hashes;
- fresh reconstruction through the real 65-migration candidate manifest;
- legacy ID-only ledger backfill without historical SQL replay;
- checksum and position drift rejection;
- two-session real advisory-lock concurrency proof;
- transactional partial-failure rollback and corrected retry;
- a read-only restored-database/R2 attachment coherence audit; and
- mode-`0600` JSON evidence containing aggregates and hashes, not credentials,
  raw object keys, filenames, user content, or identities.

`npm run recovery:check` contributes ten deterministic safety and coherence
cases to the canonical 59-stage release runner.

## Real PostgreSQL drill

PostgreSQL 17.10 and OpenSSL 3.5.7 were built from checksum-verified official
source into a disposable directory. No system package, repository dependency,
or production service was changed.

Two fresh databases were exercised independently:

- `symposium_drill_local_20260730_norma`;
- `symposium_drill_local_20260730_normb`.

They were deliberately owned by different drill roles. This caught and removed
the non-semantic relation-owner name from the manifest before the final runs.
The corrected manifest is therefore stable across owner/provider identity.

Both produced the same:

- 64 exact canonical ledger rows;
- 61 product tables;
- 1,265 normalized schema-manifest entries;
- manifest SHA-256
  `2933b4e655e75aa51e53fd5fe107cae826e7c7485e6db1e828650c55fb2e4670`;
- row-count digest
  `ae86c2453497d0bac8b580de2cf193596537a7fc78043fa7b0d551d88b61de82`.

The two final runs reconstructed the full schema in 122 ms and 126 ms. In
both:

- all 64 legacy rows acquired exact checksum and one-based position metadata;
- product schema and row counts remained stable across backfill;
- two independent sessions applied one pending test migration exactly once;
- a deliberately failing migration left zero partial tables and zero partial
  ledger rows;
- the corrected retry applied exactly once; and
- no test-only migration ID remained in the database.

The machine evidence is:

- `.artifacts/refactor/recovery/final-local-postgres-a.json`;
- `.artifacts/refactor/recovery/final-local-postgres-b.json`.

The disposable database server was stopped after verification. Its temporary
source/build/data directory was retained for review; no destructive cleanup
was performed.

## Neon point-in-time recovery and schema convergence

An authenticated Neon session restored production to the new branch
`recovery-drill-neon-20260730-a1` at requested point
`2026-07-30 15:52:28.067 -04:00`. Neon reported a 0.24-second fork. The branch
overview was ready 7.34 seconds after submission. The first deliberately
recorded TLS database connection completed 196.26 seconds after submission;
that longer measurement includes operator credential extraction and local
approval latency and is not represented as provider-only RTO.

The restore branch is retained without auto-deletion and was not mutated. A
derived child, `recovery-audit-neon-20260730-a1`, forked in 0.20 seconds and
contains all audit mutations. Both target fingerprints differ from the
separately recorded production endpoint fingerprint.

The true production-shaped ledger initially had 64 ID-only rows and no
`checksum` or `position` columns. The first corrected backfill:

- added both metadata columns through the candidate runner;
- backfilled all 64 rows without replaying historical SQL;
- rejected checksum and position tampering;
- preserved all product row counts; and
- completed in 5.477 seconds on PostgreSQL 18.4.

This provider run found two real proof defects and one real schema drift:

1. The backfill harness tried to null metadata columns before a true legacy
   ledger had those columns. It now detects the legacy shape and lets the
   migration runner add them.
2. Recovery evidence hashed only changed path names. It now hashes the full
   binary Git diff plus NUL-delimited status.
3. The restored schema retained `comments.deleted BOOLEAN NOT NULL`, while a
   fresh reconstruction did not. All 393 restored comments had
   `deleted=false` and `deleted_at IS NULL`, but candidate migration `0065`
   still safely copies any true legacy flag into `deleted_at` before dropping
   the redundant column.

Column ordinals are now excluded from the semantic manifest. After `0065`,
the restored and fresh PostgreSQL 18.4 databases matched exactly:

- 65 canonical migration rows;
- 61 product tables;
- 1,752 normalized manifest entries;
- manifest SHA-256
  `b763d7eb4db2d361c5ba05bbde5ef0597788a90d267f9cef96552f354ab88e86`;
- zero restored-only entries; and
- zero fresh-only entries.

The final Neon `all` run additionally passed fresh reconstruction,
65-row metadata backfill, two-session exactly-once concurrency, injected
transaction rollback, corrected retry, and exact cleanup. Its fresh
row-count digest remained
`ae86c2453497d0bac8b580de2cf193596537a7fc78043fa7b0d551d88b61de82`.

Machine evidence is under `.artifacts/refactor/recovery/`, including
`neon-final-all-20260730-a1.json`,
`neon-upgrade-0065-20260730-a1.json`, and
`neon-fresh-upgrade-0065-20260730-a1.json`. Each artifact is mode `0600`.

## Live API and restart matrix

The exact candidate API ran against the first isolated database. Read smoke
passed with migration `0064`. The write matrix exercised:

- titleless Thought creation;
- idempotent replay and payload-conflict rejection;
- save, fork, activation, deactivation, and profile projection;
- comments;
- hosted calls, participant join, foreign end rejection, and host end;
- Opportunities;
- direct messages, replay, and foreign-conversation denial;
- note-block creation, replay, and foreign-owner denial;
- note publication to a Paper; and
- the explicitly disabled Assistant response boundary.

The first write run found a real defect: the legacy note-block path inserted a
new `notes` row without its required `owner_handle`. The insert now persists
the authenticated owner and the Workspace construction check guards the exact
query shape. The write matrix then passed completely.

The API process was stopped and restarted against the same database. Deep
readiness and read smoke passed, and exact reads recovered both the newly
created titleless Thought and the newly published Paper with their original
identifiers and semantic types. This proves persistence across a real service
restart, not only within one process.

The smoke harness also stopped treating a disabled AI response as a persisted
research thread. It now tests the deliberate disabled/provider-not-configured
contract without enabling the paused capability or making a provider call.

## Complete verification

Final candidate evidence:

- `npm run recovery:check` — passed ten safety/coherence cases;
- `npm run migration:check` — passed ten migration cases;
- `npm run infrastructure:check` — passed;
- `npm run workspace:check` — passed with the owner insert guard;
- `npm run proof:check` — passed;
- `npm run typecheck:all` — passed;
- `npm run build` — optimized production build and hydration passed;
- `npm run verify` — passed 59/59 stages in 66.317 seconds;
- `npm run loc:check` — passed at 475 / 127,637 / 119,540;
- `npm audit --audit-level=high` — zero vulnerabilities;
- `npm run browser:canary` — passed 6/6 in 43.5 seconds;
- exact browser report validation — passed.

The first production build attempt exposed a stricter Next typecheck boundary:
the recovery self-test's synthetic `ProcessEnv` omitted `NODE_ENV`. The fixture
now supplies `NODE_ENV=test`; the isolated build and complete 59-stage rerun
then passed.

The first browser launch was denied before page creation by the macOS sandbox's
Mach port policy. The same candidate was rerun outside only that restriction
and passed all six browser cases.

Read-only production verification on July 30, 2026 found:

- `https://www.symposiumsci.com` returned `200` with the expected security
  headers;
- public API smoke passed;
- strict deep readiness passed with every required provider configured;
- release remained
  `1a571beb2a5c51ac53641522e5a7a1d7f9cf5f43`;
- all 64 migrations remained applied through
  `0064_authored_artifact_design_assignments`;
- no pending migration was reported.

These checks establish a healthy baseline. They do not imply that this local
candidate was deployed.

## Remaining live R2 proof

The restored relational audit found:

- 190 attachment rows with 190 distinct canonical `(bucket, object_key)`
  identities;
- 89 `uploaded`, 25 `previewed`, and 76 `failed` rows;
- 114 active objects requiring metadata inspection;
- 129 distinct staging keys;
- 114 confirmed `stagingStorageState=deleted` markers; and
- zero durable storage-deletion jobs.

The local `.env.live` intentionally contains blank R2 account and credential
values, and the available browser session is logged out of Render. Therefore
no R2 `HeadObject` request was issued and no object existence, byte size, or
content type is claimed. The 76 failed rows also lack relational deletion
state, so their actual object absence or required cleanup cannot be decided
without the read-only object audit.

Gate A remains partially open only at this R2 boundary. The preserved restore
branch and derived audit child remain available for completion after
read-only R2 credentials are supplied. Gate B authority replacement must not
open to bypass this missing evidence.
