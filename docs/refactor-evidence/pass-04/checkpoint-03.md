# Pass 04 checkpoint 03 — isolated recovery proof

## Control record

| Field | Value |
| --- | --- |
| Status | Gate A passed: local, Neon relational, and live R2/static coherence recovery proof complete; authority replacement has not started |
| Exact released baseline | `2b28a88d9adc83750d6f553a58c82e537566f2f5` |
| Candidate inventory | 475 files / 127,768 physical / 119,670 nonblank |
| Candidate delta versus exact post-integration baseline | +23 files / +617 physical / +670 nonblank |
| Candidate delta versus current main | 0 files / +131 physical / +130 nonblank |
| Candidate categories | 90,034 production / 16,200 styles / 21,534 checks and tools |
| Program ceiling | 99,999 physical |
| Remaining distance to program ceiling | 27,769 physical |
| Product/schema impact | No new product or schema change in the R2 follow-up; the released checkpoint includes note ownership and forward-only migration `0065` |
| Production mutation | The user-authorized push auto-deployed `2b28a88`; the R2 continuation performed read-only provider requests only |
| Provider mutation | Previously created recovery branch, derived audit child, and disposable child databases retained; this continuation made no provider mutation |
| Commit, push, deploy | Checkpoint source is committed and pushed only after final verification; Render auto-deploy is enabled and independently verified |
| Design Lab and AI Tablet | Untouched; the disabled Assistant boundary remained disabled during smoke |
| Preserved unrelated paths | `output/`; `scripts/browserCanaryServer 2.ts` |

Documentation is excluded from the source inventory. The unrelated untracked
canary copy was moved out only for the LOC policy invocation, restored
immediately, and verified against its original SHA-256
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
cases to the canonical 59-stage release runner. The credentialed path now
separates repository-owned `static` fixtures from the configured R2 bucket,
rejects unexpected provider buckets, checks failed canonical objects for
residue, and treats missing staging objects as coherent only when a durable
deletion state or job explains the absence.

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

Final candidate evidence after the R2 harness correction:

- `npm run recovery:check` — passed ten safety/coherence cases;
- `npm run migration:check` — passed ten migration cases;
- `npm run infrastructure:check` — passed;
- `npm run workspace:check` — passed with the owner insert guard;
- `npm run proof:check` — passed;
- `npm run typecheck:all` — passed;
- `npm run build` — optimized production build and hydration passed;
- `npm run verify` — passed 59/59 stages in 70.491 seconds;
- `npm run loc:check` — passed at 475 / 127,768 / 119,670;
- `npm audit --audit-level=high` — zero vulnerabilities;
- `npm run browser:canary` — passed 6/6 in 41.9 seconds;
- exact browser report validation — passed.

The first production build attempt exposed a stricter Next typecheck boundary:
the recovery self-test's synthetic `ProcessEnv` omitted `NODE_ENV`. The fixture
now supplies `NODE_ENV=test`; the isolated build and complete 59-stage rerun
then passed.

The first browser launch was denied before page creation by the macOS sandbox's
Mach port policy. The same candidate was rerun outside only that restriction
and passed all six browser cases.

Read-only production verification after Render auto-deployed the
user-authorized push found:

- `https://www.symposiumsci.com` returned `200` with the expected security
  headers;
- public API smoke passed;
- strict deep readiness passed with every required provider configured;
- release was exactly
  `2b28a88d9adc83750d6f553a58c82e537566f2f5`;
- all 65 migrations were applied through
  `0065_comment_deletion_reconciliation`;
- no pending migration was reported.

The deep probe reported every required provider healthy, no issues or
warnings, and the durable R2 deletion worker active. The public API smoke
returned 22 profiles, 24 items, 12 communities, and one opportunity.

## Live R2 and static-object recovery proof

The final `restore-audit` ran against the derived Neon audit child, whose safe
database fingerprint differs from the production fingerprint. It imported
only `HeadObjectCommand`, rejected any provider bucket other than the exact
configured R2 bucket, and made no R2 write, copy, lifecycle, list, or delete
request. Repository-owned historical assets under the sentinel bucket
`static` were verified against `public/` with path-containment, byte-size, and
content-type checks.

The first live attempt exposed two proof-harness assumptions:

1. The 25 historical preview assets use the deliberate `static` bucket and
   must not be sent to R2, where they correctly returned `403`.
2. Failed uploads need their canonical object checked for residue. A missing
   failed object is coherent only when a deletion job, pending marker, or
   deleted marker explains it; a present object after a deleted marker is now
   a hard failure.

After correction, the final live audit passed in 39.409 seconds:

- 190 attachment rows with 190 distinct canonical `(bucket, object_key)`
  identities;
- 89 `uploaded`, 25 `previewed`, and 76 `failed` rows;
- 114 active attachments: 89 R2 objects and 25 bundled static assets;
- 129 distinct staging keys;
- 319 total inspections: 294 R2 `HeadObject` requests and 25 local static-file
  checks;
- all 89 active R2 objects present with exact byte size and normalized content
  type;
- all 76 failed canonical objects absent with `storageState=deleted`;
- all 129 distinct staging objects absent and reconciled through staging or
  failed-object deletion state;
- 205 missing references allowed by deletion state;
- zero durable deletion jobs and zero coherence issues; and
- salted coherence SHA-256
  `28564965f95478524e2dcb1bb0d4357bad1c7d507042d40ed4bc7611f6896e7b`.

Machine evidence is
`.artifacts/refactor/recovery/neon-r2-restore-audit-20260730-a1.json`, mode
`0600`. It contains no credentials, raw keys, filenames, signed URLs, bodies,
or user identities.

The existing Render application credential was used solely through the
read-only audit code path; its provider-side permission scope was not changed
or independently narrowed. This is a documented least-privilege caveat, not a
claim that the credential itself is read-only.

Gate A is complete. Gate B may now begin only as a separately bounded
authority-replacement pass; none of that work is included here.
