# Pass 04 checkpoint 11 — C6 session lifecycle authority

## Verdict

C6 removes authentication and entrance transition policy from
`SymposiumV0.tsx`. `features/session/useSymposiumSessionController.ts` now
owns the browser and Clerk effects, while
`features/session/symposiumSessionLifecycle.ts` owns their pure state
transitions and admission predicates.

This is a structural checkpoint, not Pass 04 completion. LOC governance is
explicitly on standby. The repository is 493 tracked source files / 130,206
physical / 122,024 nonblank lines, and the application shell fell from 2,400
to 2,279 lines. The replacement controller, reducer, cache and cross-tab
hardening, proof stage, and browser canary are larger than the retired shell
block. No repository LOC reduction credit is claimed. The operational source
ceiling is raised only to keep unreviewed drift fail-closed.

## Authority replaced

Before C6, `SymposiumExperience` directly owned:

- independent entry mode, account-synced, authentication-error, and
  browser-hydration state;
- the five-second approach timer and browser-session completion marker;
- Clerk account synchronization, cached identity admission, and refresh
  scheduling;
- local-preview admission and authenticated storage cleanup;
- sign-out, entrance replay, and presentation-mode policy; and
- separately derived read, social-hydration, and live-event gates.

After C6:

- `useSymposiumSessionController` owns all browser, provider, storage, timer,
  abort, and exact-user orchestration;
- `reduceSymposiumSessionLifecycle` owns the explicit loading, approach, auth,
  and complete transitions plus pending and committed user identities;
- the profile controller exposes only narrow identity and canonical-bootstrap
  ports with abort and commit guards;
- the shell supplies environment and identity ports, then consumes typed
  entry, read, social, live, and cache-scope projections;
- entrance helpers no longer coexist with lifecycle policy in
  `features/entrance/browserSession.ts`; and
- Assistant reads, queued profile live refreshes, live buffers, cached
  bootstrap state, and entity cross-tab transports follow the session
  authority's current-viewer gates.

## Security and correctness findings

The prior implementation canceled its own effect with a boolean, but an
account response could still mutate profile state before that cancellation
was observed. It also considered a cached identity sufficient without
modeling which Clerk user was committed. A direct A-to-B account replacement
could therefore retain A's shell while B synchronized.

C6 gives every account attempt an abort controller, monotonic epoch, exact
user predicate, pending user identity, and guarded profile commits. Direct
replacement clears A's authenticated identity and cached acceleration state,
masks the shell, synchronizes B, loads B's canonical bootstrap, and only then
admits B. Delayed A cache, success, failure, transport, or read-model
completion cannot admit A.

Production smoke exposed the analogous first-load edge: the server knew a
returning request was authenticated but supplied no exact user/profile
projection, so the shell could briefly render the default profile before
client Clerk resolution. Returning authenticated sessions now remain on the
stationary loading surface, with live delivery suspended, until the exact
client user and that user's scoped cache or canonical identity are admitted.

A second audit found that the general bootstrap cache and entity cross-tab
channels were browser-wide. Those projections can contain viewer-specific
membership and action state. C6 stores authenticated bootstrap data with an
exact Clerk-user scope, rejects legacy or mismatched data for authenticated
sessions, purges it on identity retirement, and namespaces inquiry, profile,
and analytics cross-tab transports by exact viewer. An unresolved viewer has
no such transport. Legacy unscoped cache remains compatible only with local
preview.

## Preserved contracts

The cutover preserves:

- server-coordinated first versus returning browser-session decisions;
- one five-second first-session entrance and stationary authentication
  background;
- canonical route hydration and late-authentication route preservation;
- exact-user cached identity acceleration and non-blocking canonical
  revalidation for an unchanged viewer;
- local-preview seed, legacy-cache, refresh, persistence, and entrance
  behavior;
- browser-storage quota tolerance and best-effort cleanup;
- canonical Clerk `/auth/sync`, profile selection, and bootstrap behavior;
- sign-out cleanup followed by entrance replay;
- live-event authentication scope and bounded private buffers;
- viewer-scoped profile activity and social cache keys; and
- every existing API, migration, persistence, design, provider, and Assistant
  capability boundary.

## Structural evidence

| Measure | Before C6 | After C6 |
| --- | ---: | ---: |
| `SymposiumV0.tsx` lines | 2,400 | 2,279 |
| shell session state variables | 5 | 0 |
| shell entrance/auth effects | 3 | 0 |
| shell entrance timers and sync refs | 5 | 0 |
| shell session storage policy | 1 distributed block | 0 |
| typed session controller/model modules | 0 | 2 |
| verification stages | 63 | 64 |
| browser canaries | 9 | 10 |

## Verification

Focused evidence covers:

- every reducer transition and admission predicate;
- first, returning, local-preview, signed-in, signed-out, failure, and replay
  paths;
- exact-user cache hits and mismatched or legacy authenticated cache
  rejection;
- A-to-B presentation masking and canonical-bootstrap admission;
- stale A cache, success, and post-failure completion rejection;
- abort and commit guards around account sync and bootstrap reads;
- exact-viewer cross-tab namespaces and unresolved-viewer suspension;
- queued live refresh and Assistant read suppression while reads are gated;
- single authority ownership and acyclic feature dependency direction; and
- a browser sign-out that removes the current shell, replays the entrance,
  and requires deliberate re-entry before the profile shell returns.

The local release candidate passed:

- all 64 aggregate verification stages, including production build and
  hydration;
- all 10 isolated browser canaries in 1.2 minutes;
- PostgreSQL 17 plus all 65 migrations, comprehensive filesystem/API writes,
  authorization, receipts, audits, events, ranges, restart persistence, and
  deterministic deletion with zero remaining object files;
- the independent proof kernel and proof TypeScript project;
- `npm audit --audit-level=high` with zero vulnerabilities; and
- staged and unstaged whitespace checks.

The first clean CI attempt exposed and retained a pre-existing nondeterministic
storage-signature assertion: replacing the last character with `0` did not
tamper a valid signature that already ended in `0`. The assertion now always
chooses a different terminal character and explicitly proves the candidate
differs before verifying rejection.

Clean CI and exact-SHA hosted frontend/API evidence must be verified after the
candidate is committed and pushed. The protected user-owned canary-server copy
remains outside the candidate at SHA-256
`9ca3d8239ffb43186453d70feb5b5d8e4f023d9dc3ec411abc82c687197e2b4a`.
