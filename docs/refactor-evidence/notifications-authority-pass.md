# Notifications browser authority evidence

## Control record

| Field | Value |
| --- | --- |
| Status | Main-integrated, full-verifier, and browser verified change; exact-SHA deployment and production proof pending |
| Branch | `codex/notifications-browser-authority` |
| Exact baseline | `c4a7a44d56d4ef721bdebd62773705a664f91d24` |
| Baseline inventory | 487 files / 133,029 physical / 124,722 nonblank |
| Candidate inventory | 489 files / 133,436 physical / 125,100 nonblank |
| Candidate delta | +2 files / +407 physical / +378 nonblank |
| Schema, migration, provider impact | None |
| UI, CSS, product-capability impact | None |
| Protected unrelated material | `output/`; `scripts/browserCanaryServer 2.ts` remained untouched and unstaged |

## Structural result

`features/notifications/notificationGateway.ts` is the only browser transport
authority for Notifications. Its injectable factory owns eight domain
operations and nine concrete request shapes across list, unread count,
preferences, single/all read, and single/clear-read archive behavior.

`features/notifications/NotificationsPanel.tsx` now consumes those operations.
It contains no `symposiumApi`, `fetch`, or raw `/api/notifications` route, and
continues to own the same request epochs, bounded retry timers, recovery
refresh, optimistic projection, live-event application, cursor state,
interaction state, navigation, and rendering. No alternate runtime request
path, compatibility route, schema, server handler, event, or database change
was introduced.

## Exact contract proof

`scripts/notificationGatewayCheck.ts` uses an injected recording request and
asserts:

- every domain operation maps to one exact request;
- actor, cursor, limit, notification ID, and group key survive encoding;
- first-page requests omit an empty cursor;
- list, unread, and preference reads remain `no-store`;
- all mutation verbs and bodies retain their previous semantics;
- `keepalive` remains exclusive to a single-group read;
- preference revision and one-key changes are preserved;
- resolved values retain identity; and
- 400, 503, offline, and arbitrary rejection objects propagate unchanged.

Permanent architecture and Notifications guards reject raw transport
ownership in the panel and require all gateway operations. The canonical
verification manifest now contains 69 stages, including the gateway check.

## Verification results

| Proof | Result |
| --- | --- |
| Focused gateway, Notifications, architecture, recovery, live-routing, compatibility, and full type checks | Passed |
| Canonical `npm run verify` | Passed 69/69, including optimized Next build and hydration proof |
| Proof-kernel suite | Passed |
| `git diff --check` | Passed |
| Dependency audit | Clean `npm ci` in the browser fixture audited 230 packages; zero vulnerabilities |
| Focused Notifications Chromium canary | Passed |
| Exact staged-tree Chromium suite and report integrity | Passed 12/12; zero skipped, flaky, retried, or unexpected cases |
| Isolated PostgreSQL notification and filesystem harnesses | Not run: `initdb` is absent and no isolated database URL is configured |

The first browser invocation was intentionally attempted inside the managed
sandbox and Chromium was denied macOS Mach-port registration before
application execution. The identical staged candidate was then run with the
required OS permission. Only the permitted run is treated as application
evidence.

The new Notifications browser canary proves closed-panel unread loading,
first-page and encoded-cursor pagination, compact/expanded/settings
navigation, preference read, optimistic successful save, an injected 409
revision conflict and canonical reload, single and all read, single archive,
clear-read, Escape close, exact actor and mutation bodies, and no unexpected
browser diagnostics. Existing Notifications model checks continue to prove
normalization, grouping, live-event projection, unread arithmetic, archive
rules, preference convergence, stale-response protection, and recovery-owner
boundaries.

## Limitations and release boundary

The database harnesses were not pointed at any ambient or production service.
`DATABASE_URL`, `POSTGRES_URL`, and `POSTGRES_PRISMA_URL` were unset, and the
machine has no `initdb`; this is an unavailable proof environment, not a
passing database result. This browser-only authority cutover changes no SQL or
server persistence behavior, but the limitation remains explicit.

Repository publication uses the established verified direct-to-`main` Git
path. Production release completion remains separate: it requires the exact
main SHA in GitHub CI, Vercel, Render, readiness, API, Notifications, and
authenticated browser verification.
