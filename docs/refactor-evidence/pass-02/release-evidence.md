# Pass 02 release evidence

This is the reconciled release ledger for the cumulative Pass 02 runtime-spine
and immediate persistence/presentation consolidation. Evidence is tied to the
immutable released SHA. Local observations and provider observations remain
separate, and no production write was manufactured for this ledger.

## Release identity

| Field | Evidence |
| --- | --- |
| Baseline | `10fdc8fd2952a61ad3b47a86988926c8825c74b6` |
| Runtime-spine checkpoint | `c603bbec2ac83841ad5535725dabb34fdb633bdd` |
| Exact released SHA | `59fe7dc4bc992f0f38c556a2cf16b5f33d53b73a` |
| Exact pushed `main` SHA | `59fe7dc4bc992f0f38c556a2cf16b5f33d53b73a` |
| GitHub workflow | [Symposium proof run 30510959884](https://github.com/usharma15/Symposium/actions/runs/30510959884), attempt 1, `success` |
| Required job | `Symposium required proof`, job `90770770592`, `success` |
| Retained artifact | `pass-01-proof-30510959884-1`, artifact `8747144705`, 22,669 bytes |
| Artifact digest | `sha256:48125410c97570dd38e08792e20809799ebbe1661a30c6d64aae2a8b21ddbea8` |
| Render deployment | Deployment `5668576940`, `success`, exact SHA |
| Vercel deployment | Deployment `5668546752`, `success`, exact SHA |
| Migration boundary | 64/64; latest `0064_authored_artifact_design_assignments`; none pending |

The retained artifact name still says `pass-01` because the workflow artifact
label was not renamed for Pass 02. Its workflow run, job, metadata, and digest
all identify the exact released Pass 02 SHA; the name is not used as release
identity.

## State ledger

| State | Result | Evidence |
| --- | --- | --- |
| Implemented | Complete | Reviewed cumulative `10fdc8f..59fe7dc` source diff |
| Locally verified | Complete | Focused checks, 56/56 verification, 5/5 browser canary, and extended presentation audit |
| Exact candidate committed | Complete | Immutable commit `59fe7dc4bc992f0f38c556a2cf16b5f33d53b73a` |
| Clean exact-SHA verified | Complete | GitHub clean checkout, locked install, audit, inventory, proof, 56/56 verification, 5/5 browser canary, and pristine tracked tree |
| CI verified | Complete | Exact-SHA workflow and required job succeeded; retained artifact and digest recorded |
| Pushed | Complete | Local `origin/main` and GitHub workflow checkout resolved to the exact SHA |
| Deployed | Complete | Render and Vercel deployment records both identify the exact SHA and report success |
| Production readback | Complete within the read-only boundary below | Strict readiness, exact release, 64/64 migrations, provider checks, API smoke, and representative public routes |
| Provider runtime-log review | Not independently retained | The exact deployment status is public and successful; authenticated Render runtime logs were unavailable in the connected browser during reconciliation |

The missing authenticated runtime-log review is recorded rather than converted
into an inferred pass. It is not evidence of a runtime defect, and current
readiness and route checks are green, but it remains outside the retained
release proof.

## Exact candidate proof

The GitHub clean checkout recorded:

| Gate | Result |
| --- | --- |
| Locked dependency install | Success; `npm ci`; zero reported vulnerabilities |
| Canonical source inventory | 468 files / 126,778 physical / 118,710 nonblank |
| Source categories | 90,837 production / 16,283 styles / 19,658 checks and tools |
| Dependency audit | Success |
| Proof kernel | Success |
| Complete verification manifest | Success, 56/56 |
| Browser canary | Success, 5/5 in 1.9 minutes |
| Browser report validation | Success |
| Tracked-tree integrity after proof | Pristine |
| Retained evidence | Ten files with a generated SHA-256 manifest |

The exact source result is 1,571 physical and 1,411 nonblank lines below the
`10fdc8f` Pass 02 baseline. It is 1,553 physical and 1,368 nonblank lines below
the `c603bbe` runtime-spine checkpoint.

## Deployment and production proof

| Boundary | Observed |
| --- | --- |
| GitHub workflow SHA | Exact released SHA; push to `main`; success |
| Render deploy identity | Exact released SHA; deployment `5668576940`; success |
| Vercel deploy identity | Exact released SHA; deployment `5668546752`; success |
| Vercel commit status | `success`; “Deployment has completed” |
| `/readyz?probe=database` | `ok: true`, `status: ready`, `strict: true`, exact released SHA |
| Migration readback | 64 applied; current/latest `0064`; none pending |
| Provider readiness | Database, Clerk, authenticated writes, dev-actor exclusion, origins, Upstash, R2, deletion worker, owner binding, and AI provider all healthy |
| Readiness findings | No issues and no warnings |
| Public compatibility | `/`, Library, Communities, a Thought detail, Workspace, Messages, Assistant, and bootstrap returned HTTP 200 |

The readiness observation was refreshed on July 30, 2026 at
`2026-07-30T04:01:02.967Z`. Provider state is time-sensitive and must be
refreshed before a later release or incident claim.

## Production verification boundary

Production verification was intentionally read-only. It did not create, edit,
or delete live user content solely to satisfy this ledger. Therefore this
record does not claim a new production:

- authenticated write;
- Postgres receipt replay;
- qualified-view increment;
- multi-session mutation;
- R2 object lifecycle;
- cross-process event delivery; or
- destructive rollback exercise.

Those semantics were covered by the exact-SHA local and CI proof to the level
named in the verification record. Current strict readiness proves provider
configuration and database/migration reachability; it does not turn an
unperformed production mutation into performed evidence.

## Rollback

- The pass is schema-neutral; application rollback requires no reverse
  migration.
- Revert or redeploy the preceding exact application SHA without resetting
  Postgres, local data, R2 objects, receipts, revisions, events, or browser
  data.
- Stop a later rollout on any exact-SHA mismatch, failed required check,
  migration discrepancy, readiness failure, private-data exposure,
  persistence concern, or new error pattern.

## Final decision

- Delivery state: complete
- Publication state: pushed to `main`
- Deployment state: Render and Vercel exact-SHA success
- Production state: strict-ready and read-only smoke verified
- Known evidence limitation: no independently retained authenticated Render
  runtime-log review and no deliberately manufactured production write
- Decision: Pass 02 is released and closed; carry the explicit evidence
  limitation forward rather than describing the release as literally
  exhaustive
