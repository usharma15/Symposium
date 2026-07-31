# Messaging browser authority pass

## Control record

| Field | Value |
| --- | --- |
| Status | Released, protected-CI green, and exact-SHA production verified |
| Exact released baseline | `8cb445f4a05220970caf940046d1c8520eca1af2` |
| Exact merge SHA | `0edc8131476c0f09987fb1b03b202a4d6b641980` |
| Baseline inventory | 484 files / 132,456 physical / 124,197 nonblank |
| Candidate inventory | 487 files / 132,915 physical / 124,617 nonblank |
| Candidate delta | +3 files / +459 physical / +420 nonblank |
| Candidate categories | 91,132 production / 16,200 styles / 25,583 checks and tools |
| Runtime scope | Browser Messaging transport and local draft persistence authority |
| API schema impact | None |
| Database or migration impact | None |
| Design impact | None intended or accepted |
| Product capability impact | None intended or accepted |
| Unrelated material preserved | `output/`; `scripts/browserCanaryServer 2.ts` |

## Demonstrated structural problem

`features/messages/MessagesSection.tsx` constructed every Messaging endpoint,
request method, request body, cursor, actor query, revision, and idempotency
scope while also owning live reconciliation, recovery, draft persistence,
send ordering, and rendering. The same presentation module directly read and
wrote browser localStorage. Changing an endpoint or draft recovery behavior
therefore required auditing a 2,700-line mixed-responsibility component.

This was a material feature-safety problem and satisfied the governing rule
for reopening infrastructure work. File length alone was not used as the
justification.

## Candidate cutover

- `features/messages/messagingGateway.ts` is the single injectable transport
  authority for 23 Messaging operations and protected attachment URLs.
- `features/messages/messageDraftStorage.ts` is the single browser authority
  for draft keys, validated reads, writes, deletion, storage failure, and
  ordered failed-send recovery.
- Transport error classification and canonical draft-conflict decoding live
  beside the gateway instead of presentation.
- `MessagesSection.tsx` retains the exact UI, orchestration, live projection,
  recovery, send queue, and upload workflow, but contains no raw Messaging API
  route and no direct localStorage access.
- `scripts/messagingGatewayCheck.ts` exercises every gateway method, route,
  verb, actor/cursor encoding, revision body, idempotency generation, conflict
  decoding, retry classification, and draft-storage success/failure path.
- `scripts/architectureBoundaryCheck.ts` makes the ownership cutover
  regression-resistant.

## Verification ledger

The candidate has passed the following gates:

- `npm run messaging-gateway:check` — 46 assertions;
- `npm run architecture:check`;
- `npm run messaging:check`;
- `npm run client-recovery:check`;
- `npm run assistant-evidence:check`;
- `npm run typecheck:all`; and
- `git diff --check`.

Complete evidence:

- `npm run verify` — 68/68 stages, including the optimized production build,
  both TypeScript programs, production hydration, security, recovery,
  persistence, live transport, and every product/domain check;
- `npm run proof:check` — source inventory, observable verification-runner,
  browser-report, browser-server, and proof-TypeScript self-tests;
- isolated tracked-tree `npm run browser:canary` — 11/11 scenarios in 1.2
  minutes with exact report integrity, including first/returning sessions,
  route/history, Paper/Thought identity, desktop/mobile layout, social state,
  discovery races, live routing, offline replay, simultaneous local writes,
  and durable titleless Thought create/edit/reload;
- isolated `npm ci` audit — 0 package vulnerabilities; and
- interactive working-tree browser smoke — Quick Messages opened, the full
  `/messages` route rendered one Messaging shell, live data remained
  connected, the new-chat `plato` search returned the canonical profile
  through the gateway, and the browser log contained no warning or error.

The first sandboxed canary invocation could not launch Chromium because macOS
denied its process rendezvous; its non-browser concurrency case still passed.
The exact candidate was rerun outside that restriction, where all 11 browser
cases executed and passed. This is recorded as an execution-environment
precondition, not counted as an application pass or failure.

Release evidence:

- merged through protected [PR #3](https://github.com/usharma15/Symposium/pull/3);
- post-merge GitHub run `30662040958` passed every job and retained both
  evidence artifacts with SHA-256 digests;
- Vercel production reported the exact merge SHA Ready and Current;
- Render deployment `dep-d9mg5nc9v7es73bmj870` reported the exact merge SHA
  live and strict-ready with 65/65 migrations, every required provider
  healthy, and zero readiness issues or warnings;
- production API smoke passed across health, bootstrap, communities, calls,
  opportunities, and validation; and
- the deployed Messaging UI remained live-connected, returned the canonical
  `@plato` profile through the gateway search, and logged no browser warning
  or error.
