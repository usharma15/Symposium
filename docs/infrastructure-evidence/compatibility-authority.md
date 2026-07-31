# Final compatibility-authority cutover

## Verdict

This candidate replaces distributed Next compatibility policy with explicit
family authorities. It does not delete local preview, protected delivery,
Clerk synchronization, or the safe same-origin retry path.

Before the cutover, Assistant, Conversations, and Notifications used 22 route
modules to repeat method exports, forwarding calls, and local-unavailable or
empty-state responses. After the cutover, three optional catch-all modules
delegate to allowlisted dispatchers in `lib/assistantRouteSupport.ts` and
`lib/messageRouteSupport.ts`.

Unknown paths are not forwarded. Unsupported methods are not forwarded.
Local-preview mutations remain fail-closed, and local empty-state reads retain
their prior response shapes and private cache policy.

## Structural result

| Measure | Before | Candidate |
| --- | ---: | ---: |
| Next route modules | 85 | 66 |
| Exported framework handlers | 116 | 96 |
| Distributed family modules retired | 0 | 22 |
| Consolidated family modules | 0 | 3 |
| Preserved logical family contracts | 31 | 31 |
| Tracked source files | 501 | 484 |
| Physical tracked source lines | 131,999 | 132,399 |
| Nonblank tracked source lines | 123,739 | 124,143 |

LOC is not a governing objective. The source increase is the explicit
contract inventory and adversarial proof that make the deletion safe; it is
not counted as a reduction. The structural gain is 19 fewer route modules and
one policy owner per family.

## Complete remaining-route classification

Every one of the 66 route modules is assigned a runtime reason by
`scripts/compatibilityRouteAuthorityCheck.ts`:

| Category | Modules | Reason retained |
| --- | ---: | --- |
| Consolidated compatibility | 3 | Allowlisted Assistant, Conversations, and Notifications safe retry |
| Protected Next boundary | 8 | Clerk sync, private delivery, local bytes, or bounded stream redirect |
| Canonical-only compatibility | 3 | Explicit same-origin retry for live-only product operations |
| Synthesized local preview | 4 | Supported empty/follow/event projection without live persistence |
| Persisted local preview | 48 | Credential-free laptop persistence and behavior |

No module remains unclassified. Removing any retained category would require a
product/runtime decision or a replacement authority, not another cleanup
sweep.

## Preserved behavior

- Direct authenticated Render requests remain primary.
- GET requests and idempotent mutations retain the same-origin retry path.
- Assistant local-preview reads and mutations retain their exact 503 payloads.
- Conversations and Notifications retain their local empty-state read shapes.
- Local-preview message and notification mutations remain unavailable.
- Actor forwarding, body forwarding, cache policy, and `Vary` behavior remain.
- Conversation subresources retain GET, POST, PATCH, and DELETE compatibility.
- Unknown catch-all paths return 404 and never reach Render.
- Unsupported methods return 405 with an exact `Allow` header and never reach Render.
- The production-unavailable mode still cannot open local JSON.

## Verification evidence

Focused candidate evidence:

- `npm run compatibility:check` — all 31 logical contracts, all 66 module
  classifications, forwarding, local responses, unknown paths, and method
  rejection passed;
- `npm run architecture:check` — retained signatures, consolidated modules,
  retired-module guards, dependency direction, and authority ownership passed;
- Assistant, Assistant Projects, Assistant Actions, private post drafts,
  Messaging, Notifications, Content Analytics, and API-client checks passed;
- frontend and API strict typechecks passed;
- optimized Next production build exposed and then verified the exact App
  Router handler boundary; and
- production hydration verification passed.

Complete local release evidence:

- `npm run verify` passed all 67/67 manifest stages, including the optimized
  production build and production hydration boundary;
- `npm run browser:canary` passed all 11/11 isolated Chromium canaries,
  including missed-event recovery and create/edit/durable-reload behavior;
- `npm run proof:check` passed and `npm audit --audit-level=high` reported zero
  vulnerabilities; and
- an additional real Next development-server smoke verified the consolidated
  routes' local responses, private cache headers, unknown-path 404s, and exact
  method-rejection `Allow` headers.

`npm run storage-filesystem:integration` could not start because this macOS
host has no PostgreSQL `initdb`/server binaries. The harness stopped at its
precondition before creating a database, starting the API, or touching a
provider. It was not redirected to Neon because the harness intentionally
creates, migrates, mutates, and destroys an isolated test cluster. Durable
local persistence remains covered by the browser canary and verification
manifest; protected CI and exact-SHA production evidence remain release gates
before this candidate can be called released.
