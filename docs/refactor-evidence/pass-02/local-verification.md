# Pass 02 local verification

This record began as the pre-release worktree ledger and is now reconciled to
the exact released Pass 02 SHA. Local proof is recorded here; exact CI,
deployment, and production readback are recorded separately in
`release-evidence.md`.

## Identity and boundary

| Field | Evidence |
| --- | --- |
| Baseline | `10fdc8fd2952a61ad3b47a86988926c8825c74b6` |
| Branch | `codex/refactor-pass-02` |
| Released SHA | `59fe7dc4bc992f0f38c556a2cf16b5f33d53b73a` |
| Local runtime | Node `v24.16.0`; npm `11.13.0` |
| Lockfile SHA-256 | `c1959c39fad39b26072430ff86b6271910d07ea0823d83be0705f593da52271e` |
| Route surface | 85 files / 116 methods, unchanged |
| Migration manifest | 64/64; latest `0064_authored_artifact_design_assignments` |
| Schema or migration changed | No |
| Backend domain repository changed | Yes; shared post-conversation selection/hydration only, with domain semantics preserved |
| Design or style changed | Presentation ownership and stylesheet names changed; approved rendered design did not |
| Assistant capability changed | No |
| Unrelated material | `output/` and `scripts/browserCanaryServer 2.ts` remain untouched and uncommitted |

The released implementation centralizes request mapping, live forwarding,
Assistant transport wrappers, Workspace live/local wrappers, protected
attachment delivery, atomic local JSON writes, seed normalization, and
post-conversation read/hydration. It preserves explicit domain routes, local
preview behavior, persistence formats, and authored visual behavior.

## Canonical worktree source result

| Metric | Baseline | Released SHA | Delta |
| --- | ---: | ---: | ---: |
| Files | 461 | 468 | +7 |
| Physical lines | 128,349 | 126,778 | −1,571 |
| Nonblank lines | 120,121 | 118,710 | −1,411 |
| Production | 91,513 | 90,837 | −676 |
| Styles | 17,615 | 16,283 | −1,332 |
| Checks and tools | 19,221 | 19,658 | +437 |

The exact clean CI checkout reproduced this result. The checked-in pass ceiling
is ratcheted to 126,778; a later pass must deliberately lower it again after
its exact candidate is known.

## Local proof

| Gate | Result | Scope |
| --- | --- | --- |
| Route signature lock | Passed | Exact 85-route/116-method method, runtime, and dynamic signatures against the baseline |
| Focused transport checks | Passed | Mapper, actor, protected boundary, direct/fallback, response-loss hash parity, proxy headers, status, body, and failures |
| Domain checks | Passed | Existing post, comment, profile, community, Workspace, messaging, attachment, Assistant, opportunity, revision, sync, and persistence checks |
| Full verification | Passed 56/56 locally and in exact-SHA CI | Includes frontend/API typechecks, optimized production build, and production hydration check |
| Browser canary | Passed 5/5 locally and in exact-SHA CI | Isolated disposable local preview; no skipped, flaky, unexpected, console, page, request, or hydration failures |
| Extended presentation audit | Passed | Sixteen representative routes, Day/Night overlays, composer/search, and mobile overflow |
| Exact candidate source check | Passed | 468 files / 126,778 physical / 118,710 nonblank |
| Clean-checkout repetition | Passed | GitHub run `30510959884`, exact SHA, pristine tracked tree after proof |

The route-handler response-loss harness invokes current post/comment handlers
behind the browser client and compares direct and same-origin targets,
serialized receipt-hashed bodies, actor headers, idempotency behavior, and
responses. It covers titleless Thought, Paper, proposal, Opportunity,
post/comment create/update/delete/action/read, conflicting actors, legacy
action metadata, and malformed or missing delete bodies.

Protected Workspace attachment fixtures prove valid live redirect, exact
upstream denial passthrough, and malformed-success `502` fail-closed behavior.
Proxy fixtures prove strict-production unavailability, development local
selection, token/actor/idempotency forwarding, safe response headers,
bodyless status handling, and unreachable-backend failure.

## Browser proof

The five canaries prove:

1. first-session entrance into isolated local preview;
2. canonical route hydration, PDF rendering, in-app history, and Back;
3. stable Paper and titleless-Thought muse/caricature identity through theme
   change and reload;
4. desktop and mobile authored-artifact overflow containment;
5. titleless Thought creation, editing, reload readback, and a fresh-context
   canonical GET asserting persisted design IDs and matching DOM identity.

The browser proof does not cover Thought deletion, Paper mutation, comments,
replies, attachment lifecycle, community membership, Workspace mutations,
profile mutation, controlled live provider behavior, two authenticated tabs,
or process restart. Fresh browser context proves a new client session reading
the same local server state; it is not process-restart proof.

## Evidence limits

Local and clean-CI checks do not prove:

- production Clerk authentication or private multi-session visibility;
- a real Postgres transaction, receipt replay, qualified-view increment,
  durable event, or cross-process SSE delivery;
- Redis or R2 lifecycle against live providers;
- ongoing GitHub enforcement beyond the observed successful exact-SHA run;
- provider runtime logs, sustained latency, or saturation;
- production writes.

Fastify domain contracts and migrations were unchanged; post/comment
repository internals gained a shared conversation read/hydration kernel.
Existing domain checks remain preservation evidence, not a new live-database
exercise. No production content was mutated to manufacture proof.

## Local decision

| State | Result |
| --- | --- |
| Implemented | Yes |
| Locally verified | Yes |
| Exact candidate verified | Yes, `59fe7dc4bc992f0f38c556a2cf16b5f33d53b73a` |
| Clean exact-SHA verified | Yes |
| CI verified | Yes |
| Pushed | Yes, exact SHA on `main` |
| Deployed | Yes, exact SHA on Render and Vercel |
| Production verified | Yes within the explicit read-only boundary |

Decision: the exact candidate cleared local, clean-CI, deployment, readiness,
and read-only production gates. The authenticated Render runtime-log review and
deliberately destructive or mutating production probes were not performed and
must not be inferred.
