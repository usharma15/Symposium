# Pass 03 implementation and verification ledger

## Control record

| Field | Value |
| --- | --- |
| Status | Candidate implementation and local release verification complete |
| Implementation baseline | `51c1045a6d609c28ff182df0d53105373f59d39c` |
| Baseline inventory | 468 files / 126,778 physical / 118,710 nonblank |
| Staged candidate inventory | 470 files / 126,543 physical / 118,498 nonblank |
| Genuine delta | -235 physical / -212 nonblank |
| Candidate categories | 90,493 production / 16,283 styles / 19,767 checks and tools |
| Distance to 99,999 | 26,544 physical |
| Unrelated material preserved | `output/`; `scripts/browserCanaryServer 2.ts` |
| Migration impact | None |
| Design impact | None |
| Product capability impact | None intended or accepted |

The candidate count includes the two newly staged authority modules and
excludes the pre-existing user-owned browser-canary copy. The local
`loc:check` correctly refuses a clean-worktree certificate while that unrelated
source copy remains untracked; the inventory above is the canonical staged
candidate, and clean exact-SHA CI remains the authoritative source gate.

## Implemented authority compression

### Transaction and event lifecycle

`runAtomic` is now the sole ordinary mutation transaction owner for:

- post create, action, edit, and deletion;
- comment create, action, edit, and deletion;
- profile upsert and authenticated user synchronization;
- post and comment qualified-view accounting;
- opportunity application create, review update, reviewer comment, and
  deletion.

The shared executor owns connection release and post-commit live-event
publication. Its extracted `runTransaction` kernel has direct characterization
for successful `BEGIN` → operation → `COMMIT` order and failing `BEGIN` →
operation → `ROLLBACK` order. Source guards reject reintroduction of manual
transaction or event-publication tails in the converted repositories.

Receipt replay still commits before returning. Events remain staged inside the
transaction and publish only after commit and connection release. Attachment
and profile-object deletion triggers still run after database commit.

### Workspace access policy

Workspace document effective-role SQL, role rank, private event audience
calculation, and advisory lock acquisition now have one authority:

- `workspaceDocumentRoleSql` accepts only the two statically valid actor
  parameters used by the queries;
- `workspaceAccessRoleRank` from the shared contract replaces three local rank
  tables;
- document audience and lock helpers replace duplicated implementations.

Document, comment, access-management, and publication repositories all consume
the same policy. Existing kind-specific ceilings and owner-only behavior remain
in their domain repositories.

### Inquiry read projection

Bootstrap, feed, detail, locked mutation reads, and post-update rehydration now
share canonical post and comment column projections. Nested and selected
comments share one row-to-contract mapper. Viewer-private action projection,
attachment hydration, design assignment, titleless Thought semantics, and
community/privacy filtering were not generalized or removed.

The local profile-search fallback now shares one filter and deterministic
ranking kernel between the Next compatibility route and Fastify read model.
Each caller still applies its own public-profile projection, so email privacy
does not move into the ranking helper.

## Deliberately retained mechanisms

These are not credited as savings:

- `lib/dataStore.ts` direct PostgreSQL mode remains because README and
  architecture documentation still describe development without
  `SYMPOSIUM_API_URL` plus a database URL as a supported fallback.
- attachment verification transactions remain explicit because object
  inspection/promotion and compensating status reset span external storage and
  database state.
- migration, maintenance, storage-deletion leasing, legacy seed, historical
  fixture, and repeatable-read bootstrap transactions remain explicit because
  their isolation, lock, logging, or recovery lifecycles differ from ordinary
  request mutations.
- frozen authored-artifact design, all CSS, AI Tablet capability boundaries,
  local JSON formats, migrations, and route contracts were untouched.

## Verification ledger

### Baseline

- `npm run verify`: 56/56 stages passed before implementation, including the
  optimized production build and production hydration.
- Typecheck and source inventory reproduced the documented baseline exactly.

### Focused candidate checks

- `npm run typecheck`: passed after every implementation slice.
- `npm run mutation:check`: passed transaction ordering, receipt replay,
  staged-event, facade parity, and canonical-authority guards.
- `npm run workspace-collaboration:check`: passed role ceilings, owner and
  collaborator permissions, sharing, sync, persistence, and publication
  boundaries.
- `npm run bounded-read:check`: passed live API injection, pagination, sparse
  hydration, profile privacy, projection ownership, and local search ranking.
- `npm run content-analytics:check`: passed private analytics and qualified
  view behavior.
- `npm run identity:check`: passed authenticated identity precedence and
  bootstrap identity preservation.
- `npm run profile:check`: passed the complete profile activity, privacy,
  ordering, pagination, live reconciliation, and optimistic-total matrix.
- `npm run opportunity:check`: passed private applications, review, protected
  attachments, deletion cleanup, live synchronization, and legacy API
  compatibility.
- `git diff --check`: passed.

### Candidate release gates

- `npm run verify`: passed 56/56 stages, including both TypeScript programs,
  the optimized production build, and production hydration.
- `npm run proof:check`: passed source-inventory, verification-runner,
  browser-report, canary-server, and proof-typecheck self-tests.
- `npm run browser:canary`: passed 5/5 in 37.3 seconds with no retry, skip,
  flake, or unexpected result. The canary created, edited, and durably
  reloaded a titleless Thought and also covered canonical navigation,
  Paper/Thought design identity stability, and desktop/mobile containment.
- staged inventory and `git diff --cached --check`: passed, subject to the
  explicitly isolated user-owned untracked source copy above.

### Release observations still to record

- exact commit and push to `main`;
- exact-SHA GitHub checks;
- exact-SHA Render and Vercel deployments;
- strict readiness and read-only production smoke.

No statement that “absolutely everything was checked” is made. The release
claim is limited to the explicit automated, browser, deployment, readiness,
and smoke evidence recorded here.

## Feasibility result

This slice removed real duplicated authority and 235 physical source lines
without deleting tests or compressing formatting for credit. It did not meet
the planning envelope of 2,500–5,000 lines, and those lines are not claimed.

The remaining 26,544-line gap confirms that transaction tails and backend
projection cleanup alone cannot reach the under-100,000 test. The target
remains possible only if later evidence supports retirement of materially
larger compatibility implementations and presentation/controller families.
The still-supported direct `dataStore` PostgreSQL mode is the largest immediate
compatibility question, but deleting it now would violate the zero-loss rule.
