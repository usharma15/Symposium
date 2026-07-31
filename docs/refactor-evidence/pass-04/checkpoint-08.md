# Pass 04 checkpoint 08 — C3 profile and social authority

## Verdict

C3 is implemented as a complete profile/social authority replacement. One
typed profile controller now owns profile and bootstrap reads, authenticated
identity projection, settings writes, following state, social-list caching,
profile and follow convergence, profile cross-tab delivery, and composition
with inquiry through narrow typed ports. Its profile-activity subcontroller
owns scoped pagination, request deduplication, abort and stale-response policy,
bounded subject hydration, viewer-scoped caches, optimistic totals, canonical
rollback/commit checks, and live reconciliation.

This is a structural checkpoint, not Pass 04 completion. The user explicitly
set LOC aside for this slice. The repository is 484 tracked source files /
127,359 physical / 119,282 nonblank lines: 1,033 physical and 1,008 nonblank
lines above C2, and 12,360 physical lines above the 114,999 Pass 04 ceiling. No LOC
reduction credit is claimed. The exact operational ceiling is raised to the
candidate so CI remains fail-closed against unreviewed growth.

## Authority replaced

Before C3, `SymposiumExperience` directly owned:

- bootstrap, authentication-sync, profile, follow, and profile-activity API
  calls;
- current and selected profile projection;
- following and social-list state plus local persistence;
- profile and follow mutation coordinators;
- profile live merges and profile cross-tab transport;
- profile-activity caches, cursors, aborts, stale-request isolation, recency,
  optimistic actions, and canonical convergence.

After C3:

- `features/profiles/useProfileController.ts` is the single profile, identity
  projection, settings, follow, social-list, cache, live, and cross-tab facade;
- `features/profiles/useProfileActivityController.ts` is its bounded activity
  subauthority;
- `features/profiles/profileActivityModel.ts` owns pure activity scope, key,
  paging, and timestamp policy;
- `features/profiles/profileTypes.ts` owns the feature contract previously
  declared inside the view;
- `features/profiles/profileControllerPorts.ts` limits cross-domain
  composition to explicit inquiry and community operations;
- the shell has zero direct `/api/bootstrap`, `/api/auth/sync`,
  `/api/follows`, or `/api/profiles` requests;
- the shell has zero profile/follow mutation coordinators, profile cross-tab
  transport, profile caches, or profile/social/activity state setters; and
- architecture, bounded-read, entry-session, provider-cost, and
  profile-activity checks inspect the new owner and fail if retired shell
  authority returns.

The two remaining shell API calls are both discovery searches. They are
reserved for C4.

## Preserved contracts

The cutover preserves:

- the exact 85 Next compatibility-route modules and 116 exported HTTP methods;
- every bootstrap, profile, profile-activity, follow, and auth-sync request and
  response shape;
- exact Clerk-user cached identity isolation;
- current-profile precedence during late bootstrap and authentication;
- optimistic profile save and follow/unfollow behavior;
- idempotency, retry retention, pending-mutation protection, and monotonic
  profile/follow revisions;
- BroadcastChannel-first profile synchronization plus storage-event fallback;
- viewer-scoped profile-activity and social-list cache isolation;
- durable local-preview follow hydration across reload without treating the
  intentionally empty compatibility response as canonical social state;
- independent action and authored-comment cursors;
- rapid profile-filter request isolation and 15-second activity aborts;
- sparse subject hydration and detail-loaded comment retention;
- exact activity totals, privacy filtering, and optimistic total transitions;
- the single global live subscription and existing live event routing;
- Paper titles, titleless Thoughts, design assignments, attachments, quotes,
  Patronage, Opportunities, and every approved visual; and
- provider, schema, migration, database, storage, Assistant, and Design Lab
  boundaries.

No public behavior, persistence contract, schema, migration, provider call,
visual, authored artifact, or Assistant capability changed.

## Structural evidence

| Measure | Before C3 | After C3 |
| --- | ---: | ---: |
| `SymposiumV0.tsx` lines | 3,899 | 2,722 |
| direct shell `symposiumApi.request` calls | 10 | 2 |
| direct shell profile/bootstrap/auth/follow/activity requests | 8 | 0 |
| shell profile mutation coordinators | 1 | 0 |
| shell follow mutation coordinators | 1 | 0 |
| shell profile cross-tab transports | 1 | 0 |
| shell profile/social/activity state authorities | 1 combined block | 0 |
| typed profile controller modules | 0 | 5 |

The repository grew because C3 replaced implicit shell closures with explicit
typed ports, dedicated controllers, and enforcement checks while retaining
every behavior. This is intentional under the user-authorized
architecture-first priority and is not represented as reduction.

## Verification

Candidate results:

- the uninterrupted full verifier passed all 61 stages, including frontend and
  API no-unused typechecks, the optimized Next production build, production
  hydration, security, route-surface preservation, mutation ordering,
  reconciliation, cross-tab behavior, local persistence, and profile privacy;
- architecture checks proved a single profile/social/activity authority, zero
  retired shell endpoints, acyclic feature dependencies, and the exact 85/116
  route surface;
- profile checks passed scoped paging, rapid-filter isolation, sparse comment
  hydration, exact totals, optimistic transitions, live reconciliation, and
  private-community visibility boundaries;
- follow reconciliation passed pending follow and unfollow protection,
  revision commitment, stale rejection, rollback rejection, and newer
  external convergence;
- entry-session checks passed non-blocking bootstrap/activity, cached identity
  isolation, persisted-viewer hydration, and bounded viewer-scoped profile
  projections;
- provider-cost and bounded-read checks passed against the new activity owner;
- dependency audit, durable proof, isolated PostgreSQL/filesystem integration,
  browser canary, exact-SHA CI, and hosted verification are recorded at release;
  and
- the protected user-owned canary-server copy remains outside the candidate and
  must retain SHA-256
  `9ca3d8239ffb43186453d70feb5b5d8e4f023d9dc3ec411abc82c687197e2b4a`.

## Next authority

C4 should absorb the two discovery search calls and their query/result state
behind a typed discovery controller. It should then reduce the legacy shell to
authentication lifecycle, one global live-event router, and composition,
before deciding whether the remaining orchestrator should be renamed or
retired. No generic global store or cross-domain request executor should be
introduced.
