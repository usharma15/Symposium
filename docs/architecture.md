# SYMPOSIUM Platform Architecture

## Purpose

SYMPOSIUM is moving from a stable live prototype into a modular platform. This is an incremental extraction, not a rewrite. Every checkpoint must preserve current behavior, remain deployable, and reduce responsibility overlap or failure radius.

## Existing load-bearing kernel

The following systems are established and should be reused rather than rebuilt:

- Clerk-derived actor identity and server-side authorization.
- Transactional domain writes, idempotency receipts, audits, and durable events.
- Canonical post/comment action ledgers and monotonic action revisions.
- Repeatable-read bootstrap snapshots and privacy-safe public projections.
- Verified attachment staging, immutable promotion, quotas, and durable object-lifecycle cleanup.
- Migration-aware readiness, request correlation, maintenance, and release gates.
- A production-fail-closed Next bridge plus an explicit local-preview adapter.

## Target dependency direction

```text
app routes and shell
        |
        v
feature UI and controllers
        |
        v
shared client state, API and live-sync adapters
        |
        v
versioned contracts
        ^
        |
backend routes -> domain services -> repositories -> Postgres/R2/Redis
```

Dependencies may point down this graph, never back into the application shell. A feature owns its policy and rendering. Shared modules own only invariants consumed by more than one feature.

## Target domains

- Identity and profiles
- Posts and publications
- Comments and discussion trees
- Attachments and embeds
- Links, quotes, citations, and references
- Workspaces, notes, drafts, revisions, and publishing
- Communities, membership, calls, and permissions
- Conversations, messages, notifications, and presence
- Search, indexing, sorting, and discovery
- Funding, opportunities, bounties, and ledgers
- AI assistant conversations and context

Cross-domain writes use the existing mutation envelope. Cross-domain reads use explicit contracts or projections rather than reaching into another domain's tables or client state.

## Canonical resource routes

The application will progressively replace its private history stack with URLs that survive reloads and can be opened in new tabs:

- `/posts/[postId]`
- `/posts/[postId]?comment=[commentId]`
- `/profiles/[handle]`
- `/profiles/[handle]/followers`
- `/profiles/[handle]/following`
- `/communities/[slug]`
- `/workspace`
- `/messages?conversation=[conversationId]`
- `/opportunities`
- `/funding`

The existing in-world navigation remains the visual shell. URL routing becomes its state authority rather than a competing navigation system.

Canonical routing is live for public rooms, workspace modes, funding modes, opportunities, messages and selected conversations, the community directory, selected communities, profiles and social graphs, posts, and selected comments. Resource navigation uses semantic anchors with a client-navigation adapter: ordinary clicks retain the synchronized shell, while modified clicks, middle-click, copying, and new tabs retain native browser behavior. Direct-entry application Back falls back to the Main Hall without manufacturing a history loop.

## Shared content model

The additive version-1 document and durable resource-reference contracts are defined in `packages/contracts`. Current `title` and `body` fields remain readable during migration. The first supported primitives correspond to imminent consumers:

- paragraphs, headings, lists, and code
- attachment references and placement
- safe external links and previews
- quote/reference blocks with durable source identity
- citations and footnotes

Posts, comments, notes, drafts, and messages receive capability policies over this shared model; they do not receive separate incompatible editors.

## Attachment ownership

Attachments remain independent staged resources. Binding them to posts, comments, notes, drafts, or messages is an atomic owner transition performed inside the owning domain mutation. Editing uses a declared retained/added/removed set so detached objects can be expired safely.

Post, comment, and reply attachments now use the shared owner-neutral claim service. Post and comment edits submit the complete desired attachment identity set under a content-version precondition; retained objects stay ordered, new staged objects are claimed in the owning transaction, and removed objects become unavailable and enter the durable deletion queue before commit. Comments under private Office/draft posts fail closed until protected attachment delivery is available.

Posts and comments also share one quote-reference contract. Either owner type can quote either public source type; the destination stores an exact-word, non-recursive source snapshot inside its own transaction, edits use the same content-version precondition, and source deletion strips the snapshot while preserving only safe canonical identity for an unavailable-state card.

## Client reconciliation

Inbound state has three classes:

1. Mutation responses are authoritative for the mutation that produced them.
2. Live events are monotonic hints or complete entities when privacy allows.
3. Bootstrap is a canonical snapshot, but a request that began before a local content mutation must not erase optimistic or newly committed state.

The shared item mutation coordinator records per-item epochs and pending mutations, publishes ordered cross-tab snapshots, and reconciles bootstrap and live input. Posts expose an authoritative aggregate revision that advances for direct post mutations and every nested-comment mutation. Profiles, comments, and follow relationships also expose revisions. A higher authoritative revision converges immediately; a lower one is rejected permanently; equal or legacy snapshots still use the optimistic mutation guard and bounded cross-tab convergence lease.

Optimistic action membership and metrics use a clock-independent action-state guard. Stale live events remain unable to reverse the latest local intent, regardless of request duration. Protection is retired only when a bootstrap request that began after the mutation confirms both membership and metric direction. This avoids timer-based snap-back while still allowing later canonical changes to converge.

The client collection is normalized into `byId` plus stable order before it reaches the shell. Synchronous refs and React state are updated through one entity-store boundary, so mutation handlers, live events, bootstrap replacement, persistence, and rendering cannot maintain divergent copies. Mutation ordering is owned by `features/mutations/itemMutationCoordinator.ts`; action reconciliation is owned by `features/live-sync/inquiryActionReconciler.ts`, not by UI components.

Profiles reuse the same collection coordinator and ordered browser transport as inquiry items. Follow relationships use a relationship-specific coordinator that tracks the pending desired state and the last authoritative relationship revision, so refreshes and delayed events cannot reverse a follow or unfollow while its request is outstanding. Profile, follow, post, comment, and action writes all use the shared JSON API client and idempotency-key policy.

## Frontend ownership

`SymposiumV0.tsx` is the application controller: authentication lifecycle, route-level state, mutation invocation, persistence decisions, and composition. HTTP normalization, retry identities, SSE/polling lifecycle, browser cross-tab delivery, mutation ordering, and reconciliation are delegated to shared infrastructure. Rendering and feature policy are owned below it:

- `features/posts`: composers, feed cards, detail views, edit surfaces, post action presentation
- `features/comments`: discussion trees, reply-window paging, comment ownership and actions
- `features/attachments`: metadata generation, carousel, document/media previews, zoom and fullscreen
- `features/profiles`: activity projection, privacy-aware tabs, social graph and settings
- `features/communities`, `features/rooms`, `features/workspace`, `features/messages`, `features/search`: their respective surfaces
- `features/entities`, `features/live-sync`, `features/navigation`, `features/actions`: shared client invariants and contracts
- `features/api`: same-origin JSON requests, structured failures, and retry-safe mutation identities

Feature modules cannot import the application shell or Next routes, must stay bounded in size, and must form an acyclic dependency graph. These constraints are executable architecture checks.

`app/globals.css` is an ordered manifest. Styles are split into numbered foundation, established, immersive, overlay, and responsive layers under `styles/`. Numbering preserves the proven cascade while each layer declares ownership and has an enforced size ceiling.

The canonical browser-history state machine is owned by `features/navigation/useCanonicalBrowserHistory.ts`. The shell supplies and restores view snapshots, but it does not directly implement browser index, popstate, or direct-entry fallback policy.

Browser-session entry is server-coordinated. `app/SymposiumPage.tsx` reads a non-persistent session cookie and renders subsequent tabs directly into their canonical route; `features/entrance/useBrowserSessionEntrance.ts` establishes the marker on the first visit. The first browser-session visit alone owns the five-second entrance. `features/bootstrap/cachedBootstrap.ts` owns best-effort cached entity/profile hydration so later tabs do not wait for Clerk synchronization or the live bootstrap request before rendering useful content. Browser storage quota pressure is non-fatal and cannot fail a live mutation. Server-rendered shell values, including timestamps, must be deterministic across server and browser locales to preserve hydration.

## Backend ownership

Backend persistence is split into bounded repositories for posts, comments, identity, profiles, communities, conversations, notifications, search, workspaces, attachments, actions, opportunities, and the assistant. HTTP and tRPC routes import their owning repository directly. Cross-domain note-to-post publication is explicit in `services/notePublishing.ts`; there is no compatibility façade. Domain repositories may depend on the shared foundation, transaction, mutation, audit, event, database, and storage kernels, but they may not import one another sideways.

## Extraction order

1. Characterization checks and mutation-safe inbound reconciliation. Complete.
2. Canonical URL routing and shell/navigation separation. Complete for current surfaces.
3. Shared normalized entity store and live-sync controller. Complete for current inquiry entities and action reconciliation.
4. Comment tree and composer extraction. Complete.
5. Attachment gallery, viewer, uploader, post/comment ownership, editing, and deletion extraction. Complete for public posts, comments, and replies; private note/message delivery remains intentionally fail-closed.
6. Post composer/detail/feed extraction. Complete.
7. Profile activity and social graph extraction. Complete.
8. Workspace/notes wiring and shared editor foundation. Presentation extracted and authoritative note/block revision guards are in place; durable structured-document/editor integration remains next-stage work.
9. Layer `globals.css` into tokens, foundations, layout, shared components, and feature styles. Complete with cascade-preserving layers.
10. Split the backend live repository by domain while retaining the shared transaction kernel. Complete: routes now address domain repositories directly and cross-domain orchestration is service-owned.
11. Add server-authoritative entity revisions and a shared cross-tab mutation coordinator. Complete for posts, comments, profiles, follows, bootstrap, live events, and the current edit/delete mutation envelope.
12. Extract the client API, live-event, and browser-transport kernels and extend idempotent mutation coverage to profiles and follows. Complete.

## Checkpoint gates

Every extraction must satisfy:

- Existing behavior remains visually and semantically equivalent.
- `npm run verify` passes.
- Relevant browser characterization cases pass without flicker or console errors.
- Persistence survives reload.
- Live updates converge in another session.
- The production frontend and API report the same release.
- Old code is removed after its replacement is proven; permanent dual implementations are not accepted.
