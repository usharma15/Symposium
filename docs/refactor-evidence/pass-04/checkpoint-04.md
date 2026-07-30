# Pass 04 checkpoint 04 — canonical development authority

## Control record

| Field | Value |
| --- | --- |
| Status | Gate B passed locally: canonical Postgres plus provider-free filesystem storage proved; duplicate Next/Postgres authority retired |
| Exact starting baseline | `c4b1390574942d691b243e9f70f70a3dcc888a4c` |
| Candidate inventory | 479 files / 127,805 physical / 119,667 nonblank |
| Candidate delta versus starting baseline | +4 files / +37 physical / -3 nonblank |
| Candidate categories | 89,330 production / 16,200 styles / 22,275 checks and tools |
| Category delta versus starting baseline | -704 production / 0 styles / +741 checks and tools |
| Program ceiling | 99,999 physical |
| Pass 04 checkpoint ceiling | 114,999 physical |
| Remaining distance to program ceiling | 27,806 physical |
| Remaining distance to Pass 04 ceiling | 12,806 physical |
| Product/schema impact | No product behavior or schema change; all 65 existing migrations are exercised |
| Production storage | R2 remains the only permitted strict-live backend |
| Development storage | Explicit filesystem mode; Postgres remains metadata and lifecycle authority |
| Design Lab and AI Tablet | Untouched |
| Preserved unrelated paths | `output/`; `scripts/browserCanaryServer 2.ts` |

Documentation is excluded from the source inventory. The unrelated untracked
canary copy remains byte-for-byte unchanged at SHA-256
`9ca3d8239ffb43186453d70feb5b5d8e4f023d9dc3ec411abc82c687197e2b4a`.
The clean candidate metric is checked from the committed tree so that this
user-owned untracked file remains outside the release without being deleted,
hidden, or staged.

This checkpoint completes Gate B, not Pass 04. It misses the explicit Pass 04
ceiling by 12,806 physical lines and the program ceiling by 27,806. The
checkpoint source ceiling is ratcheted to its exact candidate, leaving no
unreported growth allowance.

## Authority replacement

`lib/dataStore.ts` no longer imports `pg`, creates a connection pool, creates
or alters schema, seeds Postgres, projects database rows, or performs SQL
reads and mutations. It retains only the serialized atomic JSON preview used
when the canonical API is deliberately absent.

Database-backed configuration now fails closed in that compatibility store
with an instruction to configure `SYMPOSIUM_API_URL` and run the canonical
API. The guard recognizes the first non-empty value across
`POSTGRES_PRISMA_URL`, `POSTGRES_URL`, and `DATABASE_URL`; empty higher
priority variables cannot mask an active database URL.

`npm run authority:check` locks these boundaries:

- no `pg` or SQL authority in the compatibility store;
- no compatibility-store import from the canonical API;
- continued serialized JSON mutation behavior;
- rejection before any database connection or local write when a database
  environment variable is configured; and
- no regression to the retired schema or mutation branches.

The cut removes approximately 1,200 lines of duplicated database authority.
The net source metric grows by 37 only because 741 lines of new checks and
integration machinery accompany a 704-line production reduction.

## Storage port and filesystem backend

The canonical API now selects a narrow attachment-storage implementation:

- `r2`, the unchanged default and only strict-live choice; or
- `filesystem`, an explicit provider-free development choice.

The filesystem implementation provides:

- containment-checked object keys with absolute, traversal, empty-segment,
  backslash, and NUL rejection;
- mode-`0600` temporary files and atomic rename into the object path;
- declared-size verification with failed-object cleanup;
- bounded metadata, prefix, full-body, and byte-range reads;
- atomic promotion from staging to canonical keys;
- idempotent deletion and empty-directory cleanup;
- HMAC-SHA256 private URLs with timing-safe comparison and a hard 15-minute
  maximum lifetime; and
- public and private delivery backed by active Postgres attachment rows.

The adapter stores object bytes only. Canonical ownership, status, content
type, byte size, audit history, mutation receipts, revisions, events, and
deletion jobs remain Postgres rows. No JSON metadata or filesystem sidecar can
become a second authority.

Public filesystem reads re-check an uploaded or previewed Postgres row,
restrict ownership to public attachment types, and reject deletion-pending or
deleted objects. Private reads require a valid short-lived signature and the
same active-row check. Delivery supports complete and open-ended byte ranges,
returns `206` and `Content-Range` for valid ranges, and returns `416` for
invalid ranges.

The existing R2 operations remain selected through the same interface:
authenticated upload, signed private read, prefix/body inspection, server-side
promotion, public URL projection, and durable deletion. Production deployment
configuration explicitly selects `r2`.

## Runtime safety

Environment validation adds the explicit storage selector and filesystem
root, base URL, signing secret, and logical bucket. Provider-free mode requires
all of them, an absolute root, and a loopback HTTP base URL.

Strict live preflight rejects the filesystem backend even if it is fully
configured. It independently requires:

- R2 credentials and bucket;
- an HTTPS R2 public base URL;
- Postgres;
- authenticated writes with the development actor disabled;
- exact HTTPS web origins;
- Clerk;
- Redis-backed shared mutation limits; and
- the existing owner identity binding.

Deep readiness reports the selected attachment backend and retains the
strict-live R2 check. The deletion worker now reports and processes the active
storage implementation without weakening its durable Postgres queue.

## Real isolated integration proof

`npm run storage-filesystem:integration` starts a disposable PostgreSQL 17.10
server, a canonical Fastify API process, and a private object directory. The
server binary uses the checksum-verified PostgreSQL/OpenSSL build prepared for
the recovery pass. Nothing is installed into the repository or host package
manager.

The final run proved:

- canonical startup and all 65 migrations through
  `0065_comment_deletion_reconciliation`;
- deep database readiness with zero pending migrations;
- seeded canonical bootstrap;
- complete read smoke;
- comprehensive write smoke;
- public attachment prepare, authenticated content upload, idempotent
  duplicate upload, confirmation, delivery, and range delivery;
- pending-public rejection and foreign-actor confirmation rejection;
- attached titleless Thought creation with the same persisted public URL;
- private note attachment prepare, upload, confirmation, signed delivery,
  unsigned rejection, tamper rejection, and public-route rejection;
- exact attachment ownership, bucket, status, mutation-receipt, audit-log, and
  live-event evidence in Postgres;
- persistence of both metadata and bytes across a real API process restart;
- post deletion and private attachment discard;
- durable deletion-queue drain;
- rejection of the old public and private URLs after deletion; and
- zero remaining object files.

The database, socket directory, object directory, and API process are cleaned
up in `finally`, including failed runs.

## Deterministic adapter proof

`npm run storage-adapter:check` independently exercises the storage module
without a database:

- object-key and traversal rejection;
- incomplete-configuration rejection;
- strict-live filesystem rejection;
- atomic write and exact-size verification;
- declared-size mismatch cleanup;
- staging promotion;
- metadata, prefix, full-body, and range reads;
- content-type authority;
- private signature validity, tamper rejection, expiry, and maximum horizon;
- simultaneous writes that never expose a partial object;
- absence of sidecar metadata;
- canonical and staging deletion; and
- idempotent deletion cleanup.

Existing attachment, preview, comment-attachment, Workspace publishing,
Assistant vision, security, infrastructure, and storage-deletion checks remain
in the canonical runner.

## Defects found and corrected

The pass found and fixed three real defects before release:

1. Empty `POSTGRES_PRISMA_URL` or `POSTGRES_URL` values masked a populated
   `DATABASE_URL`. Both the API selector and the retired-store guard now
   select the first non-empty value.
2. The post-design construction test still expected the retired compatibility
   SQL. It now verifies canonical SQL only in the migration/repository layer
   and the local camel-case design assignment in preview storage.
3. Next's optimized Turbopack build exposed a module-initialization cycle
   inside Zod's ISO helper module. The contracts package now owns the exact
   date and default UTC date-time regex schemas, preserving the prior
   validation semantics without importing that cyclic helper.

Two harness-only failures were also corrected: a synthetic build environment
attempted to mutate read-only `NODE_ENV`, and the first Chromium launch was
denied by the macOS Mach-port sandbox before page creation. The final browser
candidate ran outside only that OS restriction.

## Complete local verification

Final candidate evidence:

- `npm run verify` — passed 61/61 ordered stages;
- `npm run typecheck:all` — passed;
- `npm run build` — optimized Next production build and hydration passed;
- `npm run proof:check` — passed;
- `npm run authority:check` — passed;
- `npm run storage-adapter:check` — passed;
- `npm run storage-filesystem:integration` — passed against real PostgreSQL
  and a restarted canonical API;
- `npm run browser:canary` — passed 6/6;
- exact browser report validation — passed;
- `npm audit --audit-level=high` — zero vulnerabilities;
- `git diff --check` — passed; and
- committed-tree LOC policy — 479 / 127,805 / 119,667.

The browser canary covers first entry, twelve simultaneous serialized local
writes without loss, canonical route hydration, in-app history, stable Paper
and Thought identities across theme and reload, desktop/mobile containment,
and creation/edit/durable reload of a titleless Thought.

Passing this matrix does not claim every possible production state was
visited. It establishes the locked contract for the changed authority and
storage boundaries, while live release identity and provider readiness are
verified separately after the authorized push.

## Next safe pass

Gate B removes the duplicate database authority that blocked deeper
decomposition. The next pass should measure the remaining 89,330 production
lines and replace one supported responsibility at a time behind existing
contracts. It must not delete the JSON preview, coupled local stores, or a
production feature merely to reach the LOC target.

The immediate sequence is:

1. verify the pushed commit in GitHub CI;
2. verify Render deep readiness reports that exact released SHA, R2, and all
   65 migrations;
3. rerun public API smoke against the released service;
4. choose the next production authority/component seam from current source
   inventory; and
5. retain rollback and exact behavioral checks before any further deletion.
