# SYMPOSIUM

Early public prototype for the Science Rebirth software vessel.

## Run locally

```bash
npm install --cache .npm-cache
npm run dev
```

## Production check

```bash
npm run typecheck
npm run api:typecheck
npm run build
npm run start
```

## Live backend

SYMPOSIUM now includes a Render-ready TypeScript backend under `apps/api`.

```bash
npm run api:dev
npm run deploy:api:check
npm run db:migrate
npm run api:smoke
npm run api:smoke:writes
```

Use `.env.example` as the provider checklist. The API exposes `/healthz` for liveness and `/readyz` for live provider readiness without returning secret values. `api:smoke:writes` is intentionally separate from the default smoke because it creates test content.

The current Next API routes proxy to the live backend when `SYMPOSIUM_API_URL` is set. Without that env var, local development continues to use the v0 file/Postgres fallback.
Once `SYMPOSIUM_API_URL` is set, the bridge treats the live backend as authoritative and returns a controlled 503 if Render is unavailable.

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
- Persisted post creation, comments, nested replies, saves, signals, forks, and reads.
- Backend surfaces for follows, DMs, community joins/calls, opportunities, workspace notes, note publishing, and AI tablet conversations.
- Paper/thought detail views with claims, objections, evidence, tests, forks, comments, and signal panels.
- Notebook and AI tablet concepts.
- Profile concept and day/night mode.
