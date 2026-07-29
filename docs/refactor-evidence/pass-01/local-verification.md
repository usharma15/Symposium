# Pass 01 local verification record

This is an honest local dry-run record for the staged Pass 01 candidate. It is
not a deployment record and does not substitute for exact-commit GitHub,
Render, Vercel, or production evidence.

## Identity and scope

| Field | Evidence |
| --- | --- |
| Baseline `HEAD` | `8e900d0fa675b311a67029b8d2f109b4da97301e` |
| Candidate identity | Local commit on `codex/refactor-pass-01`; read the immutable SHA from Git or CI rather than embedding a self-referential value in this committed file |
| Baseline migration | `0064_authored_artifact_design_assignments`, 64 of 64 |
| Node / npm | `v24.16.0` / `11.13.0` |
| Lockfile SHA-256 | `c1959c39fad39b26072430ff86b6271910d07ea0823d83be0705f593da52271e` |
| Product runtime source changed | No |
| Design/style source changed | No |
| Database/schema/migration changed | No |
| Unrelated workspace material | Untracked `output/` remained untouched and unstaged |

The intentional candidate contains only the proof/control plane, workflow and
release configuration, dependency/runtime pins, and evidence documentation.
This record was authored before publication; exact clean-checkout proof was
repeated from a local clone of the committed candidate. Remote GitHub
exact-SHA proof remains pending.

## Canonical source result

| Metric | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
| Files | 452 | 461 | +9 |
| Physical lines | 127,151 | 128,351 | +1,200 |
| Nonblank lines | 119,000 | 120,123 | +1,123 |
| Production physical lines | 91,527 | 91,527 | 0 |
| Style physical lines | 17,615 | 17,615 | 0 |
| Proof/check physical lines | 18,009 | 19,209 | +1,200 |

`npm run loc:baseline` reproduced the immutable baseline. `npm run loc:check`
passed on the candidate with no unclassified or untracked source candidate.
The candidate is at the corrected 128,351 planning cap; enforcement is
ratcheted to the exact 128,351 result.

## Local proof results

| Gate | Result | Local evidence |
| --- | --- | --- |
| Locked install | Passed | baseline and final candidate `npm ci`; 239 candidate packages, zero vulnerabilities |
| Dependency audit | Passed | `npm audit --audit-level=high`; zero reported vulnerabilities |
| Source inventory fixtures | Passed | LF/CRLF/final-line, spaces, ignored/untracked, rename, dirty/delta, deterministic output, invalid UTF-8, NUL, symlink, and ceiling cases |
| Verification-runner fixtures | Passed | 56-stage parity, selection, environment/cwd, bounded tails, fail-fast, signal, timeout/descendant cleanup, atomic report persistence |
| Proof typecheck | Passed | `npm run proof:typecheck` |
| Canonical verification | Passed | 56 of 56 top-level stages; 58 leaf operations |
| Legacy parity run | Passed | `npm run verify:legacy` produced the same successful result |
| Browser canaries | Passed | 4 of 4 in three consecutive runs: 33.6, 33.3, and 32.8 seconds; Chromium; one worker; exact-suite validator passed; zero unexpected/flaky/skipped |
| Diff whitespace | Passed | `git diff --check` and `git diff --cached --check` after reconciliation |

The browser run used a disposable project copied from Git-tracked candidate
files, performed its own locked install, stripped provider/database/auth/AI
credentials, enabled only the existing non-production dev actor, and bound to
`localhost:3117`. It exercised:

- first-session entrance and local-preview entry;
- direct `/`, Library, and Amphitheater hydration;
- canonical internal navigation and browser Back;
- Paper `calliope` / `harp-girl` identity across night mode and reload;
- title-independent Thought `erato` / `discus-thrower` presentation;
- Paper and Thought desktop/mobile horizontal-overflow containment;
- same-origin console, page-error, and request-failure diagnostics.

The generated local artifacts are ignored under `.artifacts/`:

- `refactor/source-inventory.json`;
- `refactor/verification.json`;
- `browser/report.json`;
- browser failure screenshots/traces when a failure exists.

## Preservation evidence and limitations

The complete 56-stage gate covers the existing architecture, platform,
security, infrastructure, provider-cost, bounded-read, routing, entity,
revision, live transport, cross-tab, attachment, community, document,
citations, storage-deletion, mutation, messaging, notification, analytics,
Workspace, Assistant, Patronage, Opportunity, profile, publishing,
typechecking, production build, and hydration checks. It is strong
characterization evidence; it is not a mathematical proof of every production
state.

The local browser canary deliberately does **not** claim to prove:

- Clerk production-tenant authentication or private multi-session visibility;
- Postgres durability, transaction replay, or cross-process SSE delivery;
- Redis coordination or R2 object lifecycle against live providers;
- Render/Vercel configuration, deployment, health, or exact deployed SHA;
- branch protection or required-check enforcement;
- production writes.

No production write smoke was run. Provider controls remain `checked in` or
`configured in source` until their remote state is read back. A future release
record must replace this worktree identity with the exact candidate, workflow,
merged, and deployed SHAs and must record any provider limitation rather than
converting it into a pass.

## Local decision

- Delivery state: **implemented and verified locally**
- Publication state: **not yet evidenced in this record**
- Deployment state: **not deployed by this record**
- Production state: **not production-verified by this record**
- Decision: proceed to exact-commit GitHub CI; hold merge/deployment if any
  mandatory remote gate or provider readback is absent or failing
