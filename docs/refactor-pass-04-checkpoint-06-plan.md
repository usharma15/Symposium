# Pass 04 checkpoint 06 — client authority replacement

## Control record

| Field | Value |
| --- | --- |
| Status | Slice C1 executed and verified; C2-C4 remain pending; Pass 04 is incomplete |
| Prepared | July 30, 2026 |
| Exact released baseline | `b0ce00548a29e2111d74c4e90acb9bcf27404bf0` |
| Execution baseline | `b0b071c79962976f2c56b8692057225862860d7f` (documentation-only successor; identical source inventory) |
| Baseline inventory | 476 files / 125,725 physical / 117,682 nonblank |
| C1 candidate inventory | 477 files / 125,722 physical / 117,672 nonblank |
| Baseline categories | 87,285 production / 16,200 styles / 22,240 checks and tools |
| Pass 04 ceiling | 114,999 physical |
| Remaining distance to Pass 04 ceiling | 10,723 physical |
| Program ceiling | 99,999 physical |
| Remaining distance to program ceiling | 25,726 physical |
| Selected authority | Client route, inquiry entity, mutation, live-sync, cross-tab, and profile/social coordination still owned by `SymposiumExperience` |
| Product/schema/design change | None authorized |
| Provider or production mutation | None authorized by this preparation |
| Design Lab and AI Tablet | Out of scope and untouched |
| Preserved unrelated paths | `output/`; `scripts/browserCanaryServer 2.ts` |

Documentation is excluded from the source inventory. The user-owned untracked
canary copy must remain byte-for-byte unchanged at SHA-256
`9ca3d8239ffb43186453d70feb5b5d8e4f023d9dc3ec411abc82c687197e2b4a`.

The C1 execution record is
[`docs/refactor-evidence/pass-04/checkpoint-06.md`](refactor-evidence/pass-04/checkpoint-06.md).
C2-C4 remain prepared but unexecuted. This document does not claim that
the remaining 10,723-line Pass 04 gap can be removed from the client shell.
Moving functions into new files is not retirement and earns no LOC credit.
Pass 04 remains incomplete unless the exact tracked source inventory reaches
114,999 or lower with every release gate green.

## 1. Decision

The next authority replacement is the client application-controller seam.

`components/SymposiumV0.tsx` is 5,030 physical lines. Its
`SymposiumExperience` function still directly coordinates:

- route selection, selected identities, overlays, origin snapshots, Back
  behavior, and restoration;
- inquiry bootstrap, bounded page reads, detail hydration, and entity
  replacement;
- create, edit, delete, post action, comment, and comment-action mutations;
- optimistic state, stale-response protection, retries, and convergence;
- live-event merging and cross-tab publication;
- profile hydration, profile activity, follow state, and profile mutations;
- local snapshot persistence and cache precedence; and
- composition of every major feature surface.

Lower-level owners already exist:

- `features/entities/useInquiryEntityStore.ts`;
- `features/mutations/itemMutationCoordinator.ts`;
- `features/live-sync/inquiryActionReconciler.ts`;
- `features/live-sync/followMutationCoordinator.ts`;
- the canonical route model and Symposium API client; and
- feature-level community, message, Assistant, and moderation controllers.

The shell is therefore not the only implementation of each primitive, but it
is still the policy owner that wires and partly reimplements their combined
behavior. The safe reduction is to make those existing primitives answer to
named domain controllers, cut over all shell callers, and then delete the
superseded shell policy.

## 2. Why the other apparent candidates are not next

### 2.1 Next compatibility routes remain frozen

The current `app/api/**/route.ts` surface contains:

- 85 route modules and 116 exported HTTP methods;
- 2,916 physical lines;
- 34 modules, spanning about 2,218 physical lines, that call the canonical
  live proxy before preserving local behavior;
- 13 modules that reference `dataStore`;
- 14 modules that reference `localCommunityStore`;
- 17 modules that reference `localWorkspaceStore`; and
- route-specific Node runtime, force-dynamic, streaming, protected-delivery,
  attachment, authentication, and validation contracts.

Those files are not a disposable set of pass-through wrappers. A catch-all
dispatcher would combine a routing rewrite with a local-preview authority
rewrite and make failures difficult to attribute. The exact route/method
surface is a regression boundary for checkpoint 06, not an implementation
target.

### 2.2 Proof tooling is an enabling boundary, not the retirement target

The checks and tools category is 22,240 physical lines, including 65
`*Check.ts` verification modules. Repeated source loading, fixtures, and
database doubles should eventually be consolidated through stable semantic
case IDs and self-tested harnesses. Checkpoint 06 may add the minimum
characterization helpers needed for the client cutover, but it may not delete
or compress checks to manufacture savings.

Broader proof-system consolidation remains a later authority pass after this
runtime seam is closed.

### 2.3 Another generic dead-code or duplication sweep is rejected

Checkpoint 05 already completed strict unused-code, Knip, and repository-wide
duplication audits. Only 0.76% duplicated source was detected, and the
remaining matches were mostly domain-specific policy. No generic sweep is
authorized to replace proof of an actual authority cutover.

### 2.4 Presentation, Design Lab, and Assistant capability are closed

No selector, visual, authored-artifact identity, Paper/Thought behavior, or
Design Lab source is in scope. The Assistant may be carried through existing
navigation and context projections, but no capability, action, context,
quota, or autonomy expansion is authorized.

## 3. Absolute preservation contract

The cutover must preserve all of the following:

1. Every canonical URL, route parse/serialize result, Back/Forward transition,
   overlay, selected identity, origin snapshot, comment segment, and scroll
   restoration behavior.
2. Local JSON preview, live Fastify/Postgres operation, refresh persistence,
   process restart, cross-tab propagation, and cursor-replayed live events.
3. Optimistic success, rejection, timeout, stale response, retry,
   idempotency, conflict, and server-convergence behavior.
4. Viewer-private projections, authorization, revision checks, receipts,
   audit/events, notification effects, and deletion reconciliation.
5. Paper titles, titleless Thoughts, persisted design identities, quotes,
   citations, attachments, community context, and Workspace publication.
6. Existing feed/search ranking, pagination, bounded hydration, and cache
   precedence.
7. Existing focus, keyboard, responsive, reduced-motion, and screen-reader
   behavior.
8. Existing request volume and effect stability. The replacement may reduce
   requests or renders, but must not introduce an additional request,
   subscription, history, persistence, or provider loop.

No database migration, persisted-data rewrite, route-surface change, provider
configuration change, or production cleanup belongs to this checkpoint.

## 4. Gate 0 — executable characterization

No runtime cutover begins until the following baseline is captured on the
exact released SHA.

### 4.1 Stable case ledger

Create stable, named cases in these families:

| Family | Required cases |
| --- | --- |
| `NAV-*` | canonical paths; browser Back/Forward; overlay open/close; origin restoration; direct detail/profile/community/message/Workspace/Assistant entry; comment segment and scroll restoration |
| `READ-*` | bootstrap; bounded feed page; detail hydration; profile hydration; profile activity; cached-then-canonical precedence; missing and deleted entities |
| `MUT-*` | Paper and titleless Thought create/edit/delete; comment create/edit/delete; post/comment action toggle; follow/unfollow; profile save; stale and rejected writes |
| `LIVE-*` | create/edit/delete/action/follow event merge; cursor reconnect; duplicate and out-of-order events; viewer-private projection; deleted-content reconciliation |
| `TAB-*` | equivalent cross-tab cases; no echo loop; stale tab cannot overwrite canonical state |
| `ID-*` | selected post/comment/profile/conversation/application identities remain stable through replacement and refresh |
| `PERF-*` | bounded request, history, live-subscription, persistence-write, and render counts for changed flows |

The ledger must record the pre-cutover assertion count and browser trace for
each case. A case may be consolidated only if the ledger proves it was
semantically identical; no case may silently disappear.

### 4.2 Structural baseline

Record at minimum:

- all state cells, refs, effects, memos, and callbacks currently involved in
  route, inquiry, profile, live, and cross-tab coordination;
- the current 20 direct `symposiumApi.request` call sites in the shell and
  their owning domain;
- every `replaceItems`, local-snapshot persistence, live-event merge, mutation
  coordinator, and follow/profile cache call site;
- exact route/method inventory: 85 modules and 116 methods;
- the six-browser-canary manifest and current named assertion inventory; and
- physical/nonblank inventory by category.

Gate 0 is characterization, not a pretext for a large bespoke test framework.
Temporary instrumentation must be removed or converted into durable,
self-tested proof before the checkpoint closes.

### 4.3 Gate 0 stop conditions

Stop before runtime edits if:

- a state cell or effect has unclassified persistence, sync, focus, or route
  behavior;
- the baseline is flaky or cannot reproduce the released behavior;
- the current local-preview file cannot be loaded without mutation;
- a case requires a route or schema change to characterize; or
- unrelated user work overlaps a target file.

## 5. Slice C1 — canonical view controller

### 5.1 Authority

Add one typed view controller under `features/navigation/` that owns:

- primary view and overlay stack;
- selected entity identities;
- entry origin and restoration snapshot;
- canonical route parse/serialize projection;
- Back/Forward reconciliation;
- comment-segment and scroll-restoration intent; and
- explicit cross-feature navigation commands.

The controller may use a reducer/state machine and narrow effects. It must not
become a generic global store or absorb feature data.

### 5.2 Cutover

1. Characterize the current `navigateView`, route snapshot, restore, popstate,
   entry, and overlay paths.
2. Introduce the controller additively behind current component props.
3. Move one route family at a time and run all `NAV-*` and affected `ID-*`
   cases.
4. Make URL state a projection of the controller rather than a second owner.
5. Delete the shell state, branches, refs, and effects only after all callers
   use the controller.

### 5.3 Structural acceptance

- The shell no longer implements a second route snapshot or restoration
  policy.
- Selected identities have one owner and are not mirrored across independent
  booleans and IDs.
- Popstate and programmatic navigation converge through the same transition
  function.
- No visual component must understand browser-history serialization.

## 6. Slice C2 — inquiry projection and synchronization controller

### 6.1 Authority

Add one inquiry controller under `features/inquiry/` or
`features/entities/`. It composes, rather than copies:

- `useInquiryEntityStore`;
- the item mutation coordinator;
- the inquiry action reconciler;
- the canonical API client;
- live-event subscription input;
- cross-tab input/output; and
- local snapshot persistence.

It owns bounded reads, detail hydration, optimistic mutations, stale-response
guards, live/cross-tab merges, convergence, and the public commands consumed
by views.

### 6.2 Cutover order

1. Read-only bootstrap, feed pages, and detail hydration.
2. Post/comment action reconciliation.
3. Comment create/edit/delete.
4. Paper and Thought create/edit/delete.
5. Live-event and cross-tab merge.
6. Local snapshot persistence and cache hydration.
7. Deletion of every superseded shell branch after the affected case family
   passes.

Do not combine all mutations into one untyped generic executor. Shared
transport and reconciliation mechanics may be centralized; post, comment,
action, deletion, and design-identity policy remain typed.

### 6.3 Structural acceptance

- `SymposiumV0.tsx` contains no direct `/api/posts` request for read,
  mutation, or convergence.
- It does not directly call the item mutation coordinator or inquiry action
  reconciler.
- It does not directly merge inquiry live events, publish inquiry cross-tab
  events, or persist inquiry snapshots.
- Views receive state and typed commands, not access to persistence or
  synchronization primitives.

## 7. Slice C3 — profile and social controller

### 7.1 Authority

Add one profile/social controller under `features/profiles/` that owns:

- profile hydration and canonical storage;
- profile activity page and referenced-content hydration;
- following/follower snapshots;
- follow mutation coordination and convergence;
- profile save and avatar-update reconciliation;
- live/cross-tab invalidation; and
- cache precedence and abort/stale-response behavior.

Authentication synchronization remains a separate identity boundary. Search
query ownership remains out of scope unless characterization proves it is
inseparable from profile activity without changing ranking.

### 7.2 Structural acceptance

- `SymposiumV0.tsx` contains no direct `/api/profiles` or `/api/follows`
  request except the separately classified authentication sync boundary.
- It does not own profile activity abort/cache policy or the follow mutation
  coordinator.
- Profile views consume one canonical profile/social snapshot and typed
  commands.
- Follow state converges identically across optimistic UI, server responses,
  live events, and cross-tab events.

## 8. Slice C4 — shell retirement and responsibility proof

After the three controllers are authoritative:

1. Delete superseded shell callbacks, state, refs, effects, caches, and
   projection branches.
2. Remove temporary compatibility adapters and characterization scaffolding
   that is not durable proof.
3. Keep the shell responsible only for top-level composition, identity
   boundaries, and explicit cross-feature context projection.
4. Add construction checks that fail if inquiry/profile persistence,
   mutation-coordinator, live-merge, cross-tab, or route-restoration authority
   returns to the shell.
5. Reconcile exact physical and nonblank deltas by production, styles, and
   checks/tools.

Reducing `SymposiumV0.tsx` while increasing total tracked source by the same
amount is a responsibility move, not a completed retirement. The checkpoint
closes only with a net tracked-source reduction and deleted old authority.
The source-policy ceiling must then ratchet to the exact candidate total.

If the implementation remains above 114,999 physical lines, it may be
recorded only as another explicitly incomplete, user-authorized checkpoint.
It may not be described as completion of Pass 04.

## 9. Verification matrix

### 9.1 Every cutover unit

- affected stable case families;
- frontend and API typechecks;
- relevant construction checks;
- exact state/request/history/persistence trace comparison;
- local-preview compatibility using pre-checkpoint data;
- focused browser interaction at desktop, tablet, and mobile where affected;
- `git diff --check`; and
- exact source inventory with no pre-credited savings.

### 9.2 Complete local candidate

- every `NAV-*`, `READ-*`, `MUT-*`, `LIVE-*`, `TAB-*`, `ID-*`, and `PERF-*`
  case;
- all 61 ordered `npm run verify` stages;
- `npm run proof:check`;
- strict frontend and API unused-code typechecks;
- optimized Next build and hydration;
- real isolated PostgreSQL/filesystem integration with all 65 migrations;
- local-preview restart and pre-checkpoint-data compatibility;
- six of six browser canaries with exact report validation;
- additional authenticated two-session/two-tab mutation and live-sync flows
  for the changed domains;
- dependency audit with no high or critical vulnerabilities;
- route/method inventory unchanged at 85/116;
- exact physical/nonblank inventory and source-policy ratchet; and
- clean candidate diff containing no unrelated or protected path.

Passing this matrix demonstrates the named states. It does not justify the
false claim that every theoretically possible production state was visited.

### 9.3 Release, only when separately authorized

- intentional commit containing only checkpoint files;
- push exact candidate;
- exact-SHA required GitHub checks;
- exact-SHA Vercel and Render deployment identity where their path filters
  require deployment;
- strict deep readiness with all 65 migrations and every provider green;
- public browser/API smoke;
- authenticated read-only and controlled-write smoke only where creation and
  cleanup are explicitly authorized; and
- rollback/data-compatibility confirmation.

## 10. Rollback

No schema or data-format change is planned. Each authority slice must be a
separate revertible commit:

1. characterization;
2. additive controller;
3. cutover and old-path retirement;
4. focused/full verification and exact ledger.

The previous release must remain able to read every write produced by the
candidate. If any slice requires a persisted-format, route, or database
change, stop and prepare a separate expand/contract plan before implementation.

## 11. Mandatory pause conditions

Stop the affected slice if:

- old and replacement owners are simultaneously writable after cutover;
- a route, selected identity, scroll/focus behavior, or request count changes
  without an explicit approved improvement;
- local, live, reconnect, cross-tab, or stale-response behavior diverges;
- a controller hides invalid domain states behind a generic action API;
- exact semantic case count falls;
- the apparent saving is file splitting, formatting, weaker types, or deleted
  proof;
- a schema, route surface, provider, visual, Design Lab, or Assistant
  capability change becomes necessary;
- the exact LOC ratchet cannot be reconciled; or
- an unrelated worktree path would be staged or altered.

## 12. Prepared handoff

The implementation turn should begin by reproducing `b0ce00548...`, creating
the stable Gate 0 case ledger, and changing no runtime owner until that ledger
passes. It should report, after each cutover:

1. the old shell authority deleted;
2. the exact replacement owner;
3. the semantic cases and runtime modes proved;
4. the physical/nonblank delta by category;
5. the current Pass 04 distance;
6. any rejected abstraction and why; and
7. whether the candidate is a checkpoint or actually satisfies the 114,999
   completion ceiling.
