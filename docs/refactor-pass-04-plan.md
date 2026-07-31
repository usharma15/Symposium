# Major Refactor Pass 04 — Transitional Authority Retirement

## Document control

| Field | Value |
| --- | --- |
| Status | In progress; structural checkpoints continue while LOC governance is explicitly on standby |
| Prepared | July 30, 2026 |
| Repository | `/Users/udayansharma/Documents/Science Rebirth` |
| Exact baseline SHA | `5d89eadd83c1d3042b3eb320c0cb81ae9522d21d` |
| Baseline release state | Exact SHA on `origin/main`; Pass 03 release evidence green |
| Baseline source | 470 files / 126,543 physical / 118,498 nonblank |
| Baseline categories | 90,493 production / 16,283 styles / 19,767 checks and tools |
| Distance to 99,999 | 26,544 physical lines |
| Pass completion ceiling | **114,999 physical tracked source lines** |
| Required net reduction | **At least 11,544 physical tracked source lines** |
| Program completion ceiling | 99,999; preferred steady-state band 90,000–95,000 |
| Governing priority | Sublime, high-leverage engineering with zero product, data, synchronization, design, privacy, security, accessibility, or recoverability loss |
| Design boundary | Preserve the integrated Paper/Thought system and every approved visual; do not invent the future sitewide redesign |
| Assistant boundary | No Assistant capability, authority, context, tool, quota, or autonomous-behavior expansion |

This is the execution charter for the next pass. It deliberately sets a
material result threshold. Another few-hundred-line cleanup is useful work,
but it is not this pass.

> **Current execution addendum, July 31, 2026:** checkpoint 11 implements C6
> authentication and entrance lifecycle authority. One typed controller and
> pure reducer now own browser-session entry, Clerk account admission,
> abortable exact-user synchronization, read/live/social gates, local preview,
> sign-out, and entrance replay. Authenticated bootstrap caches and inquiry,
> profile, and analytics cross-tab transports are exact-viewer scoped; direct
> account replacement cannot present or hydrate the previous viewer, and a
> server-authenticated return cannot present the shell or subscribe to live
> delivery before exact client identity admission.
> `SymposiumV0.tsx` contains no authentication or entrance transition policy
> and is 2,279 lines. The exact candidate is 493 tracked source files / 130,206
> physical / 122,024 nonblank. Per explicit product direction, LOC reduction is
> on standby: these
> figures remain informational drift evidence, the original 114,999 completion
> contract is not met, and no repository reduction credit or Pass 04
> completion is claimed. Operational recovery evidence is the next
> infrastructure priority; ephemeral modal and cross-domain view composition
> remain legitimate shell responsibilities. Exact C6 evidence is in
> [`refactor-evidence/pass-04/checkpoint-11.md`](refactor-evidence/pass-04/checkpoint-11.md).

The threshold is an acceptance gate, not permission to game the count. If
11,544 safe deletions cannot be proved, the implementation must stop at a
green, reversible checkpoint and report that Pass 04 is incomplete. It must
not obtain the number through compressed formatting, weaker types, deleted
assertions, reduced browser coverage, generated-source hiding, product-scope
reduction, or a silent withdrawal of a supported runtime mode.

## 1. Objective

Pass 04 will retire transitional authorities that make the repository behave
like several generations of Symposium at once.

The intended result is not merely a smaller tree. The intended result is:

- one canonical live persistence and mutation architecture;
- one explicit local-preview architecture;
- one client state owner for each route, entity, optimistic mutation, and
  synchronization invariant;
- one compact proof architecture that retains every semantic assertion while
  eliminating repeated test infrastructure;
- one canonical source for repeated fixtures, projections, policies, and
  normalization rules;
- presentation source in which only rendered and approved selectors remain;
- fewer concepts to understand before safely changing the product;
- no change to what a user can do, what survives reload, what another session
  observes, or what an approved screen looks and feels like.

Pass 04 is therefore both a production-architecture pass and a proof-system
pass. A check suite that repeats thousands of lines of setup is part of the
codebase problem, but checks may become smaller only by becoming more
systematic and powerful.

## 2. Baseline facts

### 2.1 Current source distribution

| Area | Physical lines | Planning implication |
| --- | ---: | --- |
| Production | 90,493 | Runtime consolidation must contribute materially |
| Styles | 16,283 | Only proven dead or superseded rules may be retired |
| Checks and tools | 19,767 | Shared harnesses may replace repeated machinery; semantic coverage may not fall |
| `components/SymposiumV0.tsx` | 5,032 | Responsibility concentration is real, but file splitting alone earns no LOC credit |
| `lib/dataStore.ts` | 2,125 | Contains local JSON behavior and a separate legacy five-table PostgreSQL authority |
| Backend repositories | approximately 19,900 | Repeated mapping and lifecycle tails remain, but policy must stay explicit |
| `features/assistant` | 5,508 | Infrastructure may be clarified; capability work remains paused |
| `features/attachments` | 4,385 | Viewer and lifecycle behavior is broad and load-bearing |
| `features/messages` | 3,402 | State, live projection, drafts, retry, and responsive presentation are concentrated |
| Stylesheet layer | 16,256 under `styles/` | The future redesign should replace old families rather than layer on top |

### 2.2 What Pass 03 proved

Pass 03 established shared ordinary transaction execution, Workspace policy,
inquiry projections, and local profile-search semantics. It removed 235
physical lines in that release slice and left the repository at 126,543.

That work is valid infrastructure, but its result proves that low-level
backend tail consolidation alone cannot bridge the 26,544-line program gap.
Pass 04 must address whole transitional implementations and repeated
engineering systems.

### 2.3 Protected mechanisms

The following remain load-bearing unless this pass proves an exact replacement:

- Postgres as the live source of truth;
- the Fastify/Render API, Clerk identity, transactional receipts, audit rows,
  durable events, and cursor-replayable SSE;
- local JSON preview, including existing file compatibility, serialized
  mutation order, process-restart persistence, attachment cleanup, Workspace
  publication, and community behavior;
- direct browser transport plus the named Next compatibility and protected
  delivery boundaries;
- expected revisions, retry rules, conflict behavior, optimistic guards,
  cross-tab reconciliation, and viewer-private projections;
- R2 staging, confirmation, promotion, access control, replacement, and
  durable deletion;
- Paper titles, titleless Thoughts, persisted design identities, theme
  derivation, attachment/citation/quote/editor behavior, and frozen artwork;
- Assistant privacy, evidence, quota, receipt, confirmation, and limited
  private-draft authority;
- all currently named verification stages and every semantic case they assert.

## 3. Completion contract

Pass 04 is complete only when all of the following are true:

1. Tracked source is at most 114,999 physical lines under
   `scripts/sourceInventory.ts`.
2. Every deletion has a replacement authority or a proved-dead ledger entry.
3. Production, local preview, live synchronization, cross-tab behavior,
   persistence, and approved design remain equivalent or deliberately improve
   without narrowing capability.
4. The complete verification manifest, proof kernel, browser canaries, clean
   exact-SHA CI, deployments, readiness, and production smoke are green.
5. No assertion category, browser scenario, type boundary, migration, route,
   or supported runtime mode was removed to buy the count.
6. The final evidence states exact limitations; it does not claim that every
   theoretically possible state was tested.

The pass may land through multiple individually green commits. It may be
released to `main` only after the aggregate threshold and all release gates
pass.

## 4. Reduction ledger rules

No candidate saving is pre-credited. During execution, every slice must record:

| Field | Required evidence |
| --- | --- |
| Old authority | Exact files, exports, callers, runtime modes, and persistence/sync effects |
| Replacement authority | Exact owner and why it expresses the same or stronger invariant |
| Characterization | Tests or traces that fail when the old behavior changes |
| Cutover | Callers moved and old path unreachable |
| Retirement | Deleted files/branches/selectors and exact physical/nonblank delta |
| Coverage parity | Semantic case IDs before and after; no disappeared assertion |
| Runtime parity | Local/live, reload, reconnect, cross-tab, conflict, and failure evidence as applicable |
| Design parity | Rendered viewport/theme/state comparison when presentation changes |
| Rollback | Commit boundary and data compatibility of the previous release |

The ledger has four confidence states:

- **confirmed** — replacement and deletion are implemented and proved;
- **characterized** — behavior is locked, but replacement is not complete;
- **conditional** — retirement depends on a support or design decision;
- **rejected** — the candidate is not duplication or cannot be safely removed.

Only confirmed retirement counts toward the 11,544-line gate.

## 5. Execution sequence

### Gate 0 — Reproduce the release baseline

Before runtime edits:

1. Confirm `HEAD`, `origin/main`, GitHub, Render, and Vercel identity.
2. Reproduce 126,543 physical / 118,498 nonblank and the category totals.
3. Confirm no pending migrations and strict database readiness.
4. Run the full 56-stage verification manifest.
5. Run the proof kernel and five isolated browser canaries.
6. Preserve the user-owned untracked `output/` directory and
   `scripts/browserCanaryServer 2.ts` without staging, editing, or deleting
   either path.
7. Record the exact baseline assertion-case inventory, route/method inventory,
   CSS manifest, and runtime-mode matrix.

Stop if the baseline does not reproduce.

### Slice A — Canonical runtime-mode boundary

#### Problem

`lib/dataStore.ts` combines two different compatibility architectures:

- the supported local JSON preview used for credential-free design and
  product work; and
- a legacy five-table direct PostgreSQL implementation selected when a
  database URL exists without `SYMPOSIUM_API_URL`.

The live product already uses the Fastify/Postgres authority. The legacy
direct database implementation duplicates schema creation, seed loading,
reads, mutations, content views, and action-ledger behavior outside the
canonical migration, receipt, audit, event, and authorization architecture.

#### Default decision

Local JSON preview is preserved exactly.

The database-backed development mode is also presumed supported for zero-loss
purposes. The default implementation strategy is therefore to preserve its
observable workflow through the canonical API/repository contract and retire
the separate five-table implementation—not silently withdraw it.

If exact characterization proves that this mode has no supported or reachable
consumer and the documentation is historical rather than contractual, its
withdrawal still requires an explicit recorded product decision. The pass
must not manufacture that decision from the LOC target.

#### Work

1. Move browser-consumed action and input types out of the persistence module.
2. Give local JSON inquiry behavior a named local-preview store.
3. Route database-backed development through the canonical backend authority
   or a narrow adapter over the same repositories and contracts.
4. Delete the legacy schema initializer, seed/read implementation, SQL
   mutation branches, and environment-selected dual authority only after the
   preserved mode passes equivalence.
5. Make production fail closed when the canonical API is absent; never fall
   into local JSON or the retired schema.

#### Required proof

- existing local JSON files load without mutation loss;
- fresh seed and historical-world migration;
- restart persistence;
- Paper and titleless Thought create/edit/delete/read;
- nested comment and reply behavior;
- qualified-view dedupe and action ledger;
- attachments, quotes, communities, profiles, search, and Workspace
  publication;
- database-backed development equivalence if retained;
- production cannot access `.data` or a legacy schema;
- canonical live mutations still issue receipts, audits, events, revisions,
  and attachment transitions.

### Slice B — Proof architecture compression

#### Problem

The checks/tools category is 19,767 lines. Much of it is legitimate behavioral
coverage, but the suite repeats:

- source loading and regex-policy scaffolding;
- ad hoc PostgreSQL client doubles and SQL dispatch;
- Assistant action receipt/audit/event fixtures;
- temporary directory, environment, and process cleanup;
- success/failure reporting;
- schema-valid/schema-invalid tables;
- route and file ownership assertions;
- similar live-event, request, and persistence fixtures.

#### Work

1. Create one typed check harness with named cases and deterministic failure
   reporting.
2. Create reusable recording database doubles with strict unexpected-query
   failure, transaction traces, and typed response dispatch.
3. Replace repeated Assistant receipt/audit/event fixtures with canonical
   builders.
4. Convert repeated source-policy assertions into declarative rule tables that
   preserve the exact file, pattern, polarity, and failure message.
5. Replace repeated valid/invalid schema examples with named case matrices.
6. Keep integration checks separate where their process, storage, timing, or
   provider behavior is genuinely distinct.
7. Add harness self-tests proving that each rule kind and database-double
   failure mode is observable.

#### Coverage parity gate

Before editing, assign stable semantic case IDs to the existing suite. After
consolidation:

- every prior case ID must still execute;
- expected assertion count may rise but may not fall without a duplicate-case
  proof in the ledger;
- deliberately broken fixtures must fail at the intended case;
- verification-stage names and exit behavior remain stable;
- browser, build, typecheck, inventory, and exact-SHA evidence remain outside
  any fake “unit-test compression.”

This slice counts only structural removal. Reformatting large fixtures onto
fewer lines is forbidden.

### Slice C — Client route, entity, and synchronization ownership

#### Problem

`SymposiumExperience` still owns route selection, overlay state, selected
entities, feed pages, profile activity, optimistic mutations, live-event
merging, cross-tab publication, caches, and navigation restoration in one
4,467-line function. Many lower-level primitives already exist, but the shell
still retains adjacent policy and mirrored state.

#### Work

1. Establish one canonical view-state machine for route, overlay, selected
   entity, origin snapshot, Back behavior, and scroll restoration.
2. Make the URL projection derive from that state rather than mirror it across
   independent booleans and IDs.
3. Establish one inquiry projection controller for bounded reads, optimistic
   writes, live events, cross-tab events, and revision guards.
4. Establish one profile/social activity controller for cache hydration,
   canonical activity, following, and live invalidation.
5. Delete shell-owned implementations after consumers use those owners.
6. Keep feature policy in feature controllers and keep the shell limited to
   composition and explicit cross-feature coordination.

#### Non-goals

- splitting the component without deleting responsibility;
- introducing a global generic store;
- changing navigation, Back, overlay, scroll, focus, or responsive behavior;
- changing feed/search ranking;
- redesigning any surface;
- expanding Assistant behavior.

#### Required proof

- every canonical route and browser Back/Forward transition;
- detail/profile/community/messages/Workspace/Assistant overlays;
- selected post/comment/application/conversation identity;
- exact scroll and comment-segment restoration;
- optimistic success, failure, stale response, retry, and live-event races;
- cross-tab create/edit/delete/action/follow behavior;
- cache hydration never outranks canonical data;
- entry and sign-in identity precedence;
- no additional render, request, or provider loop.

### Slice D — Canonical fixtures, projections, and policy tables

#### Problem

Historical-world and seed data are represented across browser fixtures,
backend fixtures, migration/seed mapping, normalization, and tests. Contract
and repository files also repeat field projections and policy tables.

#### Work

1. Identify semantically identical fixture facts and define one canonical
   source that is safe for both server and browser consumption.
2. Generate runtime projections in memory through typed builders; generated
   tracked source is not permitted as a way to hide LOC.
3. Share field projections and row mappers only where visibility and
   viewer-private semantics are identical.
4. Consolidate policy constants for titles, design identity, action metrics,
   Workspace roles, attachment classes, and supported Assistant boundaries
   without building a generic policy engine.
5. Retire duplicated literal representations and normalization branches after
   snapshot and migration equivalence.

#### Required proof

- exact historical identities, timestamps, room/community membership, content,
  comments, metrics, design assignments, and activity;
- existing local data migration and live seed idempotence;
- browser bundle does not absorb server-only code or secrets;
- private fields remain excluded from public projections;
- titleless Thoughts and authored-artifact identity remain exact.

### Slice E — Proven presentation retirement

#### Problem

The stylesheet system is 16,283 lines. The future sitewide design has not yet
been authorized for production, so this pass cannot replace current visuals.
It may, however, retire rules that are provably unreachable, duplicated, or
superseded by the already integrated presentation.

#### Work

1. Build a selector-to-rendered-class ledger from source, static classes,
   dynamic class families, portals, responsive states, and browser canaries.
2. Classify selectors as rendered, dynamic, compatibility, frozen-design, or
   dead.
3. Consolidate genuinely identical declarations only where ownership and
   cascade order are equivalent.
4. Delete only selectors proved unreachable or superseded.
5. Do not touch frozen authored-artifact geometry, assets, identities, Day/
   Night behavior, or future Design Lab material.

#### Required proof

- desktop, tablet, and mobile viewport matrix;
- Day and Night;
- entrance, Main Hall, every room, feed, detail, profile, community,
  Workspace, messages, notifications, attachments, editor, Scribble,
  Assistant, analytics, opportunities, and patronage;
- overlays, focus, hover, touch, empty, loading, error, conflict, and disabled
  states represented by the affected selectors;
- no computed-style or geometry delta for an unchanged approved state;
- no horizontal overflow, focus loss, or reduced-motion regression.

If browser evidence cannot prove a selector dead, it stays.

### Slice F — Remaining backend authority compression

This slice is last because Pass 03 already demonstrated that low-level
repository consolidation has lower LOC leverage.

Potential work is limited to confirmed duplication discovered by the earlier
slices:

- repeated receipt/audit/event completion shapes;
- identical actor/profile/attachment/public projection mapping;
- repeated bounded pagination and cursor validation;
- repeated notification invalidation and audience construction;
- repeated repository test doubles replaced by Slice B;
- imports and compatibility branches made dead by Slice A.

Domain authorization, lock ordering, storage compensation, notification
policy, migration transactions, maintenance leases, and repeatable-read
bootstrap remain explicit unless exact equivalence is proved.

## 6. Checkpoint and rollback strategy

Each slice uses this commit shape:

1. characterization and case ledger;
2. additive replacement;
3. cutover;
4. old-path retirement;
5. focused and full verification;
6. exact LOC reconciliation.

Characterization may temporarily add source. A slice is not closed until its
temporary code and old implementation are retired and its net result is
recorded.

Every slice must be independently revertible without reversing a migration or
discarding writes created after deployment. Pass 04 should avoid schema
changes. If a schema change becomes necessary, use expand/contract and retain
read compatibility through the rollback window.

No intermediate candidate is pushed to `main` merely because its focused
checks pass. The aggregate candidate is released only after the Pass 04
threshold and the complete release gate are green.

## 7. LOC ratchet

| Checkpoint | Maximum tracked source | Meaning |
| --- | ---: | --- |
| Baseline | 126,543 | Exact released starting point |
| Mid-pass review | 120,999 | At least 5,544 confirmed lines retired before expanding risk |
| Pass 04 release | 114,999 | At least 11,544 confirmed lines retired |
| Program exit | 99,999 | Absolute completion ceiling |
| Preferred final band | 90,000–95,000 | Headroom for design, AI, feed/search, and settings |

The mid-pass review is a stop/go gate. If the safest completed slices cannot
reach 120,999, do not open broader presentation or runtime work merely to chase
the number. Reconcile the opportunity ledger and report the limitation.

At release, lower `sourcePolicy.passMaximum` to the exact released total so
later work cannot silently regain the removed lines.

## 8. Verification matrix

### Every slice

- focused typecheck and domain checks;
- exact semantic-case inventory;
- source inventory before/after;
- `git diff --check`;
- no unrelated worktree changes;
- targeted local persistence and failure tests;
- targeted browser states for any client or style change.

### Aggregate local candidate

- `npm run verify` with every manifest stage green;
- `npm run proof:check`;
- `npm run loc:baseline`;
- `npm run loc:check` against the lowered ceiling;
- eight isolated browser canaries with no skip, retry, flake, console error,
  page error, request error, hydration error, or unexpected result;
- additional authenticated/two-session scenarios for every changed live-sync
  domain;
- local-preview restart and pre-pass-data compatibility;
- database-backed development-mode proof if that mode is retained through an
  adapter;
- dependency audit and optimized production build;
- clean-checkout rerun on the exact candidate SHA.

### Release

- intentional commit with only Pass 04 files;
- push exact candidate to `main`;
- exact-SHA GitHub required check success and retained evidence artifact;
- exact-SHA Render and Vercel deployments;
- strict `/readyz?probe=database`, no pending migrations, and expected release
  identity;
- read-only production route/API/browser smoke;
- controlled write smoke only in an environment where creation and cleanup are
  authorized;
- rollback and data-compatibility confirmation.

## 9. Mandatory pause conditions

Stop the affected slice when:

- a runtime mode cannot be classified;
- a deleted path owns persistence, authorization, live events, cleanup,
  accessibility, or design behavior not present in the replacement;
- semantic case IDs or browser coverage fall;
- the only apparent saving is formatting or fixture compression;
- a shared abstraction hides domain policy or permits invalid states;
- local preview, database-backed development, or production authority becomes
  ambiguous;
- a visual delta cannot be proved intentional;
- an Assistant change would expand product capability or authority;
- migration or rollback safety becomes uncertain;
- unrelated user work overlaps the target files;
- the exact release baseline is no longer reproducible.

Stopping one unsafe tactic does not cancel the threshold. It means that tactic
is rejected and a deeper zero-loss simplification must be found.

## 10. Explicit non-goals

Pass 04 does not:

- implement future Design Lab work;
- redesign the Main Hall or any sitewide surface;
- expand AI Tablet or Assistant capabilities;
- optimize feed/search ranking;
- add settings features;
- change providers;
- rewrite the product;
- delete local preview;
- delete checks or assertions;
- split large files and claim success;
- promise that under 100,000 is already proved.

It prepares the architecture for those later product stages by reducing the
number of authorities they would otherwise need to integrate with.

## 11. Expected handoff

The final Pass 04 evidence must answer, with exact paths and numbers:

1. What entire implementations ceased to exist?
2. Which authority now owns each preserved invariant?
3. How many physical/nonblank lines were removed from production, styles, and
   checks/tools?
4. Which semantic cases and browser states prove zero loss?
5. What became faster, smoother, safer, or easier to change?
6. Which candidates were rejected and why?
7. Is the repository at or below 114,999?
8. What remains between the released result and 99,999?
9. Which remaining reductions depend on the future approved design migration?
10. Which boundaries are ready for later AI, feed/search, and settings work
    without authorizing those features now?

The pass is successful only if the answers describe a materially smaller,
clearer, more powerful system and the exact released source count satisfies
the ratchet.
