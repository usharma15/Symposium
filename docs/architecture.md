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

Provider calls are also traffic-shaped. Public reads and process health checks remain local except for their authoritative Postgres read; they do not spend Redis commands. Redis is reserved for distributed authenticated-mutation limits. Live events commit durably to Postgres, publish through the active process bus, and replay from a cursor on connect or reconnect rather than polling or publishing into an unused provider channel.

The cached public shell uses a static-compatible CSP. Per-request nonce policies are not applied to prerendered HTML because build-time script tags cannot carry a request-time nonce; the production build gate inspects every static shell artifact and its matching CSP mode so a security-header change cannot silently block hydration. Resource authorization remains enforced at the API and repository boundaries rather than depending on the browser policy.

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
- `/profiles/[handle]/[activity-filter]`
- `/profiles/[handle]/followers`
- `/profiles/[handle]/following`
- `/communities/[slug]`
- `/workspace`
- `/messages?conversation=[conversationId]`
- `/opportunities`
- `/funding`

The existing in-world navigation remains the visual shell. URL routing becomes its state authority rather than a competing navigation system.

Canonical routing is live for public rooms, workspace modes, the unified Patronage Hall, opportunities, messages and selected conversations, the community directory, selected communities, profiles, profile activity filters and social graphs, posts, and selected comments. Resource navigation uses semantic anchors with a client-navigation adapter: ordinary clicks retain the synchronized shell, while modified clicks, middle-click, copying, and new tabs retain native browser behavior. Direct-entry application Back falls back to the Main Hall without manufacturing a history loop. Legacy Patronage mode query strings normalize to `/funding`; civic and private capital are not separate feed modes.

## Shared content model

The additive version-1 document and durable resource-reference contracts are defined in `packages/contracts`. Current `title` and `body` fields remain readable during migration. The first supported primitives correspond to imminent consumers:

- paragraphs, headings, lists, and code
- attachment references and placement
- safe external links and previews
- quote/reference blocks with durable source identity
- citations and footnotes

Posts, comments, notes, drafts, and messages receive capability policies over this shared model; they do not receive separate incompatible editors.

## Workspace documents

Notes are a private workspace-document family, not a second post store. Generic Notes, Paper drafts, and Patronage Proposal drafts use the full shared editor; Thought, Comment, and Reply drafts use the reduced capability policy. A proposal remains an ordinary paper-grade draft marked with the `proposal` publication target and exact funding metadata rather than becoming a new Office category. `All` is a virtual last-edited projection, while a document may be filed in zero or one durable notebook.

Every create, autosave, explicit Save Draft, and notebook-removal move advances the document revision and stores an immutable `workspace_note_revisions` checkpoint. Publish always resolves the exact open revision, serializes against saves and notebook moves with a document-scoped advisory lock, and records a unique note/revision publication. A successful publication promotes the draft out of every workspace projection, transfers its discussion tree into the public post or published comment, and retains only the internal publication, revision, and audit linkage required for idempotency and recovery. A collaborator with publish rights publishes under the immutable document owner's authorship; the publisher remains separately audited.

The workspace root is always private. Notebook and document grants define cumulative viewer, commenter, editor, and publisher roles, with notebook access inherited by current and future filed documents. Generic Notes and Papers are collaboration-capable; Thoughts, Comments, and Replies remain owner-editable and owner-publishable. The sharing-and-collaboration manager exposes the same authoritative grants in note cards, note details, notebook rows, and navigation menus; it enforces delegated role ceilings, exact grant revisions, direct-plus-inherited precedence, grantor/owner revocation, self-leave, audit events, notifications, local fallback, and live/cross-tab convergence. Draft discussion uses the same effective-access projection and intentionally omits public quote and reshare actions.

## Patronage proposals

The Patronage Hall is one public proposal feed at `/funding`, using the same For you and Following scopes as the other feed rooms. A proposal is a paper-grade post with an additional validated funding projection: status, currency, goal, optional deadline, provider-confirmed amount, supporter count, and at most ten public supporter rows. Proposal creation lives in the global post composer; Save draft creates an ordinary Office paper draft marked as a proposal, and exact-revision publishing preserves its funding metadata.

The public proposal JSON on a post is a read projection. `patronage_proposals` is the canonical proposal record and `patronage_contributions` is the provider-keyed append-only payment ledger from which confirmed totals and leaderboards can later be rebuilt. No client mutation can write raised totals or supporters directly. Until a payment provider is integrated, Contribute explains that no payment or contribution has been created; Private Capital is an explicitly disabled coming-soon action. Compute markets, resource exchange, crypto, bounties, and private-capital coordination are outside this construction boundary.

## Attachment ownership

Attachments remain independent staged resources. Binding them to posts, comments, notes, drafts, or messages is an atomic owner transition performed inside the owning domain mutation. Editing uses a declared retained/added/removed set so detached objects can be expired safely.

Post, comment, reply, and workspace-document attachments use the shared owner-neutral claim service. Edits submit the complete desired attachment identity set under a content-version precondition; retained objects stay ordered even when an authorised collaborator did not upload them, new staged objects are claimed in the owning transaction, and removed objects become unavailable and enter the durable deletion queue before commit. Public PDF previews use a fixed-origin same-site rewrite because the current public R2 endpoint does not expose browser CORS headers; this lets PDF.js fetch pages without turning the frontend into an arbitrary URL proxy or waking Neon. Workspace attachments use permission-checked same-origin delivery and short-lived signed object URLs. Publishing an exact workspace revision creates deterministic public copies for the document and its discussion, rewrites inline attachment references to the public identities, then durably queues the private source objects for deletion after the public owners are committed. Private message attachment delivery remains intentionally fail-closed.

Posts and comments also share one quote-reference contract. Either owner type can quote either public source type through the direct quote action or by attaching a canonical Symposium link while drafting; the destination stores an exact-word, formatting-preserving, non-recursive source snapshot inside its own transaction, edits use the same content-version precondition, and source deletion strips the snapshot while preserving only safe canonical identity for an unavailable-state card.

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
- `features/attachments`: metadata generation, carousel, document/media previews, continuous virtualized PDF.js and DOCX reading surfaces, attachment-scoped reading/translation sessions shared across preview/modal/fullscreen, scroll-derived active-page context, fitted structured in-place page translation, selectable PDF text, zoom and fullscreen
- `features/profiles`: activity projection, privacy-aware tabs, social graph and settings
- `features/communities`, `features/rooms`, `features/workspace`, `features/messages`, `features/search`: their respective surfaces
- `features/entities`, `features/live-sync`, `features/navigation`, `features/actions`: shared client invariants and contracts
- `features/api`: same-origin JSON requests, structured failures, and retry-safe mutation identities

Feature modules cannot import the application shell or Next routes and must form an acyclic dependency graph. Architecture checks enforce dependency direction and ownership without imposing arbitrary file-length ceilings.

`app/globals.css` is an ordered manifest. Styles are split into numbered foundation, established, immersive, overlay, and responsive layers under `styles/`. Numbering preserves the proven cascade while each layer declares ownership and has an enforced size ceiling.

The canonical browser-history state machine is owned by `features/navigation/useCanonicalBrowserHistory.ts`. The shell supplies and restores view snapshots, but it does not directly implement browser index, popstate, or direct-entry fallback policy.

Browser-session entry is server-coordinated. `app/SymposiumPage.tsx` reads a non-persistent session cookie and renders subsequent tabs directly into their canonical route; `features/entrance/useBrowserSessionEntrance.ts` establishes the marker on the first visit. The first browser-session visit alone owns the five-second entrance. `features/bootstrap/cachedBootstrap.ts` owns best-effort cached entity/profile hydration so later tabs do not wait for Clerk synchronization or the live bootstrap request before rendering useful content. Exact Clerk-user identity and viewer-scoped profile first-page projections extend that acceleration boundary to returning authenticated profile routes; the same existing API reads always revalidate them, cursor continuations remain network-only, and no provider request is added. Browser storage quota pressure is non-fatal and cannot fail a live mutation. Server-rendered shell values, including timestamps, must be deterministic across server and browser locales to preserve hydration.

## Backend ownership

Backend persistence is split into bounded repositories for posts, comments, identity, profiles, communities, conversations, notifications, search, workspaces, attachments, actions, opportunities, and the assistant. HTTP and tRPC routes import their owning repository directly. Cross-domain note-to-post and note-to-proposal publication is explicit in `services/notePublishing.ts`; there is no compatibility façade. The post repository owns proposal creation and metadata edits in the same transaction as the public post, while payment ingestion remains gated behind a future provider-owned service. Domain repositories may depend on the shared foundation, transaction, mutation, audit, event, database, and storage kernels, but they may not import one another sideways.

The notification repository owns page/unread reads and read convergence. Domain mutations supply notification copy and metadata to the shared notification-delivery service while still inside their existing transaction; that kernel performs recipient-safe insertion, stable deduplication, and private recipient-event staging. Message bodies deliberately remain outside this notification table because Quick Messages has its own authoritative unread/read model.

## Extraction order

1. Characterization checks and mutation-safe inbound reconciliation. Complete.
2. Canonical URL routing and shell/navigation separation. Complete for current surfaces.
3. Shared normalized entity store and live-sync controller. Complete for current inquiry entities and action reconciliation.
4. Comment tree and composer extraction. Complete.
5. Attachment gallery, viewer, uploader, post/comment ownership, editing, and deletion extraction. Complete for public posts, comments, and replies, protected workspace-document delivery, public copies of exact private note revisions, and bounded client-side PDF text/page grounding. PDF image understanding and derived translated PDFs remain separate, explicitly gated passes; private message delivery remains intentionally fail-closed.
6. Post composer/detail/feed extraction. Complete.
7. Profile activity and social graph extraction. Complete.
8. Workspace/notes wiring and shared editor foundation. Complete for the construction and collaboration passes: durable workspace documents and notebooks, structured editor capability policies, immutable revisions, autosave/checkpoint saves, exact-revision publication, protected note attachments, public publication copies, permission-safe search, direct and inherited role management, private draft discussion, local/live persistence, and cross-tab convergence. Quick Note capture remains the explicit next-pass gate.
9. Layer `globals.css` into tokens, foundations, layout, shared components, and feature styles. Complete with cascade-preserving layers.
10. Split the backend live repository by domain while retaining the shared transaction kernel. Complete: routes now address domain repositories directly and cross-domain orchestration is service-owned.
11. Add server-authoritative entity revisions and a shared cross-tab mutation coordinator. Complete for posts, comments, profiles, follows, bootstrap, live events, and the current edit/delete mutation envelope.
12. Extract the client API, live-event, and browser-transport kernels and extend idempotent mutation coverage to profiles and follows. Complete.
13. Construct the unified Patronage Hall domain. Complete for proposal contracts, creation and editing, Office drafts, exact-revision publication, canonical proposal and contribution-ledger storage, local/live persistence, feed and detail projections, and payment/private-capital feature gates. Provider payment ingestion remains intentionally unopened.

## Checkpoint gates

Every extraction must satisfy:

- Existing behavior remains visually and semantically equivalent.
- `npm run verify` passes.
- Relevant browser characterization cases pass without flicker or console errors.
- Persistence survives reload.
- Live updates converge in another session.
- The production frontend and API report the same release.
- Old code is removed after its replacement is proven; permanent dual implementations are not accepted.
