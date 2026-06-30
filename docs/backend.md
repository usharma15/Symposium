# SYMPOSIUM Live Backend

This repo now has two runtime surfaces:

- `next dev` / Vercel: the laptop-first SYMPOSIUM interface.
- `npm run api:dev` / Render: the live TypeScript backend.

The existing Next API routes remain in place as a bridge. When `SYMPOSIUM_API_URL` is set on Vercel, those routes proxy to the Render backend. When it is not set, local development keeps using the existing `.data/symposium.json` fallback.

## Local API

```bash
npm run api:dev
```

The API listens on `http://localhost:4000` by default.

Useful endpoints:

- `GET /healthz`
- `GET /v1/bootstrap`
- `GET /v1/posts`
- `POST /v1/posts`
- `POST /v1/posts/:id/comments`
- `POST /v1/posts/:id/actions`
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
- `/trpc/*` for the typed procedure router
- Socket.IO on the same server for realtime presence/events

## Environment

Backend:

```bash
DATABASE_URL=postgres://...
CLERK_SECRET_KEY=sk_...
CLERK_JWT_AUDIENCE=
SYMPOSIUM_STRICT_ENV=true
SYMPOSIUM_WEB_ORIGINS=https://your-vercel-domain.vercel.app
SYMPOSIUM_REQUIRE_AUTH=true
SYMPOSIUM_ALLOW_DEV_ACTOR=false
SYMPOSIUM_OWNER_CLERK_USER_ID=user_...
SYMPOSIUM_OWNER_HANDLE=@usharma
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
R2_ACCOUNT_ID=...
R2_BUCKET=symposium-uploads
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=
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

When `SYMPOSIUM_API_URL` is configured on Vercel, the Next API bridge treats Render as the source of truth. If Render is unreachable, writes return a controlled 503 instead of silently falling back to local v0 storage.

## Deployment Preflight

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
- Upstash Redis config.
- Cloudflare R2 config.
- owner Clerk user mapping for the reserved `@usharma` handle.

For a smoke test against a running API:

```bash
npm run api:smoke
```

By default this checks `http://localhost:4000`. To check Render:

```bash
SYMPOSIUM_SMOKE_URL=https://your-render-api.onrender.com npm run api:smoke
```

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
- attachments, previews, external links
- DMs, messages, read state
- workspaces, notes, note blocks, note publications
- opportunity/job posts
- AI tablet conversations and messages
- notifications, events, audit logs, moderation reports
- credit accounts, ledger entries, bounties, pledges

On first boot, the backend seeds the current mock SYMPOSIUM world into Postgres so the interface does not become empty.

## Current Boundary

Implemented now:

- Render-ready API service
- Clerk-aware actor layer
- Neon/Postgres schema and migrations
- Upstash-ready rate limiting and event publishing
- R2 signed upload flow
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

- actual model execution for AI tablet once provider policy/key is set
- full note/workspace UI wiring
- production moderation/admin screens
- payment provider integration after the internal credit ledger is exercised

## First Live Provider Sequence

1. Create the Clerk application and capture `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and the owner Clerk user id.
2. Create the Neon database and set `DATABASE_URL` or `POSTGRES_URL` locally for the migration pass.
3. Create the Upstash Redis database.
4. Create the Cloudflare R2 bucket and API token.
5. Put the backend env vars in Render and run `npm run deploy:api:check`.
6. Run `npm run db:migrate` against Neon.
7. Deploy the Render API and run `SYMPOSIUM_SMOKE_URL=<render-url> npm run api:smoke`.
8. Put frontend env vars in Vercel: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `SYMPOSIUM_API_URL`.
9. Redeploy Vercel and verify sign-in, `/api/auth/sync`, `/api/bootstrap`, post creation, comments, saves, and community browsing against the live API.
