# Historical Symposium Zero-Loss Sublime Engineering Refactor Program

> **Reconciled July 31, 2026.** Pass 04 and its LOC gates are retired. This
> document is retained as historical design and verification evidence, not as
> the current execution or completion contract. Its zero-loss, structural,
> proof, retirement, and rollback requirements are incorporated selectively by
> the Passes 1-10 ledger in `docs/infrastructure-revamp.md`; that current ledger
> is authoritative when this historical document conflicts with it.
>
> **Current repository policy (August 1, 2026):** work on `main`, verify
> locally, commit, and push directly to `origin/main`. Historical topic-branch,
> pull-request, GitHub Actions, and branch-protection instructions below are
> superseded and must not be reused without explicit user authorization.

## Document control

| Field | Value |
| --- | --- |
| Status | Historical and reconciled; LOC gates are retired, while current structural requirements are dispositioned in `docs/infrastructure-revamp.md` |
| Prepared | July 29, 2026 |
| Execution gate | **Satisfied July 29, 2026.** “Local design lab integration” completed at the exact baseline below and the user explicitly authorized the first Ultra pass |
| Repository | `/Users/udayansharma/Documents/Science Rebirth` |
| Exact post-integration baseline | `8e900d0fa675b311a67029b8d2f109b4da97301e`; migration `0064_authored_artifact_design_assignments`; 127,151 canonical tracked source lines / 119,000 nonblank |
| Pass 01 local candidate | 128,351 canonical physical / 120,123 nonblank lines across 461 files; +1,200 physical, entirely in proof/check tooling; no product or style source changed |
| Latest current-main baseline | `2b28a88d9adc83750d6f553a58c82e537566f2f5`; 475 files / 127,637 canonical physical / 119,540 nonblank lines |
| Current local candidate | 475 files / 127,768 canonical physical / 119,670 nonblank lines; +131 physical / +130 nonblank versus current main, entirely in checks/tools |
| Cumulative candidate result | +617 physical / +670 nonblank versus the exact post-integration baseline; production 90,034, styles 16,200, checks/tools 21,534 |
| Remaining completion distance | 27,769 physical lines; 21.7% of the complete counted repository, or about 26.1% of production plus styles if proof code remains flat |
| Sub-100k feasibility status | **Possible but unproven.** The threshold remains the program test, but no future saving is pre-credited and the code may not be contorted, weakened, or stripped to satisfy it |
| Governing priority | Build a beautiful, sublime, ultra-capable, ultra-lean engineering system while permitting zero loss of site usage, functionality, persistence, live synchronization, design, privacy, security, accessibility, or recoverability |
| Meaning of the LOC target | A forcing function and absolute falsifiable test of whether conceptual and implementation waste was actually removed—not the highest-order objective and never a substitute for engineering quality |
| Required product outcome | The complete site continues to operate perfectly at every known microfeature boundary and becomes measurably faster, smoother, safer, easier to change, or more efficient wherever the refactor creates a legitimate opportunity |
| Size policy | **Hard exit gate: fewer than 100,000 tracked source lines. The program cannot be called successful, complete, or “close enough” at 100,000 or above.** Aim for 90,000–95,000 as operating headroom without gaming the count or losing anything |
| Joint completion tests | Perfect zero-loss operation **and** fewer than 100,000 tracked source lines. Neither test can compensate for failure of the other |
| Refactor form | Bounded, measured consolidation and operational hardening; **not** a greenfield rewrite or platform replacement |

This is the execution contract for the coming refactor program. It supplements
`docs/architecture.md`, `docs/backend.md`, and
`docs/authored-artifact-integration.md`; it does not replace their domain
contracts.

> **The line count is not the point.** The point is to produce an exceptionally
> beautiful and powerful codebase: a small number of coherent systems, sublime
> logic, explicit invariants, extraordinary modifiability, efficient runtime
> behavior, and enough architectural leverage to build ambitious future design
> and AI capabilities without returning to sprawl. LOC reduction is the
> pressure that forces us to remove accidental complexity and duplicate
> machinery. It is successful only when the resulting product and engineering
> system are materially better. Fewer than 100,000 tracked source lines is the
> absolute empirical test that this higher-order ambition actually manifested
> in a lean implementation.

The document deliberately distinguishes four kinds of statement:

- **Current fact** — verified in the repository snapshot identified above.
- **Product intent** — a decision from the user’s discussions that the
  refactor must respect.
- **Candidate** — an area worth auditing, not pre-approved deletion and not a
  promised saving.
- **Required proof** — evidence that must exist before a slice is considered
  complete.

Time-sensitive deployment and provider state must still be verified at the
moment it is used. The source identity, migration identity, and line-count
arithmetic in this revision distinguish the historical post-integration
baseline from the exact current-main baseline.

---

## 1. Executive decision

Symposium is due for a major **consolidation and hardening program**, but the
evidence does not justify a rescue rewrite, provider migration, or replacement
of the platform kernel.

This program is not fundamentally a deletion exercise. It is a deliberate act
of software design. Its north star is a codebase that is beautiful to read,
powerful to extend, difficult to misuse, economical to run, and calm to modify.
The desired result is not “the same site in fewer lines.” It is a stronger site
and a stronger engineering medium:

- fewer concepts, each carrying more legitimate capability;
- one exact authority for every invariant;
- small, composable primitives instead of repeated feature-specific machinery;
- direct dependency flow and explicit state transitions;
- durable contracts that let future design and AI work attach cleanly;
- changes that remain local instead of rippling unpredictably across the site;
- faster and smoother user paths where the old overlap imposed real cost;
- lower query, provider, bundle, synchronization, and maintenance waste;
- code whose shape makes correctness easier to see and preserve.

The current system already has valuable, load-bearing behavior:

- Clerk-derived identity and server-side authorization;
- a Next/Vercel frontend and a Fastify/Render API;
- Neon/Postgres as the durable source of truth;
- transactional domain mutations with idempotency receipts, audit records,
  and durable live events;
- cursor-replayable live synchronization and cross-tab reconciliation;
- R2 attachment staging, promotion, access control, and durable deletion;
- revisioned Workspace documents, discussions, grants, and publication;
- persistent messages, notifications, communities, search, analytics,
  opportunities, proposals, and Assistant data;
- local-preview behavior that lets interface work continue without production
  credentials;
- a broad repository verification suite and production build gate.

Those are assets to consolidate around, not liabilities to casually rebuild.
The oversized and transitional parts are primarily responsibility overlap,
compatibility/fallback duplication, large orchestration surfaces, repeated
test/check scaffolding, accumulated CSS, historical fixtures, and domain code
that grew feature by feature. The correct response is to identify one
authoritative path for each behavior and retire only the superseded path after
equivalence has been proved.

The order of priorities is:

1. Preserve every user-visible, data-visible, operational, and design
   guarantee down to the smallest known microfeature.
2. Replace accidental complexity with beautiful, coherent, high-leverage
   systems that make the product dramatically easier to build and modify.
3. Improve real user and operator experience wherever evidence permits:
   speed, smoothness, responsiveness, reliability, recovery, and cost.
4. Establish reproducible release, restore, migration, and observability
   evidence.
5. Reduce responsibility overlap and failure radius.
6. Retire genuine duplication and legacy paths.
7. Reach and then protect the source-line ceiling.

If a safe pass cannot produce the hoped-for line reduction, the pass must stop
or remain size-neutral. It must never obtain a favorable count by removing
coverage, weakening types, compressing formatting, hiding code behind
indirection, or narrowing the product.

That permission applies only to an individual tactic or prerequisite pass. It
is not an escape hatch for the overall program. A locally unsafe deletion is
abandoned; the architectural investigation continues until a deeper,
zero-loss simplification is found. The program cannot close at or above
100,000 tracked source lines. If it does, the refactor has failed its absolute
efficiency test just as surely as an “efficiency” program whose final codebase
grew.

### 1.1 The sublime-engineering standard

“Beautiful” and “sublime” are technical requirements here, not compliments
applied after the fact.

| Dimension | Required result | Rejected substitute |
| --- | --- | --- |
| Conceptual beauty | The minimum coherent set of concepts explains the system | Clever compression, abstraction for its own sake, or renamed duplication |
| Correctness | Invariants are explicit, typed, authorized, transactional, and testable | Correctness that depends on call order, UI convention, timing, or tribal memory |
| Power | A small primitive safely supports many real product uses | A generic framework that obscures policy or permits invalid states |
| Leanness | Duplicate state, logic, adapters, selectors, and fixtures are retired | Minification, weaker types, moved code, deleted checks, or hidden complexity |
| Modifiability | A feature or design change touches the fewest legitimate owners and has predictable effects | Global edits, shotgun conditionals, parallel stores, or shell-owned feature policy |
| Composability | New capabilities combine stable contracts rather than clone whole flows | Feature-specific versions of persistence, sync, editor, action, or permission logic |
| Runtime efficiency | Browser, API, database, storage, live-sync, and provider work are bounded and purposeful | Fewer source lines that create more network, render, query, memory, or provider work |
| Operational elegance | Deploy, migrate, observe, recover, and roll back through explicit repeatable mechanisms | Heroic manual procedures or recovery assumptions |
| Product quality | Every current behavior remains exact and the experience becomes faster, smoother, clearer, or more reliable where possible | Merely surviving the refactor with the same visible happy path |
| Design integrity | Approved geometry, assets, semantics, responsiveness, and interaction quality remain exact or improve through approval | “Close enough” visual reconstruction or accidental DOM/CSS drift |

A solution that is shorter but harder to understand, extend, verify, operate,
or use is a failed solution. A solution that is beautifully factored but loses
one obscure persistence, synchronization, accessibility, or design behavior is
also a failed solution.

### 1.2 The change-power standard

The finished codebase should make ambitious modification routine:

- a new content capability should enter through the shared document,
  authorization, mutation, persistence, event, and rendering contracts;
- a new visual system should replace presentation without reopening domain
  state or live synchronization;
- a new Assistant capability should enter through one capability registry,
  context/evidence pipeline, confirmation boundary, receipt, and audit/event
  path;
- a new live domain should reuse one durable-event/revision/reconciliation
  model;
- a new provider should sit behind one narrow adapter;
- a change to one feature should not require edits to unrelated features,
  parallel local/live stores, several bridge routes, and the application shell.

“Build and modify anything” therefore means the architecture has enormous
composable leverage while remaining explicit about safety and domain policy.
It does not mean one magical abstraction that accepts anything and guarantees
nothing.

---

## 2. The user intent this program implements

### 2.1 The discussion, in sequence

The planning conversation established the following:

1. The first question was whether the product was due for a major
   infrastructure revamp.
2. A moderate, unpublished design revamp was already happening locally and
   expanded from Papers to Thoughts.
3. The repository had grown to roughly 120,000 lines even though the original
   aspiration was an unusually lean 10,000–20,000-line product; 60,000 then
   became an attractive reduction target.
4. The user made the controlling requirement explicit: **“absolutely ZERO
   loss in site usage, functionality, live sync, or persistence of absolutely
   anything at all”** during revamps and efficient rewrites.
5. The user reasonably observed that a version designed coherently from
   scratch might have stayed under 50,000 lines.
6. For the existing product, the durable objective became: **always be under
   100,000 lines**.
7. The user chose to finish and integrate the design work before beginning
   consolidation.
8. The user also identified major future AI Tablet/Assistant capability and
   later sitewide design work and asked whether those could be integrated into
   the refactor rather than disrupted by it.
9. The “Revamp main hall design” task established that the future visual work
   is not a one-off background replacement. It is a progressively authored
   visual world and, later, a complete sitewide design system.
10. The present instruction is to prepare the refactor program while the
    “Local design lab integration” task finishes.

### 2.2 Binding interpretation

“Zero loss” means more than retaining visible buttons. It includes:

- no missing, weakened, corrupted, or subtly altered microfeature;
- the same actions being available to the same people;
- the same canonical records, identifiers, relationships, revisions,
  attachments, discussions, drafts, permissions, and history surviving;
- the same retry, conflict, optimistic-update, reload, reconnect, cross-tab,
  cross-session, and degraded-provider behavior;
- the same concealment of private or inaccessible resources;
- the same semantic, keyboard, responsive, and assistive-technology access;
- no material regression in entry, navigation, editing, scrolling, attachment
  viewing, mutation latency, live convergence, or shipped bundle behavior;
- no silent expansion of AI authority or source access;
- no disappearance of local-preview behavior that is still deliberately
  supported;
- a rollback path that does not require sacrificing writes made after a
  release.

For this program, a **microfeature** is any observable or relied-upon behavior,
including small details that are easy to miss: a visibility rule, keyboard
state, focus return, metric update, draft restoration, cursor position, route
fallback, responsive breakpoint, title omission, theme layer, attachment
cleanup, retry receipt, revision conflict, notification resolution, SSE replay,
local-preview behavior, or one field omitted from a private/public projection.
If it exists before a slice, it is presumed part of the contract until it is
inventoried and either proved equivalent or explicitly approved for
improvement.

“Under 100,000” is an absolute engineering exit test, not permission to reduce
the product. Zero loss and fewer than 100,000 tracked source lines are jointly
mandatory; neither can be traded for the other. The refactor should create
5,000–10,000 lines of headroom below the ceiling so future work does not
immediately cross it again. The 90,000–95,000 operating band is the preferred
target, while 99,999 is the hard maximum for completion.

“Major refactor” does **not** mean:

- rewriting the product all at once;
- switching providers merely to make the architecture look newer;
- redesigning a surface during a behavior-only slice;
- launching new AI authority while changing the Assistant substrate;
- replacing persisted data models without expand/contract compatibility;
- deleting local or compatibility paths before their remaining uses are
  measured;
- splitting large files and calling the result a line-count reduction;
- treating a successful local build as proof of persistence or live sync.

### 2.3 The under-50,000 observation

A smaller greenfield Symposium was theoretically possible if its eventual
domain model, design system, live architecture, permissions, editor,
attachments, and Assistant boundaries had all been known at the beginning.
That is a useful lesson for the consolidation: design one shared primitive,
one mutation path, and one state owner before adding more variants.

It is not evidence that the existing full product can safely be forced below
50,000 lines. The current repository includes mature behavior, migration
history, local-preview support, privacy boundaries, revision/conflict logic,
provider integration, and a substantial verification corpus. Removing roughly
60% of the present tracked source would almost certainly require deleting
scope, coverage, or compatibility unless a later audit proves otherwise.
Therefore 50,000 and 60,000 are not program commitments.

### 2.4 LOC reduction is the instrument, not the destination

The source-line ceiling exists because unbounded growth is evidence that the
system is failing to reuse its own ideas. It forces each pass to ask:

- Why are there multiple ways to represent or mutate this state?
- Why does this feature need a private version of a shared capability?
- Why does a visual change reach persistence or synchronization code?
- Why does a new action require another dispatch, receipt, audit, and event
  system?
- Why does one conceptual change require edits across many unrelated files?

The desired answer is not “because the code is compressed now.” It is that one
beautiful, exact system replaced several weaker ones and made the next ten
changes easier than the last ten.

### 2.5 The hierarchy of aims

This program is governed from the highest aim downward:

1. **Highest-order aim — truth, beauty, and power:** perfect product behavior;
   sublime logic; coherent infrastructure; exceptional composability and
   modifiability; an excellent, fast, smooth user experience.
2. **Structural manifestations:** one authority per invariant; minimal
   concepts; explicit contracts; strong types; reusable domain primitives;
   bounded provider, database, rendering, and synchronization work.
3. **Lower-order manifestations:** fewer duplicated paths, fewer coordinated
   edits, less operational waste, a smaller change surface, and a leaner LOC
   count.

The program deliberately aims at the highest order. The lower-order outcomes
should manifest naturally because beautiful, powerful systems do not need five
competing implementations of the same idea. We do not sacrifice the higher
aims to force the lower ones. If a smaller count is obtained while truth,
clarity, capability, modifiability, performance, design, or perfect operation
declines, the hierarchy has been inverted and the refactor has failed.

Conversely, persistent duplication or unnecessary bulk is evidence that the
higher-order design has not yet fully manifested in the implementation. LOC is
therefore a useful diagnostic and discipline, but never the object of worship.
“Lower-order” does not mean optional: the under-100,000 result is the hard,
observable test that the higher-order work reached the implementation rather
than remaining beautiful architectural language.

---

## 3. Context and source-of-truth hierarchy

When facts conflict, use this order:

1. The final committed state produced by “Local design lab integration”.
2. The exact source and migrations at that commit.
3. Fresh local verification and browser evidence at that commit.
4. The exact production release SHA, readiness response, and production
   browser evidence for that release.
5. Current architecture and integration documents.
6. Older task summaries and discussion-derived plans.

Older evidence is context, not a current production claim. In particular, a
previously verified SHA, migration count, line count, or readiness result must
not be copied into a new release report without remeasurement.

### 3.1 Discussions incorporated

This program incorporates the intent of:

- the present infrastructure/LOC/zero-loss conversation;
- **“Local design lab integration”**;
- **“Revamp main hall design”**;
- the isolated Paper/Thought design handoff and its production integration;
- the candid AI Tablet capability audit and explicit pause;
- the repository’s architecture and backend contracts.

### 3.2 Documents that remain authoritative

- `docs/architecture.md` — dependency direction and domain ownership.
- `docs/backend.md` — provider topology, live API, integrity, readiness, and
  deployment boundaries.
- `docs/authored-artifact-integration.md` — Paper/Thought authored-artifact
  behavior and design-assignment contract.
- `docs/authored-artifact-provenance.md` — technical asset lineage and the
  external-rights boundary.
- `docs/ai-tablet-roadmap.md` — implemented Assistant stages, action-risk
  model, and acceptance gates.

This program may later be updated with links to Gate 0 evidence, but it should
not absorb frequently changing production values into architectural prose.

### 3.3 Design-integration state at preparation time

The core authored Paper/Thought port had already reached `main` before this
program was drafted. The relevant sequence includes:

- `cb387e3` — initial authored Paper/Thought integration;
- `3ffd79c` — restored established post geometry and corrected Thought fills;
- `01a23e5` — shared metric-bar sizing;
- `6f05860` — post layering and material corrections;
- `eb32d07` — closure of the authored-artifact integration;
- `200d4b6` — preservation of mobile navigation controls.

Migration `0064_authored_artifact_design_assignments` and the production
release evidence for that core port are documented in
`docs/authored-artifact-integration.md`.

The completed “Local design lab integration” task added and verified the final
content/Workspace/editor refinements through
`8e900d0fa675b311a67029b8d2f109b4da97301e`. Its full `npm run verify` passed
at that exact source state, and production readiness reported all 64 migrations
applied with no pending migration. The isolated Design Lab remains
non-production authority by default: future files are copied into this
repository only through another explicit integration decision.

---

## 4. Exact post-integration repository baseline

### 4.1 Git state

At the July 29 post-integration measurement:

- `HEAD` and `origin/main` are both
  `8e900d0fa675b311a67029b8d2f109b4da97301e`.
- No tracked product file is modified.
- `docs/major-refactor-program.md` is the untracked planning artifact for this
  program.
- The untracked `output/` directory contains separate Main Hall design-task
  output. It is not product source and the refactor must not edit, revert,
  stage, commit, delete, or otherwise absorb it.
- Migration `0064_authored_artifact_design_assignments` is the 64th and latest
  migration at the baseline.
- The integration task ran the complete `npm run verify` release suite
  successfully at the baseline SHA.

### 4.2 Canonical LOC definition

The program metric is physical lines in **Git-tracked, handwritten executable
source or style files** with these extensions:

```text
.ts .tsx .js .jsx .mjs .cjs .mts .cts .css .scss .py .sql .sh
```

The broader set is deliberate. The older six-extension count omitted 822
tracked lines in executable `.mjs` and `.py` files. It would also allow a
migration extraction to manufacture a reduction merely by moving SQL out of
TypeScript. Every refactor report must use the broader definition.

The checked-in inventory is the sole canonical measurement implementation:

```bash
npm run loc:report
npm run loc:check
```

Baseline reproduction is:

```bash
npm run loc:baseline
```

`scripts/sourceInventory.ts` uses the Git index as working-tree authority and
Git objects for historical commits. It counts logical physical records,
including an unterminated final line, handles LF and CRLF consistently, decodes
UTF-8 fatally, rejects source symlinks/NUL bytes/unknown classifications, and
emits deterministic category, root, extension, and baseline deltas. Ad hoc
`wc` or formatter-sensitive arithmetic is diagnostic only and may not replace
this implementation.

The exact baseline measures:

| Metric | Value |
| --- | ---: |
| Tracked source files | 452 |
| Tracked physical source lines | 127,151 |
| Tracked nonblank source lines | 119,000 |
| Older six-extension physical count, retained only for reconciliation | 126,329 |
| Previously omitted executable source | 822 |
| Minimum net reduction to reach 99,999 | 27,152 |
| Minimum net reduction to reach 95,000 | 32,151 |
| Minimum net reduction to reach 90,000 | 37,151 |

The first threshold is approximately a 21.4% net reduction; 95,000 requires
approximately 25.3%; 90,000 requires approximately 29.2%.

The repository also contains an ignored early prototype:

| Ignored file | Lines |
| --- | ---: |
| `app.js` | 1,757 |
| `styles.css` | 1,340 |
| `index.html` | 82 |
| Total | 3,179 |

Those files are not imported by the tracked Next application and are not part
of the canonical product metric. They must not be silently added to or removed
from the metric to manufacture progress. Their eventual archival or deletion
is a separate, evidence-backed workspace cleanup decision.

Generated output, dependencies, lockfiles, JSON data, documentation, design
assets, binary media, build output, and external Design Lab files are excluded.
Generated code must not be moved to an excluded extension or directory merely
to evade the metric.

### 4.3 Tracked source distribution

| Root | Files | Lines | Observation |
| --- | ---: | ---: | --- |
| `apps/` | 87 | 35,917 | Fastify API, repositories, services, routes, schema, and migration runner |
| `features/` | 126 | 32,761 | Product UI and client controllers |
| `scripts/` | 60 | 18,009 | Characterization, architecture, security, domain, and release checks |
| `styles/` | 27 | 17,588 | Ordered legacy, immersive, feature, responsive, Assistant, and authored-artifact layers |
| `lib/` | 41 | 10,607 | Browser/server bridges, compatibility storage, routing, and runtime support |
| `components/` | 1 | 5,032 | Shared Symposium shell |
| `app/` | 104 | 3,982 | Next pages, route façade, layout, and global entry styles |
| `packages/` | 2 | 3,101 | Shared contracts and schemas |
| repository root | 4 | 154 | Counted root-level TypeScript/config source |

The same baseline reconciles by extension:

| Extension | Files | Lines |
| --- | ---: | ---: |
| `.ts` | 348 | 80,247 |
| `.tsx` | 72 | 28,467 |
| `.css` | 28 | 17,615 |
| `.mjs` | 3 | 473 |
| `.py` | 1 | 349 |

These rows sum exactly to 452 files and 127,151 physical lines.
| `lib/` | 41 | 10,500 | Shared product logic plus local fallback stores |
| `components/` | 1 | 5,032 | `SymposiumV0.tsx`, the application controller |
| `app/` | 103 | 3,920 | Next routes, bridge handlers, layout, and entry surfaces |
| `packages/` | 2 | 3,051 | Predominantly the shared contract surface |
| Root configuration source | 3 | 76 | Proxy and TypeScript/Drizzle source |

By extension:

| Extension | Files | Lines |
| --- | ---: | ---: |
| `.ts` | 347 | 79,362 |
| `.tsx` | 72 | 28,445 |
| `.css` | 28 | 17,614 |

### 4.4 Large surfaces that require auditing

Large files are signals for investigation, not automatic defects:

| Surface | Provisional lines | Why it matters |
| --- | ---: | --- |
| `components/SymposiumV0.tsx` | 5,032 | Route/auth/composition controller with 73 imports; risk of duplicated orchestration and state ownership |
| `apps/api/src/db/migrate.ts` | 3,388 | All 64 historical migrations plus the runner in one file; operational and concurrency risk, not necessarily a LOC-saving opportunity |
| `packages/contracts/src/index.ts` | 2,984 | Shared public type/validation surface; must be split only if dependency clarity improves without creating contract variants |
| `features/messages/MessagesSection.tsx` | 2,715 | Dense messaging UI/controller surface |
| `styles/89-messages.css` | 2,681 | Largest feature style sheet and likely design-system migration pressure |
| `features/attachments/AttachmentViews.tsx` | 2,522 | Complex shared rendering with substantial behavioral scope |
| `scripts/assistantBoundaryCheck.ts` | 2,422 | Valuable Assistant characterization plus repeated source-inspection scaffolding |
| `lib/dataStore.ts` | 2,148 | Load-bearing local/compatibility store still referenced by Next routes, the shell, features, and other local stores |
| `apps/api/src/repository/assistant.ts` | 2,075 | Persistent Assistant preparation, authorization, history, evidence, quota, and response flow |
| `apps/api/src/repository/foundation.ts` | 1,763 | Shared backend foundation and legacy/seed compatibility responsibilities |
| `features/assistant/useAssistantController.ts` | 1,678 | Mounted Assistant state and client action orchestration |
| `styles/92-ai-tablet.css` | 1,663 | Assistant-specific visual system |
| `apps/api/src/repository/conversations.ts` | 1,642 | Messaging persistence and authorization |
| `styles/20-content-core.css` (renamed from `20-legacy-content.css`) | 1,543 | Established content behavior mixed with accumulated legacy selectors |
| `apps/api/src/db/schema.ts` | 1,473 | Canonical Drizzle schema |

The six tracked local stores total 4,592 lines:

- `lib/dataStore.ts` — 2,148;
- `lib/localWorkspaceStore.ts` — 1,069;
- `lib/localCommunityStore.ts` — 522;
- `lib/localAttachmentStore.ts` — 416;
- `lib/localWorkspaceCommentStore.ts` — 239;
- `lib/localOpportunityApplicationStore.ts` — 198.

They remain referenced. None is approved for deletion merely because Render is
the production source of truth.

### 4.5 Backend topology

Current source evidence shows:

- Fastify API on Render’s Starter plan;
- Next frontend and compatibility routes intended for Vercel;
- Neon/Postgres durable data;
- Clerk authentication;
- Upstash Redis for distributed authenticated-mutation limiting, not
  canonical state;
- Cloudflare R2 object storage;
- OpenAI for Assistant and translation work;
- 32 backend repository files totaling 20,339 lines;
- 34 backend service files totaling 7,021 lines;
- 10 route files totaling 2,092 lines;
- 151 route registrations detected by the current route-pattern count;
- 64 embedded migrations, currently ending at
  `0064_authored_artifact_design_assignments`.

The current migration runner:

- stores applied migration IDs, exact SQL checksums, and canonical positions in
  `symposium_migrations`;
- executes pending migrations in order;
- wraps the entire startup migration run in one transaction;
- takes a transaction-scoped cross-process advisory lock before inspecting or
  changing migration history;
- backfills metadata for the pre-checksum history without replaying SQL;
- fails closed when a known migration's SQL or order drifts;
- caches migration status for readiness;
- embeds migration SQL in the TypeScript runner rather than immutable
  per-migration files.

The concurrency, checksum, order, backfill, rollback, retry, and partial-failure
boundaries now have deterministic fault-injection coverage. Historical SQL is
still embedded in the TypeScript manifest rather than immutable per-migration
files, and a real isolated Postgres recreate/current-database exercise remains
a release proof obligation. Historical IDs, order, SQL meaning, and production
compatibility are immutable constraints; changing file layout must not cause
any migration to rerun or disappear.

### 4.6 Live synchronization topology

Current live behavior is:

1. The mutation and its durable event commit to Postgres.
2. After commit, the active process publishes the event on an in-process
   `EventEmitter`.
3. A direct authenticated SSE stream delivers new visible events.
4. Initial connection and reconnect replay durable events after the supplied
   cursor.
5. Browser reconciliation uses revisions, mutation guards, and cross-tab
   transport to reject stale state.

Current limits include 12 streams per client, 500 per API process, bounded
replay pages, and slow-client termination. The route and its local
`EventEmitter` now share the same 500-listener capacity authority; the complete
capacity is exercised with exact delivery and leak-free unsubscribe coverage.
The local process bus is correct for the current single-instance Render
deployment. A distributed fanout layer must not be introduced until horizontal
API scaling is real; when that day comes, durable cursor replay remains the
recovery authority.

### 4.7 Verification and delivery topology

Current strengths:

- 57 tracked TypeScript check entrypoints;
- `npm run verify` chains architecture, platform, design, security,
  infrastructure, provider-cost, bounded-read, routing, state reconciliation,
  attachments, editor, messaging, notification, Workspace, Assistant,
  profile, publishing, typecheck, and production-build checks;
- `npm run build` includes a production hydration check;
- `api:smoke` and `api:smoke:writes` exist;
- `/healthz` and migration-aware `/readyz` exist;
- exact release reporting and request correlation exist in the API.

The focused checks are intentionally broad but heterogeneous: some execute
pure/domain logic, while others inspect source text and architecture patterns.
Source assertions are useful for enforcing ownership and preventing known
regressions; they are not substitutes for transaction, browser, or
multi-session execution. The refactor should preserve their protections while
adding runtime proof at the highest-risk seams.

Current gaps visible from the repository:

- no repository CI workflow directory was present;
- the Render build command runs `deploy:api:check`, which is preflight plus API
  typecheck, not the full `verify` suite;
- `npm audit` is documented as a release gate but is not part of `verify`;
- there is no direct browser end-to-end test dependency or checked-in browser
  regression suite;
- no checked-in restore-drill runbook or restore-test automation was found;
- no checked-in external monitoring/alerting configuration was found.

These are statements about repository evidence, not claims that provider-side
dashboards, branch rules, snapshots, or alerts do not exist.

---

## 5. Load-bearing contracts that must survive unchanged

### 5.1 Platform invariants

The refactor must preserve:

- Clerk actor identity as the authority for authenticated ownership;
- server-side authorization for every private, community, draft, message,
  notification, application, and Assistant resource;
- deliberate `404` concealment where resource existence is private;
- Postgres as canonical durable state;
- transactional coupling of domain mutations, receipts, audits, notifications
  where applicable, and durable live events;
- idempotency-key scope and canonical payload-hash behavior;
- monotonic revisions and expected-revision conflicts;
- repeatable-read snapshot consistency;
- public projection privacy and audience-filtered live events;
- after-commit publication, cursor replay, SSE bounds, and cross-tab
  convergence;
- attachment ownership transitions, immutable public promotion, signed private
  delivery, quotas, and durable deletion;
- maintenance that is driven by real database activity and does not
  gratuitously wake scale-to-zero infrastructure;
- production fail-closed behavior when the live API is configured but
  unavailable;
- explicit no-Clerk local preview on a development laptop.

### 5.2 Domain preservation matrix

Before changing a domain, its row must be expanded into executable tests and a
manual acceptance checklist.

| Domain | Behavior and persistence that must not regress | Sync/conflict requirement |
| --- | --- | --- |
| Identity and entry | Clerk sign-in/up, actor sync, reserved-owner mapping, cached identity acceleration, first-session entrance, subsequent-tab entry, local preview | Identity replacement must not race route/bootstrap hydration |
| Canonical navigation | Main Hall fallback, direct links, modified/middle click, new tabs, Back/Forward, selected comments/conversations/profile filters, legacy route normalization | Route state and shell state converge without manufactured loops |
| Papers and Thoughts | Create, edit, delete, publish from Office, attachments, quotes, citations, translation, actions, feed/detail/profile presentation | Mutation responses, live events, bootstrap, reload, and other tabs preserve the latest revision |
| Proposals | Paper-grade editor, exact funding metadata, canonical proposal record, draft/publish flow, intentionally disabled payment boundary | Proposal projection and post revision remain one coherent user result |
| Comments and replies | Tree shape, paging, edits, deletion, attachments, quotes, reactions, inherited post metrics | Nested mutations advance the authoritative aggregate and converge without snap-back |
| Saves/signals/forks/reads | Canonical ledgers, denormalized metrics, privacy controls, idempotent retry, analytics | Latest local intent cannot be reversed by stale live or bootstrap input |
| Profiles and follows | Public/private activity filters, followers/following, profile edits, avatar lifecycle, follow revisions | Relationship-specific coordinator preserves the latest desired state |
| Communities and calls | Discovery, membership, requests, roles, announcements, private visibility, calls/join | Audience-filtered events and permission changes converge without disclosure |
| Messages | Direct/group conversations, first-message race protection, drafts, unread/read, attachments’ current fail-closed delivery boundary | Conversation/message ordering and unread state converge across sessions |
| Notifications | Stable aggregation/dedupe, preferences, unread projection, archive/resolve/clear behavior, request lifecycle | Private notification events and bounded recovery preserve counts and state |
| Workspace and Scribble | Notebooks, virtual All view, documents, structured editor, autosave, revisions, grants, discussion, filing, search, discard/restore | Revision conflict behavior, local fallback, live/cross-tab convergence, and collaboration roles survive |
| Notebook deletion | Deletion serializes against saves, deletes the notebook’s active documents as currently specified, resolves notifications, and queues private document/discussion objects for durable deletion | No other session may resurrect deleted documents or file a save into the deleted notebook |
| Workspace publication | Exact-revision publication, authorship/publisher audit distinction, discussion transfer, public attachment copies, private-source deletion | Retry reuses the publication; live projections remove the draft and add the public result coherently |
| Attachments and viewers | Staging, validation, ownership, inline references, PDF/DOCX/media viewers, reading position, translation context, public proxy, private signed delivery | Replaced/deleted objects disappear from every projection while durable cleanup remains retry-safe |
| Search/discovery | Public/private/community filtering, current semantic fields, route destinations, cursor bounds | Deleted/private/titleless content cannot leak through stale indexes or local projections |
| Citations and quotes | Exact snapshots, source identity/revision, access revalidation, non-recursion, deletion sanitization, formatting | Saved snapshots remain stable while inaccessible/deleted sources display the defined unavailable state |
| Translation | Original preservation, structured segments, page/document fidelity, caching, source layout, cross-tab state | Translated state must not overwrite originals or expose fields intentionally removed from a content type |
| Assistant | Persistent private threads/projects, bounded history/evidence, quotas, citations, source access, private drafts, Draft Studio review/live/undo | Requests, action proposals, receipts, revisions, audit, and private events remain retry-safe and authorized |
| Opportunities/applications | Public opportunity post, private applications, application discussions, ownership and status | Private applicant/owner events and access changes remain contained |
| Patronage | Public proposal data and internal append-only ledger, no fake payment success | Later provider reconciliation must remain possible; current disabled actions remain honest |
| Historical/local world | Seed/fallback world, no-empty local preview, historical activity, compatibility routes | Production never silently falls back to local state; local preview remains usable |

### 5.3 Paper and Thought authored-artifact invariants

The integrated Paper/Thought system is part of behavior, not cosmetic
decoration. Preserve all of the following:

- `design_assignment` is schema-versioned and persisted once for a new Paper or
  Thought after idempotent creation is confirmed not to be a replay.
- Paper muse identity is Calliope or Urania; Thought muse identity is Erato or
  Thalia.
- `bottomCaricatureId` is one of the closed seven-item pool.
- Day/Night is derived from the viewer theme and is never persisted or
  rerandomized.
- Deterministic legacy/local assignment is byte-identical across JavaScript and
  Postgres.
- Runtime artifacts remain versioned, immutable, registry-hashed, and complete.
- The runtime asset set remains limited to the approved production registry;
  technical lineage does not substitute for the product owner’s separate
  external acquisition/license evidence.
- Paper and Thought bottom figures use their correct, separate fill behavior.
- Authored-artifact styling does not seize ownership of the established detail
  grid or center-panel width.
- Compact Paper/Thought emblems remain restrained on feed/profile cards;
  comments remain emblem-free.
- Thoughts have no public title. Historical title data must not reappear in UI,
  search, translation, quotes, citations, analytics, deletion copy, alternate
  Assistant attachment/context projections, or accessibility labels.
- Detail/feed/profile, Day/Night, responsive, and theme-switching behavior all
  remain covered.

### 5.4 Recent integration failures converted into permanent safeguards

The design integration caught several classes of defect. They are now
mandatory refactor tests:

| Failure caught during integration | Permanent safeguard |
| --- | --- |
| Authored CSS changed the established detail width and grid | Geometry contract tests plus desktop/tablet/mobile screenshot comparison for any shared style or post-shell change |
| Six Thought bottom figures reused Paper-filled assets | Registry-wide asset-semantic test; never test one representative variant only |
| JavaScript and Postgres legacy assignment used different hashes | Cross-runtime golden vectors for every deterministic identifier or backfill algorithm |
| Historical Thought titles leaked through alternate Assistant context | Field-absence tests across every projection and consumer, not only the primary renderer |
| Theme material/foreground layering needed correction | Day/Night layering and occlusion matrix on every registered post type |
| Mobile navigation controls regressed in a follow-up | Required narrow and compact navigation checks for every shared-shell/style release |
| A code preview accessibility/detail issue was caught during the active finishing pass | Keyboard, semantic labeling, focus, and expanded/collapsed-state acceptance for shared editor controls |

---

## 6. Future design work: how the refactor must prepare for it

### 6.1 Main Hall direction

The “Revamp main hall design” work defines a long-term authored world:

- the user expects to draw the source architecture;
- the implementation should professionalize that drawing without replacing
  its authored character;
- the system needs canonical 2D architecture, room entrances, interaction
  hotspots, responsive crops, UI-safe regions, and Day/Night behavior;
- the master should be layered and versioned, with approved stages frozen;
- releases may progress from sketch to linework, color, ornament, and lighting;
- each progressive release must be independently rollbackable;
- future local edits should affect targeted layers or regions rather than
  regenerate the whole world;
- interactive controls must remain real React/HTML components, not painted
  controls inside an image.

This means the refactor should make scene data, route intent, hotspot
semantics, crops, and interactive components independent of any one raster or
SVG master. It must not hard-code current temporary artwork dimensions into
navigation policy.

### 6.2 Sitewide design-system direction

The later design program extends beyond the Hall to buttons, inputs,
navigation, posts, Office, Messages, the AI Tablet, dialogs, empty/error/offline
states, mobile behavior, motion, focus, and accessibility.

The refactor should therefore:

- preserve semantic component boundaries and accessible native behavior;
- establish one shared interaction-state vocabulary;
- centralize stable tokens only after their semantics are understood;
- keep visual skins replaceable without moving persistence or sync logic;
- migrate one component family at a time;
- use the new family to delete old CSS and markup variants in the same bounded
  program;
- retain visual regression evidence for the old approved state until the new
  state is explicitly approved;
- keep authored scene assets separate from controls and content surfaces;
- avoid “cleanup” that bakes the current transitional visual hierarchy more
  deeply into feature controllers.

### 6.3 What can proceed before the future visual system is designed

Safe early work:

- CI, restore, migration, readiness, alerting, and release evidence;
- mutation, persistence, authorization, and live-sync characterization;
- server/service/repository responsibility consolidation;
- local/production adapter inventories;
- pure data/controller extraction;
- shared test helpers;
- dead-code proof;
- stable semantic component interfaces and state machines.

Work to defer or constrain:

- aggressive selector consolidation based on visual similarity;
- renaming/removing DOM hooks without a migration inventory;
- broad layout-wrapper rewrites;
- replacing authored Paper/Thought geometry;
- final token taxonomy based only on the current design;
- deleting responsive rules because a single breakpoint appears correct.

Future design work is therefore not blocked by the refactor. It becomes safer
if behavior and visual ownership are separated first. Conversely, the future
design migration should become one of the largest legitimate deletion waves:
new approved components replace old component/CSS families, and the old family
is retired after equivalence and visual approval.

---

## 7. Future AI Tablet/Assistant work: how the refactor must prepare for it

### 7.1 Current capability boundary

At the preparation snapshot, the Assistant is a secure, source-grounded
research chat with persistent private threads/projects, citations, translation
support, Quick Note persistence, and private Office drafting/editing. It is
not yet a general sitewide agent.

Current evidence shows:

- the provider history query loads the latest six messages;
- included source context is bounded to five sources;
- evidence extraction is bounded to 16 blocks per source and 900 characters
  per excerpt;
- exactly three action tools are registered:
  `office.note.create_draft`, `office.post.create_draft`, and
  `office.document.edit_draft`;
- those actions are private, schema-constrained, confirmation/revision/audit
  workflows;
- actual posting, publishing, sending messages, sharing, permission changes,
  deletion, and autonomous/background actions are not currently granted to the
  Assistant.

The user previously paused speculative Assistant expansion pending hands-on
product learning. This document prepares the substrate; it is not itself
authorization to resume capability work.

### 7.2 Invariants for the future Assistant

Refactoring may consolidate the Assistant only if it preserves:

- exact actor and resource authorization before source inclusion;
- canonical source identity, revisions, provenance, and evidence labels;
- visible distinction between source text, inference, and insufficient
  context;
- bounded provider input and cost/quota ledgers;
- server-owned action schemas;
- separate proposal/preview and confirmation/commit steps;
- idempotency receipts and canonical payload binding;
- exact-revision conflicts;
- immutable before/after checkpoints and bounded undo;
- private audit records and audience-contained live events;
- honest failure and partial-result states;
- no implied authority from mere UI visibility or conversation history.

### 7.3 Refactor/capability sequencing

Do not combine a deep Assistant substrate refactor with a new consequential
capability. Use this sequence:

1. Characterize the current Assistant end to end.
2. Consolidate context identity, evidence packing, action dispatch, persistence,
   and UI state without adding tools.
3. Prove equivalence in private research and Office workflows.
4. Establish one canonical capability registry and risk/confirmation model.
5. Only after renewed product authorization, add one new capability through
   that registry.
6. Verify authorization, preview, confirmation, idempotency, audit,
   persistence, live events, and receipts for that capability.

Likely later capabilities—message drafts, Office organization, source
save/attach/detach, project-wide context, durable user preferences, or
consequential send/publish actions—should reuse the substrate. They must not
reintroduce separate chat histories, source formats, action registries,
confirmation modals, or revision logic.

---

## 8. LOC policy and anti-gaming rules

### 8.1 The ceiling

The program has two stages and one non-negotiable test:

1. **Descent stage:** reduce the current post-Gate-0 baseline below 100,000
   tracked source lines.
2. **Steady-state stage:** once below 100,000, do not merge or release a
   `main` branch at 100,000 or above.

**Absolute test:** the refactor program is incomplete and unsuccessful until
the canonical count is 99,999 or lower while every zero-loss requirement also
passes. “We could not safely find the remaining reduction” means the
architecture or investigation is not yet good enough; it does not convert the
ceiling into an aspiration.

The preferred steady-state operating band is 90,000–95,000, leaving room for
future design and Assistant work. That band is a target, not permission to
remove behavior.

Every pass publishes a cumulative burn-down against the exact Gate 0 baseline.
An enabling safety pass may temporarily add lines, but it must name and unlock
a larger bounded retirement. A final net increase, a flat result above the
ceiling, or an unexplained reversal in the cumulative trend is categorical
evidence that the “efficiency” program has not achieved its purpose.

### 8.2 What counts as a real reduction

A reduction is legitimate when it removes:

- a superseded implementation after all callers moved;
- duplicated state ownership;
- duplicated API/bridge behavior;
- repeated domain logic replaced by one tested shared invariant;
- legacy CSS/markup replaced by one approved component family;
- repeated fixtures replaced by canonical builders without coverage loss;
- repeated check harness/scaffolding while preserving assertions and failure
  quality;
- unused exports, routes, assets, adapters, or compatibility paths proven
  unreachable in every supported mode.

### 8.3 What does not count

The following are prohibited:

- deleting or weakening tests/checks to reach the number;
- moving source into JSON, Markdown, generated output, strings, or ignored
  files;
- minifying or collapsing formatting;
- replacing explicit types with `any`, casts, or opaque generic machinery;
- moving code into dependencies without a sound product reason;
- deleting local preview or failure states without withdrawing support
  explicitly;
- reducing error handling, authorization, audit, observability, accessibility,
  or rollback;
- splitting or merging files and claiming architectural progress based on file
  count alone;
- measuring only production code after previously counting checks and styles;
- excluding a directory after it becomes inconvenient.

### 8.4 Temporary increases

Expand/contract work can temporarily increase a branch because old and new
paths coexist. That increase must have:

- a named reason;
- an explicit maximum;
- a removal issue/checklist;
- a deadline or exit gate;
- no merge of permanently dead parallel code.

Safety infrastructure may produce a small net increase before it enables safe
deletion. Every such increase must be reported openly. After the repository
crosses below 100,000, temporary branch increases may occur, but released
`main` should remain below the ceiling.

### 8.5 Per-slice measurement

Every refactor slice records:

```text
baseline SHA
result SHA
source files before/after
physical LOC before/after
nonblank LOC before/after
production LOC delta
check/test LOC delta
CSS LOC delta
deleted paths
new paths
behavioral evidence added/removed
authoritative concepts/owners before and after
supported change paths/callers before and after
runtime or operational efficiency before and after
positive product/engineering improvement delivered
```

The result should also say whether the slice:

- reduced duplication now;
- was size-neutral safety work;
- temporarily expanded for contract migration;
- unlocked a later named deletion;
- made a named future change materially easier, safer, or more local;
- improved a measured runtime, operational, or user-experience property.

---

## 9. Target architecture

The existing dependency direction remains correct:

```text
Next routes and application shell
             |
             v
feature UI and feature controllers
             |
             v
shared API, state, mutation, live-sync, navigation, and browser adapters
             |
             v
versioned contracts

Fastify routes -> domain services -> domain repositories
                                      |
                                      v
                         Postgres / R2 / Redis / provider adapters
```

### 9.1 Ownership rules

- The shell owns application composition, authentication lifecycle, and
  route-level coordination—not feature rendering, HTTP normalization, live
  transport, or domain mutation policy.
- A feature owns its view policy and controller.
- Shared client modules own only proven cross-feature invariants.
- Contracts define wire/resource shapes; they do not accumulate feature
  behavior.
- Routes parse/authenticate/translate HTTP and call the owning service or
  repository.
- Services own real cross-domain orchestration.
- Repositories own database access for their domain and may depend on shared
  transaction/audit/event/storage kernels, not sideways on other repositories.
- Providers remain behind narrow adapters.
- Persisted source-of-truth state has one owner.
- Optimistic, cached, local-preview, live-event, and bootstrap representations
  are projections with explicit precedence—not competing truth stores.
- Visual component state is not allowed to own durable domain policy.

### 9.2 What modularity is for

Modularity is valuable when it:

- narrows the blast radius of a change;
- makes one invariant reusable;
- removes a parallel implementation;
- makes authorization or transaction boundaries obvious;
- allows future design or AI work to attach to a stable contract.

Moving 3,000 lines into ten files without deleting overlap may improve
navigability but does not, by itself, satisfy the consolidation objective. Some
operational work—especially migration extraction—may be worth doing even when
it is LOC-neutral. It must be labeled accurately.

### 9.3 Engineering leverage and the modification test

Every major consolidated system must demonstrate leverage, not merely
abstraction. Its review should answer:

- What formerly required several implementations now has one authority?
- What invalid state or misuse became impossible or immediately visible?
- What future capability can now be added through an existing contract?
- How many unrelated files, branches, stores, routes, selectors, and tests no
  longer need coordinated edits for a representative change?
- Can a new engineer trace the read, write, authorization, persistence, live,
  rollback, and rendering path without reconstructing hidden conventions?
- Did runtime work decrease or remain demonstrably bounded?

For representative future-change drills, document the intended edit surface.
Examples include adding a document node, adding a reversible Assistant draft
action, restyling a complete control family, adding a live mutation, or adding
a protected attachment owner. The target is not literally one file; it is the
smallest truthful set of owners, with no duplicated policy.

Code beauty is also visible locally:

- names expose domain meaning;
- functions have one coherent responsibility;
- types encode valid states;
- error and rollback paths are first-class;
- comments explain non-obvious constraints rather than narrate syntax;
- abstractions delete more complexity than they introduce;
- modules are easy to test without constructing the entire application;
- performance and provider cost are properties of the design, not later
  patches.

---

## 10. Gate 0 — freeze the post-integration baseline

The source-identity portion of Gate 0 is complete at `8e900d0`. The first
execution turn recaptures that identity, count, and full local gate before its
first edit. Evidence is then layered: a small repository-wide canary belongs
in Pass 1, while each later subsystem must receive its detailed browser,
persistence, live, accessibility, performance, and failure baseline before
that subsystem changes. This avoids both unsafe deletion and weeks of
front-loaded ceremony unrelated to the first slice.

### 10.1 Active-task closure

- “Local design lab integration” reports complete, not merely locally edited.
- Every active subtask has returned and been reconciled.
- The working tree contains no unexplained modifications.
- The task’s intended changes are committed in reviewable commits.
- No Design Lab intermediate or generated `output/` material is accidentally
  included in production.
- Its final document and migration behavior match the code.

### 10.2 Exact identity

Record:

- baseline commit SHA;
- `origin/main` SHA;
- production frontend release SHA;
- production API release SHA;
- whether frontend and API report the same release;
- current migration count, latest ID, and pending IDs;
- runtime versions and provider topology;
- the exact LOC and nonblank counts using this document’s commands;
- clean `git status`.

### 10.3 Local release evidence

Run and retain:

```bash
npm ci
npm run verify
npm audit --audit-level=high
npm run api:smoke
```

Run `api:smoke` against an explicitly selected running API. Run
`api:smoke:writes` only against an explicitly approved environment where
verification writes and cleanup are safe. A production-dependency-only audit
with `npm audit --omit=dev --audit-level=high` may be retained as an additional
report, but it does not replace the full dependency audit above.

The report must include command, SHA, start/end time, exit status, and any
warning—not merely “passed”.

### 10.4 Production readiness evidence

After the final release:

- `/healthz` succeeds;
- `/readyz` reports the expected release and database-silent healthy state;
- one explicit `/readyz?probe=database` confirms the database, exact migration
  convergence, maintenance state, and provider boundaries;
- the frontend and API are on the intended compatible release;
- error logs are reviewed for the deployment window;
- the release is not called current until the exact SHA is confirmed.

### 10.5 Browser baseline

The list below is the cumulative program matrix, not a demand to automate and
recapture every surface before the first proof-kernel edit. Pass 1 establishes
the stable cross-cutting canaries. Before a product subsystem changes, its
applicable rows below become mandatory slice-entry evidence.

Capture desktop, tablet, narrow mobile, Day, and Night evidence for:

- entry/Main Hall and every primary room;
- Paper and Thought feed/detail/profile rendering;
- every muse and all seven bottom-caricature identities across the registered
  artifact tests;
- comments/replies and action metrics;
- create/edit/delete/reload for Paper and Thought;
- Office notebooks/documents/Scribble;
- notebook deletion semantics;
- editor code blocks and edit/preview collapse behavior;
- messages and notifications;
- profiles/follows;
- communities/calls;
- search and direct routes;
- attachment upload/view/delete;
- translation/citation/quote paths;
- AI research chat, evidence, Quick Note, private draft, Draft Studio edit and
  undo;
- offline/error/empty/loading states that the changed integration surfaces can
  reach;
- keyboard navigation, focus visibility, labeling, and horizontal overflow.

Also capture a small reproducible performance baseline: production build/chunk
output, cold and warm entry, representative route transitions, editor typing,
long-feed/attachment scrolling, representative API latency/query counts, and
live-event convergence time. The program does not need synthetic precision it
cannot reproduce, but it does need enough before/after evidence to prevent a
“leaner” code path from making the site materially slower or more fragile.

### 10.6 Persistence and live baseline

Apply these cases before and after each slice that can affect persistence,
mutation, bootstrap, cross-tab, or live-event behavior. They are not required
for a documentation-only or CI-orchestration diff that cannot execute in the
product runtime.

Use at least:

- reload after each representative write;
- two tabs for the same actor;
- a second browser session for the same actor where feasible;
- a different actor for permission/audience cases;
- disconnect/reconnect with cursor replay;
- stale bootstrap arriving after a local mutation;
- an expected-revision conflict;
- an idempotent retry;
- server restart followed by readback.

### 10.7 Gate 0 artifacts

Create a dated evidence directory or document set containing:

- `baseline.md`;
- `loc.txt`;
- `verification.md`;
- `browser-matrix.md`;
- `persistence-live-matrix.md`;
- `production-release.md`;
- `known-limitations.md`;
- screenshots or trace links where appropriate.

The source baseline is complete when every moving repository number is exact.
Production/provider facts remain time-sensitive and are reverified when a
slice depends on them or a release is authorized.

---

## 11. The refactor pass sequence

Each pass is a program envelope. Inside it, work still ships as small,
independently reversible slices.

Every pass must report three separate outcomes:

1. **Perfect preservation:** which microfeatures, data, live-sync, design,
   accessibility, privacy, recovery, and degraded-mode behaviors were proved.
2. **Sublime engineering:** which concepts, owners, paths, and duplicated
   mechanisms disappeared; why the replacement is clearer and more powerful;
   and which future modifications became local and composable.
3. **Positive improvement:** what became faster, smoother, safer, cheaper,
   easier to operate, easier to test, or easier to build. A safety prerequisite
   may honestly report no user-facing improvement yet, but it must name the
   later deletion or capability it unlocks.

### Pass 1 — Safety rails, CI, and evidence automation

**Purpose:** make regression proof reproducible before changing load-bearing
code.

**Local implementation result (July 29, 2026):** complete and within its
corrected proof budget. The candidate adds 1,200 canonical lines, all in
proof/check tooling; production remains 91,527 lines and styles remain 17,615
lines. No source under `app/`, `apps/`, `components/`, `features/`, `lib/`,
`packages/`, or `styles/` changed. The checked-in ceiling is ratcheted to the
exact 128,351-line candidate rather than leaving the +1,200 allowance as
permanent headroom.

The execution-ready runbook is
`docs/refactor-pass-01-plan.md`. It fixes the baseline, per-slice order,
source budget, proof obligations, pause conditions, and the read-only
runtime-spine inventory that hands off to the first substantial consolidation.

Implemented:

- strict, deterministic Git-backed LOC inventory with adversarial fixtures;
- typed 56-stage verification manifest and fail-fast observable runner;
- retained `verify:legacy` chain and explicit result-parity proof;
- atomic, bounded, secret-safe local evidence under ignored `.artifacts/`;
- immutable-action-pinned GitHub workflow for install, audit, metric, proof,
  full verification, browser canaries, integrity checks, and artifact upload;
- isolated browser canaries running from a sanitized disposable checkout with
  no production credentials or data;
- exact-SHA release-evidence template and local dry-run record;
- source-grounded runtime-spine inventory covering 16 page routes, 85 Next
  route files/116 methods, 110 Fastify paths/141 registrations, six preview
  stores, durable providers, browser persistence, and cross-tab transport;
- Render Blueprint configured to wait for checks before auto-deploying.

Do not:

- rewrite product code while constructing the gate;
- replace the focused checks wholesale;
- declare the current source-inspection checks obsolete before equivalent
  runtime tests exist.

Local exit:

- a failing stage fails the canonical local runner and the checked-in workflow;
- the full suite has a provider-independent checked-in execution definition;
- a minimal browser critical path is reproducible;
- line-count drift is visible;
- no production behavior changed.

Remote exit is deliberately separate. The workflow is not called “required,”
and `autoDeployTrigger: checksPass` is not called active, until GitHub and
Render configuration are read back. Vercel gating and exact deployed-SHA
readback also remain provider-state proof, not facts inferred from source.

LOC result: +1,200 canonical lines against a corrected proof-only maximum of
+1,200 and an additive construction maximum of +1,500. The initial +300
estimate was disproved before implementation: the old orchestration is in
excluded package metadata, while a rigorous typechecked metric, observable
runner, browser harness, and failure fixtures require real counted source.
This enabling delta is not called progress toward 99,999. Its value is the
proof leverage that makes later deletion governable.

### Pass 2 — Recovery, migration, and operational hardening

**Purpose:** ensure a refactor can be deployed, rolled back, and recovered
without data loss.

**Current local implementation and proof (July 30, 2026):** the migration runner now
serializes concurrent startups through a transaction-scoped advisory lock,
records and verifies SHA-256 SQL checksums and canonical positions, backfills
the existing ID-only ledger without replaying historical SQL, and fails closed
on checksum or order drift. Deterministic checks prove duplicate/malformed
plan rejection, two-process exactly-once application, partial-failure rollback,
retry, legacy metadata backfill, and pre-execution drift rejection. Readiness
deep probes revalidate this metadata. The live-bus warning limit is aligned
with the 500-stream process limit, and local first-access reads now share the
mutation queue so seed initialization cannot erase a concurrent successful
write.

Two independent disposable PostgreSQL 17.10 databases proved the original 64
migrations from zero, exact legacy-ledger metadata backfill, stable normalized
schema and row-count digests, two-session exactly-once concurrency, complete
transaction rollback, and corrected retry. A real API write/restart matrix
also exposed and fixed the missing note owner on legacy note-block creation.
An authenticated Neon point-in-time restore then proved a true ID-only ledger,
PostgreSQL 18 fresh reconstruction, 65-row candidate convergence, real
concurrency, rollback, and exact restored/fresh semantic manifests. It exposed
and fixed a false legacy-ledger setup assumption, a path-only evidence digest,
non-semantic column-order hashing, and a production-only legacy
`comments.deleted` column. Forward migration
`0065_comment_deletion_reconciliation` preserves any legacy tombstone in
`deleted_at` before removing the redundant flag. The restored and fresh
manifests now match at 1,752 entries.

The credentialed R2/static follow-up is now complete. Against the isolated
Neon audit child, 294 R2 `HeadObject` requests and 25 repository static-file
checks verified all 89 active R2 objects, every historical static asset, all
76 failed-object deletion states, and all 129 distinct staging paths with
zero coherence issues. The harness now rejects unexpected provider buckets,
verifies failed objects are absent rather than trusting status alone, and
fails if an object remains after a deleted marker. The existing Render
application credential was used only through this read-only code path; its
provider-side IAM scope was not independently narrowed. No object-store
mutation occurred.

The exact isolation sentinels, real-Postgres cases, Neon restore measurements,
read-only Postgres/R2 coherence evidence, stop conditions, and the following
provider-free attachment-adapter gate are recorded in
`docs/refactor-pass-04-checkpoint-03-plan.md`. Gate B remains a separate
authorization and implementation boundary.

Work:

- document and perform a Neon restore drill into an isolated database;
- verify what the provider’s point-in-time window and retained snapshots
  actually guarantee on the current plan;
- inventory R2 recovery/versioning realities separately from Postgres;
- define recovery-point and recovery-time expectations;
- test that restored Postgres data references available objects coherently;
- extract historical migrations into immutable ordered units while preserving
  every ID and semantic byte boundary that matters;
- add a cross-process advisory migration lock;
- add duplicate-ID, order, checksum/drift, pending, and partial-failure tests;
- support expand/backfill/contract sequencing;
- keep deployments compatible with the preceding release during additive
  windows;
- add migration/release telemetry and alert conditions;
- record a rollback playbook that never overwrites writes made after release.

Do not:

- edit old migration meaning;
- rerun applied IDs;
- introduce destructive down migrations as the normal rollback mechanism;
- couple this work to a new product schema;
- add Postgres `LISTEN` or a distributed fanout provider without a scaling
  requirement.

Exit:

- concurrent startup cannot race the migration runner;
- the current production schema can be recreated from zero;
- an isolated restore drill has measured evidence;
- N-1 application compatibility is defined for expand/contract slices;
- readiness still reports exact migration state;
- durable event replay and maintenance remain intact.

Expected LOC effect: neutral or a small increase. This is operational risk
reduction, not a fake consolidation claim.

### Pass 3 — Compatibility, bridge, and local-store audit

**Purpose:** identify which transitional paths remain required and converge
them behind explicit adapters.

**Current disposition after released Pass 04 checkpoint 01:** substantially
advanced, not complete. `c603bbe` established the canonical request mapper,
live forwarder, private attachment boundaries, and explicit local/live route
adapters. `59fe7dc` established shared atomic JSON writes and seed
normalization; `5d89ead` consolidated transaction, Workspace-access, and
inquiry-projection authorities; `1a571be` hardened local persistence and
retired proven-dead source. The remaining `dataStore` authority split,
duplicated backend read/mutation projections, proof-fixture overlap, and
conditional client/presentation retirements are chartered in
`docs/refactor-pass-03-plan.md`. This revised plan supersedes any assumption
that the original candidate list is still untouched.

Current candidates:

- the Next compatibility routes under `app/api`;
- `lib/dataStore.ts`;
- the five specialized local stores;
- direct Render requests and bridge fallback behavior;
- local-preview persistence;
- historical seed/fallback repositories;
- duplicate request/normalization/idempotency logic;
- direct and same-origin live-event routes.

Required method:

1. Enumerate every import and runtime mode.
2. Classify each caller as production-direct, production-compatibility,
   protected-delivery, local-preview, test/fixture, or dead.
3. Record production fail-closed behavior.
4. Create contract tests for each supported mode.
5. Put supported behavior behind one narrow adapter.
6. Migrate callers one family at a time.
7. Prove zero production fallback to local state.
8. Delete only paths with zero supported callers.

Do not:

- delete `dataStore.ts` wholesale;
- remove local preview because it is not production;
- make production silently succeed on local data when Render fails;
- collapse protected attachment delivery into public delivery;
- change canonical IDs, revisions, or event shapes.

Exit:

- every compatibility path has a named reason or is removed;
- production, bridge, and local modes have explicit tests;
- duplicate request and persistence logic is reduced;
- no supported fallback behavior disappears.

Expected LOC effect: first significant candidate reduction, but no savings are
pre-credited.

### Pass 4 — Client shell, controller, and state ownership

**Purpose:** reduce orchestration overlap while retaining one mounted
application and one authoritative state path.

Current candidates:

- `components/SymposiumV0.tsx`;
- route/view selection and canonical history;
- repeated modal/panel open-state coordination;
- entity refs versus React state;
- mutation invocation and response application;
- repeated loading/error/retry state;
- cross-tab and live invalidation subscriptions;
- Assistant mounting/collapse coordination.

Required method:

- characterize each state variable by owner, persistence, URL authority,
  cross-tab behavior, and consumers;
- extract only coherent state machines/controllers;
- preserve one mounted owner for shared resources, especially Assistant and
  live transport;
- migrate one view family at a time;
- assert that no second entity collection, event stream, or optimistic owner
  is introduced;
- remove the old branch immediately after equivalence.

Do not:

- rewrite the shell wholesale;
- mix this with a broad visual redesign;
- move logic into context providers simply to reduce the shell’s file length;
- replace explicit state with a generic framework unless it deletes real
  overlap and preserves synchronization semantics.

Exit:

- the shell is primarily composition and route-level coordination;
- feature policy lives with features;
- API/live/mutation/navigation invariants have one owner;
- reload, Back/Forward, cross-tab, reconnect, and stale-response matrices pass.

### Pass 5 — Shared content, editor, Workspace, and attachment primitives

**Purpose:** consolidate content-family behavior from the frozen
post-integration baseline.

Candidates:

- Paper/Thought/Comment/Reply/Note/Draft capability policies;
- TipTap schema, toolbar, code block, preview, and read-only rendering;
- duplicated title/qualifier/translate/metadata layout;
- inline attachment/reference handling;
- autosave/save/publish state;
- local/live Workspace branches;
- discussion components shared between private drafts and public content.

Guardrails:

- content types retain their deliberate differences;
- Thoughts remain titleless everywhere;
- reduced editors do not accidentally acquire Paper capabilities;
- every document revision and publication relationship remains durable;
- notebook deletion remains serialized and cascade-safe;
- attachment owner transitions stay in the domain transaction;
- code blocks remain available in every intended editor;
- accessibility and unlimited edit/preview collapse behavior remain exact;
- authored Paper/Thought art and established detail geometry remain untouched
  unless the slice is explicitly visual and approved.

Exit:

- one shared document model and capability policy drives supported content
  types;
- repeated editor/rendering code is retired;
- Workspace persistence, collaboration, publication, and deletion matrices
  pass locally and in two sessions.

### Pass 6 — Messaging, notifications, and repeated interaction patterns

**Purpose:** remove parallel conversation/inbox interaction machinery while
preserving their distinct data models.

Candidates:

- message/conversation list selection and pagination;
- draft persistence;
- unread/read/visibility/resume recovery;
- participant/actor presentation;
- notification list/unread interaction patterns;
- repeated modal, menu, optimistic, loading, and empty-state UI;
- CSS patterns likely to be replaced by the future design system.

Guardrails:

- messages remain canonical in the conversation domain;
- notification rows never absorb message bodies;
- direct-conversation advisory-lock behavior remains;
- private audiences and unread counts remain exact;
- no polling is introduced for convenience;
- private message attachment delivery remains fail-closed until separately
  implemented and authorized.

Exit:

- shared interaction primitives exist only where semantics genuinely match;
- messaging and notification domain ownership remains separate;
- unread/read/draft/live behavior passes multi-session tests;
- superseded CSS/markup variants are removed only with visual approval.

### Pass 7 — Assistant substrate consolidation, without capability expansion

**Purpose:** make the future AI Tablet safer and leaner while keeping its
authority exactly unchanged.

Candidates:

- one canonical context/source identity pipeline;
- repeated provider request preparation and output validation;
- evidence/reference packing;
- action proposal/confirmation/receipt presentation;
- Assistant thread/project list state;
- Draft Studio edit/undo result handling;
- repeated check fixtures and source-inspection helpers;
- Assistant-specific CSS that later moves into approved shared components.

Guardrails:

- keep the three-tool authority boundary unless a separate user-approved
  product pass changes it;
- preserve private-only actions, revision conflicts, audits, events, quotas,
  and citations;
- do not call persistent transcript storage “complete context”;
- do not call private draft creation “posting”;
- preserve exact model-input bounds unless intentionally reviewed;
- prohibit broad access grants disguised as refactor convenience.

Exit:

- one action registry and one confirmation pipeline;
- one context identity and one evidence contract;
- equivalent private research/draft/edit/undo behavior;
- no new tool, authority, source scope, or background behavior.

### Pass 8 — Backend domain and contract consolidation

**Purpose:** reduce repeated repository/service/contract machinery after the
client and compatibility paths are characterized.

Candidates:

- repeated row-to-contract mapping;
- repeated mutation-receipt/audit/event scaffolding;
- attachment claims and removal sets;
- notification delivery calls;
- cursor/page parsing;
- access/resource lookup patterns;
- local/DB dual implementations;
- oversized contract index organization;
- historical fixture and seed projections.

Guardrails:

- abstractions must preserve domain-specific transaction boundaries;
- authorization must remain explicit and auditable;
- cross-domain writes remain service-owned;
- no sideways repository imports;
- shared mutation helpers cannot obscure receipt scope or payload hashes;
- database query count and bounded-read checks cannot worsen;
- contract versions and backward compatibility remain explicit;
- splitting the contract index is not claimed as a LOC saving.

Exit:

- duplicated kernels are truly shared;
- repositories are smaller because repeated behavior was removed, not hidden;
- query, transaction, privacy, receipt, audit, and live-event tests pass;
- provider request/cost boundaries do not regress.

### Pass 9 — Approved sitewide design-system migration and CSS retirement

**Purpose:** integrate later visual work as a controlled replacement that
deletes old presentation families.

This pass begins only when a component family or visual layer is approved. It
does not wait for the entire future site to be designed.

For each family:

1. Freeze the old behavioral and visual baseline.
2. Define semantic states and responsive/accessibility requirements.
3. Build the approved new component/token layer.
4. Port one surface family.
5. Verify behavior, persistence, live sync, visual geometry, Day/Night,
   responsive, focus, motion, and reduced-motion behavior.
6. Remove the old component markup and selectors for that family.
7. Verify no orphan selectors, DOM hooks, or screenshot-only controls remain.

Main Hall scene layers follow the same pattern: versioned master, explicit
hotspot/crop contracts, progressive release, and rollback.

Exit:

- approved visual work is live without changing domain behavior;
- legacy CSS and markup are actually deleted;
- future component work consumes the new system;
- no feature owns a private variant without a documented semantic reason.

This is likely one of the largest honest LOC-reduction opportunities, but it
must follow design approval rather than inventing the design during cleanup.

### Pass 10 — Final retirement, ceiling enforcement, and architecture audit

**Purpose:** remove the remaining superseded paths and establish the
steady-state discipline.

Work:

- run import/export, route, selector, asset, feature-flag, migration, and
  provider-adapter audits;
- remove proven dead compatibility code;
- remove old component and CSS families already replaced;
- consolidate repeated test fixtures while retaining assertions;
- update architecture/backend docs to the actual result;
- run the complete verification, persistence, live, recovery, security,
  accessibility, performance, and production matrices;
- enforce the LOC ceiling on main;
- establish a per-feature code-budget review that evaluates deletion and reuse,
  not arbitrary file limits.

Exit:

- tracked source is below 100,000;
- preferably 90,000–95,000 if achieved without compromise;
- no temporary expand/contract path remains;
- no unexplained compatibility adapter remains;
- exact production SHA and migration state are verified;
- recovery evidence is current;
- the known-limitations list is honest and explicit.

If the repository remains at or above 100,000 after the currently identified
safe retirements, do not fake completion and do not declare the program done.
Stop that exhausted approach, report the evidence, return to the architecture,
and find a deeper zero-loss simplification. Product scope, functionality,
proof, design, persistence, and live synchronization are not the variables
used to buy the missing reduction.

The current 26,779-line gap is large enough that feasibility must be measured,
not assumed. If the audited, zero-loss opportunity ledger eventually totals
less than the remaining gap, record that finding plainly. Do not compensate
with formatting compression, abstraction theater, generated-code hiding,
weaker types, deleted checks, or reduced product scope. At that point the user,
not the refactor implementation, decides whether the numerical policy or
product scope changes. Until that decision, the threshold remains active but
unproven rather than guaranteed.

---

## 12. Standard workflow for every slice

Every slice follows the same sequence.

### 12.1 Characterize

- State the exact behavior being preserved.
- List source files, callers, routes, tables, events, browser storage keys,
  CSS hooks, and provider calls.
- Record supported production, compatibility, and local modes.
- Add or identify tests for success, failure, authorization, retry, conflict,
  reload, live, and accessibility behavior.
- Record baseline LOC and performance/request-cost observations.
- Inventory microfeatures, including small visual, responsive, keyboard,
  recovery, and absence/privacy behaviors.
- Record the present change fanout: which legitimate owners must be edited for
  a representative nearby feature change.

### 12.2 Design the smallest replacement

- Name the one authority after the slice.
- Show old and new dependency direction.
- Define compatibility and rollback.
- For data, define expand, backfill, dual-read/write if required, cutover, and
  contract.
- For UI, define semantic state and visual non-goals.
- For AI, define the unchanged capability boundary.
- State why the replacement is conceptually smaller and more powerful, not
  merely shorter.
- Name at least one future modification that becomes safer or more local.

### 12.3 Implement additively

- Add the new path without deleting the old one.
- Keep the change within one bounded subsystem.
- Preserve old readers during data transitions.
- Emit the same or version-compatible contracts/events.
- Add telemetry needed to compare behavior.

### 12.4 Prove equivalence

- Run focused checks.
- Run the full repository gate.
- Exercise browser, persistence, cross-tab, second-session, reconnect,
  authorization, responsive, accessibility, console, and network cases
  appropriate to the slice.
- Compare old/new outputs or execute shadow reads when safe.
- Check provider cost and query bounds.
- Verify build and hydration.
- Check the microfeature inventory item by item; “main flow works” is
  insufficient.
- Measure the slice’s promised positive improvement, or record it honestly as
  an enabling safety slice with no runtime claim.

### 12.5 Cut over

- Switch one caller family at a time.
- Monitor exact release and errors.
- Preserve a non-destructive rollback.
- Do not contract data in the same release as initial cutover unless proof and
  compatibility make it genuinely safe.

### 12.6 Retire

- Prove no supported caller remains.
- Remove old code, selectors, routes, flags, and fixtures.
- Run the entire relevant matrix again.
- Record exact LOC delta and deleted behavior path.
- Update docs and the decision ledger.

### 12.7 Change isolation

- Start from a clean, exact baseline SHA.
- Use one bounded branch/slice and one accountable owner for overlapping files.
- Do not run parallel design, capability, and refactor edits through the same
  surface.
- Keep characterization, additive replacement, cutover, and retirement
  reviewable in the commit history.
- Avoid drive-by formatting, dependency upgrades, or unrelated cleanup.
- Preserve user-owned working-tree changes and generated design output.
- Rebase/reconcile deliberately; never use destructive Git cleanup to make a
  slice appear clean.

### 12.8 Mandatory pause conditions

Pause the slice and report evidence when:

- baseline checks fail before the refactor change;
- another active task owns overlapping files;
- supported production/local behavior cannot be classified;
- a data migration lacks a non-destructive compatibility/rollback path;
- restored data cannot be reconciled with object storage;
- an authorization or privacy projection is ambiguous;
- a visual behavior is neither clearly current nor explicitly approved for
  replacement;
- a cross-runtime algorithm lacks golden vectors;
- a release cannot be tied to an exact SHA;
- the only route to the LOC target is reduced behavior, coverage, typing,
  accessibility, security, or recoverability.

---

## 13. Verification matrix

“Full verify passed” is necessary but not sufficient. Apply the rows relevant
to each slice.

| Layer | Required evidence |
| --- | --- |
| Static architecture | Dependency direction, no shell imports from features, repository ownership, no duplicate mounted owners |
| Types/contracts | Frontend and API typechecks, schema parsing, backward compatibility, field-absence/privacy tests |
| Build/hydration | Production build, static-shell CSP/hydration check, no hydration warnings |
| Unit/property | Pure state, revision, hash, normalization, cursor, capability, and projection behavior |
| Repository/integration | Transaction, authorization, idempotency, audit, event, notification, attachment, query-bound behavior |
| Migration | Fresh database, current database, concurrent runner, pending/drift detection, failure rollback, N-1 compatibility |
| API read smoke | Health, readiness, bootstrap, representative public/private reads, validation failures |
| API write smoke | Controlled environment only; create/edit/delete/action/publish/retry/conflict/readback and cleanup |
| Browser single session | Complete user path, reload persistence, Back/Forward, direct link, loading/error/empty states |
| Browser cross-tab | Same actor, ordered cross-tab state, no stale snap-back, storage pressure non-fatal |
| Browser second session | Same actor and different actor, live events, permissions, audience containment, reconnect replay |
| Offline/recovery | Network loss, retry-safe mutation, stale response, SSE reconnect, API restart, browser resume |
| Privacy/security | Unauthorized and foreign resources, 404 concealment, public projection, event audience, forged payload/source/citation |
| Storage | Stage/confirm/claim/replace/delete, public/private delivery, queue retry, orphan handling |
| Accessibility | Keyboard-only, focus order/visibility, labels, expanded state, dialogs, reduced motion, contrast where design changes |
| Responsive/visual | Desktop/tablet/mobile, Day/Night, overflow, geometry, layering, asset variants, approved screenshots |
| Performance | Production bundle/build output, cold/warm entry, route transition, editor/scroll responsiveness, API latency/query budget, live convergence |
| Engineering leverage | Fewer authoritative concepts/owners, smaller truthful change fanout, stable extension path, invalid states excluded, no new parallel machinery |
| Microfeature integrity | Itemized preservation of small visual, keyboard, responsive, privacy, retry, conflict, cleanup, routing, and degraded-mode behaviors |
| Operations | Exact SHA, migration convergence, readiness, logs, alerts, query/provider cost, rollback evidence |
| LOC | Canonical before/after count, category delta, no excluded-source movement, tests and types preserved |

### 13.1 Mandatory two-session scenarios

At minimum:

- create in session A, appear in B;
- edit in B, converge in A;
- conflicting edit produces the defined revision behavior;
- delete in A, disappear and stay gone after reload in B;
- save/signal/follow toggles do not snap back;
- notification unread/read converges;
- message order and unread state converge;
- Workspace autosave and collaboration grants converge;
- notebook deletion cannot be undone by a stale save;
- publication removes the private draft projection and creates the public
  projection coherently;
- inaccessible private/community/Assistant resources never appear in the
  wrong session;
- reconnect from a prior cursor recovers missed events without a full-state
  corruption.

### 13.2 Data-preservation proof

For any persistence-affecting slice:

- capture representative record counts and checksums/projections before;
- exercise the migration on a production-shaped copy;
- verify every foreign key and ownership relation;
- verify revisions and receipt/audit/event continuity;
- verify attachment object references;
- run old and new readers during the compatibility window;
- restore or roll back in isolation;
- never infer data safety from TypeScript success.

---

## 14. Deployment and rollback contract

### 14.1 Release shape

- Every slice has an exact commit SHA.
- Frontend/API compatibility is stated explicitly.
- Schema expansion ships before code that requires it.
- Schema contraction waits until old readers/writers are gone.
- Feature flags, when needed, are scoped and temporary.
- The release report names the rollback method.
- Production browser evidence is captured after the exact release is live.

### 14.2 Rollback principles

Preferred rollback:

- redeploy prior compatible application code;
- disable a new path with a scoped flag;
- switch reads back while keeping additive data;
- repair forward with an idempotent migration.

Prohibited as routine rollback:

- restoring the whole database over newer user writes;
- destructive down migrations;
- deleting unknown “bad” rows without a reconciled ledger;
- silently falling back from production to local data;
- reverting a shared contract while another deployed service still emits it.

### 14.3 Expand/contract checklist

1. Add nullable/default-compatible schema or versioned contract.
2. Deploy code that tolerates old and new.
3. Backfill deterministically and idempotently.
4. Compare counts/golden vectors.
5. Switch authoritative writes.
6. Switch reads.
7. Observe for the defined window.
8. Remove old writes.
9. Remove old reads.
10. Contract only after every deployed version is compatible.

The design-assignment integration’s cross-runtime hash correction is the model
for why deterministic backfills need golden vectors before production.

---

## 15. Operational hardening requirements

### 15.1 CI and release gates

Required jobs:

- clean dependency install;
- canonical LOC report;
- focused changed-domain checks;
- full `npm run verify`;
- frontend/API typechecks and production build;
- dependency vulnerability gate;
- migration fresh/current/drift tests;
- minimal browser critical path;
- artifact/design registry checks;
- release evidence publication.

The Render build should not be the only backend quality gate. Whether full
verification runs before Render deploy or as a provider pre-deploy gate, a
release must not reach production after only preflight and API typecheck.

### 15.2 Observability

Retain existing readiness, request IDs, cost-budget logs, migration state, and
maintenance reporting. Add or confirm external visibility for:

- HTTP error rate and latency;
- database query errors, pool saturation, and slow/budget-breaking requests;
- migration start/failure/pending state;
- SSE active streams, disconnects, replays, replay truncation, and 429s;
- event age/cursor lag;
- storage-deletion queue age, retries, and terminal failures;
- attachment verification/promotion failures;
- authentication/authorization failure anomalies without logging secrets;
- notification/message delivery failures;
- Assistant provider errors, quota denials, latency, and budget state;
- frontend error/hydration signals;
- release SHA and deployment correlation.

Alerts must be actionable and privacy-safe. Do not log message bodies, private
drafts, credentials, bearer tokens, cookies, or full Assistant evidence.

### 15.3 Recovery

The existing documentation mentions a limited Neon point-in-time recovery
window and one retained manual snapshot on the current plan. Gate 0/Pass 2 must
verify the current provider reality rather than assume that note remains
current.

The recovery plan distinguishes:

- Postgres relational state;
- R2 objects;
- immutable deployed authored assets;
- Clerk identity mappings;
- Redis rate-limit state, which is intentionally non-canonical;
- release artifacts and environment configuration.

A database restore that points to missing private/public objects is not a
complete recovery. Conversely, R2 objects without canonical ownership rows are
not a valid application state. The drill must evaluate the pair.

### 15.4 Capacity and scaling

Do not preemptively replace the process-local event bus. Before horizontal API
scaling:

- measure stream count, connection duration, reconnect rate, CPU, memory, and
  event replay cost;
- confirm the provider will run multiple instances;
- choose a non-Postgres fanout transport only if needed;
- retain durable Postgres events and cursor replay;
- test duplicate and out-of-order fanout delivery against revision guards.

---

## 16. Candidate reduction map — hypotheses only

No line in this section is an approved deletion or promised saving.

| Area | Evidence of pressure | Audit question |
| --- | --- | --- |
| CSS and presentation | 17,614 tracked CSS lines across legacy, immersive, feature, responsive, Assistant, and authored layers | Which selectors/components are truly superseded once an approved design family lands? |
| Check suite | 16,775 lines across 57 scripts, including repeated file loading and source assertions | Which harness code can be shared while every behavioral assertion and failure signal remains? |
| Shell/controller | 5,032-line controller with 73 imports | Which state machines already have extracted owners, and which shell branches duplicate them? |
| Local/compatibility stores | 4,592 lines and many callers | Which callers require local preview, which require protected bridge behavior, and which are historical/dead? |
| Assistant | 5,508 feature lines plus large repository/service/check/style surfaces | Can context, action, result, and thread-state pipelines converge without changing authority? |
| Messaging | 3,402 feature lines, 2,681 CSS lines, and a 1,642-line conversation repository | Which list/detail/draft/unread patterns are repeated, and which are semantically distinct? |
| Backend repositories | 20,339 lines | Which mapping/mutation/audit/event/access patterns are duplicated versus necessarily domain-specific? |
| Contracts | 2,984-line index | Can domain exports improve dependency clarity without creating parallel contract definitions? |
| Migrations | 3,388-line embedded runner/history | Operational extraction is needed; what runner duplication can be removed without changing history? |
| Fixtures/historical world | Large local and database seed projections | Can canonical builders replace repeated literal representations without weakening historical/local coverage? |
| Next compatibility routes | More than 100 route files under `app/`, many bridging to the live API | Which are necessary for protected delivery/local preview/retry and which are redundant with direct Render traffic? |

The map intentionally avoids savings ranges. Safe savings can be estimated
only after caller graphs, runtime modes, and characterization tests exist.

---

## 17. Risk register

| Risk | Likelihood / impact | Control |
| --- | --- | --- |
| A rewrite drops obscure behavior | High / catastrophic | No rewrite; bounded slices and behavior inventory |
| LOC pressure causes deleted coverage | High / high | Count checks consistently; prohibit coverage-reducing “savings” |
| Design cleanup breaks exact geometry | High / high | Freeze visual baselines; component-family migrations; breakpoint matrix |
| Titleless Thoughts leak historical titles | Proven / high | Field-absence tests across every projection and consumer |
| Local and DB deterministic algorithms diverge | Proven / high | Cross-runtime golden vectors |
| A representative asset test misses other variants | Proven / medium-high | Registry-wide exhaustive variant checks |
| Stale live/bootstrap state reverses a write | Historical / high | Revisions, mutation epochs, two-session and reconnect tests |
| Local-preview deletion impairs design work | Medium / high | Classify and test modes before bridge/store retirement |
| Production silently uses local fallback | Low but severe / catastrophic | Preserve fail-closed production adapter tests |
| Migration race during multi-instance startup | Medium / high | Advisory lock and concurrent-runner tests |
| Migration refactor changes historical semantics | Medium / catastrophic | Immutable IDs/order/checksums; fresh/current database tests |
| Rollback overwrites newer writes | Medium / catastrophic | Additive schema and application rollback, not database rewind |
| CSS consolidation removes mobile/accessibility state | High / high | Narrow/compact, keyboard, focus, reduced-motion matrix |
| Assistant refactor expands authority | Medium / catastrophic | Fixed action registry snapshot and authorization/confirmation tests |
| Assistant refactor weakens grounding | Medium / high | Exact provider-input/evidence tests |
| Provider “improvement” raises cost or wakes idle DB | Medium / medium-high | Request-cost checks and provider-call budgets |
| Refactor branches collide with active design work | High until Gate 0 / high | Gate 0 and one-subsystem ownership |
| Full local suite exists but deploy bypasses it | Current / high | Required CI/pre-deploy full gate |
| Restore capability is assumed, not tested | Current / catastrophic | Isolated restore drill and evidence |
| Repository monitoring gaps hide regressions | Current / high | External alert and release-correlation evidence |
| Temporary dual paths never get deleted | High / medium | Named contract deadline and exit gate |
| Large-file splitting is mistaken for consolidation | High / medium | Report responsibility and LOC separately |

---

## 18. Required artifacts per pass

Every pass keeps:

1. **Scope record**
   - exact files/domains;
   - user behavior in scope;
   - explicit non-goals;
   - owner and conflict boundaries.
2. **Behavior inventory**
   - routes, actions, data, authorization, events, storage, browser state,
     responsive/accessibility states.
3. **Dependency/caller map**
   - imports, runtime callers, local/production modes, provider edges.
4. **Data plan**
   - schema/contract versions, expand/contract, backfill, rollback.
5. **Verification plan**
   - focused/full/browser/persistence/live/security/accessibility/operations.
6. **LOC report**
   - before/after and category delta using the canonical metric.
7. **Release report**
   - commit, deployed SHAs, migrations, readiness, browser evidence, logs.
8. **Retirement ledger**
   - old path, replacement, proof, deletion commit, remaining compatibility.
9. **Known limitations**
   - what was not proved, why, and the blocking decision.

Suggested slice completion statement:

```text
Implemented:
Conceptual simplification:
Engineering leverage gained:
Positive product/runtime improvement:
Verified locally:
Verified in browser:
Verified across reload/tabs/sessions:
Verified in production:
Persistence evidence:
Live-sync evidence:
Security/accessibility evidence:
LOC before/after:
Deleted superseded paths:
Rollback:
Not changed:
Known limitations:
```

This language prevents “implemented”, “verified”, and “deployed” from being
collapsed into one vague completion claim.

---

## 19. Definition of done

### 19.1 A slice is done when

- the intended responsibility has one authoritative owner;
- every inventoried microfeature and the old supported behavior are preserved
  or explicitly improved with evidence;
- the old implementation is deleted or has a named compatibility reason;
- the replacement is easier to understand and harder to misuse;
- the replacement exposes a stable, composable path for the next relevant
  feature or design change;
- the truthful change fanout and conceptual surface decrease or have a
  documented enabling reason not to;
- focused and full checks pass;
- required browser, persistence, live, privacy, responsive, and accessibility
  cases pass;
- data changes are compatible and recoverable;
- exact LOC delta is reported honestly;
- any claimed speed, smoothness, query, bundle, synchronization, provider-cost,
  operational, or developer-experience improvement is measured;
- the exact deployed SHA is verified when the slice is released;
- docs match source;
- no unexplained warning, console error, network error, migration drift, or
  provider-cost regression remains.

### 19.2 A pass is done when

- all its slices meet the above definition;
- temporary paths are retired;
- its risk controls are demonstrated;
- its promised sublime-engineering outcome—not merely file movement or a lower
  count—is present;
- its systems are more coherent, powerful, composable, and modifiable than
  those they replaced;
- it delivers a named product, runtime, operational, or engineering
  improvement, or is explicitly classified as prerequisite safety work;
- its aggregate LOC and behavioral changes are reconciled.

### 19.3 The program is done when

- the entire current product still works and persists as defined;
- no known microfeature is missing, weakened, corrupted, or left
  uncharacterized;
- reload, two-tab, second-session, reconnect, conflict, retry, and restart
  matrices pass;
- privacy and authorization projections remain exact;
- current Paper/Thought design behavior is intact;
- future Main Hall/sitewide design has stable, replaceable interfaces;
- future Assistant work has one safe capability/context/action substrate;
- ordinary and ambitious feature changes travel through a small number of
  stable, explicit, high-leverage systems rather than duplicating machinery;
- the codebase is materially easier to understand, test, modify, and extend;
- representative user paths are measurably faster, smoother, more reliable, or
  no worse where no honest runtime gain was available;
- database, provider, storage, rendering, and live-sync work are measurably
  efficient and bounded;
- CI gates the full release suite;
- migration concurrency and recovery are tested;
- operational alerting/release evidence is real;
- exact production SHAs and migrations are verified;
- tracked source is below 100,000 without metric manipulation;
- preferably the product operates in the 90,000–95,000 band;
- every remaining large/compatibility surface has a documented reason.

---

## 20. Pass 01 exit and next action

The integration baseline was recaptured, the complete pre-edit release suite
passed, and the first refactor implementation remained safety/evidence work:
it did not modify `SymposiumV0.tsx`, `dataStore.ts`, authored-artifact styles,
domain runtime code, or the Assistant.

Before this pass is represented as remotely enforced or released:

1. finish the final local exit matrix on the exact candidate;
2. commit and push the bounded topic branch;
3. run the checked-in workflow on that exact pull-request SHA;
4. read back GitHub required-check configuration rather than inferring it;
5. sync and read back Render Blueprint state before relying on
   `checksPass`;
6. establish the corresponding Vercel release gate and verify exact deployed
   SHAs before calling production current.

The first code-reduction slice is selected only after that proof boundary is
honest. Its source of truth is the runtime-spine inventory, and it must retain
the same local/full/browser/release evidence shape.

---

## 21. Decisions that remain open

These require evidence or user direction; this document does not silently
resolve them:

- Which GitHub branch-protection rules will be enabled after the checked-in
  GitHub Actions gate is validated.
- Which isolated environment may safely run destructive/write smoke tests.
- The current provider-side backup, snapshot, and alert configuration.
- The provider runtime versions to pin after reconciling Vercel, Render, and
  local support.
- Which compatibility routes/local stores remain product requirements after
  caller classification.
- When horizontal API scaling is actually required.
- The order in which future sitewide component families receive visual
  approval.
- When the user is ready to resume Assistant capability expansion.
- Which later Assistant read/draft permissions may become standing preferences.
- Whether private message attachments will be implemented and through which
  protected-delivery contract.
- Which payment provider, if any, will eventually activate Patronage
  contributions.
- Whether ignored early-prototype files should be archived or removed from the
  workspace after their historical value is reviewed.

Open decisions do not block characterization and safety work unless they
change a slice’s supported behavior or authority.

---

## 22. Final governing rule

The real objective of this program is to create a **sublime engineering
system**: extraordinarily clear code, ultra-powerful composable logic,
beautifully bounded infrastructure, exceptional modification leverage, and a
site that feels faster, smoother, safer, and more dependable. The LOC ceiling
is the forcing function that prevents this ambition from dissolving back into
sprawl—and fewer than 100,000 tracked source lines is the absolute test that
the efficiency actually manifested in code.

The refactor is successful only if Symposium becomes smaller **because a few
excellent systems replace many competing implementations**, not because it has
fewer capabilities, fewer guarantees, less proof, or more hidden complexity.
Every feature, persistence rule, live-sync behavior, responsive/design detail,
accessibility behavior, privacy boundary, degraded mode, and known
microfeature must remain complete and correct unless an explicitly approved,
verified change makes it better.

The completion test is conjunctive:

```text
perfect zero-loss operation
AND
tracked source LOC <= 99,999
```

Passing only one is failure. A flawless site left at 100,000 or more lines has
not completed this refactor. A smaller site with one missing or corrupted
microfeature has also failed. An efficiency program that finishes larger—or
cannot cross its declared efficiency threshold—has exposed a grave defect in
its architecture or execution and must continue rather than redefine success.

When elegance, schedule, LOC, and user/data safety conflict, user/data safety
wins—but the program does not use safety as an excuse for mediocre code. It
seeks both: perfect operational preservation and exceptional engineering.
When a deletion cannot be proved safe, it waits. When a new design or AI
capability arrives, it enters through the high-leverage contracts established
here and pays for its complexity by reusing or retiring older paths.

That is how the product gets below 100,000 lines and stays there while becoming
a more powerful, more beautiful, more efficient, and more pleasurable system
to use and build.
