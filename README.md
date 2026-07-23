# SYMPOSIUM

Early public prototype for the Science Rebirth software vessel.

## Run locally

```bash
npm install --cache .npm-cache
npm run dev
```

## Production check

```bash
npm run verify
npm audit --audit-level=high
npm run start
```

## Live backend

SYMPOSIUM now includes a Render-ready TypeScript backend under `apps/api`.

```bash
npm run api:dev
npm run deploy:api:check
npm run db:migrate
npm run live:env:report
npm run live:env:check
npm run api:smoke
npm run api:smoke:writes
```

Use `.env.example` as the provider checklist. `live:env:report` prints a secret-safe backend/frontend live-env report, while `live:env:check` exits nonzero until required live envs are present. The API exposes `/healthz` for liveness, an idle-safe `/readyz` backed by startup verification, and `/readyz?probe=database` for an explicit deep provider check without returning secret values. `api:smoke:writes` is intentionally separate from the default smoke because it creates test content.

When `SYMPOSIUM_API_URL` is set, normal browser traffic and live events connect directly to the live backend with Clerk authentication; the Next API routes remain as a narrow compatibility and local-preview bridge. Without that env var, local development continues to use the v0 file/Postgres fallback.
Once `SYMPOSIUM_API_URL` is set, Render is authoritative. Requests never silently fall back to local v0 storage when the live backend is unavailable.

See `docs/backend.md` for the Neon, Clerk, Upstash, R2, Render, and Vercel environment setup.

## Persistence

The v0 app uses API routes for profiles, posts, comments, and post actions.

- Locally, data is stored in `.data/symposium.json`.
- In production, set `DATABASE_URL`, `POSTGRES_URL`, or `POSTGRES_PRISMA_URL` to use hosted Postgres.
- If no database URL is present on Vercel, the site still builds and runs, but writes are not durable across serverless instances.
- For the live public beta path, run the API service separately and set `SYMPOSIUM_API_URL` on Vercel.

## Current v0 shape

- Greco-futurist arrival screen.
- Room shell for Office, Symposium, Library, and Amphitheater.
- Seeded feeds for papers, thoughts, drafts, code, and saved work.
- Lightweight account/profile creation and switching.
- Persisted post creation, comments, nested replies, saves, signals, forks, reads, attachment-capable editing, and public post/comment quoting in every source/destination combination, including link-attached quotes while drafting.
- Backend surfaces for follows, DMs, community joins/calls, opportunities, workspace notes, note publishing, and AI tablet conversations.
- Paper/thought detail views with claims, objections, evidence, tests, forks, comments, and signal panels.
- Notebook and AI tablet concepts.
- Profile concept and day/night mode.
