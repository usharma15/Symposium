# Pass 04 checkpoint 01 — safe retirement and persistence hardening

## Control record

| Field | Value |
| --- | --- |
| Status | User-authorized checkpoint release; Pass 04 remains incomplete |
| Exact baseline | `5d89eadd83c1d3042b3eb320c0cb81ae9522d21d` |
| Baseline inventory | 470 files / 126,543 physical / 118,498 nonblank |
| Candidate inventory | 469 files / 125,849 physical / 117,856 nonblank |
| Genuine candidate delta | -694 physical / -642 nonblank |
| Candidate categories | 89,849 production / 16,200 styles / 19,800 checks and tools |
| Category deltas | -644 production / -83 styles / +33 checks and tools |
| Pass 04 release ceiling | 114,999 physical |
| Remaining distance to release ceiling | 10,850 physical |
| Program ceiling | 99,999 physical |
| Remaining distance to program ceiling | 25,850 physical |
| Migration impact | None |
| Stored-data format impact | None |
| Route or method impact | None |
| Design impact | Only selectors proved absent were removed; no rendered design was intentionally changed |
| Product capability impact | None intended or accepted |
| Release authorization | User explicitly waived the Pass 04 LOC gate for this checkpoint on July 30, 2026 |
| Release state at evidence capture | Commit and direct push to `main` pending; no deployment or migration performed |
| Unrelated material preserved | `output/`; `scripts/browserCanaryServer 2.ts` |

Documentation is excluded from the source inventory. The source delta is not
inflated by this ledger or the Pass 04 charter.

## Outcome

This checkpoint makes local-preview persistence safer, removes one wholly
unreachable fixture implementation and a bounded set of declaration-only
surfaces, removes exact unreferenced selectors, makes a direct runtime
dependency explicit, and increases browser coverage.

It does **not** satisfy either the 120,999 mid-pass review gate or the 114,999
release gate. It is therefore not represented as Pass 04 completion. The user
subsequently authorized this rigorously tested checkpoint to be committed and
pushed directly to `main` despite that failed LOC gate.

## Confirmed changes

### One serialized local inquiry mutation boundary

`lib/dataStore.ts` previously serialized only action mutations. Profile,
post, and comment create/update/delete operations each performed their own
read-modify-write cycle outside that queue. Concurrent local-preview
requests could read the same snapshot and let the final atomic rename erase
an earlier successful mutation.

All local profile, post, comment, and inquiry-action read-modify-write paths
now use the same `withLocalMutation` queue. The Postgres branches are
unchanged. The local file format, seed merge, identifiers, revisions,
tombstones, quote invalidation, design assignments, and action-ledger
semantics are unchanged.

The browser canary now issues twelve simultaneous titleless Thought creates,
requires twelve successful responses with distinct identifiers, reloads the
canonical posts collection, and compares the exact identifier and body sets.
The scenario passed twice during candidate verification.

### Corrupt local data no longer resets silently

`readLocal` now creates seed data only when the file is absent (`ENOENT`).
JSON parse errors, permission failures, and other filesystem errors propagate
instead of silently replacing the stored site state with seeds. Existing
historical-world migration and pre-migration snapshot behavior remain.

### Dead source retirement

The following whole or declaration-only surfaces had no runtime consumer and
were removed:

- `lib/communityContentFixtures.ts`, an unreferenced 322-line fixture module;
- old workspace, notification, event, AI-budget, citation, patronage,
  authored-artifact, Scribble, attachment, quote, historical-asset, mock-data,
  and post-semantics exports whose repository-wide occurrence was their
  declaration only;
- unused contract aliases and schemas with no runtime or type consumer;
- unused database-client shutdown scaffolding.

The removal was iterated through Knip and exact repository occurrence checks.
Remaining Knip export findings are internally consumed declarations whose
`export` modifier is unnecessary, not deletion-size runtime implementations.

### Proven-dead presentation source

Exact selector families absent from JSX, TS, TSX, and dynamic class
construction were removed from the foundations, content, Workspace,
Scribble, and AI Tablet stylesheets. Dynamic room, tone, document, responsive,
portal, and authored-artifact families were retained. No future Design Lab
material was read or integrated.

### Explicit image-processing dependency

The backend Assistant vision service and artifact verification tools import
`sharp` directly. `sharp@0.35.3` is now an explicit pinned dependency instead
of an accidental transitive dependency supplied by Next. `npm ls sharp`
resolves one deduplicated version, and a clean isolated browser installation
reports zero package vulnerabilities.

## Rejected or conditional candidates

### Direct Postgres Next-development mode — retained

An initial reachability scan made the five-table direct Postgres branch in
`lib/dataStore.ts` appear transitional. A documentation and prior-release
audit established that README and architecture evidence still describe
database-backed Next development without `SYMPOSIUM_API_URL` as supported.

The branch was restored before candidate verification. Its schema, seed,
read, mutation, design-assignment backfill, and action behavior remain.
Deleting it would save materially more lines, but would silently withdraw a
supported runtime mode. Retirement remains conditional on either:

1. an exact adapter through the canonical Fastify/repository authority; or
2. an explicit product decision that database-backed Next-only development is
   no longer supported.

Neither decision is manufactured from the LOC target.

### Direct clone consolidation — insufficient

A direct clone audit analyzed 422 source files and approximately 124,000
lines. It found 1,693 duplicated lines, or 1.36 percent, at the default
threshold. Even perfect removal of those clones could not satisfy the
11,544-line pass gate, and several matches express deliberately separate
domain policy or test doubles.

### Historical data, migrations, dynamic CSS, and regeneration tooling — retained

- Historical fixtures and migrations were not moved into generated or
  non-counted files.
- Dynamic selectors were not classified as dead merely because their full
  class string is assembled at runtime.
- `scripts/buildThoughtBottomCaricatureVariants.mjs` remains because authored
  artifact provenance names it as the frozen asset regeneration tool.
- The user-owned untracked `scripts/browserCanaryServer 2.ts` and `output/`
  remain untouched and unstaged.

These choices prevent an artificial LOC result.

## Verification evidence

### Baseline

- Baseline inventory reproduced exactly: 470 files / 126,543 physical /
  118,498 nonblank.
- `npm run verify`: 56/56 stages passed, including both TypeScript programs,
  optimized production build, and production hydration.
- `npm run proof:check`: passed.
- Isolated browser canary: 5/5 passed outside the Chromium-restricted sandbox.

### Candidate

- `npm run verify`: 56/56 stages passed, including route/method preservation,
  security, persistence, live transport, reconciliation, attachments,
  citations, Workspace, Scribble, Assistant, Patronage, Opportunities,
  profiles, both TypeScript programs, optimized production build, and
  production hydration.
- `npm run proof:check`: source-inventory, verification-runner,
  browser-report, canary-server, and proof-typecheck self-tests passed.
- `npm run browser:canary`: 6/6 passed in 42.9 seconds with one worker, no
  skip, retry, flake, unexpected result, report error, page error, accepted
  same-origin console error, or accepted same-origin request failure.
- The browser matrix covered first entry; canonical room/detail navigation
  and Back; Paper and titleless Thought identity across Day/Night and reload;
  desktop/mobile containment; titleless Thought create, edit, reload, and
  fresh-session persistence; and twelve simultaneous local writes without
  loss.
- Exact browser report validation passed.
- `npm run loc:report`: 469 files / 125,849 physical / 117,856 nonblank.
- `npm run loc:check` intentionally withheld a clean-worktree certificate
  because the preserved user-owned `scripts/browserCanaryServer 2.ts` is
  untracked source. It reported the same canonical tracked-source inventory;
  that unrelated copy is not silently counted, staged, edited, or deleted.
- `git diff --check`: passed.
- Candidate package audit: clean isolated install found 0 vulnerabilities;
  Knip found no unexplained tracked whole-file deletion candidate beyond the
  retained authored-artifact regeneration tool.
- Current released Render API deep readiness remained healthy and strict with
  64/64 migrations, no pending migration, all required providers healthy, and
  exact release `5d89eadd83c1d3042b3eb320c0cb81ae9522d21d`.

The local shell intentionally has no production credentials, so
`npm run live:env:report` reports the local development configuration rather
than certifying the candidate against production providers. The candidate was
not deployed, and no claim of candidate production verification is made.

## Why this checkpoint stops

The candidate is 10,850 lines above the Pass 04 release ceiling and 4,850
lines above its mid-pass review ceiling. The charter requires a stop and
opportunity-ledger reconciliation when safe slices cannot reach 120,999. The
explicit checkpoint-release waiver does not change those facts or mark the
pass complete.

The audit found no unreferenced or directly duplicated implementation large
enough to close that gap. The largest apparent immediate saving was the
documented database-backed Next runtime, and it was retained. Deleting
assertions, moving source into excluded formats, compressing formatting,
removing frozen or dynamic design rules, and weakening types were also
rejected.

The next material reduction therefore requires a real authority decision and
replacement, not another deletion sweep:

- preserve database-backed Next development by implementing a canonical API
  adapter, then retire its five-table authority; or explicitly retire that
  runtime mode;
- replace shell-owned route/entity/synchronization state with a characterized
  canonical controller and delete the old ownership;
- perform the future approved sitewide design migration as replacement and
  retire superseded presentation families rather than layering new CSS over
  them;
- consolidate proof infrastructure only with stable semantic-case parity.

No statement that “absolutely everything was checked” is made. The evidence is
limited to the exact static, behavioral, browser, build, inventory, dependency,
and released-readiness gates recorded above.
