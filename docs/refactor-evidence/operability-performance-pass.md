# Operability and measured-performance pass

## Control record

| Field | Value |
| --- | --- |
| Baseline | `9bd80cf6bb46b4434a8162b7787e26d34a36fd24` |
| Scope | Rolling request/live-stream health, repository-owned production watch, and one measured bootstrap critical-path optimization |
| Product boundary | No schema, product capability, presentation, authorization, persistence, or live-event contract change |
| Status | Initial implementation released through PR #8 as `c820ab1a25706f1e81524a0c1d2b25eaf9cddca4`; production-discovered alert calibration pending protected release |

## Measured baseline

Three public production bootstrap observations were recorded against the exact
baseline before implementation:

| Observation | End-to-end | Server total | Summed DB | Queries | Payload |
| --- | ---: | ---: | ---: | ---: | ---: |
| first observation | 2.099 s | 1,788.84 ms | 968.09 ms | 7 | 191,342 bytes |
| warm observation 1 | 0.997 s | 433.71 ms | 595.26 ms | 7 | 191,342 bytes |
| warm observation 2 | 0.859 s | 431.58 ms | 593.84 ms | 7 | 191,342 bytes |

The measurements are a reproducible spot baseline, not a p50/p95/p99 claim.
They established that query count, response size, and wall time remained within
their budgets, while the first observation's summed database time exceeded the
900 ms route budget by 7.6%. They also showed avoidable serial tail work:
required-profile resolution completed before independent community-call
projection began.

## Cutover

### Request operability

`apps/api/src/services/operability.ts` retains at most 512 privacy-safe request
samples for a rolling fifteen-minute window. It reports aggregate request,
server-error, query-error, budget-violation, latency, database-duration,
response-size, and maximum-budget-utilization state. It retains no URL query,
request body, actor, token, cookie, message, draft, or evidence content.

The API records every completed request-cost snapshot into that bounded owner.
`/readyz` exposes only the aggregate `nominal`, `degraded`, or `unobserved`
state and distribution data. Server or database-query errors degrade
immediately. Request-budget violations remain visible individually; status
degrades after two violating requests in the window or one sample at 125%
utilization. This preserves the signal without converting one marginal cold
sample into a global production failure.

### Live-stream operability

`apps/api/src/services/liveStreamRegistry.ts` replaces route-local stream
capacity state. It remains the exact 12-stream-per-client / 500-stream-process
authority and now records active/peak streams, total and resumed connections,
capacity rejection, replayed events, replay failure/truncation, and recent
privacy-safe delivery problems. No client key is returned by readiness.

The SSE route records capacity rejection, replay pages, replay failure,
truncation, pending-live backlog, and socket backpressure/write failures. The
durable cursor, event visibility, initial replay, heartbeat, live publication,
and disconnect behavior are unchanged.

### External production watch

`.github/workflows/production-watch.yml` runs every two hours and on manual
dispatch. It verifies:

- public web and database-silent readiness HTTP success;
- five-second availability TTFB ceilings;
- CSP, HSTS, and content-type security headers;
- strict readiness, zero issues, zero warnings, and zero pending migrations;
- a valid Render release identity on scheduled runs, with optional exact expected
  backend SHA enforcement on manual release-time dispatch;
- presence and non-degraded request/live-stream operability state; and
- retained 30-day evidence on every run, including failures.

The scheduled path deliberately never requests `/v1/bootstrap` or probes the
database, so the monitor does not defeat Neon idle scaling.

### Bootstrap critical path

`getBoundedBootstrap()` now starts required-profile and community-call
projection together after the feed/community prerequisites resolve. Query
count, response shape, visibility, ordering, caller identity, and fallback
behavior are unchanged. The optimization removes one avoidable serial await;
no speculative repository split or cache was introduced.

## Permanent proof

- `operability:check` proves nominal/degraded/window-expiry behavior,
  percentile calculation, the 512-sample memory bound, live capacity/release,
  replay/problem counters, privacy-safe output, readiness wiring, scheduled
  idle safety, and parallel bootstrap tail ownership.
- `live-transport:check` retains the exact 500-listener event-bus contract and
  the existing cursor/replay/recovery matrix.
- `provider-cost:check` retains request budgets, database timing attribution,
  startup priming, idle-safe maintenance, and readiness probe behavior.
- The canonical verification manifest contains 71 stages and includes the new
  operability gate.

## First release observation

PR #8 merged as `c820ab1a25706f1e81524a0c1d2b25eaf9cddca4`; Vercel and
Render both reported that exact release. Strict readiness reported all 65
migrations applied, none pending, and no configuration issues. The deep smoke
returned the complete public world and every contract probe passed.

The first smoke bootstrap recorded 967.67 ms of summed database time against
the 900 ms budget while finishing in 747.12 ms wall time. Three subsequent
observations retained seven queries and the exact 191,342-byte payload, with
server totals of 400.69 ms, 399.72 ms, and 335.68 ms. That first marginal
budget observation is the production evidence for the alert calibration above;
it was not erased or mislabeled as a successful within-budget sample.

## Limitations

- The in-process rolling window resets on deployment or process restart. Logs
  and retained production-watch artifacts are the durable evidence paths.
- A repository-owned scheduled watch is not a full error-analysis service or
  long-retention metrics warehouse.
- Public checks cannot prove authenticated multi-actor permissions or measure
  commit-to-render latency for a real remote user session.
- The API remains single-process for low-latency publication. Horizontal scale
  still requires a non-Postgres fanout transport while retaining durable cursor
  replay.
- Post-release before/after bootstrap observations and the exact merge SHA must
  be appended only after the protected release completes.
