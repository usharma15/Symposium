# Pass 04 checkpoint 09 — C4 discovery authority

## Verdict

C4 replaces the last shell-owned feature requests with one typed discovery
authority. Global overlay search and selected-community feed search now share
request, cancellation, stale-response, entity-merge, and viewer-isolation
policy without introducing a global store or changing the search API.

This is a structural checkpoint, not Pass 04 completion. The repository is
487 tracked source files / 127,886 physical / 119,783 nonblank lines: 527
physical and 501 nonblank lines above C3, and 12,887 physical lines above the
114,999 Pass 04 gate. The user continued the architecture-first sequence with
rigorous verification; no LOC reduction credit is claimed. The exact
operational ceiling is raised to the candidate so CI remains fail-closed
against unreviewed growth.

## Authority replaced

Before C4, `SymposiumExperience` directly owned:

- global and community `/api/search` requests;
- global overlay query, loading, and remote-result state;
- community result-ID and loading state;
- duplicate local title, content, and profile fallback derivation;
- remote title/content partitioning; and
- search-specific bounded entity merging.

After C4:

- `features/discovery/useDiscoveryController.ts` is the single global and
  community request/state authority;
- `features/discovery/discoveryModel.ts` owns pure local and remote projection,
  title/content partitioning, recency ordering, canonical profile
  reprojection, and viewer-scoped result keys;
- both remote flows are debounced, abortable, and exposed only when their
  actor/query/community key matches the current view;
- failed remote reads fall back to the same local projection without hiding
  valid already-loaded content;
- returned posts and profiles still enter the inquiry/profile authorities
  through the typed bounded-read port;
- `SearchModal` consumes the discovery result contract directly; and
- `SymposiumV0.tsx` has zero direct `symposiumApi.request` calls and no
  search-result state or local fallback implementation.

## Security and correctness finding

The replacement audit found that the old remote-result identity contained only
the query. During an authenticated identity transition, a same-query render
could therefore transiently reuse viewer-scoped action projection or
community result IDs from the previous actor until revalidation completed.
C4 keys global and community snapshots by normalized actor plus query (and
community where applicable), aborts the superseded request, and immediately
falls back to the current local projection. No previous-viewer result is
eligible for the new viewer.

## Preserved contracts

The cutover preserves:

- the exact `/api/search` and `/v1/search` request/response schemas;
- 250 ms request debounce, global limit 16, and community limit 50;
- PostgreSQL full-text ranking order inside result groups;
- local-preview title, body, comment, and profile matching;
- title matches before content/comment matches;
- published-recency ordering for local fallback;
- global exclusion of non-Paper community posts;
- canonical-public Paper discovery even from a community;
- selected-community membership/privacy projection;
- deleted post/comment exclusion;
- current-profile replacement of sparse search profiles;
- canonical post/profile navigation;
- search-derived AI Tablet context without expanding Assistant capability; and
- every provider, schema, migration, persistence, live-sync, design, and
  authored-artifact boundary.

## Structural evidence

| Measure | Before C4 | After C4 |
| --- | ---: | ---: |
| `SymposiumV0.tsx` lines | 2,722 | 2,585 |
| direct shell `symposiumApi.request` calls | 2 | 0 |
| shell discovery effects | 2 | 0 |
| shell discovery state setters | 6 | 0 |
| duplicate shell local-search projections | 2 | 0 |
| typed discovery authority modules | 0 | 2 |
| browser canaries | 7 | 8 |

The shell is now a composition orchestrator rather than an HTTP authority. A
later pass may rename, further split, or retire it only after characterizing
authentication lifecycle, the single global live-event router, modal
composition, and view coordination. It must not recreate feature state in a
generic application store.

## Verification

Focused evidence covers:

- local title/content/profile matching and empty-query behavior;
- published-recency fallback ordering;
- private-community, canonical-Paper, and deleted-content policy;
- server ranking preservation;
- canonical current-profile reprojection;
- actor/query/community snapshot isolation;
- abort and stale-response protection;
- bounded entity merging;
- exact API limits and scoping;
- architecture and bounded-read ownership guards; and
- browser-level rapid global queries, canonical result links, selected
  community search, request parameters, and zero client diagnostics.

Aggregate local evidence:

- the uninterrupted verifier passed all 62 stages, including both no-unused
  typechecks, the optimized production build, and production hydration;
- the proof kernel passed source-inventory, verification-runner,
  browser-report, browser-server, and proof-typecheck self-tests;
- `npm audit --audit-level=high` reported zero vulnerabilities;
- isolated PostgreSQL 17/filesystem integration applied all 65 migrations,
  passed comprehensive writes, authorization, receipts, audit/events, range
  delivery, restart persistence, and deterministic cleanup with zero remaining
  object files; and
- all eight serial clean-room browser canaries passed once, without skip,
  retry, flake, page error, console error, or unexpected request failure, and
  the exact JSON report passed its governance check.

Exact-SHA CI and hosted release evidence are appended at release. The protected
user-owned canary-server copy remains outside the candidate with SHA-256
`9ca3d8239ffb43186453d70feb5b5d8e4f023d9dc3ec411abc82c687197e2b4a`.
