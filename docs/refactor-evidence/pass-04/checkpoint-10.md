# Pass 04 checkpoint 10 — C5 global live-event authority

## Verdict

C5 removes global live-event classification, delivery buffers, transport
composition, and cross-domain invalidation policy from `SymposiumV0.tsx`.
`features/live-sync/useSymposiumLiveController.ts` now owns the one transport
subscription and the bounded consumer buffers, while
`features/live-sync/symposiumLiveEventRouter.ts` owns the pure routing policy
for every supported event family.

This is a structural checkpoint, not Pass 04 completion. The repository is
490 tracked source files / 128,699 physical / 120,565 nonblank lines: 813
physical and 782 nonblank lines above C4, and 13,700 physical lines above the
114,999 Pass 04 gate. The application shell fell from 2,585 to 2,400 lines,
but the typed replacement, exhaustive routing proof, transport-scope proof,
and browser canary are larger than the retired shell block. No repository LOC
reduction credit is claimed. The exact operational ceiling is raised to the
candidate so CI remains fail-closed against unreviewed growth.

## Authority replaced

Before C5, `SymposiumExperience` directly owned:

- the sole `useLiveEventStream` subscription;
- cross-tab content-analytics invalidation delivery;
- event-family classification and early-return policy;
- 1,000-event messaging and notification buffers;
- the 100-event Assistant buffer;
- inquiry metric, item, deletion, and quote invalidation dispatch;
- profile, follow, and activity dispatch;
- Workspace, Scribble, opportunity-application, community, and fallback
  refresh invalidation; and
- editor teardown when a remotely deleted post or comment was open.

After C5:

- `useSymposiumLiveController` owns the one live transport subscription,
  cross-tab analytics publication, bounded event buffers, browser-domain
  invalidation events, malformed-event recovery, and connection callbacks;
- `routeSymposiumLiveEvent` owns pure ordered event classification and typed
  ports into inquiry, profile, activity, editor, and refresh authorities;
- the shell supplies those narrow ports and consumes the three bounded event
  projections;
- `useLiveEventStream` attaches the captured actor/backend scope to every
  transport callback; and
- `SymposiumV0.tsx` contains no event-kind policy, event buffers, live stream
  hook, or cross-tab analytics transport.

The shell remains the application composition root. Authentication and
entrance lifecycle are the next characterized authority candidate. Ephemeral
modal selection and cross-domain view composition remain legitimate shell
coordination and must not be moved into a generic global store.

## Security and correctness finding

The old transport cursor already reset on actor/backend changes, but the
notification, messaging, and Assistant event arrays lived for the lifetime of
the shell. An authenticated viewer transition could therefore render or
reprocess buffered private events accepted for the previous viewer until a
consumer's own filtering or refresh displaced them.

C5 keys every buffer by the normalized authentication-session key. A new
scope receives an empty projection synchronously, the previous buffer is
retired after the transition, and the first event in the new scope replaces
rather than extends old state. Transport callbacks also carry the scope
captured by their stream or poll effect; a delayed callback from the previous
actor/backend is rejected before routing, connection status, or fallback
refresh. Private live input from one viewer is therefore ineligible for
another viewer.

## Preserved contracts

The cutover preserves:

- one cursor-monotonic SSE stream with the existing polling fallback;
- actor/backend cursor reset, reconnect watchdogs, visibility suspension,
  online/offline recovery, and direct-backend authentication;
- content-analytics invalidation before domain routing and ordered cross-tab
  publication;
- notification delivery without suppressing a canonical item projection;
- bounded tails of 1,000 messaging events, 1,000 notification events, and 100
  Assistant events;
- canonical inquiry/profile validation and sparse-event refresh fallback;
- metric-only convergence without a full bootstrap refresh;
- passive read convergence without profile-activity refresh;
- optimistic action protection and current-actor activity isolation;
- post/comment deletion quote invalidation and editor teardown;
- profile/follow/activity convergence;
- Workspace, Scribble, opportunity-application, community, post, comment,
  profile, and note invalidation policy;
- unknown-event no-op behavior; and
- every API, schema, migration, persistence, cross-tab, design, provider, and
  Assistant capability boundary.

## Structural evidence

| Measure | Before C5 | After C5 |
| --- | ---: | ---: |
| `SymposiumV0.tsx` lines | 2,585 | 2,400 |
| shell live transport hooks | 1 | 0 |
| shell cross-tab analytics transports | 1 | 0 |
| shell event buffers | 3 | 0 |
| shell event validators | 2 | 0 |
| shell event-family policy branches | 1 distributed block | 0 |
| typed global live controller/router modules | 0 | 2 |
| verification stages | 62 | 63 |
| browser canaries | 8 | 9 |

## Verification

Focused evidence covers:

- every ordered routing branch and early-return contract;
- canonical and malformed inquiry/profile projections;
- metric-only, passive-read, action, follow, deletion, and sparse-event paths;
- current-viewer action isolation and stale optimistic projection rejection;
- notification-plus-item routing;
- bounded Assistant, message, and notification buffers;
- synchronous viewer-scope hiding, transition retirement, and bounded-tail
  replacement;
- delayed prior-scope transport callback rejection;
- Workspace, Scribble, opportunity, analytics, and unknown-event policy;
- architecture ownership and feature dependency direction; and
- an injected SSE browser event that updates the rendered canonical Paper
  projection without a bootstrap or detail refetch.

Aggregate verification and exact-SHA hosted release evidence are recorded at
release. The protected user-owned canary-server copy remains outside the
candidate and must retain its previous SHA-256.
