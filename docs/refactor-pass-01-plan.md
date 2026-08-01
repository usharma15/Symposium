# Major Refactor Pass 01 — Proof Kernel and Refactor Control Plane

> **Historical plan.** As of August 1, 2026, its topic-branch, pull-request,
> GitHub Actions, and remote-enforcement instructions are retired. Current work
> stays on `main`, is verified locally, committed, and pushed directly.

## Document control

| Field | Value |
| --- | --- |
| Status | Implemented and verified locally on `codex/refactor-pass-01`; remote CI/enforcement and provider readback remain |
| Prepared | July 29, 2026 |
| Execution trigger | Satisfied July 29, 2026: the user explicitly authorized the first major Ultra infrastructure pass |
| Baseline commit | `8e900d0fa675b311a67029b8d2f109b4da97301e` |
| Baseline migration | `0064_authored_artifact_design_assignments` — migration 64 of 64 |
| Baseline source size | 127,151 physical / 119,000 nonblank lines across 452 tracked handwritten source/style files |
| Hard program exit | Perfect zero-loss operation **and** no more than 99,999 canonical source lines |
| Preferred operating band | 90,000–95,000 canonical source lines |
| Pass 01 product scope | Verification, measurement, CI/release proof, and read-only characterization; no feature redesign or capability expansion |
| Pass 01 source budget | Evidence-based proof-only final cap: 128,351 (+1,200). Additive construction cap: 128,651 (+1,500). Every added line must belong to tested measurement, verification, browser proof, or exact evidence; product source remains frozen |
| Pass 01 candidate result | 128,351 physical / 120,123 nonblank lines across 461 files; +1,200 physical, all in proof/check tooling; exact checked-in ceiling ratcheted to 128,351 |
| External-state rule | The execution instruction authorizes completion work, including publication, but remote enforcement/deployment remains evidence-gated; no production write smoke or destructive data/provider action is inferred from broad authority |

This is the runbook for the first major pass of the
`Symposium Zero-Loss Sublime Engineering Refactor Program`. It is deliberately
specific enough that the Ultra execution turn should begin with evidence
capture and implementation, not another broad planning exercise.

---

## 1. The decision

The first major pass establishes one trusted **refactor control plane**:

- one honest definition and report for source size;
- one authoritative manifest for the repository’s verification commands;
- one reproducible full verification gate outside an individual Codex session;
- one small, stable automated browser canary layer;
- one exact-SHA release-evidence format;
- one zero-loss slice report and rollback contract;
- one generated inventory of the compatibility/local runtime spine that will
  be the first large consolidation target.

This is not an architectural rewrite and it is not a ceremonial prelude that
may expand indefinitely. It is a bounded engineering pass that turns the
existing broad but locally orchestrated checks into a dependable proof system.
That proof system is what permits later deletion of load-bearing duplicate
paths without gambling with functionality, data, live synchronization, or
design.

The pass must improve engineering leverage immediately:

- a regression becomes attributable to one named check and timed stage;
- a change cannot silently move source into an uncounted executable extension;
- a pull request can be proved at an exact SHA;
- a later slice receives the same focused/full/browser/release evidence shape;
- the next consolidation starts from a caller-and-runtime-mode inventory,
  rather than intuition.

It does **not** claim that this enabling pass alone is the 27,152-line descent.
The pass is successful only if it creates the proof system without becoming a
new source of sprawl and hands the next pass a deletion-ready runtime map.
The original planning estimate allowed only +300 lines. Pre-implementation
audit disproved that estimate: the old orchestration lives in excluded
`package.json`, so replacing it retires no canonical source, while a
typechecked/tested metric, runner, browser harness, and failure fixtures require
roughly 1,000–1,200 honest lines. The budget is therefore corrected before
those systems are built. Forcing +300 would reward under-testing, formatting
compression, or risky edits across valuable checks. The 99,999 program exit is
unchanged.

---

## 2. Locked baseline facts

### 2.1 Source and Git identity

- `HEAD` is
  `8e900d0fa675b311a67029b8d2f109b4da97301e`.
- `origin/main` is the same SHA.
- The completed design integration’s full `npm run verify` passed at this SHA.
- No tracked product file is modified at planning time.
- `docs/major-refactor-program.md` and this plan are refactor planning
  artifacts.
- The unrelated untracked `output/` directory belongs to the Main Hall design
  work and is out of scope. It must not be staged, deleted, reformatted, or
  absorbed.

### 2.2 Honest source metric

Canonical extensions:

```text
.ts .tsx .js .jsx .mjs .cjs .mts .cts .css .scss .py .sql .sh
```

Exact baseline:

| Metric | Value |
| --- | ---: |
| Files | 452 |
| Physical lines | 127,151 |
| Nonblank lines | 119,000 |
| Older six-extension count | 126,329 |
| Executable source omitted by the older count | 822 |
| Reduction required for 99,999 | 27,152 |
| Reduction required for 95,000 | 32,151 |
| Reduction required for 90,000 | 37,151 |

The broader metric prevents two obvious forms of accidental gaming:

1. the existing `.mjs` and `.py` tools count as executable source;
2. extracting migration SQL from `migrate.ts` into `.sql` files cannot
   manufacture a reduction.

Generated output, installed dependencies, lockfiles, documentation, binary
assets, external Design Lab files, and ignored prototypes remain excluded.
Handwritten executable logic may not be moved into an excluded format or
generated file to reduce the report.

### 2.3 Current verification topology

- `npm run verify` invokes 56 commands in a fixed shell chain.
- It includes architecture, platform, security, infrastructure, cost, routing,
  persistence/revision, live transport, cross-tab, content, Workspace,
  messaging, notifications, Assistant, attachment, typecheck, build, and
  hydration checks.
- The integration task passed that complete chain at the baseline SHA.
- The repository has no checked-in CI workflow at the baseline.
- Render currently runs `npm ci && npm run deploy:api:check`; the latter is
  preflight plus API typecheck, not the complete release suite.
- There is no checked-in, stable end-to-end browser test harness at the
  baseline.
- The local runtime used during planning is Node `v24.16.0` and npm `11.13.0`;
  `package.json` permits Node `>=20.9.0`. Pass 01 pins the candidate and CI to
  Node 24; provider-side compatibility/readback remains a release condition,
  not something source configuration alone proves.

### 2.4 Current runtime-spine candidate surface

This is a candidate inventory, not pre-approved deletion:

| Surface | Physical lines |
| --- | ---: |
| `app/api/**/route.ts` — 85 Next route files | 3,714 |
| `lib/dataStore.ts` | 2,148 |
| Five `local*Store.ts` modules, including `localWorkspaceStore.ts` | 2,551 |
| Combined visible compatibility/local surface | 8,413 |

Eighty-three of the 85 Next routes reference the live-backend bridge directly
or through message/live helpers. Some are thin production/protected-delivery
proxies; many also preserve local-preview behavior. The Fastify repositories’
no-database branches do not currently reproduce all of that durable local
behavior. Therefore none of these 8,413 lines is credited as savings and none
may be deleted wholesale.

---

## 3. Non-negotiable invariants

Pass 01 and every later pass inherit these invariants:

1. No site usage, feature, microfeature, route, state, or failure mode is
   silently withdrawn.
2. No persisted user data is lost, corrupted, reinterpreted, or made
   unreachable.
3. No revision, idempotency, authorization, privacy, attachment, or audit
   guarantee is weakened.
4. No live-event, cursor replay, cross-tab reconciliation, reconnect, or
   stale-response behavior is weakened.
5. No approved Paper, Thought, Workspace, responsive, Day/Night, keyboard, or
   accessibility design behavior changes.
6. Production must continue to fail closed; it may not fall back to
   process-local demo data when the live API is absent.
7. Local preview remains supported until an equivalent path is implemented
   and proved.
8. The Assistant remains at its present capability boundary. This pass adds no
   tools, context scope, actions, publishing, messaging, or autonomy.
9. Historical migration IDs and meaning remain immutable.
10. A line is removed only after its supported responsibility has one proved
    surviving owner.

The pass is also governed by a positive standard: the result must be clearer,
more composable, less error-prone, and easier to extend—not merely shorter.

---

## 4. Scope boundaries

### In scope

- canonical source inventory and burn-down reporting;
- verification manifest/orchestration and evidence output;
- checked-in CI workflow;
- dependency vulnerability gate;
- exact-SHA release-evidence template;
- stable, non-production browser canaries for the smallest critical paths;
- reusable test-only setup that does not use production user data;
- read-only compatibility/local-runtime caller classification;
- consolidation of strictly duplicated verification scaffolding when every
  assertion and failure diagnostic is preserved;
- documentation required to execute and audit the pass.

### Explicitly out of scope

- changing `components/SymposiumV0.tsx` application behavior;
- changing `PostViews`, authored-artifact registries, Paper/Thought geometry,
  editor behavior, or the newly integrated design;
- changing domain repositories, schema, migrations, mutation semantics, or
  production data;
- deleting or converging Next compatibility routes or local stores;
- Assistant capability work;
- a broad CSS cleanup;
- provider replacement;
- distributed live-event fanout;
- payment activation;
- feature work discovered incidentally;
- deployment or remote repository administration without explicit authority.

If execution discovers a genuine regression in the baseline, it records and
isolates it. It does not smuggle an unrelated product fix into this pass unless
the user explicitly expands scope.

---

## 5. Execution sequence

Each slice ends with a checkpoint. A later slice does not conceal failure in an
earlier one.

### Slice 0 — Baseline recapture

Purpose: prove that the execution turn still starts from the planned source
identity.

Actions:

1. Read this plan and the master program completely.
2. Inspect `git status`, `HEAD`, `origin/main`, and all untracked paths.
3. Confirm that no active task owns overlapping files.
4. Recompute physical and nonblank source counts with the canonical extension
   set.
5. Record Node, npm, lockfile, Next, React, TypeScript, and provider runtime
   facts that are locally or authoritatively available.
6. Run the full baseline gate:

   ```bash
   npm ci
   npm run verify
   npm audit --audit-level=high
   ```

7. Do not run write smoke tests or mutate production.

Stop immediately if:

- `HEAD` or the tracked tree differs without an explained user-owned change;
- the canonical count differs without a classified source change;
- the baseline verification fails;
- an overlapping task is active;
- `output/` cannot be kept isolated.

Checkpoint evidence:

- exact SHA and status;
- exact count;
- command versions;
- full gate exit codes and elapsed times;
- baseline warnings, if any.

No baseline tag is required. The immutable commit SHA is sufficient; a tag is
created only if the user asks for one.

### Slice 1 — Canonical source inventory

Purpose: replace copy-pasted shell arithmetic with one tested, reviewable
metric implementation.

Planned shape:

- add one small source-inventory module under `scripts/`;
- use `git ls-files` as the tracked-file authority;
- count physical and nonblank lines;
- report by extension, top-level owner, production/check/style category, and
  total;
- support comparison against a baseline SHA;
- emit human-readable text and deterministic JSON;
- fail on an unclassified new executable extension;
- distinguish source delta from documentation/config/assets;
- record the hard 99,999 ceiling and the current per-pass budget;
- add focused tests using a temporary Git fixture, including spaces in paths,
  empty files, CRLF/LF, a new extension, and baseline comparison.

Required commands after implementation:

```bash
npm run loc:report
npm run loc:check
```

Acceptance:

- output exactly reproduces 127,151 / 119,000 at the baseline;
- `.mjs`, `.py`, and future `.sql` migration files count;
- ignored, untracked, generated, dependency, and design-output files do not;
- changing only an extension cannot fabricate a reduction;
- the report is deterministic and attached to the exact SHA.

### Slice 2 — Verification manifest and runner

Purpose: turn the 56-command shell chain into an observable proof kernel
without weakening it.

Method:

1. Inventory all 56 existing commands, their order, side effects, environment
   needs, and failure behavior.
2. Represent them in one typed manifest with stable IDs and categories.
3. Initially execute them in the exact present order. Do not introduce
   parallelism until independence is proved.
4. Preserve every individual npm command for focused local use.
5. Produce concise console output plus a deterministic report containing SHA,
   command, category, duration, exit status, and failure tail.
6. Support focused categories and the exact full gate.
7. Keep `typecheck:all` and the production build/hydration check in the full
   gate.
8. Test runner behavior with harmless fixture commands: success, failure,
   timeout, signal termination, and report writing.

Assertion-parity rule:

- no existing check file, assertion, fixture, negative case, or diagnostic is
  removed merely because orchestration changes;
- any shared check helper introduced must demonstrate a smaller total
  implementation and equal or better failure messages;
- exact before/after assertion counts are recorded for every check file touched.

Acceptance:

- the new full command and the old command have the same pass/fail result at
  the baseline;
- a controlled failing fixture yields a nonzero exit and names the failed
  stage;
- reports survive a failed run;
- there is no product runtime dependency on the proof kernel;
- repeated orchestration or file-loading scaffolding is consolidated only
  where mechanically provable.

### Slice 3 — CI and release gating

Purpose: ensure the proof kernel runs outside the initiating workstation.

Planned repository work:

- add a GitHub Actions verification workflow because `origin` is GitHub;
- pin the runtime only after reconciling the supported local, Vercel, and
  Render versions;
- use `npm ci`;
- run the canonical LOC report/check;
- run the full verification gate;
- run `npm audit --audit-level=high`;
- set explicit timeouts and cancel superseded runs for the same branch;
- retain concise verification and LOC artifacts;
- avoid logging secrets or environment values;
- use test/local identities only;
- do not run production write smoke tests.
- keep workflow YAML declarative: substantive metric, verification, or product
  logic remains in counted and tested source rather than hidden in multiline
  `run:` blocks.

Remote branch protection and required-check configuration are external
repository mutations. The workflow can be prepared and locally validated
inside the pass, but enabling remote enforcement requires explicit authority.
Until that happens, the pass must label the gate “checked in but not remotely
required,” not “enforced.”

Render must not be made to build the entire frontend needlessly. The execution
pass will determine the smallest API deployment gate that proves API
preflight, API types, migration manifest integrity, and relevant API checks,
while the complete repository gate remains the merge authority.

Acceptance:

- the workflow syntax and commands validate locally;
- a clean checkout can run the same full gate;
- the LOC artifact contains the exact SHA;
- failure in verification or audit fails CI;
- no secret or production write is required;
- enforcement state is reported exactly.

### Slice 4 — Minimal browser canary layer

Purpose: prove a few load-bearing browser contracts automatically before later
UI/runtime consolidation.

Initial canary boundary:

- entry hydration with no console or hydration error;
- canonical direct route plus Back/Forward behavior;
- modifier-safe navigation behavior;
- one Paper detail and one Thought detail render;
- desktop and narrow-mobile horizontal-overflow check;
- one Day/Night transition without identity rerandomization;
- one read-only live connection/reconnect observation if a safe local test
  environment can provide it.

Authentication constraints:

- do not weaken Clerk or add a production bypass;
- do not use production user data;
- prefer a local/dev actor only where the existing runtime explicitly permits
  it;
- if stable authenticated automation requires a dedicated test tenant or
  secret that is not available, keep authenticated cases in the explicit
  manual matrix and report the blocker. Do not fake coverage.

The canaries are intentionally small. This pass does not attempt to encode the
entire site in brittle screenshots. Each later product slice adds targeted
browser cases for the surface it changes.

Acceptance:

- canaries run against a controlled local build;
- failures include route, viewport, console/network context, and screenshot or
  trace;
- no production mutation occurs;
- visual checks assert semantic/frozen invariants rather than incidental
  pixels unless the exact geometry is an approved frozen asset;
- added test source respects the pass LOC budget.

### Slice 5 — Exact-SHA evidence and slice contract

Purpose: make every later consolidation produce the same auditable handoff.

Deliver:

- a compact evidence template for baseline, focused checks, full gate, browser,
  persistence/live, LOC, performance, release identity, limitations, rollback,
  and deleted-owner proof;
- a command that captures locally available SHA/count/version facts without
  secrets;
- explicit distinction among implemented, locally verified, deployed,
  production-verified, incomplete, and blocked;
- an additive data-change/rollback reminder: code can roll back without
  rewinding writes; database contractions wait through compatibility windows.

Acceptance:

- one dry-run report is generated for Pass 01;
- no statement calls a local result deployed;
- no production release is called current without exact-SHA readiness
  evidence;
- known limitations remain visible rather than being converted into “passed.”

### Slice 6 — Runtime-spine characterization

Purpose: spend the end of the Ultra pass preparing the first large, real
consolidation without modifying that product surface yet.

Generate an inventory for every `app/api` route and every local store:

- source file and LOC;
- methods and route pattern;
- client callers;
- server callers;
- production-direct behavior;
- production compatibility behavior;
- protected-delivery reason;
- local-preview behavior and persistence location;
- authentication/authorization owner;
- idempotency and revision behavior;
- live-event behavior;
- failure/fail-closed behavior;
- tests that prove the path;
- intended surviving authority;
- classification: retain, converge, replace, or proven dead;
- estimated gross deletion only after replacement cost;
- unresolved evidence.

The characterization must specifically prove or disprove:

- whether a thin catch-all compatibility gateway can replace any family of
  route files without changing Next route precedence or protected delivery;
- which direct client paths already bypass Next in production;
- which local stores preserve behavior absent from Fastify’s no-database mode;
- whether a canonical durable local adapter can serve both route and repository
  contracts without duplicating the production repository;
- which routes exist solely for authentication or protected attachment
  delivery and therefore must remain explicit.

Acceptance:

- all 85 route files and all six local/data stores are classified;
- every proposed deletion has a named replacement and proof requirement;
- no 8,413-line gross number is represented as net savings;
- the next pass can select one bounded route/store family without redoing this
  investigation.

---

## 6. Verification cadence

For each source-changing slice:

1. run the slice’s focused tests;
2. run typechecks for every touched runtime;
3. run the full proof kernel;
4. run the relevant local browser canaries;
5. recompute physical/nonblank LOC and category deltas;
6. inspect the full diff for weakened checks, casts, moved logic, or accidental
   design/output changes.

At final Pass 01 exit:

```bash
npm ci
npm run loc:check
npm run verify
npm audit --audit-level=high
git diff --check
git status --short --branch
```

Also perform:

- clean-checkout reproduction where available;
- browser canary run with retained evidence;
- old-versus-new verification-result parity;
- exact assertion/fixture reconciliation for every changed check;
- manual inspection that no application, data, design, or Assistant behavior
  changed.

`npm run verify` passing is necessary, not sufficient. The pass also needs
metric integrity, runner-failure proof, browser evidence, and a clean scope
audit.

---

## 7. LOC accounting

Pass 01 reports:

- exact physical and nonblank before/after totals;
- delta by extension;
- delta by top-level directory;
- production/check/style categories separately;
- new automated-proof LOC separately;
- retired duplicated scaffolding separately;
- cumulative distance to 99,999, 95,000, and 90,000.

Rules:

- CI YAML, documentation, or package metadata are not falsely presented as
  source reduction;
- moving logic out of a counted extension is prohibited;
- deleting tests or assertions is prohibited;
- weakening types, formatting compression, code generation, or opaque
  abstraction is prohibited;
- a positive delta is not called progress toward the ceiling;
- the corrected +1,200 proof-only allowance and +1,500 additive construction
  allowance exist only so rigorous proof is not rejected for accounting
  reasons; neither alters the hard program exit.

Pass 01 proof-only final cap:

```text
canonical source after Pass 01 <= 128,351
```

Absolute temporary ceiling during additive construction:

```text
canonical source during Pass 01 <= 128,651
```

The implemented candidate finishes at 128,351 physical lines (+1,200) and
120,123 nonblank lines (+1,123). Production remains 91,527 lines and styles
remain 17,615 lines; all nine added source files belong to proof/check
tooling. The checked-in enforcement ceiling is ratcheted to the exact 128,351
candidate, so the unused planning allowance cannot silently become future
headroom. This delta is prerequisite proof, not progress toward the
under-100,000 objective.

---

## 8. Rollback and change isolation

- Begin from the exact baseline SHA.
- Use checkpoint-sized diffs; do not create one monolithic refactor commit.
- Preserve the untracked Main Hall `output/` directory.
- Do not use destructive Git cleanup.
- Do not modify old migrations or production data.
- Revert proof-kernel changes by code commit if necessary; no database rollback
  is involved in this pass.
- Keep the old `npm run verify` semantics available until the new runner has
  proved parity.
- Do not remove focused npm commands.
- Publication is authorized for this execution, but do not merge/deploy past a
  failed or unverified remote gate. Verify exact deployed SHAs and retain
  N-1-compatible application behavior.

Suggested review checkpoints, not pre-authorized commits:

1. source metric and tests;
2. verification manifest/runner and parity;
3. CI workflow and release evidence;
4. browser canaries;
5. runtime-spine inventory and final reconciliation.

---

## 9. Mandatory pause conditions

Pause and report evidence if:

- the baseline SHA/tree/count is not what this plan records;
- the baseline full verification gate fails;
- a new or resumed task overlaps the same files;
- CI requires weakening authentication or exposing a secret;
- browser automation cannot authenticate without changing product security;
- source-report arithmetic cannot reconcile with Git-tracked files;
- a verification rewrite loses an assertion, fixture, or useful diagnostic;
- the pass would exceed the temporary source ceiling;
- product code must change to make the proof system pass;
- production write smoke or a destructive provider/data mutation becomes
  necessary without specific safety evidence;
- a candidate “cleanup” is actually a behavior or support-policy decision.

These are pause conditions, not invitations to lower the standard.

---

## 10. Ultra-effort operating discipline

When execution is authorized:

- reread the current tree and this plan rather than relying on stale counts;
- solve one slice completely before widening scope;
- use the extra reasoning budget on invariant extraction, negative cases,
  proof design, and diff reconciliation;
- do not spend it redesigning product behavior that is out of scope;
- keep a live before/after evidence ledger;
- run focused proof frequently and the full gate at every meaningful
  checkpoint;
- inspect every deletion by responsibility, not merely by import count;
- reserve the final portion of the run for independent diff review, full
  verification, LOC reconciliation, and an honest incomplete/verified/deployed
  status;
- do not assume parallel agents or tasks. Shared-tree parallelism is used only
  if the user explicitly requests it and the file ownership can be made
  disjoint.

Ultra effort changes the depth of analysis and proof. It does not broaden
authority, relax scope boundaries, or justify a giant unreviewable rewrite.

---

## 11. Pass 01 completion contract

Pass 01 is complete only when all statements below are true:

- the canonical source metric is checked in, tested, deterministic, and
  reproduces the exact baseline;
- all handwritten executable extensions are classified;
- the 56-command full gate has an authoritative observable runner;
- every existing focused command and assertion remains available;
- CI runs the canonical count, full verification, and dependency gate;
- the exact remote enforcement state is stated honestly;
- a minimal local browser canary layer is reproducible without production
  data or weakened security, or its authentication blocker is explicitly
  documented rather than faked;
- an exact-SHA evidence template has been exercised;
- all 85 Next route files and six local/data stores have a runtime-mode
  classification;
- no product feature, data, live-sync behavior, design, accessibility,
  privacy, security, or Assistant capability changed;
- the final source count is exactly 128,351, at the corrected 128,351
  proof-only planning cap, with the checked-in ceiling ratcheted to 128,351,
  every added line classified, and product source unchanged;
- the full local exit matrix passes;
- the diff contains no unrelated change and does not touch `output/`;
- implemented, verified, committed, pushed, deployed, and production-verified
  states are reported separately.

This pass does not satisfy the whole refactor program. It makes the subsequent
27,152-line zero-loss descent governable.

---

## 12. Execution result and honest boundary

### Implemented

- deterministic Git-backed source inventory, strict classification, exact
  baseline/delta reporting, and adversarial fixtures;
- typed 56-stage verification manifest and sequential fail-fast runner with
  bounded diagnostics, signal/timeout handling, and atomic evidence;
- retained legacy verifier and mechanically tested stage/order parity;
- immutable-action-pinned GitHub verification workflow with locked install,
  audit, proof, full verification, browser, SHA-integrity, clean-tree, and
  artifact gates;
- isolated Playwright canaries using a disposable sanitized checkout and
  existing non-production dev actor only;
- release-evidence template plus local dry-run record;
- read-only runtime inventory of 16/16 page routes, 85/85 Next route files
  with 116 methods, 110 Fastify paths with 141 registrations, the six
  preview stores, 64 migrations, 62 canonical tables, provider persistence,
  browser persistence, and cross-tab transports;
- Render Blueprint configured to defer auto-deploy until checks pass.

### Exact source result

The candidate contains 461 canonical files, 128,351 physical lines, and
120,123 nonblank lines. Relative to the immutable baseline, that is +9 files,
+1,200 physical, and +1,123 nonblank. Production remains exactly 91,527 lines
and styles remain exactly 17,615 lines; the entire delta is in proof/check
tooling. The product-source freeze is mechanically visible in the diff: no
file beneath `app/`, `apps/`, `components/`, `features/`, `lib/`, `packages/`,
or `styles/` changed.

The implementation finishes exactly at the corrected +1,200 planning cap. The
canonical `passMaximum` is ratcheted to 128,351, so no unused allowance is
available to later work.

### Verification state

- clean locked baseline install: passed with zero reported vulnerabilities;
- canonical baseline inventory: 452 files, 127,151 physical, 119,000 nonblank;
- source-inventory and runner negative/adversarial fixtures: passed;
- proof-kernel typecheck: passed;
- canonical verifier: 56 of 56 top-level stages passed;
- retained legacy verifier: passed, proving result parity;
- browser canaries: final exact-candidate run is recorded in
  `docs/refactor-evidence/pass-01/local-verification.md`;
- migration identity remains
  `0064_authored_artifact_design_assignments`, 64 of 64.

### Deliberately unclaimed

Repository source can prove a workflow is checked in and a Blueprint requests
`checksPass`; it cannot prove either provider has activated those controls.
Until exact provider responses exist, GitHub required-check enforcement,
Render Blueprint synchronization, Vercel gating, deployment, and production
health remain pending. The isolated browser suite also does not prove Clerk
tenant behavior, authenticated multi-session visibility, durable
Postgres/Redis/R2 replay, provider credentials, or production writes. No
production write smoke was run to manufacture those claims.

The unrelated untracked `output/` directory remained untouched and excluded.

## 13. Immediate successor

The expected next macro-pass is **Canonical Runtime Spine — compatibility,
local persistence, and route-authority consolidation**.

Its exact first slice will be selected from the generated classification, not
from the gross 8,413-line candidate total. It must preserve:

- production-direct and production fail-closed behavior;
- same-origin compatibility where still required;
- protected attachment delivery;
- local-preview persistence;
- identity, revision, idempotency, authorization, event, and error contracts.

Only after one route/store family has contract tests and a single surviving
authority will its old path be retired. This is where the first substantial
source reduction is expected to begin; no amount is promised before the
Pass 01 inventory establishes replacement cost and safe deletion boundaries.
