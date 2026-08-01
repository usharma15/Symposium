# Authenticated multi-actor live-sync proof pass

## Control record

| Field | Value |
| --- | --- |
| Baseline | `fa14e04c3a9bfc4c94c76756d24119218bcf2855` |
| Scope | Authenticated public convergence, private isolation, durable reconnect replay, persistence readback, and automatic cleanup |
| Product boundary | No route, schema, migration, authorization, persistence, presentation, or runtime live-event behavior change |
| Implementation status | Implemented; exact release evidence is recorded after protected-main integration |

## Authority added

`scripts/authenticatedLiveSyncCanary.ts` is one orchestrator for both the
environment-free verifier and an explicitly authorized credentialed run. It:

- requires strict deep readiness and an exact expected 40-character backend
  release before the first mutation;
- requires two different Clerk bearer tokens and verifies that they resolve to
  two different canonical actor handles;
- opens actor-A, actor-B, and anonymous SSE streams through the supported
  `/v1/events/stream` route;
- proves public post and cross-actor comment delivery exactly once across all
  three streams, then reads the canonical comment back as both actors;
- disconnects actor B, performs a mutation, resumes from actor B's last cursor,
  and requires the missed event exactly once without a page reload;
- creates an owner-only Workspace draft, uses a later public event as an ordered
  privacy barrier, and proves actor B and the anonymous stream did not receive
  or read the draft;
- deletes every namespaced draft, comment, and post on the success path and in
  `finally` after a failure; and
- reports only the release, generated run label, named checks, aggregate
  latency, and cleanup disposition. It does not report tokens, handles,
  content, or object identifiers.

The canary has no development-actor mode and no production authentication
bypass. Short-lived session tokens remain runtime-only environment values.

## Adversarial permanent proof

`scripts/authenticatedLiveSyncCheck.ts` supplies a deterministic in-memory
HTTP/SSE fixture to the same orchestrator. The positive control proves the
complete sequence and zero remaining live fixture artifacts. Negative controls
then inject:

1. duplicate delivery during actor B's durable replay; and
2. actor A's private event into actor B and anonymous streams.

Both faults must be detected, and both failing runs must still remove every
created artifact and close every stream. `authenticated-sync:check` is included
in the state-sync category of the canonical 72-stage verifier. The credentialed
`authenticated-sync:canary` command remains separate because it performs real,
namespaced writes and therefore requires explicit acknowledgement.

## Evidence boundary

The deterministic harness is direct proof of orchestration, guards, negative
controls, and failure cleanup. It is not evidence that two real Clerk sessions
were available or that the production-write command ran. A production execution
is recorded only when its exact release, successful redacted report, and
post-cleanup readback are actually observed.
