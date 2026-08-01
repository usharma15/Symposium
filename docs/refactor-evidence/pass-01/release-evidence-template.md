# Refactor Pass 01 release evidence

This is a completion template, not a claim that Pass 01 is released. Every
entry must be backed by an immutable commit, command output, CI artifact, or
provider response. Write `blocked` or `not run` instead of inferring success.

## Release identity

| Field | Evidence |
| --- | --- |
| Candidate or pull-request head SHA | |
| Pull-request synthetic merge SHA, if tested | |
| Final merged SHA | |
| Candidate branch or pull request | |
| Baseline commit SHA | `8e900d0fa675b311a67029b8d2f109b4da97301e` |
| Reviewer and timestamp | |
| Git worktree clean at verification | |
| Lockfile installation command | `npm ci` |
| `package-lock.json` SHA-256 | |
| Node and npm versions | |

## Change boundary

- Intended infrastructure changes:
- Product behavior intentionally changed:
- Product behavior required to remain identical:
- Persistence, live-sync, and authorization surfaces touched:
- Design surfaces touched:
- Explicitly deferred or blocked work:
- Rollback commit or branch:

## Canonical source inventory

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run loc:check` | | |
| Candidate physical source lines | | |
| Candidate nonblank source lines | | |
| Delta from the exact baseline | | |
| Pass ceiling respected | | |
| Untracked or unclassified source | | |
| Inventory SHA equals candidate SHA | | |

Attach `source-inventory.json`; do not substitute `wc`, formatter compression,
generated output, deleted tests, or excluded extensions for the canonical
metric.

## Local proof

| Gate | Result | Evidence |
| --- | --- | --- |
| Clean locked install | | |
| `npm audit --audit-level=high` and severity totals | | |
| `npm run proof:check` | | |
| `npm run verify` status, stage count, and duration | | |
| Browser canary | | |
| Working tree remained pristine | | |

Record the failed stage and retained report when any gate fails. A partial
manifest is not a pass.

## CI and merge enforcement

| Field | Evidence |
| --- | --- |
| GitHub workflow run URL, ID, and attempt | |
| Workflow event and ref | |
| Workflow commit SHA | |
| `Symposium required proof` conclusion | |
| Retained artifact name and digest | |
| Branch rule requires the exact job | |
| Pull request and conversation requirements | |
| Force-push and deletion protections | |
| Bypass actors, if any | |

Until the provider settings are read back, describe the workflow as
`checked in`, not `required`. A green run on a different SHA is not evidence
for the candidate.

## Browser-canary boundary

- Browser and version:
- Viewports exercised:
- Routes and stable fixtures exercised:
- Console, page, network, and hydration errors:
- Back, Forward, direct-route, and modifier navigation:
- Paper identity before and after theme/reload:
- Thought identity and title-independent presentation:
- Horizontal-overflow result:
- Local reconnect observation:
- Screenshots, trace, or report artifact:

State explicitly that an isolated local canary does not prove authenticated
multi-session behavior, durable cursor replay, production Clerk, Postgres,
Redis, R2, or provider health unless those boundaries were separately tested.
Never run production writes to complete this section.

## Persistence and live-sync proof

| Contract | Result | Evidence |
| --- | --- | --- |
| Migration manifest ID and count | | |
| API preflight and typecheck | | |
| Transactional mutation/receipt/audit coupling | | |
| Monotonic revision and conflict behavior | | |
| Durable live-event and replay behavior | | |
| Cross-tab reconciliation | | |
| Local fallback boundary | | |
| Attachment persistence and deletion | | |

For any contract proved only by a focused check or source assertion, label it
that way. Do not present local transport reconnect as durable replay.

## Provider and production evidence

| Boundary | Expected candidate | Observed | Evidence |
| --- | --- | --- | --- |
| GitHub required-check configuration | | | |
| GitHub runner Node / npm versions | | | |
| Render Blueprint sync | | | |
| Render runtime Node / npm versions | | | |
| Render deployed commit | | | |
| Render `/healthz` | | | |
| Render `/readyz?probe=database` exact SHA | | | |
| Applied migration count and latest ID | | | |
| Vercel deployed commit | | | |
| Vercel runtime Node / npm versions | | | |
| Public frontend-to-API release compatibility | | | |
| Frontend/API SHA equality required or not required | | | |
| Render and Vercel error-log review | | | |
| Provider degradation or alert state | | | |

Verify secret-safe responses only. Do not paste credentials, tokens, database
URLs, cookies, private payloads, or full environment values into this record.
`autoDeployTrigger: checksPass` is not proven active until the Render
configuration is synced and read back.

## Rollout and rollback

- Pre-deploy snapshot or backup evidence:
- Expand/contract compatibility window:
- Deployment order:
- Post-deploy read-only probes:
- Error, latency, reconnect, and saturation observations:
- Stop conditions:
- Rollback trigger:
- Rollback procedure and owner:
- Data-forward remediation if rollback cannot reverse a migration:

## Final decision

- Delivery state: `implemented` / `verified locally` / `verified in GitHub CI`
  / `pushed` / `deployed` / `production verified` / `blocked`
- Decision: `release` / `hold` / `rollback`
- Unresolved exceptions:
- Evidence reviewed:
- Decider and timestamp:

Release requires the exact candidate SHA to pass every mandatory local and
remote gate, a healthy production readback, and no unresolved evidence of
feature, persistence, live-sync, authorization, or design regression.
