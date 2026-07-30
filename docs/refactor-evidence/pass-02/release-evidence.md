# Pass 02 release evidence

This is a pending release ledger, not a release claim. Empty remote evidence
must remain `pending` or `blocked`; a green result from another SHA is invalid.

## Release identity

| Field | Evidence |
| --- | --- |
| Baseline | `10fdc8fd2952a61ad3b47a86988926c8825c74b6` |
| Branch | `codex/refactor-pass-02` |
| Exact candidate SHA | Pending |
| Exact pushed `main` SHA | Pending |
| GitHub workflow run | Pending |
| Render deployed SHA | Pending |
| Vercel deployed SHA | Pending |
| Previous deployable SHA | `10fdc8fd2952a61ad3b47a86988926c8825c74b6` unless production readback proves otherwise |
| Migration boundary | 64/64; latest `0064_authored_artifact_design_assignments`; unchanged |

## State ledger

| State | Result | Required evidence |
| --- | --- | --- |
| Implemented | Complete in worktree | Reviewed source diff |
| Locally verified | Complete in worktree | 56/56 verification and 5/5 browser canary |
| Exact candidate committed | Pending | Immutable commit SHA and intended diff |
| Clean exact-SHA verified | Pending | Locked install, audit, inventory, proof, 56/56, 5/5, clean status |
| CI verified | Pending | Exact-SHA GitHub run, required job, artifact name and digest |
| Pushed | Pending | Non-force `main` push and remote SHA readback |
| Deployed | Pending | Render and Vercel exact identity and healthy status |
| Production verified | Pending | Exact-SHA readiness, 64/64 migrations, read-only UI/API smoke, safe log review |

## Exact candidate gate

Before push, record:

- candidate SHA;
- Node/npm versions and lockfile hash;
- exact-ref source inventory at or below 128,331;
- checked-in ceiling equal to the exact lower candidate result;
- zero high-severity dependency findings;
- proof-kernel result;
- 56/56 verification result and duration;
- 5/5 browser result with zero skipped, flaky, or unexpected cases;
- clean tracked status after verification;
- confirmation that unrelated user files were absent from the clean checkout.

The local worktree result cannot substitute for this gate.

## CI and deployment gate

Record only immutable provider evidence:

| Boundary | Expected | Observed |
| --- | --- | --- |
| GitHub workflow SHA | Exact candidate | Pending |
| Required proof conclusion | Success | Pending |
| Artifact name and digest | Exact run artifact | Pending |
| Render deploy identity | Exact candidate | Pending |
| Vercel deploy identity | Exact candidate where exposed | Pending |
| `/readyz?probe=database` release | Exact candidate | Pending |
| Migration readback | 64 applied / 64 total / none pending | Pending |
| Public frontend/API compatibility | Healthy | Pending |
| Provider error/retry/timeout review | No new regression | Pending |

Checked-in workflow or Blueprint configuration is not proof that the provider
enforces or has deployed it.

## Production verification boundary

Production verification is read-only. It may cover public routes,
authenticated surfaces already safely available to the operator, readiness,
deployment identity, and secret-safe logs. It must not create, edit, or delete
live user content merely to complete this ledger.

Therefore release evidence must not claim a new production write, Postgres
transaction, receipt replay, qualified-view increment, multi-session mutation,
R2 lifecycle, or cross-process event test unless separately and safely
performed. Local proof and unchanged backend code are not substitutes.

## Rollback

- Stop on any exact-SHA mismatch, failed required check, migration discrepancy,
  readiness failure, private-data exposure, persistence concern, or new error
  pattern.
- Revert or redeploy the previous exact application SHA without resetting
  Postgres, local data, R2 objects, receipts, revisions, events, or browser data.
- Because this pass is schema-neutral, application rollback requires no reverse
  migration.

## Final decision

- Delivery state: implemented and locally verified
- Publication state: pending
- Deployment state: pending
- Production state: pending
- Decision: hold release until every exact-candidate, clean-checkout, CI,
  provider, readiness, and read-only production gate above is evidenced
