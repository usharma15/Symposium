# Symposium infrastructure revamp

## Governing contract

This is the current infrastructure program. The historical Pass 04 LOC gate
was retired on July 31, 2026. Source inventory remains exact and reviewable,
but line count is not a release gate, architectural objective, or completion
test. Reduction is credited only when replacement authority makes old code
genuinely obsolete.

The program continues only while a pass does at least one of the following:

- replaces competing authorities with one explicit owner;
- eliminates a demonstrated failure mode;
- makes feature changes materially safer;
- permits superseded infrastructure to be deleted; or
- measurably improves correctness, security, persistence, recovery, or
  operational efficiency.

The program stops when recovery is proven, the shell primarily composes
features, persistence authorities are coherent, superseded compatibility
paths are retired, and exact-SHA local/database/browser/production
verification is green. Moving files, renaming equivalent abstractions,
chasing LOC, or rewriting stable modules after that point is out of scope.

Zero loss of site behavior, persistence, live synchronization, privacy,
security, accessibility, and recoverability remains the highest-order gate.

The repository operating model is deliberately simple: work on `main`, verify
locally, commit, and push directly to `origin/main`. Do not introduce topic
branches, pull-request gates, GitHub Actions workflows, or repository rulesets
unless the user explicitly reopens that decision.

The historical master program remains evidence, but its retirement was too
broadly worded. Only its numerical LOC ceiling and any work requiring separate
product authorization are retired from this infrastructure contract. Its
zero-loss rules, authority-ownership tests, verification matrix, retirement
discipline, rollback requirements, and requirement that documentation match
source remain binding.

## Master-program reconciliation ledger

This ledger is the authoritative disposition of Passes 1-10 from
`docs/major-refactor-program.md`. It was reconciled on July 31, 2026 against
`main` at `c4a7a44d56d4ef721bdebd62773705a664f91d24`, the released commits,
current architecture, source ownership, verification manifest, and evidence
records. The tracked-source inventory at that SHA is 487 files / 133,029
physical / 124,722 nonblank lines. LOC remains an exact historical signal,
not a completion or release gate.

Status meanings:

- **Complete** — the structural responsibility has one supported disposition
  and current proof; ordinary maintenance does not reopen the pass.
- **Substantially complete; audit-gated** — broad implementation exists, but a
  bounded ownership audit must either certify it or identify one concrete
  competing authority before any further cutover.
- **Partially complete** — a demonstrated competing authority remains and a
  bounded implementation is justified.
- **Product-blocked / outside this sequence** — the work requires explicit
  product or design authorization. It is not mislabeled complete and does not
  keep the present infrastructure sequence open indefinitely.
- **Closeout pending** — implementation may be finished, but retirement,
  documentation, limitations, or final release evidence is not yet complete.

| Master pass | Current status | Source-grounded disposition | Remaining gate |
| --- | --- | --- | --- |
| 1. Local verification and evidence | **Complete for the direct-main workflow** | The canonical manifest, proof-kernel, isolated Chromium, exact-SHA release checks, and authenticated-sync canary harness remain available locally. GitHub Actions, protected pull requests, and the scheduled GitHub production watch were retired on August 1, 2026. | Keep verification local and bounded; add a stage only when a new authority needs direct proof. |
| 2. Recovery, migration, operations | **Complete** | Migration locking/checksums, fresh and restored Postgres proof, Neon restore, R2/static coherence, browser recovery, fail-closed identity, and 65 migrations are implemented and released. | Keep evidence current during releases; do not introduce distributed fanout without a scaling trigger. |
| 3. Compatibility and persistence modes | **Complete** | Canonical API, credential-free local preview, and unavailable modes are explicit; `dataStore.ts` and direct-Postgres Next authority are retired; every remaining Next route has a named compatibility, protected-delivery, or local-preview reason. | A retained supported mode is not debt merely because it is large. Reopen only when its caller or product requirement disappears. |
| 4. Client shell and state ownership | **Substantially complete** | Navigation, inquiry, profile/social, discovery, live delivery, session, recovery, and transient surfaces have typed owners. `SymposiumV0.tsx` is 2,274 lines and primarily composes domain ports. | Final architecture audit must confirm no remaining shell policy is a competing owner. File size alone cannot justify extraction. |
| 5. Shared content, editor, Workspace, attachments | **Complete for the authorized infrastructure scope** | The audit proved four Workspace consumers constructing 19 operations, including a duplicate document-create envelope in the global composer. `workspaceGateway.ts` now owns document, notebook, publication, discussion, access, and search HTTP contracts; `workspaceSnapshotStorage.ts` owns the actor-scoped private cache. The new authenticated canary directly exercises public and owner-only Workspace delivery through the supported API/SSE paths. Shared editor, attachment, autosave, mutation-epoch, optimistic, and live/cross-tab owners remain unchanged. | Preserve the gateway/cache boundary. The harness is permanent; a real production run still requires two distinct short-lived Clerk sessions and must not be replaced by an auth bypass. |
| 6. Messaging and Notifications | **Main-integrated; production proof pending** | Messaging is released behind one typed browser gateway and one draft-storage authority. Notifications now has one typed browser gateway for all eight domain operations and nine request shapes; the panel contains no raw route or API-client authority. | Complete exact-main-SHA local, Vercel, Render, API, readiness, and authenticated browser proof. |
| 7. Assistant substrate | **Product-paused / outside this sequence** | Context identity, evidence, actions, receipts, private persistence, and the three-tool authority boundary are strong; the 1,671-line browser controller still mixes transport and orchestration. | No capability expansion or speculative substrate pass. Reopen only by explicit user direction or a demonstrated Assistant regression/feature requirement. |
| 8. Backend domains, contracts, and operability | **Bounded operability implementation released** | Shared transaction, mutation, receipt, audit, event, attachment, access, and notification kernels exist. The audit found no safe broad `foundation.ts` split, while production measurement justified parallel bootstrap tail reads and bounded privacy-safe readiness telemetry. The GitHub-hosted scheduled watch was retired; the telemetry remains available through readiness and local release checks. | Execute no further backend split without a new measured failure or feature dependency. |
| 9. Sitewide design-system migration | **Product-blocked / outside this sequence** | No approved sitewide replacement family has been opened. Existing authored-artifact and layered CSS behavior remains protected. | Requires explicit design approval and a separate visual migration. Do not infer authorization from this ledger. |
| 10. Final retirement and architecture audit | **Closeout pending** | Major compatibility authorities are retired, the master ledger is reconciled, and Notifications plus Workspace now have bounded browser authorities. The release flow is direct-to-main with local proof. The conditional backend leverage audit and final release proof remain. | Finish the backend audit, reconcile its disposition, record limitations, run final local/browser/database/production proof, then stop. |

The ledger retires neither zero-loss requirements nor evidence merely because
a pass is old. It also does not turn an audit candidate into authorization to
rewrite a stable subsystem. For Passes 5 and 8, a well-supported finding that
one authority already exists is a valid closeout result.

## Released authority sequence

The current released production baseline is
`9bd80cf6bb46b4434a8162b7787e26d34a36fd24`. It includes:

1. canonical mutation/read-model and local persistence boundaries;
2. canonical view and browser-history authority;
3. inquiry and profile/social authorities;
4. global and community discovery authority;
5. global live-event delivery and routing authority; and
6. exact-user authentication, entrance, cache, read, social, and live
   admission authority;
7. browser/runtime recovery and reconnect authority;
8. transient shell-surface lifecycle authority;
9. explicit canonical/local-preview/unavailable persistence mode authority;
   and
10. consolidated Assistant, Conversations, and Notifications compatibility
    route authority;
11. one browser Messaging transport and draft-storage authority;
12. measured bootstrap query-cost reduction plus startup fixture priming; and
13. one browser Notifications transport authority; and
14. one browser Workspace HTTP authority plus one actor-scoped snapshot-storage authority.

The released sequence includes bounded request/live-stream operability and one
measured bootstrap critical-path optimization. The former GitHub-hosted
production watch is retired and is not part of the operating model.

`components/SymposiumV0.tsx` remains the composition root.
The direct-Postgres Next authority is already retired. Credential-free local
preview remains deliberately supported through `lib/localPreviewStore.ts`;
it is not a production fallback or a second database authority.

## Recovery and resilience authority

The next bounded cutover owns browser/runtime recovery rather than domain
data:

- one browser coordinator observes online, offline, focus, visibility, page
  restoration, and recoverable transport failure;
- hidden tabs suspend transport synchronously and do not run retry loops;
- recovery produces one monotonic epoch consumed by session bootstrap,
  notifications, messaging, Assistant, analytics, and Scribble refreshers;
- live transport retains its cursor, replays missed durable events, rejects
  stale session callbacks, and uses bounded exponential reconnect backoff;
- session identity sync retries only for the exact current Clerk user, with
  its existing abort controller, epoch, and commit predicate intact;
- authenticated API and live requests fail closed when an exact Clerk token
  is unavailable and never downgrade to browser-supplied handle trust;
- successful transport after a recoverable failure publishes one recovery
  epoch, while duplicate failure notifications are coalesced; and
- domain mutation idempotency, revision conflict, optimistic state, and
  durable retry semantics remain owned by their existing domain authorities.

This authority does not automatically retry unsafe non-idempotent mutations,
invent offline writes, or convert a provider outage into local-preview trust.

## Shell surface authority

Transient surface lifecycle now has one typed reducer and one React
controller. The authority owns the compact Assistant, Assistant origin
context, post composer and destination, quote composer, settings, Quick
Messages and selected conversation, post/comment editors, and dedicated
attachment preview.

The cutover:

- retires ten independent shell state owners and the composer destination
  state that was incorrectly stored in the community domain;
- makes composer visibility and destination, and Quick Messages visibility
  and selected conversation, atomic states;
- centralizes route commit, browser-history restore, session-route reset,
  Assistant expand/collapse, search preparation, and surface open/close
  transitions;
- preserves the existing surface-coexistence contract, including compact
  Assistant context beside the attachment viewer;
- keeps live deletion cleanup guarded by exact post/comment identity; and
- adds a pure transition proof plus architecture guards preventing the old
  shell and community authorities from returning.

Search remains owned by discovery, full Assistant/Messages routes remain
owned by canonical view state, and attachment/PDF content context remains
owned by the corresponding feature controllers.

## Persistence mode authority

The Next boundary now selects exactly one named mode: `canonical-api` when a
valid backend URL exists, `local-preview` only outside production when no
backend exists, or `unavailable` in production without the canonical API.
The production-unavailable mode returns a no-store 503 and cannot fall
through to local JSON.

The cutover:

- retires the ambiguous `lib/dataStore.ts` name and makes the supported JSON
  implementation explicitly local-preview-only;
- fails closed if that store is invoked in production or beside database
  credentials;
- moves shared action types back to the domain core and local input types to
  a type-only module, so browser features no longer depend on a persistence
  implementation;
- makes Clerk sync attempt the canonical API before any local snapshot read,
  preventing production bridge traffic from initializing ephemeral local
  state; and
- retains the exact local JSON file, seed normalization, serialized atomic
  mutation, action ledger, view dedupe, and restart behavior.

The local-preview store remains load-bearing for credential-free laptop work.
Deleting it would be a product decision, not infrastructure cleanup.

## Authenticated multi-actor proof authority

The canonical release verifier now contains `authenticated-sync:check`. It runs
the production canary orchestrator against a deterministic API/SSE fixture and
proves the three-actor sequence, durable reconnect replay, private filtering,
canonical readback, exact-once rejection, and cleanup on both success and
failure. Adversarial duplicate replay and private-event leakage are injected as
negative controls; either fault fails the gate.

`authenticated-sync:canary` is the credentialed execution of that same
orchestrator. It is intentionally outside the environment-free verifier. The
command requires an exact expected backend SHA, two distinct short-lived Clerk
session tokens, HTTPS, and an explicit production-write acknowledgement. It
never accepts development actor headers and never prints tokens, user content,
handles, or created object identifiers.

The canary uses the durable event order itself as the privacy proof: actor A
creates a private Workspace draft, then a later public post update. Actor B and
the anonymous client must receive the later marker without ever receiving the
earlier private event, while actor A must receive and read back the draft. A
separate disconnect/reconnect step resumes actor B from its last acknowledged
cursor and requires the missed mutation exactly once. Namespaced post, comment,
and draft artifacts are deleted in a `finally` path, and the successful path
also proves cleanup events and canonical tombstone/absence readback.

This closes the missing *test authority*. It does not manufacture a claim that
the credentialed production command ran when two real session tokens were not
available; that execution remains a separately recorded release proof.

## Compatibility route authority

The released compatibility authority retires 22 distributed Assistant,
Conversations, and Notifications route modules in favor of three explicit,
allowlisted dispatchers. All 31 logical method contracts remain available.
The repository now contains 66 Next route modules / 96 exported framework
handlers, classified as:

- 3 consolidated compatibility authorities;
- 8 protected Next-only boundaries;
- 3 canonical-only compatibility exceptions;
- 4 synthesized local-preview projections; and
- 48 persisted local-preview adapters.

The apparently large compatibility surface is therefore no longer
unexplained. The retained modules own local persistence, Clerk admission,
protected delivery, local attachment bytes, live-stream redirection, or an
explicit canonical retry boundary. Removing those responsibilities would
narrow supported behavior rather than improve infrastructure.

## Messaging browser authority

The user explicitly reopened infrastructure work after the governing stop
condition was satisfied in order to remove the largest remaining feature-side
transport entanglement. The released pass establishes one typed browser
Messaging gateway for all conversation, message, participant, discovery,
profile-search, read-receipt, draft, block, and attachment-cleanup operations.

The cutover:

- removes every raw Messaging request and API route string from
  `features/messages/MessagesSection.tsx`;
- centralizes route construction, request methods, actor propagation,
  cursor/query encoding, revisions, and mutation idempotency scopes in an
  injectable `messagingGateway`;
- moves local message-draft keys, reads, writes, deletion, storage-failure
  behavior, and failed-send restoration into one draft-storage authority;
- centralizes retry classification, missing-resource recognition, and draft
  conflict decoding at the transport boundary;
- retains the existing live-event reconciliation, send ordering, optimistic
  projection, recovery epochs, UI state, confirmation, and attachment upload
  behavior; and
- adds direct route/body/idempotency/storage/failure contract tests plus
  architecture guards that fail if raw API or localStorage authority returns
  to the Messaging view.

This pass does not change server routes, schemas, migrations, rendered design,
or product capability. It is an ownership cutover intended to make Messaging
changes reviewable and safe without creating a second runtime path.

The pass merged through protected PR #3 at
`0edc8131476c0f09987fb1b03b202a4d6b641980`. Local verification passed 68/68,
browser canaries passed 11/11, the isolated dependency audit reported zero
vulnerabilities, post-merge GitHub run `30662040958` passed, and exact-SHA
Vercel, Render, readiness, API, and deployed Messaging checks passed. Its
evidence record is `docs/refactor-evidence/messaging-authority-pass.md`.

## Notifications browser authority

The main-integrated change replaces the clearest feature-side ownership defect.
`features/notifications/notificationGateway.ts` is now the one typed,
injectable Notifications gateway
for list, unread, preferences, read, and archive operations. It deliberately
leaves live-event reconciliation, optimistic state, recovery scheduling,
pagination state, panel lifecycle, and rendering in their current owners.
`NotificationsPanel.tsx` contains no raw Notifications route, `fetch`, or
API-client authority. The implementation contract is
`docs/refactor-notifications-authority-plan.md`; exact local evidence is
`docs/refactor-evidence/notifications-authority-pass.md`.

## Workspace browser authority

The bounded Shared Content/Workspace audit found a real competing browser
authority rather than a file-size concern. `useWorkspaceDocuments.ts`,
`useWorkspaceComments.ts`, `useWorkspaceAccess.ts`, and
`savePostDraftToWorkspace.ts` independently constructed Workspace routes,
actor bodies, revision fields, idempotency scopes, and cache behavior. The
Workspace hook and global composer also duplicated document creation.

`features/workspace/workspaceGateway.ts` is now the one injectable HTTP
authority for 19 document, notebook, publication, discussion, access, and
search operations. `features/workspace/workspaceSnapshotStorage.ts` owns the
existing actor-scoped private snapshot cache and preserves fail-open behavior
when storage is malformed, unavailable, or full. The hooks retain autosave,
stale-request suppression, mutation epochs, optimistic projection,
collaboration state, and live/cross-tab invalidation. The shared document
model, editor capability policies, private attachment delivery, publication
transactions, and UI were not rewritten. Exact local evidence is recorded in
`docs/refactor-evidence/workspace-authority-pass.md`.

## Remaining structural sequence

1. Recompute the exact source inventory and identify concrete superseded code,
   duplicate authorities, and oversized modules whose responsibilities can be
   simplified without adding replacement layers.
2. Retire one proven-obsolete path at a time. Each pass must be net simpler,
   preferably net negative in modules and lines, locally verified, committed
   on `main`, and pushed directly.
3. Reconcile architecture and evidence documents, record limitations, run the
   complete final proof matrix, and stop.

Assistant consolidation and sitewide design migration remain outside this
sequence until explicitly reopened. The revamp is complete when Notifications
and Workspace have one browser transport authority, the backend conditional
audit has an honest disposition, docs match source, all temporary paths are
retired or justified, and the final exact-SHA proof is green. Beyond that
boundary, infrastructure work requires a demonstrated failure mode, measurable
bottleneck, or explicit product/runtime decision.
