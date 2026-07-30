# Major Refactor Pass 02 — Canonical Runtime Spine

## Document control

| Field | Value |
| --- | --- |
| Status | Implemented and verified in the current worktree; exact-commit, clean-checkout, CI, push, deployment, and production verification remain pending |
| Prepared / updated | July 29, 2026 |
| Repository | `/Users/udayansharma/Documents/Science Rebirth` |
| Branch | `codex/refactor-pass-02` |
| Exact baseline | `10fdc8fd2952a61ad3b47a86988926c8825c74b6` |
| Candidate commit | Pending |
| Route surface | 85 Next API route files / 116 exported methods, unchanged |
| Migration boundary | 64 migrations; latest `0064_authored_artifact_design_assignments`; no migration changed |
| Source baseline | 461 files / 128,349 physical / 120,121 nonblank |
| Current worktree | 465 files / 128,331 physical / 120,078 nonblank |
| Category result | 91,113 production / 17,615 styles / 19,603 checks and tools |
| Pass result | −18 physical / −43 nonblank; production −400, styles 0, checks +382 |
| Pass ceiling | The exact committed candidate must remain at or below 128,331 and below the 128,349 baseline |
| Schema boundary | No product schema change and no migration |
| Design boundary | No Paper, Thought, Main Hall, room, Workspace, responsive, Day/Night, asset, or interaction redesign |
| Assistant boundary | No new capability, context, tool, posting authority, messaging authority, or autonomy |

This file is the authoritative architectural charter and execution record for
Pass 02. Detailed local proof and the still-pending release proof are kept in
`docs/refactor-evidence/pass-02/`.

## 1. Purpose and success hierarchy

The primary objective is not line deletion by itself. It is a more beautiful,
explicit, powerful runtime spine: fewer semantic authorities, less drift, and
infrastructure that remains easy to understand and extend.

The hard LOC result is an integrity test of that improvement. A refactor that
adds aggregate source, hides code, weakens proof, or merely moves complexity
has failed even if it appears tidy.

Above both architecture and LOC is the zero-loss contract:

- no feature, microfeature, route, method, error, or supported fallback may
  disappear;
- live persistence, revisions, receipts, idempotency, events, attachment
  lifecycle, and synchronization semantics must remain exact;
- local preview must keep its supported durable behavior;
- private data must remain private and production must never use local data;
- approved design, responsive behavior, accessibility, Paper identities, and
  title-independent Thoughts must remain exact;
- the Assistant capability boundary must not expand or contract;
- the result should improve speed, smoothness, reliability, or maintainability
  where the infrastructure change permits it.

## 2. Starting defect and retained topology

Before Pass 02, request mapping, actor extraction, body transformation,
idempotency forwarding, backend selection, and response forwarding were
repeated across the browser client, 70 Next route files, and the live-backend
helper. A rule could therefore change in one layer and remain stale in
another. The titleless-Thought save regression demonstrated that risk.

The pass intentionally retains the necessary topology:

```text
feature caller
     |
     v
canonical API request mapper
     |
     +---------------- direct live ----------------+
     |                                             |
     v                                             v
explicit Next route                         Fastify /v1 route
     |
     +-- canonical live forwarder ----------> Fastify /v1 route
     |
     +-- explicit local-preview behavior
     |
     +-- explicit protected-delivery or SSE behavior
```

Direct Render access avoids unnecessary Vercel work. The Next facade remains
necessary for local preview, protected delivery, Clerk exchange, compatibility,
and special routes. Fastify remains the live mutation and persistence
authority. This was a consolidation, not a topology rewrite.

## 3. Implemented architecture

### 3.1 Canonical request mapper

`lib/symposiumApiRoute.ts` now owns:

- safe backend URL normalization;
- `/api` to `/v1` path mapping;
- named Next-boundary classification;
- method and query preservation;
- actor discovery and upstream-query removal;
- the small set of explicit transport body transformations.

It does not own authorization, domain business policy, persistence, or replay
eligibility. Direct-to-facade retry eligibility remains explicit browser-client
policy: GET requests, or mutations with an idempotency key, may retry after a
direct transport failure.

`features/api/symposiumApiClient.ts` composes this mapper for direct requests
and same-origin fallback. The fallback preserves the development actor and the
same canonical receipt-hashed payload after a possible response-loss failure.

### 3.2 Canonical live forwarder

`lib/liveBackendClient.ts` now provides the narrow forwarding spine:

- backend configuration and strict-production fail-closed behavior;
- Clerk bearer token and supported compatibility actor forwarding;
- method, query, JSON body, and selected idempotency propagation;
- no-store responses;
- safe `Content-Type`, `Vary`, `X-Request-Id`, and `Retry-After` propagation;
- bodyless `204`, `205`, and `304` handling;
- configured-backend failure as the existing unavailable response.

The forwarder contains no domain authorization or product validation.

### 3.3 Explicit domain helpers

- `lib/assistantRouteSupport.ts` centralizes live-required Assistant reads,
  mutations, private no-store unavailable responses, and error shape.
- `lib/workspaceRouteSupport.ts` centralizes Workspace actor resolution,
  live-first reads/mutations, local execution, private responses, and local
  error mapping.
- `lib/protectedAttachmentRoute.ts` centralizes access delegation, safe live
  redirect handling, local private streaming, concealment, and malformed
  upstream fail-closed behavior.
- Post and comment routes remain explicit because their local persistence,
  revision, quote, attachment, and action policies are domain behavior.

No generic catch-all was introduced. All 85 route files and 116 methods remain.
The pass modified 82 API route files and retired direct `proxyLiveBackend`
ownership from all 70 route files that previously imported it. Three routes
remain intentionally outside the generic forwarding path:

- `/api/attachments/local-upload/[attachmentId]` owns local byte upload;
- `/api/attachments/local/[attachmentId]/[fileName]` owns local delivery;
- `/api/events/stream` owns SSE and heartbeat compatibility.

## 4. Compatibility and preservation ledger

| Boundary | Preserved contract |
| --- | --- |
| Community membership | `join`, `access`, and `leave` keep their distinct live paths and leave-method transformation |
| Workspace publication | Resource route maps to `/v1/notes/publish`; decoded `noteId`, expected revision, publication target, and public visibility are preserved |
| Views | Post and comment `read` actions map to their qualified `/views` endpoints |
| Profile follow | Target handles are decoded, normalized, re-encoded, and inserted into the canonical live body |
| Actor handling | Explicit option, valid body author/actor, query actor, and compatibility header precedence remain route-aware; query actors are removed upstream |
| Post/comment create and update | Shared canonical schemas normalize supported wire shapes while preserving titleless Thoughts and titled Papers |
| Post creation attachments | `attachmentIds` are derived or defaulted; legacy `attachments` is retained only when supplied |
| Actions | Raw supported action payloads retain compatibility metadata such as `clientContext` |
| Rolling deployment | Required legacy actor body fields remain where changing the receipt hash would break direct-to-facade response-loss replay |
| Protected attachments | Assistant, message, opportunity, and Workspace access stays on Next, delegates to `/access`, redirects only from a valid successful payload, propagates denials, and fails malformed success closed |
| Attachment lifecycle | Upload and access use the shared spine; confirm/discard deliberately do not forward a legacy idempotency header |
| Assistant | Existing reads, projects, conversations, translations, messages, quota, drafts, and actions keep their unavailable shapes and authority |
| Errors and headers | Status, JSON/text bodies, no-store, safe headers, false/null bodies, and no-content responses remain transport-safe |
| External URLs | Absolute untrusted URLs are never reinterpreted as first-party `/api` routes |
| Encoded identifiers | Encoded and malformed percent sequences do not crash mapping |

No `apps/api` repository, database migration, contract definition, local-store
format, component, stylesheet, or provider configuration changed in this pass.

## 5. Non-negotiable invariants

### Product and design

- Papers retain titles and persisted design assignments.
- Thoughts remain title-independent and never regain a title field or visible
  Thought heading.
- Day/Night, muse, caricature, attachment, citation, quote, editor, feed,
  detail, discussion, navigation, responsive, and accessibility behavior remain.
- No Assistant feature, prompt, context, tool, quota, evidence, draft, or
  action semantics change.

### Persistence and synchronization

- Postgres remains canonical in live mode.
- Local preview retains its current file-store contract.
- Production never reads or writes local fallback data.
- Expected revisions, conflicts, receipts, audit rows, durable events,
  post-commit publication, SSE replay, optimistic guards, and cross-tab
  reconciliation remain canonical domain behavior.
- Attachment staging, confirmation, authorization, ownership, promotion,
  removal, and durable deletion obligations remain.
- A refactored helper does not make a non-replayable mutation replayable.

### Security and privacy

- Clerk remains the live identity authority and the two-key activation rule
  remains exact.
- Local actor headers never become production authentication.
- Unauthorized resources retain their concealment projections.
- Private attachment, Workspace, message, application, and Assistant data
  never pass through a generic public route.
- Origin, CSRF, CSP, cache, CORS, security-header, and protected-delivery
  boundaries remain.

### Engineering quality

- Transport helpers remain smaller than the duplicated code they replace.
- Domain validation and authorization remain visible in contracts and
  repositories, not a magical router.
- Routes and features depend on shared infrastructure, never the reverse.
- No permanent old/new dual implementation remains.
- Reduced LOC cannot come from formatting compression, weaker types, deleted
  assertions, excluded source, or removed browser coverage.

## 6. Execution checkpoint disposition

| Checkpoint | Disposition |
| --- | --- |
| Freeze and recapture | Complete from exact baseline `10fdc8f`; unrelated `output/` and `scripts/browserCanaryServer 2.ts` preserved |
| Characterization | Focused mapping, client, proxy, route-handler, receipt-hash, protected-delivery, and failure fixtures added |
| Request mapper | Complete and consumed by browser and server forwarding paths |
| Live forwarder | Complete with injectable proxy and request-aware forwarding tests |
| Low-risk facades | Migrated without route or method retirement |
| Live-required private families | Assistant routes consolidated without capability change |
| Hybrid local/live families | Profiles, communities, calls, opportunities, Workspace, scribble, posts, comments, actions, analytics, and attachments migrated |
| Conditional catch-all | Deliberately not used; explicit routes are safer and remain auditable |
| Adversarial reconciliation | Implementation findings addressed; exact-commit and release reconciliation remain |

The route surface is mechanically locked to the baseline signatures by
`scripts/architectureBoundaryCheck.ts`.

## 7. Verification state

| State | Result |
| --- | --- |
| Implemented | Complete in the current worktree |
| Focused local checks | Green |
| Full local verification | 56/56 green in the dirty worktree, including typechecks, production build, and hydration |
| Browser canary | 5/5 green in 39.0 seconds in an isolated disposable local preview |
| Current worktree LOC | 128,331 physical; 18 below baseline |
| Exact candidate commit | Pending |
| Clean exact-SHA checkout | Pending |
| GitHub CI exact SHA | Pending |
| Pushed to `main` | Pending |
| Render/Vercel deployment | Pending |
| Exact-SHA readiness and production readback | Pending |

The browser suite proves:

- first-session entrance into isolated local preview;
- canonical route hydration, PDF rendering, in-app history, and browser Back;
- stable Paper and titleless-Thought design identity across theme and reload;
- desktop and mobile overflow containment;
- titleless Thought creation, editing, reload persistence, and a fresh-context
  canonical GET with persisted design-ID and DOM-identity assertions;
- no unexpected canary console, page, request, hydration, skipped, flaky, or
  unexpected failures.

It does not prove process-restart persistence, Paper/comment/attachment/
community/Workspace mutation flows in-browser, authenticated multi-session
behavior, live Postgres transactions, durable cross-process SSE, Redis, R2,
production Clerk, provider health, deployment identity, or production writes.
Those boundaries are covered only to the level named in the local evidence
record, or remain pending. Fresh browser context is not process restart.

## 8. LOC result and anti-gaming contract

| Metric | Baseline | Worktree | Delta |
| --- | ---: | ---: | ---: |
| Files | 461 | 465 | +4 |
| Physical | 128,349 | 128,331 | −18 |
| Nonblank | 120,121 | 120,078 | −43 |
| Production physical | 91,513 | 91,113 | −400 |
| Styles physical | 17,615 | 17,615 | 0 |
| Checks/tools physical | 19,221 | 19,603 | +382 |

The pre-execution 800–2,000-line forecast was not achieved and is not claimed.
The real result is smaller but architecturally meaningful: 400 production
lines were removed while stronger characterization added 382 proof lines,
leaving the aggregate pass net negative.

Release still requires:

- the committed candidate to remain below 128,349;
- the checked-in pass ceiling to ratchet to the exact committed result;
- an exact-ref inventory that excludes neither tracked source nor failures;
- no LOC credit for relocation, formatting compression, weaker types,
  deleted proof, generated-source hiding, or exclusion changes.

## 9. Risk controls and stop conditions

| Risk | Control / stop condition |
| --- | --- |
| Protected route capture | Named Next boundaries and negative fixtures; stop on any public exposure |
| Local preview loss | Local-mode checks and isolated browser mutation; stop on any supported workflow regression |
| Production local fallback | Strict production injection checks; stop if local data appears |
| Body or receipt drift | Direct/facade mapping and hash-parity fixtures; stop on unexplained delta |
| Duplicate mutation | Existing replay classification and idempotency preservation; stop on double-commit evidence |
| Token or actor leakage | Header-capture checks; stop if compatibility identity becomes production authority |
| Error drift | Status/body/header fixtures; stop on unexplained user-visible or retry-driving change |
| SSE or protected-delivery drift | Existing stream checks and protected redirect/denial/malformed fixtures |
| LOC reversal | Exact inventory and ratchet; stop at or above 128,349 |
| Hidden domain policy | Adversarial review; stop if transport absorbs authorization or business meaning |

## 10. Rollback and release order

Pass 02 is schema-neutral. The previous application commit remains deployable,
and rollback must not reset Postgres, local data, R2 objects, events, receipts,
revisions, or browser data.

Release order:

1. finalize the exact lower source ceiling and documentation;
2. commit the candidate and record its immutable SHA;
3. reproduce install, audit, source inventory, proof kernel, 56/56 verification,
   and 5/5 browser proof in a clean checkout of that SHA;
4. push that exact SHA non-force to `main`;
5. verify GitHub required proof and retained artifact for that SHA;
6. verify Render and Vercel deployment identity;
7. verify `/readyz?probe=database` reports the exact release, strict readiness,
   64/64 migrations, and no pending issue;
8. run read-only production route/UI smoke and inspect safe provider logs;
9. keep production writes out of release verification.

If any gate fails, hold release or revert/redeploy the previous exact
application SHA while retaining all user data. Implemented, locally verified,
clean-checkout verified, CI verified, pushed, deployed, and production
verified remain separate states.

## 11. Completion contract

The architecture is implemented and locally characterized. Pass 02 is not
released or production verified until:

- the exact committed source remains at or below the ratcheted lower ceiling;
- the clean exact-SHA checkout reproduces the complete local proof;
- GitHub succeeds on that exact SHA;
- the exact SHA is pushed and provider deployment identity is verified;
- readiness reports 64/64 migrations and the exact release;
- read-only production smoke and safe log review show no regression.

No document may convert missing provider, authenticated, durable-database, or
production evidence into a pass. Release evidence must name limitations
rather than infer perfection.
