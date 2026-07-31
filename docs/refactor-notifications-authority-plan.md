# Notifications browser authority pass

## Control record

| Field | Value |
| --- | --- |
| Status | Implemented, main-integrated, and locally verified; exact-SHA deployment and production proof pending |
| Exact baseline | `c4a7a44d56d4ef721bdebd62773705a664f91d24` |
| Baseline inventory | 487 files / 133,029 physical / 124,722 nonblank |
| Candidate inventory | 489 files / 133,436 physical / 125,100 nonblank |
| Candidate delta | +2 files / +407 physical / +378 nonblank |
| Runtime scope | Browser Notifications transport ownership only |
| Primary presentation owner | `features/notifications/NotificationsPanel.tsx` |
| Existing state owners | `notificationState.ts`, `notificationPreferences.ts`, browser recovery coordinator, global live controller |
| Server and compatibility owners | Fastify notification routes/repository and the consolidated Next Notifications dispatcher |
| API schema impact | None |
| Database or migration impact | None |
| Visual or CSS impact | None |
| Product capability impact | None |
| Assistant and Design Lab impact | None; both remain unopened |
| Protected unrelated material | `output/`; `scripts/browserCanaryServer 2.ts` |
| Exact local evidence | `docs/refactor-evidence/notifications-authority-pass.md` |

## Why this pass is justified

`NotificationsPanel.tsx` currently owns both presentation and the exact
browser transport contract. It constructs routes, query strings, verbs,
request bodies, cache policy, and the single-notification `keepalive` option
for:

1. preferences read;
2. preferences update;
3. notification page read and cursor pagination;
4. unread-count read;
5. single and all-notification read mutations; and
6. single-group and clear-read archive mutations.

The same component also owns panel visibility, expanded/settings modes,
loading and mutation indicators, request epochs, bounded retry scheduling,
recovery refresh, live-event application, optimistic projection, navigation,
and rendering. Changing a route or request contract therefore requires
editing presentation and re-auditing unrelated interaction behavior.

Messaging already demonstrated the intended boundary: presentation consumes
typed domain operations, while route construction and request semantics have
one injectable owner. Notifications is smaller, but it is the same proven
class of entanglement. This is an ownership correction, not a file-size pass.

## Exact authority after the cutover

Add `features/notifications/notificationGateway.ts` as the single browser
transport authority. It accepts an injected function compatible with
`symposiumApi.request` and exposes only domain operations:

- `list(actorHandle, limit, cursor?)`;
- `getUnreadCount(actorHandle)`;
- `getPreferences(actorHandle)`;
- `updatePreferences(actorHandle, expectedRevision, changes)`;
- `markRead(actorHandle, notificationId, groupKey)`;
- `markAllRead(actorHandle)`;
- `archive(actorHandle, notificationId, groupKey)`; and
- `clearRead(actorHandle)`.

The default exported gateway uses `symposiumApi.request`. The injectable
factory exists for exact contract tests, not as a second runtime path.

The gateway owns:

- `/api/notifications`, `/unread`, `/preferences`, `/read`, and `/archive`
  route construction;
- actor, cursor, limit, notification ID, and group-key encoding;
- GET/PATCH/POST selection;
- `cache: "no-store"` on list, unread, and preference reads;
- `keepalive: true` only for the current fire-and-follow single-read mutation;
- expected preference revision and change-map request bodies; and
- the distinction between one/all reads and one/clear-read archives.

The gateway must not catch, translate, retry, or swallow request failures.
The exact rejection must reach the existing panel orchestration so current
retry, rollback, refresh, and status behavior remains unchanged.

## Behavior that remains in existing owners

This pass does not move or redesign:

- notification normalization, aggregation, attention partitioning, unread
  arithmetic, archive projection, or live-event application;
- preference projection from live events;
- request epochs, stale-response rejection, retry attempts/timers, recovery
  epochs, or visibility/online admission;
- optimistic single/all read behavior and failure refresh;
- optimistic single/clear-read archive behavior and failure refresh;
- panel open/close, compact/expanded/settings state, outside-click/Escape,
  navigation, conversation opening, focus, labels, or status copy;
- pagination cursor state and existing page size of 50;
- server routes, compatibility dispatch, repository behavior, schemas,
  migrations, events, or database indexes; or
- CSS, rendered markup, layout, motion, Day/Night, or responsive behavior.

No hook/controller extraction is pre-authorized. After raw transport leaves
the component, the component may remain large if its remaining responsibilities
are coherent presentation and interaction orchestration.

## Contract preservation matrix

| Operation | Exact request contract to preserve |
| --- | --- |
| List first page | `GET /api/notifications?actorHandle=<encoded>&limit=50`, `cache: "no-store"` |
| List older page | Same request with encoded `cursor`; append through the existing merge function |
| Unread count | `GET /api/notifications/unread?actorHandle=<encoded>`, `cache: "no-store"` |
| Read preferences | `GET /api/notifications/preferences?actorHandle=<encoded>`, `cache: "no-store"` |
| Update preference | `PATCH /api/notifications/preferences` with actor, expected revision, and one-key changes map |
| Read one group | `POST /api/notifications/read` with actor, notification ID, group key, and `keepalive: true` |
| Read all | `POST /api/notifications/read` with actor and `all: true` |
| Archive one group | `POST /api/notifications/archive` with actor, notification ID, and group key |
| Clear read | `POST /api/notifications/archive` with actor and `clearRead: true` |

Existing local-preview and canonical-live behavior continues through the
consolidated Next Notifications compatibility authority. This pass neither
removes nor modifies that route authority.

## Implementation sequence

1. **Characterize the baseline**
   - Record the eight domain operations and nine concrete request shapes.
   - Preserve current source inventory and the direct panel request count.
   - Run Notifications, recovery, architecture, type, and build checks before
     runtime edits.
2. **Add the gateway and focused proof**
   - Implement the injectable factory and default gateway.
   - Add `scripts/notificationGatewayCheck.ts` with a recording request stub.
   - Assert exact routes, encoding, verbs, bodies, cache, keepalive, return
     values, and unchanged rejection propagation.
3. **Cut over one caller**
   - Replace every `symposiumApi.request` call in `NotificationsPanel.tsx`
     with the matching gateway operation.
   - Remove the API-client import from the presentation component.
   - Do not change state transitions, effect dependencies, catches, optimistic
     updates, timers, UI, or copy during the cutover.
4. **Install permanent guards**
   - Add `notification-gateway:check` to `package.json` and the canonical
     verification manifest.
   - Update `notificationSystemCheck.ts` so route ownership assertions inspect
     the gateway, while panel assertions verify rendering and behavior.
   - Extend `architectureBoundaryCheck.ts` to reject `symposiumApi`, raw
     `/api/notifications` strings, or another request constructor in the
     panel, and to require all gateway operations.
5. **Prove and release**
   - Run the complete matrix below on the exact candidate.
   - Commit only this pass and its evidence, push a `codex/` topic branch, and
     merge only through protected CI.
   - Verify Vercel and Render at the exact merge SHA. If Render's path filter
     skips the frontend-only change, deliberately deploy the same merge SHA
     before declaring one release identity.

## Focused proof requirements

`scripts/notificationGatewayCheck.ts` must directly assert:

- every operation invokes exactly one request;
- handles, cursors, IDs, group keys, and limits are URL-encoded exactly once;
- absent cursors do not create empty cursor parameters;
- read operations use private/no-store caching;
- mutation verbs and bodies are byte-semantically equivalent to the current
  component calls;
- only single-group read uses `keepalive`;
- update changes remain one typed preference key/value pair with the exact
  expected revision;
- injected resolved values pass through unchanged; and
- injected 4xx, 5xx, offline, and arbitrary failures reject with the same
  error object so orchestration retains ownership of recovery policy.

Permanent architecture assertions must prove:

- the panel imports and uses `notificationGateway`;
- the panel contains no `symposiumApi.request`, `fetch`, or raw Notifications
  API route;
- the gateway contains every domain operation and route family;
- notification state/live/preference models remain separate from transport;
  and
- the consolidated Next dispatcher contract remains unchanged.

## Verification and acceptance matrix

Focused local gates:

- `npm run notification-gateway:check`;
- `npm run notifications:check`;
- `npm run architecture:check`;
- `npm run client-recovery:check`;
- `npm run live-routing:check`;
- `npm run compatibility:check`;
- `npm run typecheck:all`; and
- `git diff --check`.

Complete local gates:

- `npm run verify` with the new manifest stage;
- `npm run proof:check`;
- isolated `npm ci` plus `npm audit --audit-level=high`;
- exact staged-tree `npm run browser:canary`; and
- the existing PostgreSQL/filesystem and notification-database harnesses when
  the local environment can run them. If `initdb` remains unavailable, record
  that limitation and rely on the already-covered repository proof plus deep
  Neon readiness; never point a destructive harness at production.

Browser acceptance must cover:

- signed-in initial unread fetch while the panel is closed;
- open/close, outside click, Escape, compact/expanded/settings navigation;
- first page, load older, empty, loading, retry, and reconnect states;
- preference load, optimistic toggle, success, conflict/failure reload, and
  live preference convergence;
- single read plus navigation/conversation opening;
- mark all read, archive one, and clear read;
- optimistic failure recovery without count snap-back or lost rows;
- notification live create/group/read/archive/resolve events;
- recovery epoch after offline/visibility suspension;
- actor A to actor B reset with no prior private rows, cursor, preferences, or
  pending mutation state; and
- keyboard labels, status announcements, desktop/mobile bounds, Day/Night,
  and zero unexpected browser logs.

Use an isolated local/database fixture for mutation and two-session cases.
Production verification is read-only unless a disposable account and cleanup
contract are explicitly available.

Release acceptance:

- protected pull-request proof green;
- separate exact-merge-SHA workflow green;
- Vercel exact merge SHA ready;
- Render exact merge SHA strict-ready with 65/65 migrations and all required
  providers healthy;
- public API health, readiness, bootstrap, validation, and Notifications read
  smoke green;
- authenticated production panel loads canonical unread/list/preferences data
  with no warning, error, or unexpected retry loop; and
- local `main`, `origin/main`, CI, Vercel, and Render resolve to the same
  released revision.

## Rollback and stop conditions

Rollback is an application-only revert to the prior compatible frontend. No
schema, migration, provider, stored row, event, or API contract changes, so no
data rollback or dual-read window is required.

Pause immediately if:

- a current request shape cannot be reproduced through the injected gateway;
- a test reveals actor, cache, keepalive, cursor, optimistic, retry, or live
  behavior depended on presentation-local request construction;
- a server/API/schema change appears necessary;
- browser UI, focus, layout, or accessibility changes; or
- unrelated work overlaps the owned files.

The pass is complete only when the panel has no transport authority, the old
request construction is absent rather than duplicated, every current behavior
above is preserved, docs/evidence match source, protected release proof is
green, and the exact deployed merge SHA is verified.
