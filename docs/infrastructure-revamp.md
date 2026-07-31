# Symposium infrastructure revamp

## Governing contract

This is the current infrastructure program. The historical Pass 04 LOC gate
was retired on July 31, 2026. Source inventory remains exact and reviewable,
but line count is not a release gate, architectural objective, or completion
test. Reduction is credited only when replacement authority makes old code
genuinely obsolete.

The program continues only while a pass does at least one of the following:

- replaces competing authorities with one explicit owner;
- eliminates a demonstrated failure mode;
- makes feature changes materially safer;
- permits superseded infrastructure to be deleted; or
- measurably improves correctness, security, persistence, recovery, or
  operational efficiency.

The program stops when recovery is proven, the shell primarily composes
features, persistence authorities are coherent, superseded compatibility
paths are retired, and exact-SHA local/CI/database/browser/production
verification is green. Moving files, renaming equivalent abstractions,
chasing LOC, or rewriting stable modules after that point is out of scope.

Zero loss of site behavior, persistence, live synchronization, privacy,
security, accessibility, and recoverability remains the highest-order gate.

## Released authority sequence

The released production baseline before the shell-surface pass is
`4b2b613cf0239312634f93802bb93c5b46ac8e43`. It includes:

1. canonical mutation/read-model and local persistence boundaries;
2. canonical view and browser-history authority;
3. inquiry and profile/social authorities;
4. global and community discovery authority;
5. global live-event delivery and routing authority; and
6. exact-user authentication, entrance, cache, read, social, and live
   admission authority; and
7. browser/runtime recovery and reconnect authority.

`components/SymposiumV0.tsx` remains the composition root.
`lib/dataStore.ts` and the direct-Postgres Next compatibility mode remain
transitional and load-bearing until a supported persistence authority
replaces them.

## Recovery and resilience authority

The next bounded cutover owns browser/runtime recovery rather than domain
data:

- one browser coordinator observes online, offline, focus, visibility, page
  restoration, and recoverable transport failure;
- hidden tabs suspend transport synchronously and do not run retry loops;
- recovery produces one monotonic epoch consumed by session bootstrap,
  notifications, messaging, Assistant, analytics, and Scribble refreshers;
- live transport retains its cursor, replays missed durable events, rejects
  stale session callbacks, and uses bounded exponential reconnect backoff;
- session identity sync retries only for the exact current Clerk user, with
  its existing abort controller, epoch, and commit predicate intact;
- authenticated API and live requests fail closed when an exact Clerk token
  is unavailable and never downgrade to browser-supplied handle trust;
- successful transport after a recoverable failure publishes one recovery
  epoch, while duplicate failure notifications are coalesced; and
- domain mutation idempotency, revision conflict, optimistic state, and
  durable retry semantics remain owned by their existing domain authorities.

This authority does not automatically retry unsafe non-idempotent mutations,
invent offline writes, or convert a provider outage into local-preview trust.

## Shell surface authority

Transient surface lifecycle now has one typed reducer and one React
controller. The authority owns the compact Assistant, Assistant origin
context, post composer and destination, quote composer, settings, Quick
Messages and selected conversation, post/comment editors, and dedicated
attachment preview.

The cutover:

- retires ten independent shell state owners and the composer destination
  state that was incorrectly stored in the community domain;
- makes composer visibility and destination, and Quick Messages visibility
  and selected conversation, atomic states;
- centralizes route commit, browser-history restore, session-route reset,
  Assistant expand/collapse, search preparation, and surface open/close
  transitions;
- preserves the existing surface-coexistence contract, including compact
  Assistant context beside the attachment viewer;
- keeps live deletion cleanup guarded by exact post/comment identity; and
- adds a pure transition proof plus architecture guards preventing the old
  shell and community authorities from returning.

Search remains owned by discovery, full Assistant/Messages routes remain
owned by canonical view state, and attachment/PDF content context remains
owned by the corresponding feature controllers.

## Remaining structural sequence

After the shell-surface authority is released:

1. converge supported persistence modes without deleting local development or
   fallback behavior prematurely;
2. retire only compatibility paths proven superseded by those authorities;
3. run the complete exact-SHA proof and stop the revamp when the governing
   completion tests above are satisfied.
