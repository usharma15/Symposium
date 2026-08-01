# Pass 01 runtime-spine inventory

Status: source-grounded inventory of the current working tree
Snapshot HEAD: `8e900d0fa675b311a67029b8d2f109b4da97301e`
Captured: 2026-07-29
Scope: all Next page entries, all Next route-handler entries, all Fastify route registrations, and every server/browser persistence surface found in the tracked runtime source

This is a preservation contract for the refactor, not a proposal to change behavior. A path may disappear or be consolidated only after its callers, authorization semantics, durable effects, event semantics, and fallback behavior have an equivalent characterized replacement.

## Completeness method and reconciled counts

The inventory was derived from the working tree, not documentation or memory:

1. `rg --files app | rg '/page\.tsx$'` found **16** page entries.
2. `rg --files app/api -g 'route.ts'` found **85** Next route-handler files. A TypeScript-AST walk of exported `GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS` declarations found **116** method exports.
3. A TypeScript-AST walk of `app.get|post|put|patch|delete|head|options` calls with literal paths under `apps/api/src/routes` found **141** Fastify registrations across **110** unique paths:
   - attachment 4
   - community 18
   - event 2
   - message/notification 31
   - opportunity application 7
   - post/comment 13
   - profile 9
   - system 4
   - workspace/assistant 53
4. Filesystem and browser persistence were found by tracing `node:fs/promises`, `pg`, R2/S3, Upstash Redis, `localStorage`, `sessionStorage`, cookies, and `BroadcastChannel` use. There are **six** first-party server fallback-store modules, one canonical Postgres store, one R2 object store, one Redis coordination store, and the browser key families listed below.
5. The Fastify authorization classification was checked at each registration against `withReadActor`, `withWriteActor`, or `getActorFromRequest`. The actual token/dev-actor rules are authoritative in `apps/api/src/services/auth.ts`; route helpers are authoritative in `apps/api/src/http/actors.ts`.
6. Persistence and live-event classifications were traced from route to repository/service, then to SQL/R2/event staging. The event authority is `apps/api/src/services/events.ts`; transaction publication is `apps/api/src/services/transactions.ts`; process fan-out is `apps/api/src/services/liveBus.ts`.

### Legend

Authorization:

- `PAGE`: no page-level account gate; the shared shell renders and protected operations are enforced at API boundaries.
- `PUB`: no actor required.
- `OPT`: an actor is resolved when supplied; anonymous access remains valid and visibility is projected.
- `REQ`: a verified Clerk actor is required in strict live mode. An explicitly enabled dev actor can satisfy this only under the rules in `apps/api/src/services/auth.ts`.
- `MIX`: method-specific; the row spells out the split.
- `LP`: non-production local-preview-only path. It is not a production authorization or durability boundary.

Persistence/live-sync:

- `DB-R`: canonical Postgres read.
- `DB-W+Δ`: canonical Postgres mutation with a durable `events` row and publication to the live bus after commit.
- `DB-W`: canonical Postgres mutation for which no product live event is emitted.
- `OBJ`: Cloudflare R2 object operation; Postgres owns object metadata/lifecycle.
- `URL`: access-checked, expiring R2 download URL.
- `SSE`: durable event replay plus process-local live fan-out.
- `LL`: non-production local JSON/file fallback, serialized in-process and normally saved by temporary-file rename. It has no cross-process event bus.
- `FIX`: fixture or empty local-preview projection; not authoritative persistence.
- `AI`: OpenAI provider execution whose accepted result is persisted through the canonical database path.
- `X`: ephemeral browser cross-tab invalidation signal, not authoritative persistence.

## Next page routes: 16 of 16

Every page delegates to `app/SymposiumPage.tsx`, which reads the entrance-session cookie, detects Clerk/backend configuration, and mounts `components/SymposiumV0.tsx`. Consequently, all rows are `PAGE`; route-specific state is encoded as `initialRoute`, while data comes from bootstrap/API routes and synchronization comes from the event stream.

| Public path | Kind / parameters | Auth | Persistence and sync | Exact route authority |
|---|---|---:|---|---|
| `/` | Hall | PAGE | Shared bootstrap + event transport | `app/page.tsx` |
| `/assistant` | Assistant; optional `backdrop` | PAGE | Assistant API state; shared event transport | `app/assistant/page.tsx` |
| `/assistant/threads/:threadId` | Assistant thread; optional `backdrop` | PAGE | Assistant API state; shared event transport | `app/assistant/threads/[threadId]/page.tsx` |
| `/communities` | Community directory | PAGE | Community projection; shared event transport | `app/communities/page.tsx` |
| `/communities/:communityId` | Community detail | PAGE | Community projection; shared event transport | `app/communities/[communityId]/page.tsx` |
| `/funding` | Unified patronage/funding view | PAGE | Post/patronage projection; shared event transport | `app/funding/page.tsx` |
| `/messages` | Messages; optional `conversation` | PAGE | Private conversation APIs; shared event transport | `app/messages/page.tsx` |
| `/opportunities` | Opportunity directory | PAGE | Post/opportunity projection; shared event transport | `app/opportunities/page.tsx` |
| `/posts/:postId` | Post detail; optional `comment` | PAGE | Post/comment APIs; shared event transport | `app/posts/[postId]/page.tsx` |
| `/posts/:postId/applications` | Opportunity applications; optional `application` | PAGE | Private application APIs; shared event transport | `app/posts/[postId]/applications/page.tsx` |
| `/profiles/:handle` | Profile overview | PAGE | Public/profile-scoped projection; shared event transport | `app/profiles/[handle]/page.tsx` |
| `/profiles/:handle/:tab` | Valid profile tab except literal `all`; invalid tab is 404 | PAGE | Profile/activity APIs; shared event transport | `app/profiles/[handle]/[tab]/page.tsx` |
| `/profiles/:handle/followers` | Followers | PAGE | Social graph projection; shared event transport | `app/profiles/[handle]/followers/page.tsx` |
| `/profiles/:handle/following` | Following | PAGE | Social graph projection; shared event transport | `app/profiles/[handle]/following/page.tsx` |
| `/rooms/:roomId` | Canonical room only; invalid room is 404 | PAGE | Shared bootstrap + event transport | `app/rooms/[roomId]/page.tsx` |
| `/workspace` | Office; optional `view`, `note`, `comment` | PAGE | Private workspace APIs; shared event transport | `app/workspace/page.tsx` |

Canonical path parsing/serialization and the valid room/profile/assistant-backdrop sets are authoritative in `features/navigation/canonicalRoute.ts`; view projection is authoritative in `features/navigation/viewState.ts`.

## Global Next request, render, and asset boundaries

These three boundaries apply across the page/route rows and must be preserved
as runtime infrastructure rather than treated as incidental configuration:

| Authority | Global behavior owned | Refactor preservation requirement |
|---|---|---|
| `proxy.ts` | Activates Clerk middleware only when both Clerk keys exist; restricts production Clerk authorized parties to the two canonical Symposium origins; applies Clerk or local CSP; rejects cross-site mutations with a no-store `403`; matches dynamic pages plus API/TRPC while excluding static assets | Preserve matcher coverage, authorized parties, CSP mode, origin/Fetch-Metadata rejection, local no-Clerk behavior, and the exact fail-closed mutation boundary |
| `app/layout.tsx` | Owns metadata base/title/description/Open Graph, mobile viewport/theme color, global style and KaTeX imports, root language/body, and the same two-key conditional `ClerkProvider` activation | Preserve provider activation parity, metadata/viewport semantics, and global design/style import order |
| `next.config.mjs` | Strict React mode; removes the powered-by header; validates and publicizes the HTTPS R2 public base; rewrites `/attachment-assets/:path*`; gives authored-artifact and AVIF render assets immutable cache policy; applies sitewide nosniff/referrer/frame/permissions/HSTS headers; bounds development watchers | Preserve public attachment delivery, URL validation/fallback, immutable asset identity, security headers, and dev-only watcher behavior |

The route tables below do not supersede these global layers. A route can be
functionally correct in isolation and still regress authentication, CSRF/CSP,
attachment delivery, cache identity, metadata, or design if one of these
boundaries is weakened.

## Next API façade: 85 files / 116 method exports

These are the browser-facing same-origin routes. For routes using
`lib/liveBackendClient.ts`, a Clerk bearer token is forwarded only when both
Clerk publishable and secret keys are configured. Those routes never
substitute local data in strict production: an absent or unreachable
`SYMPOSIUM_API_URL` returns `503`. Local fallback is possible only when the
backend URL is **absent** and `NODE_ENV !== "production"` by
`lib/runtimeSafety.ts`; a configured but unreachable backend returns `503`
even in development.

`/api/events/stream` is an explicit exception: with no backend URL its route
serves a heartbeat SSE stream even in production; with a configured backend it
returns a `307` redirect and does not probe reachability. The browser treats
the ready/heartbeat stream as connected and stops fallback polling. This
compatibility behavior is a preservation obligation and must not be mistaken
for canonical durable event replay.

`REQ/LP` means the live endpoint is account-protected, while local preview may derive or default an actor through `lib/workspaceRouteSupport.ts`; that preview identity is deliberately not a production security guarantee.

### Assistant and assistant attachments: 14 files / 19 methods

| Same-origin path | Methods | Auth | Persistence and sync | Exact route authority |
|---|---:|---:|---|---|
| `/api/assistant-attachments/:attachmentId` | GET | REQ/LP | DB-R + URL; LL owner check/file response in preview | `app/api/assistant-attachments/[attachmentId]/route.ts` |
| `/api/assistant/actions/office-draft-edits` | POST | REQ | DB-W+Δ; no local substitute | `app/api/assistant/actions/office-draft-edits/route.ts` |
| `/api/assistant/actions/office-draft-edits/undo` | POST | REQ | DB-W+Δ; no local substitute | `app/api/assistant/actions/office-draft-edits/undo/route.ts` |
| `/api/assistant/actions/office-note-drafts` | POST | REQ | DB-W+Δ; no local substitute | `app/api/assistant/actions/office-note-drafts/route.ts` |
| `/api/assistant/actions/office-post-drafts` | POST | REQ | DB-W+Δ; no local substitute | `app/api/assistant/actions/office-post-drafts/route.ts` |
| `/api/assistant/content-translations` | POST | REQ | AI + DB-W+Δ; no local substitute | `app/api/assistant/content-translations/route.ts` |
| `/api/assistant/conversations/*segments` | GET, POST, PATCH, DELETE | REQ | DB-R or DB-W+Δ by method/subpath; no local substitute | `app/api/assistant/conversations/[...segments]/route.ts` |
| `/api/assistant/conversations` | GET | REQ | DB-R; absent live backend returns `503` with an empty-shaped thread payload | `app/api/assistant/conversations/route.ts` |
| `/api/assistant/document-translations` | POST | REQ | AI + DB-W+Δ; no local substitute | `app/api/assistant/document-translations/route.ts` |
| `/api/assistant/messages` | POST | REQ | AI + DB-W+Δ; no local substitute | `app/api/assistant/messages/route.ts` |
| `/api/assistant/projects/:projectId` | PATCH, DELETE | REQ | DB-W+Δ; no local substitute | `app/api/assistant/projects/[projectId]/route.ts` |
| `/api/assistant/projects` | GET, POST | REQ | DB-R / DB-W+Δ; no local substitute | `app/api/assistant/projects/route.ts` |
| `/api/assistant/quick-notes` | POST | REQ | DB-W+Δ; no local substitute | `app/api/assistant/quick-notes/route.ts` |
| `/api/assistant/quota` | GET | REQ | DB-R; absent live backend returns `503` because quota enforcement cannot be emulated | `app/api/assistant/quota/route.ts` |

### Attachment lifecycle: 5 files / 5 methods

| Same-origin path | Methods | Auth | Persistence and sync | Exact route authority |
|---|---:|---:|---|---|
| `/api/attachments/:attachmentId` | DELETE | REQ/LP | DB-W + OBJ cleanup; LL pending-upload deletion in preview | `app/api/attachments/[attachmentId]/route.ts` |
| `/api/attachments/confirm` | POST | REQ/LP | OBJ verification/promotion + DB-W+Δ; LL confirmation in preview | `app/api/attachments/confirm/route.ts` |
| `/api/attachments/local-upload/:attachmentId` | PUT | LP | LL binary write only; production is 404 | `app/api/attachments/local-upload/[attachmentId]/route.ts` |
| `/api/attachments/local/:attachmentId/:fileName` | GET | LP | LL file read only; production is 404; no local account check | `app/api/attachments/local/[attachmentId]/[fileName]/route.ts` |
| `/api/attachments/upload` | POST | REQ/LP | DB-W + OBJ upload preparation; LL pending record in preview | `app/api/attachments/upload/route.ts` |

### Identity, bootstrap, search, events, and social graph: 13 files / 15 methods

| Same-origin path | Methods | Auth | Persistence and sync | Exact route authority |
|---|---:|---:|---|---|
| `/api/auth/sync` | POST | REQ/LP | DB-W+Δ; `dataStore` profile upsert in preview | `app/api/auth/sync/route.ts` |
| `/api/bootstrap` | GET | OPT | DB-R; FIX + local-store projection in preview | `app/api/bootstrap/route.ts` |
| `/api/events` | GET | OPT | DB-R durable replay; empty cursor-preserving preview response | `app/api/events/route.ts` |
| `/api/events/stream` | GET | OPT | 307 to canonical SSE; heartbeat-only preview stream | `app/api/events/stream/route.ts` |
| `/api/follows` | GET | REQ/LP | DB-R; empty preview projection | `app/api/follows/route.ts` |
| `/api/profiles` | GET, POST | MIX: GET PUB; POST REQ/LP | DB-R / DB-W+Δ; fixture read or `dataStore` upsert in preview | `app/api/profiles/route.ts` |
| `/api/profiles/:handle` | GET | PUB | DB-R; fixture/data-store projection in preview | `app/api/profiles/[handle]/route.ts` |
| `/api/profiles/:handle/activity` | GET | OPT | DB-R; local action-ledger/community projection in preview | `app/api/profiles/[handle]/activity/route.ts` |
| `/api/profiles/:handle/follow` | POST, DELETE | REQ/LP | DB-W+Δ; fixture/local social projection in preview | `app/api/profiles/[handle]/follow/route.ts` |
| `/api/profiles/:handle/follows` | GET | PUB | DB-R; fixture/local projection in preview | `app/api/profiles/[handle]/follows/route.ts` |
| `/api/search` | GET | OPT | DB-R; fixture + local community/data-store projection in preview | `app/api/search/route.ts` |
| `/api/blocks` | POST | REQ | DB-W+Δ; no local substitute | `app/api/blocks/route.ts` |
| `/api/calls/:id/join` | POST | REQ/LP | DB-W+Δ; local community-call mutation in preview | `app/api/calls/[id]/join/route.ts` |

### Communities: 9 files / 14 methods

| Same-origin path | Methods | Auth | Persistence and sync | Exact route authority |
|---|---:|---:|---|---|
| `/api/communities` | GET, POST | MIX: GET OPT; POST REQ/LP | DB-R / DB-W+Δ; LL read/write in preview | `app/api/communities/route.ts` |
| `/api/communities/:id` | GET, PATCH | MIX: GET OPT; PATCH REQ/LP | DB-R / DB-W+Δ; LL read/write in preview | `app/api/communities/[id]/route.ts` |
| `/api/communities/:id/membership` | POST | REQ/LP | Maps join/leave/access intent to canonical mutation; DB-W+Δ or LL | `app/api/communities/[id]/membership/route.ts` |
| `/api/communities/:id/calls` | GET, POST | MIX: GET OPT; POST REQ/LP | DB-R / DB-W+Δ; LL read/write in preview | `app/api/communities/[id]/calls/route.ts` |
| `/api/communities/:id/members` | GET | OPT | DB-R visibility projection; LL read in preview | `app/api/communities/[id]/members/route.ts` |
| `/api/communities/:id/members/:handle` | PATCH, DELETE | REQ/LP | DB-W+Δ; LL write in preview | `app/api/communities/[id]/members/[handle]/route.ts` |
| `/api/communities/:id/requests/:handle` | PATCH | REQ/LP | DB-W+Δ; LL write in preview | `app/api/communities/[id]/requests/[handle]/route.ts` |
| `/api/communities/:id/announcements` | POST | REQ/LP | DB-W+Δ; LL write in preview | `app/api/communities/[id]/announcements/route.ts` |
| `/api/communities/:id/announcements/:announcementId` | PATCH, DELETE | REQ/LP | DB-W+Δ; LL write in preview | `app/api/communities/[id]/announcements/[announcementId]/route.ts` |

### Conversations and notifications: 10 files / 14 methods

| Same-origin path | Methods | Auth | Persistence and sync | Exact route authority |
|---|---:|---:|---|---|
| `/api/conversations` | GET | REQ | DB-R; empty preview projection | `app/api/conversations/route.ts` |
| `/api/conversations/unread` | GET | REQ | DB-R; zero preview projection | `app/api/conversations/unread/route.ts` |
| `/api/conversations/groups` | POST | REQ | DB-W+Δ; no local substitute | `app/api/conversations/groups/route.ts` |
| `/api/conversations/*segments` | GET, POST, PATCH, DELETE | REQ | DB-R or DB-W+Δ by method/subpath; no local substitute | `app/api/conversations/[...segments]/route.ts` |
| `/api/messages` | POST | REQ | DB-W+Δ; no local substitute | `app/api/messages/route.ts` |
| `/api/notifications` | GET | REQ | DB-R; empty preview projection | `app/api/notifications/route.ts` |
| `/api/notifications/unread` | GET | REQ | DB-R; zero preview projection | `app/api/notifications/unread/route.ts` |
| `/api/notifications/preferences` | GET, PATCH | REQ | DB-R / DB-W+Δ; default read projection but no preview mutation substitute | `app/api/notifications/preferences/route.ts` |
| `/api/notifications/read` | POST | REQ | DB-W+Δ; no local substitute | `app/api/notifications/read/route.ts` |
| `/api/notifications/archive` | POST | REQ | DB-W+Δ; no local substitute | `app/api/notifications/archive/route.ts` |

### Posts, comments, applications, and private attachment access: 13 files / 19 methods

| Same-origin path | Methods | Auth | Persistence and sync | Exact route authority |
|---|---:|---:|---|---|
| `/api/posts` | GET, POST | MIX: GET OPT; POST REQ/LP | DB-R / DB-W+Δ; `dataStore` + local attachments in preview | `app/api/posts/route.ts` |
| `/api/posts/:id` | GET, PATCH, DELETE | MIX: GET OPT; writes REQ/LP | DB-R / DB-W+Δ; `dataStore`, attachment, quote, application cleanup in preview | `app/api/posts/[id]/route.ts` |
| `/api/posts/:id/analytics` | GET | REQ/LP | DB-R; local action/view projection in preview | `app/api/posts/[id]/analytics/route.ts` |
| `/api/posts/:id/actions` | POST | REQ/LP | DB-W+Δ; local action-ledger write in preview | `app/api/posts/[id]/actions/route.ts` |
| `/api/posts/:id/comments` | POST | REQ/LP | DB-W+Δ; `dataStore` + local attachment write in preview | `app/api/posts/[id]/comments/route.ts` |
| `/api/posts/:id/comments/:commentId` | PATCH, DELETE | REQ/LP | DB-W+Δ; `dataStore` + local attachment write/cleanup in preview | `app/api/posts/[id]/comments/[commentId]/route.ts` |
| `/api/posts/:id/comments/:commentId/actions` | POST | REQ/LP | DB-W+Δ; local action-ledger write in preview | `app/api/posts/[id]/comments/[commentId]/actions/route.ts` |
| `/api/posts/:id/opportunity/application` | GET, POST | REQ/LP | DB-R / DB-W+Δ; local application store in preview | `app/api/posts/[id]/opportunity/application/route.ts` |
| `/api/posts/:id/opportunity/applications` | GET | REQ/LP | DB-R; local application store in preview | `app/api/posts/[id]/opportunity/applications/route.ts` |
| `/api/posts/:id/opportunity/applications/:applicationId` | PATCH, DELETE | REQ/LP | DB-W+Δ; local application/attachment write in preview | `app/api/posts/[id]/opportunity/applications/[applicationId]/route.ts` |
| `/api/posts/:id/opportunity/applications/:applicationId/comments` | POST | REQ/LP | DB-W+Δ; local application write in preview | `app/api/posts/[id]/opportunity/applications/[applicationId]/comments/route.ts` |
| `/api/message-attachments/:attachmentId` | GET | REQ/LP | DB-R + URL; LL owner-only file response in preview | `app/api/message-attachments/[attachmentId]/route.ts` |
| `/api/opportunity-attachments/:attachmentId` | GET | REQ/LP | DB-R + URL; LL access check/file response in preview | `app/api/opportunity-attachments/[attachmentId]/route.ts` |

### Workspace: 21 files / 30 methods

| Same-origin path | Methods | Auth | Persistence and sync | Exact route authority |
|---|---:|---:|---|---|
| `/api/workspace` | GET | REQ/LP | DB-R; local workspace-store read in preview | `app/api/workspace/route.ts` |
| `/api/workspace/search` | GET | REQ/LP | DB-R; local workspace-store read in preview | `app/api/workspace/search/route.ts` |
| `/api/workspace/collaborators` | GET | REQ/LP | DB-R; local profile/workspace projection in preview | `app/api/workspace/collaborators/route.ts` |
| `/api/workspace/attachments/:attachmentId` | GET | REQ/LP | DB-R + URL; LL access check/file response in preview | `app/api/workspace/attachments/[attachmentId]/route.ts` |
| `/api/workspace/scribble` | GET, PATCH | REQ/LP | DB-R / DB-W+Δ; local workspace-store read/write in preview | `app/api/workspace/scribble/route.ts` |
| `/api/workspace/scribble/file` | POST | REQ/LP | DB-W+Δ; local workspace-store write in preview | `app/api/workspace/scribble/file/route.ts` |
| `/api/workspace/scribble/discard` | POST | REQ/LP | DB-W+Δ; local workspace-store write in preview | `app/api/workspace/scribble/discard/route.ts` |
| `/api/workspace/scribble/restore` | POST | REQ/LP | DB-W+Δ; local workspace-store write in preview | `app/api/workspace/scribble/restore/route.ts` |
| `/api/workspace/documents` | POST | REQ/LP | DB-W+Δ; local workspace-store/attachment write in preview | `app/api/workspace/documents/route.ts` |
| `/api/workspace/documents/:noteId` | PATCH, DELETE | REQ/LP | DB-W+Δ; local workspace-store/attachment/comment cleanup in preview | `app/api/workspace/documents/[noteId]/route.ts` |
| `/api/workspace/documents/:noteId/publish` | POST | REQ/LP | DB-W+Δ + possible OBJ promotion; local publication/data-store path in preview | `app/api/workspace/documents/[noteId]/publish/route.ts` |
| `/api/workspace/documents/:noteId/access` | GET, POST | REQ/LP | DB-R / DB-W+Δ; local grant read/write in preview | `app/api/workspace/documents/[noteId]/access/route.ts` |
| `/api/workspace/documents/:noteId/access/:granteeHandle` | PATCH, DELETE | REQ/LP | DB-W+Δ; local grant write in preview | `app/api/workspace/documents/[noteId]/access/[granteeHandle]/route.ts` |
| `/api/workspace/documents/:noteId/comments` | GET, POST | REQ/LP | DB-R / DB-W+Δ; local workspace-comment store in preview | `app/api/workspace/documents/[noteId]/comments/route.ts` |
| `/api/workspace/documents/:noteId/comments/:commentId` | PATCH, DELETE | REQ/LP | DB-W+Δ; local workspace-comment/attachment write in preview | `app/api/workspace/documents/[noteId]/comments/[commentId]/route.ts` |
| `/api/workspace/documents/:noteId/comments/:commentId/actions` | POST | REQ/LP | DB-W+Δ; local workspace-comment action write in preview | `app/api/workspace/documents/[noteId]/comments/[commentId]/actions/route.ts` |
| `/api/workspace/notebooks` | POST | REQ/LP | DB-W+Δ; local workspace-store write in preview | `app/api/workspace/notebooks/route.ts` |
| `/api/workspace/notebooks/:notebookId` | PATCH, DELETE | REQ/LP | DB-W+Δ; local workspace-store write in preview | `app/api/workspace/notebooks/[notebookId]/route.ts` |
| `/api/workspace/notebooks/:notebookId/with-contents` | DELETE | REQ/LP | DB-W+Δ + dependent cleanup; local store cleanup ledger in preview | `app/api/workspace/notebooks/[notebookId]/with-contents/route.ts` |
| `/api/workspace/notebooks/:notebookId/access` | GET, POST | REQ/LP | DB-R / DB-W+Δ; local grant read/write in preview | `app/api/workspace/notebooks/[notebookId]/access/route.ts` |
| `/api/workspace/notebooks/:notebookId/access/:granteeHandle` | PATCH, DELETE | REQ/LP | DB-W+Δ; local grant write in preview | `app/api/workspace/notebooks/[notebookId]/access/[granteeHandle]/route.ts` |

The seven section totals reconcile exactly to **85 files and 116 methods**.

## Canonical Fastify API: 141 registrations / 110 unique paths

The following is the backend authority, including direct endpoints that have no one-to-one Next file because the browser client uses a catch-all, a direct live URL, or a compatibility route. All `/v1/*` responses receive `Cache-Control: no-store` in `apps/api/src/server.ts`. Requests receive request IDs, bounded body/time/router settings, cost accounting, and CORS there; baseline rate limiting applies to non-`OPTIONS` requests.

### Attachment routes

Authority for all rows: `apps/api/src/routes/attachmentRoutes.ts`. Repository/object authority: `apps/api/src/repository/attachments.ts` and `apps/api/src/services/storage.ts`.

| Canonical path | Methods | Auth | Persistence and live-sync implication |
|---|---:|---:|---|
| `/v1/attachments/upload` | POST | REQ | DB-W attachment preparation + OBJ upload target; no product event at preparation |
| `/v1/attachments/confirm` | POST | REQ | OBJ inspection/promotion + DB-W+Δ (`attachment.uploaded`) + deferred staging-object deletion |
| `/v1/attachments/:attachmentId/content` | PUT | REQ | OBJ streaming upload to the prepared key; bounded to 50 MiB and extended request timeout; no product event before confirmation |
| `/v1/attachments/:attachmentId` | DELETE | REQ | DB-W + queued OBJ deletion and audit; no product live event |

### Community and call routes

Authority for all rows: `apps/api/src/routes/communityRoutes.ts`. Repository authorities: `apps/api/src/repository/communities.ts`, `apps/api/src/repository/communityMembers.ts`, `apps/api/src/repository/communityRequests.ts`, and `apps/api/src/repository/communityAnnouncements.ts`.

| Canonical path | Methods | Auth | Persistence and live-sync implication |
|---|---:|---:|---|
| `/v1/communities` | GET, POST | MIX: GET OPT; POST REQ | DB-R visibility projection / DB-W+Δ create |
| `/v1/communities/:id` | GET, PATCH | MIX: GET OPT; PATCH REQ | DB-R visibility projection / DB-W+Δ settings update |
| `/v1/communities/:id/join` | POST | REQ | DB-W+Δ membership join/request |
| `/v1/communities/:id/membership` | DELETE | REQ | DB-W+Δ membership leave |
| `/v1/communities/:id/access` | POST | REQ | DB-W+Δ access/invitation resolution |
| `/v1/communities/:id/calls` | GET, POST | MIX: GET OPT; POST REQ | DB-R access-filtered calls / DB-W+Δ call creation |
| `/v1/communities/:id/members` | GET | OPT | DB-R access-filtered, cursor-paginated member projection |
| `/v1/communities/:id/members/:handle` | PATCH, DELETE | REQ | DB-W+Δ role/status update or removal |
| `/v1/communities/:id/requests/:handle` | PATCH | REQ | DB-W+Δ request resolution |
| `/v1/communities/:id/announcements` | POST | REQ | DB-W+Δ announcement creation |
| `/v1/communities/:id/announcements/:announcementId` | PATCH, DELETE | REQ | DB-W+Δ announcement update/deletion |
| `/v1/calls/:id/join` | POST | REQ | DB-W+Δ participant join |
| `/v1/calls/:id/end` | POST | REQ | DB-W+Δ moderator/owner call termination |

These 13 unique paths contain **18 registrations** because five paths register two methods.

### Event replay and stream routes

Authority: `apps/api/src/routes/eventRoutes.ts`; durable event/cursor authority: `apps/api/src/services/events.ts`; process fan-out authority: `apps/api/src/services/liveBus.ts`.

| Canonical path | Methods | Auth | Persistence and live-sync implication |
|---|---:|---:|---|
| `/v1/events` | GET | OPT | DB-R cursor replay; private/community events are audience-filtered |
| `/v1/events/stream` | GET | OPT | SSE: validates cursor/`Last-Event-ID`, replays durable DB events, then subscribes to the process live bus; per-client/process stream caps apply |

The EventEmitter is only a low-latency same-process accelerator. The `events` table and cursor replay are the recovery/durability mechanism; neither this inventory nor a refactor may relabel the EventEmitter as durable cross-instance delivery.

### Conversation, message, notification, and block routes

Authority for all rows: `apps/api/src/routes/messageRoutes.ts`. Repository authorities: `apps/api/src/repository/conversations.ts` and `apps/api/src/repository/notifications.ts`.

| Canonical path | Methods | Auth | Persistence and live-sync implication |
|---|---:|---:|---|
| `/v1/conversations` | GET | REQ | DB-R private conversation list |
| `/v1/conversations/unread` | GET | REQ | DB-R private unread count |
| `/v1/conversations/:id` | GET, DELETE | REQ | DB-R detail / DB-W+Δ viewer deletion |
| `/v1/conversations/:id/messages` | GET | REQ | DB-R cursor-paginated messages |
| `/v1/conversations/:id/messages/:messageId/context` | GET | REQ | DB-R bounded surrounding-message context |
| `/v1/messages` | POST | REQ | DB-W+Δ message send and notification fan-out |
| `/v1/conversations/groups` | POST | REQ | DB-W+Δ group creation |
| `/v1/conversations/:id/invitations` | POST | REQ | DB-W+Δ participant invitations |
| `/v1/conversations/:id/participants` | POST | REQ | DB-W+Δ participant addition |
| `/v1/conversations/:id/invitation` | POST | REQ | DB-W+Δ invitation acceptance/rejection |
| `/v1/conversations/:id/participants/:handle` | PATCH, DELETE | REQ | DB-W+Δ participant role/update/removal |
| `/v1/conversations/:id/preferences` | PATCH | REQ | DB-W+Δ viewer conversation preferences |
| `/v1/conversations/:id/draft` | PATCH | REQ | DB-W+Δ revisioned server draft |
| `/v1/conversations/:id/read` | POST | REQ | DB-W+Δ read receipt |
| `/v1/conversations/:id/leave` | POST | REQ | DB-W+Δ membership leave |
| `/v1/conversations/:id/clear` | POST | REQ | DB-W+Δ viewer clear boundary |
| `/v1/conversations/:id/search` | GET | REQ | DB-R access-scoped full-text search |
| `/v1/conversations/:id/starred` | GET | REQ | DB-R starred-message list |
| `/v1/conversations/:id/messages/:messageId/star` | POST | REQ | DB-W+Δ star state |
| `/v1/conversations/:id/messages/:messageId` | PATCH, DELETE | REQ | DB-W+Δ message edit/deletion |
| `/v1/blocks` | POST | REQ | DB-W+Δ profile block state |
| `/v1/notifications` | GET | REQ | DB-R cursor-paginated notifications |
| `/v1/notifications/unread` | GET | REQ | DB-R unread count |
| `/v1/notifications/preferences` | GET, PATCH | REQ | DB-R / DB-W+Δ preference state |
| `/v1/notifications/read` | POST | REQ | DB-W+Δ one/all read state |
| `/v1/notifications/archive` | POST | REQ | DB-W+Δ one/all archive state |
| `/v1/message-attachments/:attachmentId/access` | GET | REQ | DB-R ownership/participant authorization + URL |

These 27 unique paths contain **31 registrations**.

### Opportunity-application routes

Authority: `apps/api/src/routes/opportunityApplicationRoutes.ts`; repository authority: `apps/api/src/repository/opportunityApplications.ts`.

| Canonical path | Methods | Auth | Persistence and live-sync implication |
|---|---:|---:|---|
| `/v1/posts/:id/opportunity/application` | GET, POST | REQ | DB-R own application / DB-W+Δ application creation |
| `/v1/posts/:id/opportunity/applications` | GET | REQ | DB-R poster-only review list |
| `/v1/posts/:id/opportunity/applications/:applicationId` | PATCH, DELETE | REQ | DB-W+Δ shortlist/status update or deletion |
| `/v1/posts/:id/opportunity/applications/:applicationId/comments` | POST | REQ | DB-W+Δ private application comment |
| `/v1/opportunity-attachments/:attachmentId/access` | GET | REQ | DB-R applicant/poster authorization + URL |

These five unique paths contain **7 registrations**.

### Post, comment, action, view, and analytics routes

Authority: `apps/api/src/routes/postRoutes.ts`. Repository authorities: `apps/api/src/repository/posts.ts`, `apps/api/src/repository/comments.ts`, `apps/api/src/repository/actions.ts`, `apps/api/src/repository/contentViews.ts`, `apps/api/src/repository/inquiryViews.ts`, and `apps/api/src/repository/contentAnalytics.ts`.

| Canonical path | Methods | Auth | Persistence and live-sync implication |
|---|---:|---:|---|
| `/v1/posts` | GET, POST | MIX: GET OPT; POST REQ | DB-R visibility-filtered feed / DB-W+Δ post creation |
| `/v1/posts/:id` | GET, PATCH, DELETE | MIX: GET OPT; writes REQ | DB-R visibility-filtered detail / DB-W+Δ update or tombstone |
| `/v1/posts/:id/analytics` | GET | REQ | DB-R access-controlled bounded analytics projection |
| `/v1/posts/:id/comments` | POST | REQ | DB-W+Δ comment creation |
| `/v1/posts/:id/comments/:commentId` | PATCH, DELETE | REQ | DB-W+Δ comment update or tombstone |
| `/v1/posts/:id/actions` | POST | REQ | DB-W+Δ canonical post action ledger |
| `/v1/posts/:id/views` | POST | REQ | Deduplicated DB-W+Δ qualified post view when a new bucket is claimed |
| `/v1/posts/:id/comments/:commentId/actions` | POST | REQ | DB-W+Δ canonical comment action ledger |
| `/v1/posts/:id/comments/:commentId/views` | POST | REQ | Deduplicated DB-W+Δ qualified comment view when a new bucket is claimed |

These nine unique paths contain **13 registrations**.

### Profile and identity routes

Authority: `apps/api/src/routes/profileRoutes.ts`. Repository authorities: `apps/api/src/repository/identity.ts`, `apps/api/src/repository/profiles.ts`, and `apps/api/src/repository/inquiryReads.ts`.

| Canonical path | Methods | Auth | Persistence and live-sync implication |
|---|---:|---:|---|
| `/v1/auth/sync` | POST | REQ | DB-W+Δ Clerk-user/profile synchronization |
| `/v1/profiles` | GET, POST | MIX: GET PUB; POST REQ | DB-R public directory / DB-W+Δ profile upsert |
| `/v1/profiles/:handle` | GET | PUB | DB-R public profile projection |
| `/v1/follows` | GET | REQ | DB-R current viewer social graph |
| `/v1/profiles/:handle/follows` | GET | PUB | DB-R public-policy-filtered followers/following projection |
| `/v1/profiles/:handle/activity` | GET | OPT | DB-R privacy-filtered activity projection |
| `/v1/profiles/:handle/follow` | POST, DELETE | REQ | DB-W+Δ follow/unfollow |

These seven unique paths contain **9 registrations**.

### System routes

Authority: `apps/api/src/routes/systemRoutes.ts`; readiness authority: `apps/api/src/config/readiness.ts`.

| Canonical path | Methods | Auth | Persistence and live-sync implication |
|---|---:|---:|---|
| `/healthz` | GET | PUB | Process liveness metadata; no product persistence |
| `/readyz` | GET | PUB | Configuration/migration/maintenance readiness; optional `probe=database` performs a DB probe |
| `/v1/bootstrap` | GET | OPT | DB-R visibility-projected initial profile/items/communities/calls state |
| `/v1/search` | GET | OPT | DB-R visibility-projected cross-domain search |

### Workspace, publication, and assistant routes

Authority for all rows: `apps/api/src/routes/workspaceRoutes.ts`. Repository/service authorities are named by subsystem after the table.

| Canonical path | Methods | Auth | Persistence and live-sync implication |
|---|---:|---:|---|
| `/v1/opportunities` | GET, POST | MIX: GET PUB; POST REQ | DB-R public opportunity projection / compatibility DB-W+Δ create path |
| `/v1/workspace` | GET | REQ | DB-R access-scoped notebooks, documents, grants, and scribble |
| `/v1/workspace/scribble` | GET, PATCH | REQ | DB-R / revision-checked DB-W+Δ autosave |
| `/v1/workspace/scribble/file` | POST | REQ | DB-W+Δ scribble-to-document filing |
| `/v1/workspace/scribble/discard` | POST | REQ | DB-W+Δ discard with revision history |
| `/v1/workspace/scribble/restore` | POST | REQ | DB-W+Δ revision restoration |
| `/v1/workspace/documents` | POST | REQ | DB-W+Δ document creation and attachment ownership |
| `/v1/workspace/documents/:noteId` | PATCH, DELETE | REQ | Revision/access-checked DB-W+Δ update or deletion with dependent cleanup |
| `/v1/workspace/documents/:noteId/access` | GET, POST | REQ | DB-R access overview / DB-W+Δ grant creation |
| `/v1/workspace/documents/:noteId/access/:granteeHandle` | PATCH, DELETE | REQ | DB-W+Δ grant update/revocation |
| `/v1/workspace/documents/:noteId/comments` | GET, POST | REQ | DB-R threaded discussion / DB-W+Δ comment creation |
| `/v1/workspace/documents/:noteId/comments/:commentId` | PATCH, DELETE | REQ | DB-W+Δ comment update/tombstone |
| `/v1/workspace/documents/:noteId/comments/:commentId/actions` | POST | REQ | DB-W+Δ workspace-comment action |
| `/v1/workspace/notebooks` | POST | REQ | DB-W+Δ notebook creation |
| `/v1/workspace/notebooks/:notebookId` | PATCH, DELETE | REQ | DB-W+Δ notebook update or empty-notebook deletion |
| `/v1/workspace/notebooks/:notebookId/with-contents` | DELETE | REQ | DB-W+Δ notebook-and-contents deletion with dependent object/comment cleanup |
| `/v1/workspace/notebooks/:notebookId/access` | GET, POST | REQ | DB-R access overview / DB-W+Δ grant creation |
| `/v1/workspace/notebooks/:notebookId/access/:granteeHandle` | PATCH, DELETE | REQ | DB-W+Δ grant update/revocation |
| `/v1/workspace/collaborators` | GET | REQ | DB-R bounded collaborator search |
| `/v1/workspace/search` | GET | REQ | DB-R access-scoped workspace search |
| `/v1/workspace/attachments/:attachmentId/access` | GET | REQ | DB-R document/grant authorization + URL |
| `/v1/notes/blocks` | POST | REQ | DB-W+Δ revisioned note-block save |
| `/v1/notes/publish` | POST | REQ | DB-W+Δ publication plus OBJ promotion/copy when attachments cross to a public owner |
| `/v1/assistant/quota` | GET | REQ | DB-R daily quota/usage projection |
| `/v1/assistant-attachments/:attachmentId/access` | GET | REQ | DB-R conversation ownership authorization + URL |
| `/v1/assistant/conversations` | GET | REQ | DB-R private assistant-conversation list |
| `/v1/assistant/projects` | GET, POST | REQ | DB-R / DB-W+Δ project creation |
| `/v1/assistant/projects/:projectId` | PATCH, DELETE | REQ | DB-W+Δ project update/deletion |
| `/v1/assistant/conversations/:id` | GET, PATCH, DELETE | REQ | DB-R detail / DB-W+Δ metadata update or deletion |
| `/v1/assistant/conversations/:id/context` | POST | REQ | DB-W+Δ bounded context-dock state |
| `/v1/assistant/conversations/:id/sources` | POST | REQ | DB-W+Δ evidence-source state |
| `/v1/assistant/messages` | POST | REQ | AI request with quota/cost bounds, then DB-W+Δ conversation/message/tool-result state |
| `/v1/assistant/document-translations` | POST | REQ | AI translation, then DB-W+Δ revision-keyed document translation |
| `/v1/assistant/content-translations` | POST | REQ | AI translation, then DB-W+Δ revision-keyed post/comment translation |
| `/v1/assistant/quick-notes` | POST | REQ | DB-W+Δ private Office note creation |
| `/v1/assistant/actions/office-note-drafts` | POST | REQ | Confirmation-gated DB-W+Δ private note draft |
| `/v1/assistant/actions/office-post-drafts` | POST | REQ | Confirmation-gated DB-W+Δ private Office post draft; this is not public posting |
| `/v1/assistant/actions/office-draft-edits` | POST | REQ | Confirmation/revision-gated DB-W+Δ private draft edit |
| `/v1/assistant/actions/office-draft-edits/undo` | POST | REQ | Receipt/revision-gated DB-W+Δ private draft undo |

These 39 unique paths contain **53 registrations**. Workspace repository authorities are `apps/api/src/repository/workspaceDocuments.ts`, `workspaceAccess.ts`, `workspaceComments.ts`, `workspaceScribbles.ts`, and `workspace.ts`. Assistant authorities are `assistant.ts`, `assistantProjects.ts`, `assistantActions.ts`, `contentTranslations.ts`, and `documentTranslations.ts`. Publication/object-transition authorities are `apps/api/src/services/notePublishing.ts`, `workspacePublicationState.ts`, and `workspaceAttachmentPublishing.ts`.

The backend section reconciles to **110 unique paths and 141 registrations**. `apps/api/src/server.ts` registers exactly the nine route modules inventoried above.

### Exact Fastify rate-limit topology

Every one of the 141 registrations first consumes the IP-keyed, process-local
`request` bucket at 300 requests per 60 seconds. Actor resolution then adds a
second bucket: 73 registrations use the `withWriteActor` default
`write:120/60s` process bucket; 46 use the exact custom policies below; five
use `withReadActor`, 11 use optional actor resolution, and six use no actor, so
those 22 receive no actor bucket. All custom windows are 60 seconds.

`shared` means Redis is attempted and falls back to the same process-memory
algorithm when Redis is absent/failing. `process` means Redis is never
attempted.

| Actor bucket | Mode | Exact method/path registrations |
|---|---:|---|
| `attachment:30` | shared | POST `/v1/attachments/upload`; POST `/v1/attachments/confirm`; DELETE `/v1/attachments/:attachmentId` |
| `attachment-content:30` | shared | PUT `/v1/attachments/:attachmentId/content` |
| `message-read:180` | process | GET `/v1/conversations`; GET `/v1/conversations/:id`; GET `/v1/conversations/:id/messages`; GET `/v1/conversations/:id/messages/:messageId/context`; GET `/v1/conversations/:id/starred` |
| `message-unread:180` | process | GET `/v1/conversations/unread` |
| `message-send:60` | shared | POST `/v1/messages` |
| `group-create:20` | shared | POST `/v1/conversations/groups` |
| `group-invite:30` | process | POST `/v1/conversations/:id/invitations` |
| `group-member-add:30` | process | POST `/v1/conversations/:id/participants` |
| `group-invite-resolve:30` | process | POST `/v1/conversations/:id/invitation` |
| `message-draft:90` | process | PATCH `/v1/conversations/:id/draft` |
| `message-read-receipt:120` | process | POST `/v1/conversations/:id/read` |
| `message-search:90` | process | GET `/v1/conversations/:id/search` |
| `profile-block:30` | process | POST `/v1/blocks` |
| `notification-read:180` | process | GET `/v1/notifications`; GET `/v1/notifications/unread`; GET `/v1/notifications/preferences` |
| `notification-update:60` | process | PATCH `/v1/notifications/preferences` |
| `notification-update:120` | process | POST `/v1/notifications/read`; POST `/v1/notifications/archive` |
| `message-attachment:120` | process | GET `/v1/message-attachments/:attachmentId/access` |
| `content-analytics:180` | process | GET `/v1/posts/:id/analytics` |
| `content-create:30` | shared | POST `/v1/posts`; POST `/v1/posts/:id/comments` |
| `passive-view:240` | process | POST `/v1/posts/:id/views`; POST `/v1/posts/:id/comments/:commentId/views` |
| `assistant-action:30` | shared | POST `/v1/assistant/projects`; PATCH/DELETE `/v1/assistant/projects/:projectId`; PATCH/DELETE `/v1/assistant/conversations/:id`; POST `/v1/assistant/conversations/:id/context`; POST `/v1/assistant/conversations/:id/sources`; POST `/v1/assistant/quick-notes`; POST `/v1/assistant/actions/office-note-drafts`; POST `/v1/assistant/actions/office-post-drafts`; POST `/v1/assistant/actions/office-draft-edits`; POST `/v1/assistant/actions/office-draft-edits/undo` |
| `assistant:10` | shared | POST `/v1/assistant/messages`; POST `/v1/assistant/document-translations`; POST `/v1/assistant/content-translations` |

The grouped custom rows reconcile to 46 registrations: four attachment, 22
message/notification, five post/comment, and 15 Workspace/Assistant.

### Exact mutation-receipt topology

There are 95 Fastify write registrations: 66 are receipt-capable and 29 do not
call the generic receipt envelope. Receipt capability remains optional: an
absent `Idempotency-Key` creates no context or receipt. A supplied key must be
8–200 URL-safe `[A-Za-z0-9._:-]` characters. The server hashes the
route-selected payload as canonical sorted-object JSON with SHA-256 and uses
`(actor, scope, key)` uniqueness. A reused key with a different hash or a
pending receipt returns `409`; a completed receipt replays its stored response.

Most receipt-capable mutations claim and complete inside the domain
transaction. Assistant message/translation paths are different: they commit a
pending receipt in prepare, call the provider, then finalize in a later
transaction.

| Family | Receipt-capable method/path → exact scope |
|---|---|
| Attachment | POST `/v1/attachments/upload` → `attachment.prepare` |
| Community | POST `/v1/communities` → `community.create`; PATCH `/v1/communities/:id` → `community.settings.update`; PATCH/DELETE `/v1/communities/:id/members/:handle` → `community.member.role.update` / `community.member.remove`; PATCH `/v1/communities/:id/requests/:handle` → `community.request.resolve`; POST/PATCH/DELETE announcement collection/item → `community.announcement.create` / `.update` / `.delete`; POST `/v1/communities/:id/calls` → `community.call.create` |
| Messaging | POST `/v1/messages` → `message.send`; POST `/v1/conversations/groups` → `conversation.group.create` |
| Opportunity applications | POST own application, PATCH/DELETE application, POST application comment → `opportunity.application.create` / `.update` / `.delete` / `.comment.create` |
| Posts/comments | POST/PATCH/DELETE post → `post.create` / `.update` / `.delete`; POST/PATCH/DELETE comment → `comment.create` / `.update` / `.delete`; POST post/comment action → `post.action` / `comment.action` |
| Profiles | POST `/v1/profiles` → `profile.upsert`; POST/DELETE follow → `profile.follow` / `profile.unfollow` |
| Opportunity publication | POST `/v1/opportunities` → `opportunity.create` |
| Scribble | PATCH Scribble and POST file/discard/restore → `workspace.scribble.update` / `.file` / `.discard` / `.restore` |
| Workspace documents/discussion | POST/PATCH/DELETE document → `workspace.document.create` / `.update` / `.delete`; POST/PATCH/DELETE document access → `workspace.document.access.grant` / `.update` / `.revoke`; POST/PATCH/DELETE document comment and POST action → `workspace.comment.create` / `.update` / `.delete` / `.action` |
| Workspace notebooks | POST/PATCH/DELETE notebook and DELETE with-contents → `workspace.notebook.create` / `.update` / `.delete` / `.delete_with_contents`; POST/PATCH/DELETE notebook access → `workspace.notebook.access.grant` / `.update` / `.revoke` |
| Notes/publication | POST `/v1/notes/blocks` → `note.block.save`; POST `/v1/notes/publish` → `note.publish` |
| Assistant | POST/PATCH/DELETE project → `assistant.project.create` / `.update` / `.delete`; PATCH/DELETE conversation → `assistant.thread.update` / `.delete`; POST context/sources → `assistant.context.update` / `assistant.source.update`; POST message/document translation/content translation → `assistant.message` / `assistant.document-translation` / `assistant.content-translation`; POST quick note → `assistant.quick-note.create`; four Office actions → `assistant.action.office-note.create-draft`, `assistant.action.office-post.create-draft`, `assistant.action.office-document.edit-draft`, `assistant.action.office-document.edit-draft.undo` |

The 29 writes without the generic receipt envelope are:

- POST `/v1/attachments/confirm`; PUT
  `/v1/attachments/:attachmentId/content`; DELETE
  `/v1/attachments/:attachmentId`;
- POST `/v1/communities/:id/join`; DELETE
  `/v1/communities/:id/membership`; POST `/v1/communities/:id/access`; POST
  `/v1/calls/:id/join`; POST `/v1/calls/:id/end`;
- POST `/v1/conversations/:id/invitations`; POST
  `/v1/conversations/:id/participants`; POST
  `/v1/conversations/:id/invitation`; PATCH/DELETE
  `/v1/conversations/:id/participants/:handle`; PATCH
  `/v1/conversations/:id/preferences`; PATCH
  `/v1/conversations/:id/draft`; POST `/v1/conversations/:id/read`; POST
  `/v1/conversations/:id/leave`; POST `/v1/conversations/:id/clear`; DELETE
  `/v1/conversations/:id`; POST
  `/v1/conversations/:id/messages/:messageId/star`; PATCH/DELETE
  `/v1/conversations/:id/messages/:messageId`;
- POST `/v1/blocks`; PATCH `/v1/notifications/preferences`; POST
  `/v1/notifications/read`; POST `/v1/notifications/archive`;
- POST `/v1/posts/:id/views`; POST
  `/v1/posts/:id/comments/:commentId/views`; and
- POST `/v1/auth/sync`.

Their replay behavior is heterogeneous. State/upsert/no-op logic suppresses
many duplicate join/leave/call/participant-add/preference/star/block/read/auth
transitions; participant-role PATCH can increment revision, notify, and emit
again; access rewrites a timestamp; invite resolution, removal, and edit may
conflict or return `404`; passive views dedupe by
`(target, type, actor, hour)`. They must not be labeled idempotent as a class.

### Exact expected-revision topology

Thirty-eight registrations are revision-aware: 34 require a revision on every
valid request and four apply a conditional rule. For always-required inputs,
the schema normally makes absence a `400`; stale values normally become `409`
under a row/advisory lock or conditional SQL update.

| Family | Always-required revision registrations |
|---|---|
| Opportunity application (1) | PATCH application |
| Community (7) | Settings PATCH; member PATCH/DELETE; request PATCH; announcement POST/PATCH/DELETE |
| Scribble and Workspace (15) | Scribble PATCH plus file/discard/restore; document PATCH/DELETE; document-comment PATCH/DELETE; notebook PATCH/DELETE/DELETE-with-contents; document-access PATCH/DELETE; notebook-access PATCH/DELETE |
| Assistant (8) | Project PATCH/DELETE; conversation PATCH/DELETE; context POST; sources POST; Office draft-edit POST and undo POST |
| Messaging/notification (3) | Conversation-draft PATCH; message PATCH; notification-preferences PATCH |

Conditional registrations:

- POST `/v1/notes/blocks`: expected note/block revision is optional for
  creation, but existing notes/blocks require it; missing is `412`, stale is
  `409`.
- POST `/v1/notes/publish`: expected revision is optional only for explicit
  title/body publication; publishing an existing `noteId` requires it; missing
  is `412`, stale or already-published is `409`.
- POST `/v1/assistant/messages`: `draftSession` is nullable, but when present
  its nested `expectedRevision` is required; a private Assistant-draft
  mismatch is `409`.
- DELETE message: `expectedRevision` is ignored for `mode=self`;
  `mode=everyone` requires an exact revision; missing/mismatch is `409` and an
  expired unsend window is `412`.

Conversation-draft mismatch is the one custom revision response: instead of
throwing, the route returns `409 {error, draft, requestId}` with the canonical
current draft. Message send's `draftRevision`/`draftClientVersion` pair is not
a send precondition: both fields must appear together, the message still
commits, and the server draft clears when the pair is absent or either
supplied identity matches.
Public post/comment PATCH/DELETE increment server revisions but accept no
client expected-revision precondition; revision columns alone do not imply
optimistic-concurrency enforcement.

### Error, transaction, stream, and provider failure contracts

1. `sendError` maps TRPC bad-request/unauthorized/forbidden/not-found/conflict/
   precondition/rate-limit codes to `400/401/403/404/409/412/429`; every other
   TRPC code becomes `500` while retaining its message. Zod becomes generic `400` plus issues,
   Fastify's native body-limit error becomes generic `413`, and unknown errors
   become sanitized `500`. These shared bodies include `requestId`. The
   Assistant cost-ceiling `PAYLOAD_TOO_LARGE` mismatch documented below is
   therefore currently `500`.
2. Only six direct route status-body sites bypass that shared shape:
   conversation-draft conflict `409` includes the canonical draft; event cursor
   `400`; stream cursor `400`; stream-cap `429`; readiness `200/503` returns
   its readiness object; public-profile miss returns `404 {error}` without
   `requestId`. An SSE error after reply hijack destroys/ends the socket rather
   than sending JSON.
3. `runAtomic` commits the mutation, optional receipt, and durable event
   together, then emits the process-local event. `EventEmitter` failure is
   swallowed because cursor replay is the durable recovery path. A no-op or
   receipt replay generally stages no new event.
4. SSE caps are 12 streams per client and 500 per process. Replay pages are up
   to 100 events (a lower request limit can select 25–99), bounded to 1,000 per
   connection before close; pending-live buffer
   overflow above 1,000 or backpressure destroys the stream; heartbeat is 15
   seconds. Maintenance prunes at most 5,000 events older than 14 days per run;
   14 days is a pruning threshold, not an exact retention guarantee. Cursor
   reconnect is bounded replay, not infinite history.
5. R2 upload is a saga: prepare the database row; authenticated streaming PUT
   writes staging then marks database state; confirm claims
   pending→verifying, inspects/signature-validates, promotes, then commits the
   uploaded row and event. Failures reset to pending where possible; confirming
   an already-uploaded object naturally replays state. Physical deletion is
   eventual through unique durable jobs, leases, and backoff; an inline trigger
   failure is swallowed and maintenance retries.
6. Workspace publication is a multi-phase advisory-lock workflow, not one
   transaction: deterministic public object copies, post/comment creation
   under nested `note.publish.post|comment` receipt scopes, then the
   source-draft publication transaction/original receipt. A crash can leave
   intermediate object/post state. Reusing the same idempotency key makes that
   state retry-recoverable; without a receipt, retry after destination
   creation but before source-publication persistence can duplicate the
   destination.
7. Assistant message and translation paths use prepare transaction → external
   provider → finalize transaction. Provider failure commonly returns an HTTP
   `200` business result such as `provider_error`/disabled and can account
   usage. Disabled, unconfigured, unsupported, or cached paths may return
   before receipt claim. A process crash before finalize can strand pending
   receipt and reserved-usage state.
8. Shared Redis limiter failure degrades to per-process counters with a
   throttled warning. Its `429` has no `Retry-After` header. Browser
   direct→façade fallback treats any mutation with an idempotency key as
   replay-safe even when it is one of the 29 backend exclusions above.

## Persistence spine

### 1. Canonical Postgres database

Configuration and connection authority:

- URL precedence: `POSTGRES_PRISMA_URL`, then `POSTGRES_URL`, then `DATABASE_URL` in `apps/api/src/config/env.ts` and `apps/api/src/db/client.ts`.
- Canonical schema evolution: **64** ordered migrations, latest `0064_authored_artifact_design_assignments`, in `apps/api/src/db/migrate.ts`.
- Migration status and startup application: `apps/api/src/db/migrate.ts`; startup calls `ensureDatabase()` before listening in `apps/api/src/server.ts`.
- Transaction/event publication: `apps/api/src/services/transactions.ts`.

The migration source creates **62 unique tables** (63 `CREATE TABLE IF NOT EXISTS` occurrences because `content_views` is created defensively in two migrations):

`ai_conversations`, `ai_daily_quota_resets`, `ai_messages`, `ai_projects`, `ai_usage`, `attachments`, `audit_logs`, `bounties`, `call_participants`, `comment_actions`, `comments`, `communities`, `community_calls`, `community_channels`, `community_memberships`, `content_translations`, `content_views`, `conversation_participants`, `conversations`, `credit_accounts`, `credit_ledger_entries`, `document_translations`, `events`, `external_links`, `fixture_revisions`, `historical_world_snapshots`, `maintenance_leases`, `message_hidden_for`, `message_reads`, `message_stars`, `messages`, `moderation_reports`, `mutation_receipts`, `note_blocks`, `note_publications`, `notes`, `notification_preferences`, `notifications`, `opportunity_application_comments`, `opportunity_applications`, `opportunity_posts`, `patronage_contributions`, `patronage_proposals`, `pledges`, `post_actions`, `posts`, `previews`, `profile_blocks`, `profile_follows`, `profiles`, `storage_deletion_jobs`, `symposium_migrations`, `users`, `workspace_note_comment_actions`, `workspace_note_comments`, `workspace_note_grants`, `workspace_note_revisions`, `workspace_notebook_grants`, `workspace_notebooks`, `workspace_scribble_revisions`, `workspace_scribbles`, and `workspaces`.

This table list is descriptive, not a license to infer reachability. Some funding/moderation/payment structures exist in the schema without a corresponding browser route in the 85-file façade.

### 2. Cloudflare R2 object store

Authority: `apps/api/src/services/storage.ts`, configured by `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_PUBLIC_BASE_URL` in `apps/api/src/config/env.ts`.

- Postgres `attachments` rows own metadata, owner/status, canonical and staging object keys.
- Upload is prepare → object write → confirm/inspect/promote.
- Public post, comment, and profile assets may use `R2_PUBLIC_BASE_URL`;
  private message, assistant-message, note, note-comment, and
  opportunity-application objects use access-checked signed URLs.
- Deletion is durable and retryable through `storage_deletion_jobs`, `apps/api/src/services/storageDeletion.ts`, and the maintenance worker. A refactor must not replace this with best-effort inline deletion.
- Workspace publication may promote/copy private objects to a public canonical owner through `workspaceAttachmentPublishing.ts`.

### 3. Upstash Redis

Authority: `apps/api/src/services/redis.ts`; configuration authority: `apps/api/src/config/env.ts`; consumer: `apps/api/src/services/rateLimit.ts`.

Redis stores shared rate-limit counters with TTLs. It is operational
coordination, not product-record persistence or live-event durability. When
unavailable, the service falls back to expiry-pruned process memory and emits
throttled warnings. That fallback prunes every 256 operations but has no hard
entry-count ceiling.

### 4. Six first-party non-production server stores

These are compatibility/preview persistence paths, never production substitutes. `lib/runtimeSafety.ts` blocks local fallback in production, and `lib/liveBackendClient.ts` returns `503` instead of silently reading/writing them there.

| Store | Physical path and atomicity | Data owned | Route consumers / coupling | Sync and durability boundary | Exact authority |
|---|---|---|---|---|---|
| Legacy content/data store | `.data/symposium.json`; `/tmp/symposium.json` on Vercel; serialized local action queue; temporary-file rename. Historical snapshot under `.data/snapshots/` or `/tmp`. It can also select legacy Postgres when a DB URL is present. | Profiles, posts, nested comments, view dedupe, canonical action ledger, fixture revision | Bootstrap, search, profile, post/comment/action/analytics, local opportunity validation, local publication | Single process/file only in local mode; no durable event table or cross-process fan-out | `lib/dataStore.ts` |
| Local attachment store | `.data/attachments/index.json` plus `.data/attachments/files/*`; serialized queue; temporary-file rename for index and binary writes; dependent cleanup | Pending/uploaded attachment records, owner links, bytes, safe filename/type/size metadata | Attachment lifecycle; post/comment/workspace/message/assistant/opportunity attachment hydration and cleanup | Single process/filesystem; local URLs only; no R2 retry job or event bus | `lib/localAttachmentStore.ts` |
| Local community store | `.data/symposium-communities.json`; `/tmp/symposium-communities.json` on Vercel; serialized queue; temporary-file rename; historical snapshot path | Communities, membership/roles/status, announcements embedded in community state, calls/participants | Bootstrap/search/community/profile activity/call routes | Single process/file; clients may refetch, but no canonical event replay | `lib/localCommunityStore.ts` |
| Local opportunity-application store | `.data/opportunity-applications/index.json`; serialized queue; temporary-file rename | Applications, shortlist/revision state, private comments; attachment ownership delegated to local attachment store | Application CRUD/comments/access and post-deletion cleanup | Single process/file; no durable private event stream | `lib/localOpportunityApplicationStore.ts` |
| Local workspace store | `.data/workspace/index.json`; serialized queue; temporary-file rename | Per-handle workspace, notebooks, documents, revision history, pending cleanup ledger, grants, scribble and history | Workspace/scribble/document/notebook/access/search/collaborator/publication routes | Single process/file; optimistic revision/access logic is preserved, but canonical multi-user event delivery is absent | `lib/localWorkspaceStore.ts` |
| Local workspace-comment store | `.data/workspace-comments/index.json`; serialized queue; temporary-file rename; document access delegated to local workspace store | Threaded note comments and comment actions; attachment ownership delegated to local attachment store | Workspace comment read/create/update/delete/action and document cleanup | Single process/file; no canonical notification/event delivery | `lib/localWorkspaceCommentStore.ts` |

The local stores form a coupled graph: opportunity applications and workspace comments depend on local attachments; workspace document/notebook deletion cleans comments and attachments; local publication bridges workspace documents into `dataStore`. Deleting or merging a store without preserving those cascades can strand bytes, grants, comments, revisions, or applications.

`lib/dataStore.ts` also contains a separate legacy PostgreSQL initializer for `profiles`, `items`, `comments`, `content_views`, and `action_ledger`. This is not the Fastify migration authority and must not be confused with the 62-table canonical schema. Its route callers are reachable only through the non-production fallback branch, but a development process with a database URL will select that legacy DB mode instead of the JSON file.

### 5. Browser persistence and transport keys

Browser storage accelerates rendering, protects unsent work, carries navigation handoffs, and coordinates tabs. Except where explicitly stated as a local unsent draft, it is not canonical server persistence.

#### Long-lived `localStorage` records

| Key / family | Purpose and authority | Canonical relationship |
|---|---|---|
| `symposium-local-snapshot` | Bounded bootstrap cache; `features/bootstrap/cachedBootstrap.ts` | Read acceleration only; server bootstrap wins |
| `symposium-profile-handle` | Last active handle; `features/bootstrap/cachedBootstrap.ts`, `components/SymposiumV0.tsx` | Selection hint, not authentication |
| `symposium-auth-records` | Up to four 24-hour identity cache records; `features/identity/cachedIdentity.ts` | Clerk + backend remain authoritative |
| `symposium-auth-handle` | Legacy identity key removed during sync/sign-out; `components/SymposiumV0.tsx` | Cleanup-only compatibility key; no current writer/reader |
| `symposium-profile-read-cache-v2` | Bounded 24-hour profile activity/social read cache; `features/profiles/profileReadCache.ts` | Read acceleration only |
| `symposium-workspace-v1:${handle}` | Workspace snapshot cache; `features/workspace/workspaceSnapshotStorage.ts` | Server/local preview workspace remains authoritative |
| `symposium-scribble-v1:${handle}` | Scribble body, dirty state, base revision; `features/scribble/ScribbleContext.tsx` | Recovery/autosave cache; server revision resolves conflicts |
| `symposium:message-draft:${handle}:${conversationId}` | Revisioned unsent message draft and conflict recovery; `features/messages/MessagesSection.tsx`, `messageDraftState.ts` | Local unsent recovery plus canonical server draft |
| `symposium:document-viewer-session:v1` | Per-browser-session bounded document reading/view state; `features/attachments/documentViewerSession.ts` | Presentation continuity, not content persistence |
| `symposium:content-translation-session:v2` | Per-browser-session bounded translation display state; `features/translation/contentTranslationSession.ts` | Canonical translation result remains server revision-keyed |
| `symposium-theme` | Day/night preference; `components/SymposiumV0.tsx` | UI-only |
| `symposium-activity-recency` | Client activity-recency hints; `components/SymposiumV0.tsx` | UI ranking hint only |
| `symposium-view-dedupe:${handle}` | One-hour client view-dedupe hint; `components/SymposiumV0.tsx` | Server still enforces canonical dedupe |
| `symposium-following-${handle}` | Following-list cache; `components/SymposiumV0.tsx` | Server social graph remains authoritative |

#### `sessionStorage` and cookies

| Key | Purpose and authority | Boundary |
|---|---|---|
| `symposium-entry-complete` | Entrance animation completion; `components/SymposiumV0.tsx` | Tab UI only |
| `symposium-entrance-seen-v2` | Per-tab entrance decision; `features/entrance/useBrowserSessionEntrance.ts` | Tab UI only |
| `symposium:pending-content-analytics` | One-shot navigation handoff; `features/analytics/contentAnalyticsNavigation.ts` | Removed after consumption |
| `symposium:pending-community-requests` | One-shot community request-panel handoff; `components/SymposiumV0.tsx`, `features/communities/CommunityViews.tsx` | Removed after consumption |
| `symposium:content-translation-session:v1` | Legacy translation-session migration source; `features/translation/contentTranslationSession.ts` | Removed after migration to v2 |
| Cookie `symposium_entrance_session` | Same-browser-session entrance marker; `features/entrance/browserSession.ts`, `useBrowserSessionEntrance.ts`, `app/SymposiumPage.tsx` | UI only; not auth |
| Cookie `symposium-browser-session-v1` | Random browser-session namespace for viewer/translation records; `lib/browserSessionPersistence.ts` | Isolation key only; not auth |

Clerk session cookies/tokens are managed by Clerk rather than first-party key constants in this repository. The Next server exchanges the Clerk session for a bearer token in `lib/liveBackendClient.ts`; the Fastify backend verifies it in `apps/api/src/services/auth.ts`.

#### Cross-tab/browser event transports

| Storage key / channel | Purpose | Authority |
|---|---|---|
| `symposium-cross-tab-item` + `symposium-item-sync-v1` | Post/comment/action invalidation | `features/live-sync/useCrossTabItemTransport.ts`, `components/SymposiumV0.tsx` |
| `symposium-cross-tab-profile` + `symposium-profile-sync-v1` | Profile/social invalidation | same transport and `components/SymposiumV0.tsx` |
| `symposium-cross-tab-workspace` + `symposium-workspace-sync-v1` | Workspace invalidation | `features/workspace/useWorkspaceDocuments.ts`, `savePostDraftToWorkspace.ts` |
| `symposium-cross-tab-workspace-discussion` + `symposium-workspace-discussion-sync-v1` | Workspace-comment invalidation | `features/workspace/useWorkspaceComments.ts` |
| `symposium-cross-tab-scribble` + `symposium-scribble-sync-v1` | Scribble invalidation | `features/scribble/ScribbleContext.tsx` |
| `symposium-content-analytics-sync` + `symposium-content-analytics-sync-v1` | Analytics invalidation | `features/analytics/contentAnalyticsSync.ts` |
| `symposium-opportunity-applications-change` + `symposium-opportunity-applications-v1` | Opportunity-application invalidation | `features/opportunities/OpportunityViews.tsx` |
| `symposium:assistant-library:v2` | Assistant-library invalidation | `features/assistant/useAssistantController.ts` |
| `symposium-browser-presence-v2` | Entrance presence fallback across tabs | `features/entrance/useBrowserSessionEntrance.ts` |
| `symposium-local-snapshot` and `symposium-following-*` storage events | Bootstrap/profile/social reconciliation | `components/SymposiumV0.tsx` |
| `symposium:document-viewer-session:v1` storage event | Cross-tab document-view state reconciliation | `features/attachments/documentViewerSession.ts` |
| `symposium:content-translation-session:v2` storage event | Cross-tab translation-display reconciliation | `features/translation/contentTranslationSession.ts` |

Same-tab custom events are also non-durable coordination:
`symposium-workspace-change`, `symposium-scribble-change`,
`symposium-ai-quota-change`, `symposium:content-analytics-changed`,
`symposium:open-content-analytics`,
`symposium:open-community-requests`, and
`symposium-opportunity-applications-change`. They invalidate or navigate
within one browser document; cross-tab behavior, where present, comes from the
separate storage/BroadcastChannel paths above.

These `localStorage` writes and `BroadcastChannel` messages are `X`: they prompt same-browser refresh/reconciliation. They must never be treated as durable mutations, acknowledgements, or substitutes for `/v1/events` replay.

### 6. Process-local runtime state that must not be mistaken for persistence

- `apps/api/src/services/liveBus.ts`: `EventEmitter` fan-out only; durable source is Postgres `events`.
- `apps/api/src/services/rateLimit.ts`: in-memory counters for every
  process-local bucket and as fallback when a shared Redis bucket is
  unavailable.
- `apps/api/src/services/auth.ts`: bounded five-minute Clerk-user-to-handle cache.
- The six local store modules: promise queues serialize operations only inside one Node process.
- `apps/api/src/routes/eventRoutes.ts`: active stream counters and pending replay buffers are per process/connection.
- `apps/api/src/repository/contentViews.ts`: one-hour in-memory view-dedupe
  buckets; canonical content-view persistence remains in Postgres.
- `apps/api/src/services/maintenance.ts`: readiness-visible lease/run/error
  state for the current process.
- `apps/api/src/db/client.ts`: process-local pool and last-activity timestamps.
- `apps/api/src/db/migrate.ts`: cached migration status and one in-flight
  migration promise.
- `apps/api/src/server.ts`: per-request provider-cost state held in a
  `WeakMap`.

## Known asymmetries and explicit unknowns

1. **The façade and canonical API are intentionally not one-to-one.** The Next catch-all routes expose many conversation/assistant subpaths. Canonical endpoints such as post/comment view recording, call ending, community join/access, and compatibility opportunity creation may be called directly or reached through an intent-mapping façade. Route consolidation must be call-site-proven, not inferred from filename absence.
2. **Local preview is behaviorally useful but not production-equivalent.** It lacks verified multi-user identity, cross-process synchronization, durable event replay, R2 lifecycle jobs, shared Redis limits, and canonical notification fan-out. Passing local browser canaries cannot prove private multi-session durability.
3. **The local attachment lifecycle is preview-only and not account-secure.**
   The public GET route has no account check and ignores its `fileName`
   parameter; local upload PUT validates only attachment ID/state/content; and
   local confirm validates ID/state/size/metadata without an actor. All three
   are gated out of production. Preserve that production boundary and do not
   treat preview ownership as a security proof.
4. **Provider state is not established by source inspection.** This inventory proves configured code paths, not that a particular deployment currently has healthy Postgres, R2, Redis, Clerk, or OpenAI credentials. `/readyz?probe=database` and provider-specific release evidence are required separately.
5. **Schema presence is not feature reachability.** The 62-table list includes funding, moderation, credits, bounties, pledges, and other substrate whose browser/API reachability must be audited separately before deletion.
6. **`DB-W+Δ` means the traced repository stages a product event after the durable mutation.** It does not promise that every no-op/idempotent replay emits a new event; idempotency, expected revisions, dedupe buckets, and mutation receipts intentionally suppress duplicate state transitions.
7. **R2 deletion is durably queued, not synchronously guaranteed.** The
   database job and retry worker preserve the obligation, but physical
   completion still depends on R2 eventually accepting the delete.
8. **No websocket transport is present.** Live server delivery is SSE plus durable cursor replay; same-browser invalidation also uses `BroadcastChannel`/storage events.
9. **No browser IndexedDB use was found.** Browser persistence in the tracked runtime is limited to the enumerated Web Storage/cookie surfaces.
10. **The legacy `dataStore` has its own five-table PostgreSQL mode.** It is a preview compatibility path, not a second production schema authority. Any removal requires proving that no local-preview or migration workflow still depends on it.
11. **Receipt-backed idempotency is not universal.** Of 95 Fastify write
    registrations, 66 pass a `mutationContextFromRequest` and 29 ignore the
    `Idempotency-Key` header. The browser client nevertheless treats a mutation
    carrying that header as replay-safe when falling back from the direct API
    to the same-origin façade. Draft/role/delete conversation operations, call
    join/end, parts of attachment lifecycle, notification mutations, auth
    sync, and passive views are among the non-receipt-backed families. Some
    are naturally deduplicated; others can conflict, return `404`, or rewrite
    timestamps on replay. A consolidation must not infer server replay safety
    from client header presence.
12. **Mutation receipts are opt-in and have a stranded-pending case.** Without
    an idempotency header, no receipt exists. Completed receipts are pruned
    after seven days; maintenance does not prune `pending` receipts.
    Assistant/translation provider work uses prepare → provider → finalize
    transactions, so a process failure after prepare can leave the matching key
    permanently conflicting as still in progress. That is a characterized
    recovery gap, not proof of exactly-once provider execution.
13. **Receipt identity includes route-chosen scope and hash shape.** The
    mutation helper does not automatically include HTTP method/path. Each
    route chooses its scope and payload; several Workspace routes hash only
    the body and omit path IDs. Refactoring must preserve or deliberately
    migrate both scope and hash-input semantics.
14. **Revision and wire-error behavior is route-specific.** Thirty-eight
    registrations inspect an expected revision, including
    `POST /assistant/messages` conditionally through nested
    `draftSession.expectedRevision`. The Assistant per-answer cost ceiling
    currently throws `PAYLOAD_TOO_LARGE`, but `sendError` has no mapping for
    that TRPC code, so the wire response is `500`, not `413`; Fastify's native
    body-limit `413` is separately normalized. This is a characterized defect,
    not a generic error contract to propagate blindly.

## Refactor preservation gates derived from this inventory

A pass touching this spine is incomplete until it proves:

- the global Next proxy/layout/config boundaries retain Clerk activation,
  authorized origins, CSP/CSRF behavior, global design imports, public
  attachment rewriting, immutable asset caching, and sitewide headers;
- all 16 page paths still parse, serialize, and hydrate the intended canonical view;
- all 85 Next handler files/116 method surfaces are either preserved or have characterized, caller-migrated replacements;
- all 141 Fastify registrations/110 paths retain method/auth/visibility; the
  additive base limiter and 46 non-default policies; the 66 receipt-capable
  scopes and 29 exclusions; the 38 revision-aware registrations and
  conditional rules; and the shared error envelope, six direct status-body
  sites, SSE/socket bounds, and provider/saga failure semantics documented
  here. Any touched route family still attaches focused characterization for
  repository-specific authorization, no-op, and error-message behavior;
- each documented Postgres transaction remains atomic with its event staging,
  and events publish only after that transaction commits; multi-phase R2,
  Workspace-publication, and AI workflows retain their recovery semantics
  rather than being misrepresented as one transaction;
- SSE cursor replay survives reconnect without visibility leakage;
- R2 prepare/upload/confirm/access/promotion/deletion-job behavior remains intact;
- all six preview stores retain their cascade/attachment/revision behavior wherever preview support is intentionally kept;
- browser caches remain subordinate to server authority, while unsent message/scribble recovery is not lost;
- local data read/write fallbacks remain impossible in production while the
  explicit heartbeat-only `/api/events/stream` compatibility behavior remains
  characterized; and
- release evidence distinguishes local proof, remote CI proof, provider readiness, and deployed production proof.
