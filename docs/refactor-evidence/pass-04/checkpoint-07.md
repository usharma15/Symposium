# Pass 04 checkpoint 07 — C2 inquiry authority

## Verdict

Slice C2 is implemented as a complete authority replacement. One typed
`useInquiryController` now owns the inquiry entity collection, bounded post
reads, detail hydration, optimistic post and comment mutations, passive-view
deduplication, stale-response protection, action convergence, live item and
metric merges, cross-tab item delivery, quote invalidation, feed-page state,
and cached item persistence.

This checkpoint deliberately optimizes responsibility shape rather than a line
ceiling. It is not the end of Pass 04: profile/social authority and final shell
retirement remain C3 and C4.

The previous 125,722-line release ceiling is explicitly waived for this
architecture-first slice and the operational gate is ratcheted to the exact
126,326-line candidate. That is 825 physical source lines below the Pass 04
baseline but 11,327 above the final 114,999 Pass 04 ceiling, so the pass remains
explicitly incomplete.

## Authority replaced

Before C2, `SymposiumExperience` directly combined the normalized entity
store, item mutation coordinator, action reconciler, post API calls, feed-page
state, live merge policy, cross-tab item transport, passive-view deduplication,
quote invalidation, and cached item persistence. Profile synchronization also
rewrote inquiry entities directly.

After C2:

- `features/inquiry/useInquiryController.ts` composes every inquiry authority
  behind typed reads and commands;
- `features/profiles/profileProjection.ts` owns the pure recursive projection
  of profile display changes into authored posts and comments;
- the shell has zero direct `/api/posts` requests;
- the shell has zero direct inquiry collection replacements;
- the shell has zero item mutation-coordinator or action-reconciler instances;
- the shell has zero item cross-tab publishers or receivers;
- the shell has zero direct cached item-snapshot writes;
- the global live stream remains singular and the shell delegates inquiry
  event payloads to the controller while retaining cross-domain event routing;
  and
- architecture and bounded-read checks fail if any retired shell authority
  returns.

The controller is domain-specific. It does not expose an untyped request
executor or generic global store, and it does not absorb profile activity,
following, communities, messaging, Workspace, Assistant, or navigation state.

## Preserved contracts

The cutover preserves:

- the exact 85 Next compatibility-route modules and 116 exported HTTP methods;
- the existing `/api/bootstrap`, `/api/posts`, detail, action, edit, delete,
  comment, and bounded-subject request shapes;
- idempotency and retry-key reuse;
- pending-mutation epochs and monotonic revision comparison;
- optimistic membership and metric-direction protection;
- late-response convergence requests for rapid post-action toggles;
- bounded detail/comment hydration precedence;
- cached bootstrap limits and best-effort quota behavior;
- BroadcastChannel plus storage-event fallback semantics;
- deletion tombstones and quote-source invalidation;
- profile activity optimistic staging and canonical rollback/commit checks;
- Paper titles, titleless Thoughts, semantic post projections, persisted design
  assignments, attachments, quotes, patronage, and opportunity metadata; and
- the single live subscription and existing request count per flow.

No schema, migration, route, provider, visual, Design Lab, authored-artifact,
or Assistant capability changed.

## Structural evidence

At the C2 working candidate:

| Measure | Before C2 | After C2 |
| --- | ---: | ---: |
| `SymposiumV0.tsx` lines | 4,903 | 3,899 |
| direct shell `symposiumApi.request` calls | 20 | 10 |
| direct shell `/api/posts` requests | 10 | 0 |
| direct shell `replaceItems` calls | 29 | 0 |
| shell inquiry mutation coordinators | 1 | 0 |
| shell inquiry action reconcilers | 1 | 0 |
| shell item cross-tab transports | 1 | 0 |
| shell item snapshot persistence functions | 1 | 0 |

The ten remaining shell API requests belong to unopened profile/social/auth
and discovery boundaries, not inquiry.

## Verification

Candidate results:

- the uninterrupted full verifier passed all 61 checks, including strict
  frontend and API typechecks, the optimized Next production build, production
  hydration, migration proof, compatibility routes, security, state
  convergence, persistence, and structural boundaries;
- architecture dependency and authority checks passed, including acyclic
  feature dependencies and the exact 85/116 route surface;
- bounded bootstrap, feed, detail, profile-activity subject hydration, and
  public projection checks passed;
- routing and normalized entity-store checks passed;
- API-client and mutation-envelope checks passed;
- item mutation, action-state, inquiry reconciliation, and cross-tab ordering
  checks passed;
- the browser canary passed all 6 scenarios outside the macOS Chromium sandbox,
  including concurrent local writes, canonical routing and browser history,
  stable Paper and Thought design assignments, viewport constraints, and
  titleless Thought create/edit/reload;
- the isolated PostgreSQL 17/filesystem integration passed all 65 migrations,
  comprehensive writes, authorization, public/private/range delivery,
  idempotency receipts, audit/events, restart persistence, and deterministic
  cleanup;
- the database run exposed and this checkpoint removes a probabilistic
  signature-tampering test flaw: a valid signature ending in `0` was previously
  replaced with the same character instead of always being corrupted;
- dependency audit reported zero known vulnerabilities;
- the durable proof suite and `git diff --check` passed; and
- the protected user-owned canary-server copy remained unmodified at
  `9ca3d8239ffb43186453d70feb5b5d8e4f023d9dc3ec411abc82c687197e2b4a`.

Exact committed-SHA CI and hosted verification are appended after push.

## Next authority

C3 should replace the eight remaining non-search shell API calls and their surrounding
profile/social ownership as one slice: profile reads and saves, following,
profile activity pagination and cache, abort/stale response policy, live
profile/follow merge, profile cross-tab delivery, and profile projection into
inquiry through the existing typed bridge. C4 should absorb the two discovery
search calls, then reduce the shell to authentication, global event routing,
and composition before retiring or renaming the legacy entrypoint.
