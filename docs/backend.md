# SYMPOSIUM Live Backend

This repo now has two runtime surfaces:

- `next dev` / Vercel: the laptop-first SYMPOSIUM interface.
- `npm run api:dev` / Render: the live TypeScript backend.

The existing Next API routes remain in place for local preview, Clerk profile synchronization, protected attachment delivery, and compatibility fallback. When `SYMPOSIUM_API_URL` is set on Vercel, ordinary browser requests and the authenticated live-event stream connect directly to Render with the Clerk bearer token. This removes the Vercel function hop from normal traffic. A failed direct GET or idempotent mutation may retry through the compatibility bridge; application errors never replay. When the backend URL is not set, local development keeps using the existing `.data/symposium.json` fallback.

Current production endpoints:

- Web: `https://symposium-flax.vercel.app`
- API: `https://symposium-api-ue3p.onrender.com`
- Liveness: `https://symposium-api-ue3p.onrender.com/healthz`
- Readiness: `https://symposium-api-ue3p.onrender.com/readyz`

Render forces `Cache-Control: no-store` on `/v1/*`. The compatibility bridge also forces `no-store` and varies responses by authorization and cookie state.

## Local API

```bash
npm run api:dev
```

The API listens on `http://localhost:4000` by default.

Useful endpoints:

- `GET /healthz`
- `GET /readyz`
- `GET /v1/bootstrap`
- `GET /v1/posts`
- `POST /v1/posts`
- `POST /v1/posts/:id/comments`
- `POST /v1/posts/:id/actions`
- `POST /v1/posts/:id/views`
- `POST /v1/posts/:id/comments/:commentId/views`
- `GET /v1/follows`
- `POST /v1/profiles/:handle/follow`
- `DELETE /v1/profiles/:handle/follow`
- `GET /v1/communities`
- `POST /v1/communities/:id/join`
- `GET /v1/communities/:id/calls`
- `POST /v1/communities/:id/calls`
- `POST /v1/calls/:id/join`
- `POST /v1/calls/:id/end`
- `GET /v1/opportunities`
- `POST /v1/opportunities`
- `GET /v1/conversations`
- `POST /v1/messages`
- `GET /v1/notifications`
- `GET /v1/workspace`
- `POST /v1/notes/blocks`
- `POST /v1/notes/publish`
- `POST /v1/assistant/messages`
- Authenticated browser clients call `/v1/*` directly; the matching Next.js routes remain compatibility fallbacks.
- Server-sent events provide the single realtime transport. The unused Socket.IO and tRPC HTTP surfaces have been removed.

Every API response includes `X-Request-Id`. Validation and application errors also include the same value in the JSON body, so a client-visible failure can be matched to one backend log entry without exposing internal exception text.

Every API response also includes a `Server-Timing` measurement for total application time and cumulative Postgres time, with the request-scoped query count in the database metric description. The backend emits structured `request_cost_sample` logs for a deterministic two-percent sample and `request_cost_budget_exceeded` for every route-budget violation. Routes are logged by their Fastify templates rather than concrete IDs, so the measurements remain low-cardinality and do not expose resource identifiers.

Profile activity is one bounded read model: its timeline response carries the required post/comment card projections and public profiles, so the browser does not fan one filter load into follow-up post requests. Exact aggregate totals are returned on the first load and explicit live refreshes; cursor continuation pages reuse those authoritative totals instead of repeating the aggregate query.

Returning browsers may paint a bounded, viewer-scoped first page of profile activity and social lists from local storage while that same route request revalidates against the API. The projection is keyed by the exact authenticated viewer and target, expires after 24 hours, and never replaces canonical mutation or live-event reconciliation. Cached Clerk identity is keyed by the exact Clerk user ID solely to start reads before `/v1/auth/sync` completes; the existing sync request still verifies and replaces it. These acceleration layers add no provider requests, fail open under storage pressure, and never cache cursor continuation pages.

## Environment

Backend:

```bash
DATABASE_URL=postgres://...
DATABASE_POOL_MAX=4
DATABASE_IDLE_TIMEOUT_MS=30000
CLERK_SECRET_KEY=sk_...
CLERK_JWT_AUDIENCE=
SYMPOSIUM_STRICT_ENV=true
SYMPOSIUM_WEB_ORIGINS=https://your-vercel-domain.vercel.app
SYMPOSIUM_REQUIRE_AUTH=true
SYMPOSIUM_ALLOW_DEV_ACTOR=false
SYMPOSIUM_OWNER_CLERK_USER_ID=user_...
SYMPOSIUM_OWNER_HANDLE=@udayan
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
R2_ACCOUNT_ID=...
R2_BUCKET=symposium-uploads
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=https://your-public-r2-domain.example
OPENAI_API_KEY=
SYMPOSIUM_AI_MODEL=gpt-5.4-mini
```

Frontend/Vercel:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
SYMPOSIUM_API_URL=https://your-render-api.onrender.com
```

If the Clerk key pair is missing, the frontend deliberately runs in local preview mode. The entrance flow shows a local-preview button, Clerk middleware/provider are skipped, and `/api/auth/sync` returns a controlled 503 instead of crashing. Real account creation/sign-in requires both Clerk keys.

For local bridge testing without production Clerk enforcement on the API, run the backend with:

```bash
SYMPOSIUM_ALLOW_DEV_ACTOR=true
SYMPOSIUM_REQUIRE_AUTH=false
```

That lets local development fall back to `x-symposium-handle` when no Clerk token is available. Production should use Clerk tokens.

When `SYMPOSIUM_API_URL` is configured on Vercel, Render is the source of truth. Direct requests do not fall back to local v0 storage, and the compatibility bridge returns a controlled 503 when Render is unavailable.

## Deployment Preflight

Before entering provider values into Render or Vercel, generate the secret-safe live env report:

```bash
npm run live:env:report
```

Once the live env vars are present in the shell or platform environment, use the strict form:

```bash
npm run live:env:check
```

`live:env:report` prints only key names and configured/missing status. It does not print secret values.

Before deploying the Render API, set the provider env vars and run:

```bash
npm run deploy:api:check
```

With `SYMPOSIUM_STRICT_ENV=true`, the API refuses to start unless the live provider boundary is complete:

- Neon/Postgres connection string.
- Clerk backend secret.
- non-local `SYMPOSIUM_WEB_ORIGINS`.
- authenticated writes enabled.
- dev actor fallback disabled.
- Upstash Redis config for distributed authenticated-mutation limiting.
- Cloudflare R2 config.
- a public R2 delivery base URL for post and profile attachments.
- owner Clerk user mapping for the reserved `@udayan` handle.

For a smoke test against a running API:

```bash
npm run api:smoke
```

By default this checks `http://localhost:4000`. It verifies liveness, readiness, bootstrap data, communities, community call reads, opportunity reads, and public validation error handling. To check Render:

```bash
SYMPOSIUM_SMOKE_URL=https://your-render-api.onrender.com npm run api:smoke
```

For a deeper write-path smoke against local dev mode, or against a live API when `SYMPOSIUM_SMOKE_TOKEN` contains a valid Clerk session token:

```bash
npm run api:smoke:writes
```

This creates verification posts, comments, post actions, community calls, opportunities, note blocks, note publications, and assistant messages. Use it only against environments where test writes are acceptable.

`/healthz` is a cheap process liveness check. `/readyz` is the safer deployment-readiness check: it verifies the database connection and migration position, reports the maintenance worker and release identifier, and checks the provider boundary without returning secret values. Neither endpoint spends an Upstash command. In strict live mode readiness expects Neon/Postgres, Clerk, non-local web origins, authenticated writes, disabled dev actors, Upstash for shared mutation limits, R2, a public R2 delivery URL, and the reserved owner handle binding. The AI tablet provider is reported separately because the fallback response is valid until model execution policy is finalized.

## Integrity Architecture

The durable API follows one mutation rule: domain changes, idempotency receipts, audit records, and durable live events are committed in the same Postgres transaction. Live publication happens only after commit. The active process bus delivers new events without polling Postgres; the initial stream connection and every reconnect replay durable events from the last cursor.

The production browser opens the authenticated SSE stream directly against Render. The legacy Next stream route is a short `307` compatibility redirect, so stale clients cannot leave a Vercel function running until its runtime ceiling.

The public entry routes remain prerendered for fast CDN delivery. Their CSP deliberately uses the App Router-compatible inline bootstrap mode instead of a per-request nonce: static HTML is built before a request nonce exists, and combining the two prevents React and Next from hydrating. `npm run build` verifies the emitted static artifacts and the matching middleware policy together.

Passive post and comment views return their canonical item directly to the initiating browser. Public action events carry revisioned metric patches, so read, save, signal, and fork convergence does not download the full bootstrap snapshot.

The current guarantees are:

- High-risk creates and current user-facing post, comment, profile, follow, and action mutations accept `Idempotency-Key`; the key is scoped by actor and operation and bound to a canonical payload hash. A safe retry replays the committed response, while reusing the key for a different payload returns `409`.
- Action rows are the canonical save/signal/fork ledger. The denormalized post/comment arrays and metrics are reconciled inside the same locked transaction for fast reads.
- Bootstrap reads profiles, posts, comments, attachments, communities, and action ledgers from one repeatable-read snapshot, so a refresh cannot mix rows from different mutation moments.
- Follow, membership, call, notification, message, note, opportunity, assistant, and upload-prepare writes use atomic transactions and no-op-aware state transitions.
- Direct-message creation uses a transaction-scoped advisory lock so simultaneous first messages cannot produce duplicate direct conversations.
- Note publishing is a recoverable two-stage idempotent promotion: a retry reuses the same post, moves the draft discussion and its public attachment copies into the destination, soft-removes the source from workspace projections, and then completes the publication record.
- Workspace, note, block, AI-conversation, message-conversation, notification, private-community, Office, and draft access is checked server-side against the authenticated actor. Unknown and foreign resources deliberately collapse to `404` where existence should not be disclosed.
- Public bootstrap/search/profile/community projections remove email addresses, private save membership, privacy-disabled action membership, private-community member lists, and Office/draft content. Public live events contain only refresh-safe identifiers; personalized payloads use explicit event audiences.
- Event cursors are strictly parsed, event delivery is audience-filtered in both durable polling and local streaming, slow SSE clients are dropped, and both SSE and Socket.IO connections have process/client/room/buffer bounds.
- The API caps JSON bodies at 1 MiB, constrains route parameter length, sets request timeouts, redacts authorization/cookie headers from logs, returns generic `500` responses, and applies no-store API caching. Every request receives a bounded process-local abuse limit; only authenticated mutations spend shared Redis commands. Public reads, health checks, readiness checks, event reads, and stream connections never touch Redis.
- Migration `0012_operational_integrity` backfills event audiences, removes impossible self-follows and duplicate publication links, normalizes legacy enum values conservatively, adds database checks, and adds compound/GIN indexes for the live read paths.
- Migration `0013_authoritative_entity_revisions` adds monotonic revisions to posts, comments, profiles, and follow relationships so clients can deterministically reject stale snapshots across tabs, browsers, devices, bootstrap refreshes, and delayed live events.
- Migration `0014_note_revision_guards` adds authoritative note and note-block revisions. Existing-note writes must supply the revisions they loaded, so delayed autosaves fail with a conflict instead of overwriting newer work.
- Migration `0015_durable_r2_deletion` adds a leased, retry-safe object-deletion queue and backfills attachments belonging to existing post tombstones. Post deletion keeps its database tombstone and live event, but atomically removes the attachment from read projections and queues both canonical and staging R2 keys before commit. Removal is attempted before the delete request returns; transient failures are recovered by the shared six-hour maintenance pass so an idle scale-to-zero database is not woken every minute.
- Migration `0016_comment_attachment_ownership` extends the attachment-owner constraint to comments. Comment and reply creation claims verified staged objects in the comment transaction; post/comment edits replace a content-version-guarded desired attachment set; comment deletion and parent-post deletion queue every canonical and staging object durably.
- Migration `0017_content_quotes` adds the shared post/comment quote snapshot columns. Quote resolution rejects private, deleted, or self-referential sources; source deletion sanitizes dependent snapshots, and live deletion events converge the unavailable state across active tabs.
- Migration `0018_comment_quote_kind` backfills the source post kind into existing comment quote snapshots so paper/thought presentation remains consistent without exposing parent-post content.

`npm run verify` is the local release gate. It runs security, infrastructure, domain, attachment, mutation, profile, TypeScript, and production-build checks. `npm audit --audit-level=high` is the dependency vulnerability gate.

## Database

Run the migration runner against Neon:

```bash
npm run db:migrate
```

The migration command fails if no database URL is present, so it is safe to use as the "did I actually point at Neon?" check.

The runner creates the live relational graph:

- users, profiles, preferences
- profile follows
- posts, comments, reactions/saves/forks/reads
- communities, memberships, channels, calls, call participants
- attachments, durable storage-deletion jobs, previews, external links
- DMs, messages, read state
- workspaces, notes, note blocks, note publications
- opportunity/job posts
- AI tablet conversations and messages
- notifications, events, audit logs, moderation reports
- mutation receipts for retry-safe domain creates, actions, messages, notes, assistant requests, and upload preparation
- credit accounts, ledger entries, bounties, pledges

On first boot, the backend seeds the current mock SYMPOSIUM world into Postgres so the interface does not become empty.

## Current Boundary

Implemented now:

- Render-ready API service
- Clerk-aware actor layer with server-bound profile ownership
- Neon/Postgres schema and migrations
- process-local request limiting on every route plus shared Upstash limiting only for authenticated mutations, with a bounded local outage fallback
- transactionally staged database events and audit records with after-commit live publication and durable SSE recovery
- end-to-end idempotency keys for posts, comments, profiles, follows, canonical actions, calls, opportunities, messages, note blocks/publications, assistant messages, and upload preparation
- explicit public/private/community live-event audiences and privacy-safe read projections
- server-side ownership and membership boundaries across Office/drafts, communities/calls, DMs, notifications, workspaces/notes, and AI conversations
- migration/readiness/release/maintenance observability plus structured request correlation
- verified R2 staging uploads promoted to immutable public objects only after size, MIME, signature, and DOCX-structure checks
- shared post, comment, and reply attachment ownership with transactional create/edit claims, bootstrap/live projection, and durable removal
- an enabled R2 lifecycle rule that deletes abandoned `pending/` upload objects after one day
- durable R2 removal for deleted posts, failed verification, promoted staging copies, abandoned confirmed post uploads, and replaced profile images, with leased retries and idempotent object deletion
- transaction-serialized global upload ceilings of 500 preparations or 1 GiB per day and 8 GiB of active attachment metadata, alongside the tighter per-user quotas
- batched retention maintenance for replay receipts, live events, view dedupe rows, expired attachment states, and storage-orphan discovery
- tRPC-style typed procedure router
- REST compatibility routes for the current Next frontend
- current seed data ported into the live schema
- Clerk provider, sign-in/sign-up modal entry, server-side auth sync, and token forwarding through the Vercel bridge
- no-Clerk local preview mode for laptop UI work without production auth envs
- profile follow/unfollow API
- community join and live call APIs
- opportunity/job post API
- DM/conversation REST API
- workspace block save and note-to-paper publish API
- AI tablet message API with persistent conversation storage and a provider-not-configured fallback

Still intentionally next:

- protected delivery for private message/note attachments; those upload classes currently fail closed
- actual model execution for AI tablet once provider policy/key is set
- full note/workspace UI wiring
- production moderation/admin screens
- payment provider integration after the internal credit ledger is exercised

Current provider-plan boundaries:

- The public site currently uses Clerk development keys. Readiness reports this as a warning until the Clerk application and Vercel/Render environment variables are migrated to production keys.
- Neon Free provides a six-hour point-in-time restore window. One manual production snapshot is retained without expiry; scheduled snapshots require a paid plan.
- Upstash Redis is used only for distributed authenticated-mutation rate limits, never for ordinary reads, health checks, streaming, or event publication. It is not a source of truth. Durable Postgres cursors plus the active-process event bus recover live events when a client initially connects or reconnects.
- R2 currently delivers public attachment objects through Cloudflare's rate-limited `r2.dev` URL. Moving to a production custom domain requires choosing a domain on a Cloudflare-managed zone.

## First Live Provider Sequence

1. Create the Clerk application and capture `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and the owner Clerk user id.
2. Create the Neon database and set `DATABASE_URL` or `POSTGRES_URL` locally for the migration pass.
3. Create the Upstash Redis database.
4. Create the Cloudflare R2 bucket and API token.
5. Run `npm run live:env:report` locally with the captured values loaded, then run `npm run live:env:check`.
6. Put the backend env vars in Render and run `npm run deploy:api:check`.
7. Run `npm run db:migrate` against Neon.
8. Deploy the Render API and run `SYMPOSIUM_SMOKE_URL=<render-url> npm run api:smoke`.
9. Open `<render-url>/readyz` and confirm `status: "ready"`, no pending migration ids, and no issues.
10. Put frontend env vars in Vercel: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `SYMPOSIUM_API_URL`.
11. Redeploy Vercel and verify sign-in, `/api/auth/sync`, `/api/bootstrap`, post creation, comments, saves, attachment prepare/confirm, private-room concealment, and community browsing against the live API.
