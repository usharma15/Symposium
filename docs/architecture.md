# SYMPOSIUM Platform Architecture

## Purpose

SYMPOSIUM is moving from a stable live prototype into a modular platform. This is an incremental extraction, not a rewrite. Every checkpoint must preserve current behavior, remain deployable, and reduce responsibility overlap or failure radius.

## Existing load-bearing kernel

The following systems are established and should be reused rather than rebuilt:

- Clerk-derived actor identity and server-side authorization.
- Transactional domain writes, idempotency receipts, audits, and durable events.
- Canonical post/comment action ledgers and monotonic action revisions.
- Repeatable-read bootstrap snapshots and privacy-safe public projections.
- Verified attachment staging, immutable promotion, quotas, and cleanup.
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
- `/communities/[slug]`
- `/workspace`
- `/messages`
- `/opportunities`
- `/funding`

The existing in-world navigation remains the visual shell. URL routing becomes its state authority rather than a competing navigation system.

Canonical routing is live for public rooms, workspace modes, funding modes, opportunities, messages, the community directory, selected communities, profiles, posts, and selected comments. These routes share one server wrapper and one client shell, survive direct reload, and store full view snapshots in browser history so Back and Forward retain the established scroll and comment-stack behavior.

## Shared content model

Rich content will be introduced through an additive, versioned document contract. Current `title` and `body` fields remain readable during migration. The first supported primitives should correspond to imminent consumers:

- paragraphs, headings, lists, and code
- attachment references and placement
- safe external links and previews
- quote/reference blocks with durable source identity
- citations and footnotes

Posts, comments, notes, drafts, and messages receive capability policies over this shared model; they do not receive separate incompatible editors.

## Attachment ownership

Attachments remain independent staged resources. Binding them to posts, comments, notes, drafts, or messages is an atomic owner transition performed inside the owning domain mutation. Editing uses a declared retained/added/removed set so detached objects can be expired safely.

## Client reconciliation

Inbound state has three classes:

1. Mutation responses are authoritative for the mutation that produced them.
2. Live events are monotonic hints or complete entities when privacy allows.
3. Bootstrap is a canonical snapshot, but a request that began before a local content mutation must not erase optimistic or newly committed state.

The item mutation guard records per-item epochs and pending mutations, including post and comment actions. Bootstrap reconciliation preserves an item when the item is currently mutating or changed after that bootstrap request began, then converges on the next fresh snapshot.

Optimistic action membership and metrics use a clock-independent action-state guard. Stale live events remain unable to reverse the latest local intent, regardless of request duration. Protection is retired only when a bootstrap request that began after the mutation confirms both membership and metric direction. This avoids timer-based snap-back while still allowing later canonical changes to converge.

The client collection is normalized into `byId` plus stable order before it reaches the shell. Synchronous refs and React state are updated through one entity-store boundary, so mutation handlers, live events, bootstrap replacement, persistence, and rendering cannot maintain divergent copies. Action reconciliation is owned by `features/live-sync/inquiryActionReconciler.ts`, not by UI components.

## Frontend ownership

`SymposiumV0.tsx` is the application controller: authentication lifecycle, route-level state, mutation orchestration, live-event subscription, persistence calls, and composition. Rendering and feature policy are owned below it:

- `features/posts`: composers, feed cards, detail views, edit surfaces, post action presentation
- `features/comments`: discussion trees, reply-window paging, comment ownership and actions
- `features/attachments`: metadata generation, carousel, document/media previews, zoom and fullscreen
- `features/profiles`: activity projection, privacy-aware tabs, social graph and settings
- `features/communities`, `features/rooms`, `features/workspace`, `features/messages`, `features/search`: their respective surfaces
- `features/entities`, `features/live-sync`, `features/navigation`, `features/actions`: shared client invariants and contracts

Feature modules cannot import the application shell or Next routes, must stay bounded in size, and must form an acyclic dependency graph. These constraints are executable architecture checks.

`app/globals.css` is an ordered manifest. Styles are split into numbered foundation, established, immersive, overlay, and responsive layers under `styles/`. Numbering preserves the proven cascade while each layer declares ownership and has an enforced size ceiling.

## Extraction order

1. Characterization checks and mutation-safe inbound reconciliation. Complete.
2. Canonical URL routing and shell/navigation separation. Complete for current surfaces.
3. Shared normalized entity store and live-sync controller. Complete for current inquiry entities and action reconciliation.
4. Comment tree and composer extraction. Complete.
5. Attachment gallery, viewer, uploader, and ownership extraction. Client domain complete; future owner types remain additive backend work.
6. Post composer/detail/feed extraction. Complete.
7. Profile activity and social graph extraction. Complete.
8. Workspace/notes wiring and shared editor foundation. Presentation extracted; durable document/editor contract remains next-stage work.
9. Layer `globals.css` into tokens, foundations, layout, shared components, and feature styles. Complete with cascade-preserving layers.
10. Split the backend live repository by domain while retaining the shared transaction kernel.

## Checkpoint gates

Every extraction must satisfy:

- Existing behavior remains visually and semantically equivalent.
- `npm run verify` passes.
- Relevant browser characterization cases pass without flicker or console errors.
- Persistence survives reload.
- Live updates converge in another session.
- The production frontend and API report the same release.
- Old code is removed after its replacement is proven; permanent dual implementations are not accepted.
