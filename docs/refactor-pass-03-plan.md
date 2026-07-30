# Major Refactor Pass 03 — Authority Compression and Feasibility Proof

## Document control

| Field | Value |
| --- | --- |
| Status | Prepared; implementation not started |
| Prepared | July 30, 2026 |
| Repository | `/Users/udayansharma/Documents/Science Rebirth` |
| Exact baseline | `59fe7dc4bc992f0f38c556a2cf16b5f33d53b73a` |
| Baseline source | 468 files / 126,778 physical / 118,710 nonblank |
| Baseline categories | 90,837 production / 16,283 styles / 19,658 checks and tools |
| Distance to 99,999 | 26,779 physical lines |
| Baseline migration | 64/64; latest `0064_authored_artifact_design_assignments`; none pending |
| Baseline deployment | Exact SHA green on GitHub, Render, Vercel, strict readiness, and read-only production smoke |
| Pass source ceiling | 126,778; it may be lowered, never silently raised |
| Planning reduction envelope | 2,500–5,000 genuine physical lines; an audit target, not pre-credited savings |
| Product boundary | Zero feature, microfeature, persistence, live-sync, privacy, security, accessibility, or approved-design loss |
| Design boundary | No visual redesign and no changes to frozen authored-artifact assets or geometry |
| Assistant boundary | No AI capability, authority, context, tool, quota, or background-behavior expansion |

This charter prepares the next implementation pass. It does not authorize
deletion merely because a file is large, an implementation is old, or a code
path is inconvenient. Every retirement must name the semantic authority that
replaces it and the evidence that proves equivalence.

### Preparation verification record

The first preparation candidate, `236ddc3e05a113eb1f241971a5f027f625e36acd`,
passed the source ceiling, dependency audit, proof kernel, full verification
manifest, evidence-integrity checks, and Vercel deployment. GitHub run
`30513123480` then rejected the candidate because one of five isolated browser
canaries observed eight identical `AbortError: signal is aborted without
reason` page errors while rapid in-app navigation cancelled outstanding
requests. The other four canaries passed. The immediately preceding exact
runtime release passed the same suite 5/5, and the preparation candidate
changed no runtime application path.

An unsandboxed local replay of the exact candidate subsequently passed all five
canaries in 38.1 seconds, including canonical navigation, stable Paper/Thought
design identities, desktop/mobile authored-artifact containment, and
create-edit-reload persistence for a titleless Thought. This is evidence of a
transient cancellation-timing failure, not permission to ignore the required
remote gate. A fresh exact-commit GitHub run must still pass before preparation
is called closed.

## 1. Candid decision

Fewer than 100,000 tracked source lines remains possible, but it is not yet a
credible promise.

The exact gap is 26,779 lines, 21.1% of the entire counted repository. Because
checks and tools are part of the metric and their behavioral coverage cannot
be sacrificed, production plus styles would need to fall from 107,120 to
80,341—approximately 25.0%—if proof source stayed flat.

The repository contains real consolidation opportunities, but the current
audit does not prove that they total 26,779 safe deletions. Reaching the target
will probably require all of the following:

- retirement of unsupported compatibility implementations, not merely wrapper
  cleanup;
- materially denser backend read and mutation ownership;
- real client-controller responsibility removal, not file splitting;
- shared content and interaction primitives that replace existing variants;
- future approved design-system work that retires large CSS families;
- consolidation of repeated proof scaffolding while retaining every assertion.

Pass 03 therefore has two outputs:

1. a smaller, clearer runtime with fewer authorities; and
2. a quantified feasibility ledger that separates confirmed retirement,
   design-dependent retirement, speculative opportunity, and irreducible
   product/proof code.

If the confirmed ledger eventually cannot bridge the remaining gap, the result
must say so. The implementation may not corrupt the architecture to make the
number appear attainable.

## 2. Baseline facts that shape this pass

### 2.1 Compatibility and local persistence

`lib/dataStore.ts` is 2,125 lines and still mixes:

- local JSON preview persistence;
- seed and historical-world migration;
- post/comment/profile/action domain behavior;
- a direct Postgres implementation selected by `DATABASE_URL`,
  `POSTGRES_URL`, or `POSTGRES_PRISMA_URL`;
- types imported by browser feature code.

Twenty-one tracked modules currently reference `dataStore`. They include
local-compatible Next routes, Workspace publication, profile/search/bootstrap
reads, other local stores, the application shell, and feature types.

The live application already has a separate Fastify/Postgres authority. In
strict production, ordinary Next routes forward to Render and fail closed;
local preview uses `.data` JSON. The direct Postgres branch inside
`dataStore.ts` may therefore be transitional duplication—but it cannot be
deleted until the supported runtime matrix proves that no accepted mode still
depends on it.

The six local stores remain supported behavior. Their file formats, IDs,
revisions, serialized mutation order, attachment transitions, community
authorization, Workspace publication, and process-restart durability are not
available as savings.

### 2.2 Backend read models and mutations

The Fastify backend contains repeated semantic projections:

- profile columns recur across `foundation.ts`, `identity.ts`, and
  `inquiryReads.ts`;
- post, comment, and attachment column sets recur across bootstrap, feed,
  detail, mutation, and publication paths;
- Workspace effective-role SQL recurs across `workspaceAccess.ts`,
  `workspaceComments.ts`, `workspaceDocuments.ts`, and
  `workspacePublicationState.ts`;
- post/comment notification, community-invalidation, staged-event, and commit
  tails recur across multiple mutations.

Source inspection also finds 25 manual `BEGIN` sites, 25 manual `ROLLBACK`
sites, and 46 manual `COMMIT` sites in the API, alongside the existing
`runAtomic` transaction helper. Some manual transactions are deliberate
because they return early on receipt replay, stage events, stream bytes, or
need precise lock ordering. They are candidates for classification, not blind
conversion.

The correct goal is one auditable projection or lifecycle owner per invariant,
while keeping domain-specific authorization, lock order, transaction scope,
receipt hash, attachment transition, notification audience, and event payload
visible.

### 2.3 Client and presentation

`components/SymposiumV0.tsx` remains 5,032 lines. Large feature surfaces
include Messages, Attachments, Assistant, Posts, Editors, Communities,
Profiles, and Comments. File size alone is not evidence of duplicate behavior.
Moving lines into hooks or providers without removing a competing state owner
earns no architectural or LOC credit.

The prior pass removed 1,332 style lines by proving selector ownership and
retiring superseded rules. The remaining 16,283 style lines include large,
actively rendered feature systems and frozen authored-artifact presentation.
Pass 03 may remove only newly proven dead or duplicate rules. It must not
invent the future design system or reopen approved visual work.

### 2.4 Proof source

Checks and tools are 19,658 lines. They are unusually visible because the
program correctly counts them. Repeated fixture factories and source-inspection
scaffolding may be consolidated, but assertion count, semantic matrix coverage,
failure observability, exact-SHA evidence, and adversarial cases may not fall.

## 3. Target architecture

```text
browser feature/controller
        |
        v
canonical client API + reconciliation
        |
        +---------------- live --------------------------+
        |                                                |
        v                                                v
named Next compatibility boundary                 Fastify route
        |                                                |
        v                                                v
explicit local-preview adapter              domain service/repository
        |                                                |
        v                                                v
local inquiry/workspace stores            canonical read + mutation kernels
        |                                                |
        v                                                v
atomic versioned JSON                         Postgres / R2 / events
```

The target does not merge local JSON and Postgres into a lowest-common-
denominator repository. They have different durability and concurrency
mechanisms. It gives them shared domain contracts where semantics match and
separate persistence adapters where mechanisms differ.

The target also does not create one generic backend repository. Shared kernels
own exact cross-domain invariants; domain repositories continue to own policy.

## 4. Execution sequence

### Gate 0 — Freeze and reproduce the baseline

Before implementation:

1. Verify `HEAD`, `origin/main`, GitHub, Render, and Vercel identities.
2. Reproduce the 126,778 / 118,710 inventory.
3. Record route/method signatures and migration 64/64.
4. Run focused local persistence, mutation, security, and architecture checks.
5. Run 56/56 verification and 5/5 browser canary.
6. Preserve `output/` and `scripts/browserCanaryServer 2.ts` as unrelated
   user-owned untracked material.
7. Create a Pass 03 evidence ledger before the first implementation commit.

Stop if the baseline does not reproduce or an unrelated regression exists.

### Slice A — Runtime-mode and `dataStore` authority audit

#### Characterize

Build a machine-readable caller matrix for all `dataStore` exports:

- caller and exported symbol;
- browser, Next server, script, or local-store consumer;
- live-direct, live-bridge, protected delivery, local preview, test, or
  unsupported mode;
- persistence mechanism;
- expected failure behavior;
- event, revision, attachment, quote, community, and publication effects.

Exercise this environment matrix:

| Next runtime | API URL | Database URL | Expected authority |
| --- | --- | --- | --- |
| development | absent | absent | local JSON |
| development | present | absent | live direct/bridge |
| development | absent | present | characterize current behavior before deciding support |
| production | present | any | Render; no local or direct Next Postgres fallback |
| production | absent | any | controlled fail-closed response |

The third row is the key retirement question. Documentation, scripts, and
actual usage—not convenience—decide whether it remains a supported mode.

#### Consolidate

1. Move browser-consumed action/input types out of `dataStore.ts` into the
   shared contract or feature type boundary so UI code no longer depends on a
   server persistence module.
2. Define one narrow local inquiry-store interface for profile, snapshot,
   post, comment, action, and view operations.
3. Keep local file migration and serialization explicit and versioned.
4. If direct Next/Postgres mode has no supported caller, retire its schema,
   seed, read, and mutation branches after characterization.
5. If that mode is still required, adapt it to the canonical Fastify
   repository/service contract or retain it with a named reason; do not pretend
   it was removed.
6. Remove conditionals and imports only after all callers have moved.

#### Required proof

- exact local JSON compatibility from an existing pre-pass data file;
- fresh local seed and historical-world migration;
- process restart persistence;
- profile sync and bootstrap;
- Paper and titleless Thought create/read/edit/delete;
- nested comment/reply create/edit/delete/action;
- qualified-view dedupe;
- community access and moderation;
- quote invalidation;
- attachment claim/remove/discard;
- Workspace publication into posts/comments;
- production fail-closed behavior under missing/unreachable Render;
- no production read or write to `.data`.

### Slice B — Canonical backend read projections

Create only narrow projection owners with explicit types:

- profile projection;
- post projection;
- comment projection;
- attachment projection;
- Workspace effective-access projection.

Each owner must define:

- canonical selected columns and aliases;
- row type;
- mapping function;
- privacy or visibility inputs;
- whether locking is permitted;
- whether the query is list, detail, mutation, or publication safe.

Migrate one family at a time:

1. profiles and identity;
2. attachments;
3. Workspace effective access;
4. posts and comments;
5. bootstrap/feed/detail hydration.

Do not interpolate untrusted values into SQL fragments. Do not merge list and
detail queries if their privacy, lock, pagination, or cost contracts differ.
Do not make every query select a maximal row merely to share text.

Required proof:

- identical public/private/community/Office projections;
- identical missing-resource concealment;
- stable cursor ordering and pagination;
- stable selected columns and JSON shapes;
- no query-count or bounded-read regression;
- exact attachment ordering and URLs;
- stable post/comment tree hydration;
- Assistant/native-citation visibility remains exact.

### Slice C — Mutation lifecycle compression

Classify every manual transaction:

- ordinary `runAtomic` candidate;
- receipt-replay early return;
- staged-event transaction;
- streaming or storage lifecycle;
- advisory-lock or isolation-sensitive;
- migration/maintenance special case.

Then introduce small lifecycle helpers only for repeated, identical phases:

- acquire/release client and rollback;
- claim/complete mutation receipt;
- collect and publish staged events after commit;
- create mention/quote notifications;
- stage community/profile invalidation;
- return replay without publishing duplicate events.

Migrate a bounded family, beginning with post/comment mutations whose repeated
tails were characterized by the previous conversation-kernel pass. Preserve:

- exact lock and query order;
- transaction isolation;
- payload hash and receipt scope;
- response body stored in the receipt;
- audit rows;
- attachment owner transitions;
- quote snapshots and invalidation;
- notification audiences;
- durable event order;
- post-commit publication;
- replay without duplicate external effects.

No helper may accept opaque callbacks so broad that transaction meaning
disappears. If the helper is longer or less explicit than the repeated
lifecycle, retain the domain code.

### Slice D — Conditional client-authority retirement

This slice proceeds only when characterization identifies a duplicated owner,
not merely a large file.

Candidate invariants:

- route/view selection versus canonical history;
- overlay exclusivity and URL ownership;
- selected entity versus normalized entity store;
- mutation response application versus live/bootstrap reconciliation;
- repeated loading/error/retry state;
- duplicated profile/community selection projections.

For each candidate:

1. Name both current owners.
2. Identify which is authoritative for URL, persistence, live events,
   optimistic state, and rendering.
3. Add transition tests for Back/Forward, reload, cross-tab, reconnect, and
   stale response.
4. Move consumers to one owner.
5. Delete the superseded state and effects in the same slice.

No credit for moving shell lines into another file, creating a generic
context, or adding a second store.

### Slice E — Proof-fixture consolidation

Build shared test support only where fixtures are semantically identical:

- actor/profile factory;
- Paper and titleless Thought factory;
- comment/reply tree factory;
- attachment factory;
- Workspace document/revision/grant factory;
- Assistant draft/action proposal factory;
- request/response capture and source-inspection helpers.

For every migrated check, compare before and after:

- named assertions;
- negative cases;
- mutation matrix rows;
- expected error/status/body/header cases;
- timeout and cleanup behavior;
- evidence artifact contents.

The pass fails if fewer behaviors are asserted even when the test file is
shorter.

### Slice F — Conditional presentation residue

Run a static plus runtime selector ownership audit across the complete route
matrix. Account for:

- template-generated class names;
- state/data attributes;
- Day/Night;
- desktop, narrow, and mobile breakpoints;
- overlays and portals;
- editor and document states;
- private/authenticated surfaces.

Delete only selectors with no rendered owner or rules exactly superseded by a
stronger canonical owner. Extend `styleLayerCheck.ts` so retired selectors
cannot return.

Frozen boundaries:

- `styles/95-authored-artifacts.css`;
- authored Paper/Thought asset registries and geometry;
- Main Hall approved art/hotspots;
- current responsive behavior;
- future design work not yet approved for production.

## 5. LOC and feasibility policy

### 5.1 Pass accounting

The pass begins at:

| Category | Physical |
| --- | ---: |
| Production | 90,837 |
| Styles | 16,283 |
| Checks and tools | 19,658 |
| Total | 126,778 |

The 2,500–5,000 planning envelope is not a quota to satisfy at any cost. It is
the expected order of magnitude if unsupported compatibility code and repeated
read/mutation ownership can genuinely be retired.

Every slice reports:

- physical and nonblank before/after;
- production, styles, and checks/tools separately;
- files added/removed;
- authorities removed;
- checks added/removed;
- why every deletion is behavior-neutral or improving;
- remaining distance to 99,999.

The candidate must be net negative. A temporary additive step is acceptable
inside the pass only when the completed slice deletes the replaced path and
lowers the exact ratchet.

### 5.2 No-credit changes

No reduction credit for:

- formatter compression or multiple statements per line;
- minification or generated source moved outside the metric;
- splitting or joining files;
- replacing types with `any`, casts, or runtime ambiguity;
- deleting assertions, fixtures, browser cases, or failure diagnostics;
- hiding SQL or domain policy in generic strings/callbacks;
- removing supported local preview;
- deleting design details, responsive behavior, or accessibility;
- excluding a source extension/root;
- deferring required behavior to undocumented operator steps.

### 5.3 Feasibility ledger

At the end of the pass, every future opportunity receives one status:

| Status | Meaning |
| --- | --- |
| Confirmed | Duplicate/superseded implementation with characterized replacement and a defensible range |
| Design-dependent | Requires a later approved visual/component replacement before old source can be removed |
| Product-dependent | Requires an explicit product-scope decision and therefore cannot be counted under zero-loss rules |
| Structural only | Improves boundaries but is expected to be LOC-neutral |
| Rejected | Would weaken behavior, proof, typing, privacy, or architecture |
| Unknown | Insufficient evidence; no savings credited |

Only confirmed and design-dependent ranges may be used in a sub-100k forecast,
and design-dependent ranges must remain separately labeled. The forecast must
include uncertainty and may conclude that 99,999 is not presently evidenced.

## 6. Verification matrix

### Source and architecture

- `npm run loc:baseline`
- `npm run loc:test`
- current inventory and lower ratchet
- route/method signature lock
- dependency-direction and cycle checks
- runtime-mode fail-closed checks
- selector ownership and retired-selector guards
- no untracked source included or silently ignored

### Local persistence

- fresh seed
- upgrade from existing local files
- process restart
- concurrent serialized mutations
- partial-write/crash-safe atomic replacement
- all post/comment/action/view flows
- community privacy and management
- attachment lifecycle
- Workspace collaboration/publication/deletion
- opportunity applications
- deterministic authored design IDs

### Backend domain

- Postgres fresh/current schema
- 64/64 migrations unchanged unless explicitly justified
- read projection equivalence
- privacy/concealment
- revision conflicts
- receipts and payload hashes
- replay and response-loss recovery
- attachment ownership/deletion
- notifications and audits
- durable event order and post-commit publication
- query-count/bounded-read checks

### Client/live

- bootstrap versus optimistic mutations
- stale live/bootstrap rejection
- cross-tab convergence
- two-session authenticated convergence where safe
- reconnect and event replay
- Back/Forward and direct-entry URLs
- overlay and selected-entity state
- titleless Thought editing and durable readback

### Design/accessibility

- complete route presentation audit
- Day/Night
- desktop, narrow, and mobile
- overflow and fixed-control containment
- focus and keyboard operation
- reduced motion
- approved Paper/Thought identity and geometry
- zero new console, hydration, request, or page errors

### Release

- locked clean checkout
- dependency audit
- proof kernel
- full 56-stage or expanded verification manifest
- 5/5 or expanded browser canary
- retained exact-SHA evidence artifact
- non-force `main` push
- GitHub required proof
- Render and Vercel exact deployment identities
- `/readyz?probe=database` exact SHA, strict readiness, 64/64, no issues
- read-only production route/API smoke
- authenticated provider-log review when available

## 7. Stop conditions

Stop the affected slice immediately on:

- any missing or corrupted feature/microfeature;
- changed persistence format without an explicit compatible migration;
- different revision, receipt, audit, notification, or event semantics;
- production fallback to local state;
- lost local-preview behavior;
- changed privacy/concealment/access result;
- additional query count or unbounded read without measured justification;
- duplicated state, stream, store, or transaction authority;
- title reintroduced to Thoughts;
- changed authored-artifact identity, geometry, or theme stability;
- responsive/accessibility regression;
- reduced assertion or browser coverage;
- aggregate LOC at or above 126,778 at candidate completion;
- a “shared” abstraction that makes domain meaning harder to see;
- inability to explain exactly which old authority was removed.

Rollback is application-only unless the pass deliberately and separately
introduces an additive migration. No rollback resets Postgres, local data, R2
objects, revisions, receipts, audits, events, or browser storage.

## 8. Completion contract

Pass 03 completes only when:

1. Every changed behavior has pre/post characterization.
2. At least one real compatibility, projection, mutation, state, fixture, or
   presentation authority has been retired.
3. Supported local/live/protected modes remain explicit.
4. Full local, CI, browser, deployment, and readiness gates are green.
5. The exact candidate is below 126,778 and the source ceiling is ratcheted to
   that result.
6. The released evidence ledger names what was and was not proven.
7. The updated feasibility ledger gives a candid evidence-based verdict on the
   remaining path to 99,999.

The pass is not required to reach 99,999 by itself. It is required to make the
system genuinely better and smaller, and to replace hope about the remaining
target with quantified architectural evidence.
