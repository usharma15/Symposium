# Workspace browser authority evidence

## Control record

| Field | Value |
| --- | --- |
| Baseline | `be8ab672abdf25d461cc4723586b5c58f4c2b68d` |
| Branch | `codex/workspace-authority-closeout` |
| Scope | Shared Content/Workspace ownership audit and justified browser-authority cutover |
| Product boundary | No editor, presentation, attachment, publication, Assistant, or design-system expansion |
| Status | Implemented and locally verified; protected-main and exact-SHA release proof pending |

## Audit disposition

The audit gate was met by distributed responsibility, not source size.

| Consumer | Transport/cache responsibility before cutover | Disposition |
| --- | --- | --- |
| `useWorkspaceDocuments.ts` | Snapshot read, document and notebook mutations, search, publication, route construction, actor bodies, revisions, idempotency, and local snapshot storage | HTTP calls moved to the gateway; cache moved to the storage authority; state/reconciliation retained |
| `useWorkspaceComments.ts` | Discussion read/create/update/delete/action routes, actor bodies, revisions, attachments, and idempotency | HTTP contracts moved to the gateway; discussion reconciliation and cross-tab timing retained |
| `useWorkspaceAccess.ts` | Document/notebook access paths, collaborator search, grant/update/revoke bodies, revisions, and idempotency | HTTP contracts moved to the gateway; dialog state and lost-access behavior retained |
| `savePostDraftToWorkspace.ts` | A second document-create envelope with retry-stable idempotency and its own cross-tab publication | Duplicate HTTP envelope moved to the gateway; retry identity and cross-tab behavior retained |

The resulting gateway owns 19 domain operations. The direct contract check
exercises 27 exact request shapes, including default and retry-stable document
creation, autosave and checkpoint saves, filtered and unfiltered search,
optional publication target, root comments and replies, action variants, and
both document and notebook access paths.

## Preserved authorities

- `useWorkspaceDocuments.ts` still owns the canonical snapshot projection,
  request IDs, mutation epochs, optimistic application, status, and refresh
  behavior.
- `WorkspaceDocumentDetail.tsx` still owns editor state, autosave timing,
  checkpoint saves, save-before-navigation, and revision conflict display.
- Workspace discussion and access hooks still own interaction state and
  live/cross-tab refresh orchestration.
- `useCrossTabItemTransport` remains the shared browser synchronization
  primitive; no polling or second event stream was introduced.
- The shared document model, full/reduced editor capability policies, titleless
  Thoughts, immutable revisions, notebook cascade behavior, publication
  transaction, collaboration ceilings, and private/public attachment
  transitions are unchanged.

## Permanent proof

- `workspace-gateway:check` records the exact method, URL encoding, request
  body, no-store policy, revision, attachment identity, publication target,
  and idempotency scope of every operation.
- The check injects the request function and mutation-ID factory, proves
  resolved-value identity, and verifies exact error-object propagation.
- Snapshot storage proof covers actor-key isolation, valid round trips,
  missing data, malformed JSON, invalid collection shapes, denied reads,
  quota/denied writes, and server-authoritative fallback.
- `architecture:check` scans every Workspace feature module and rejects raw
  Workspace routes or `symposiumApi.request` outside the gateway. It also
  prevents private cache access from returning to the document hook.
- Existing Workspace construction and collaboration checks were retargeted to
  the new owner; no semantic assertion was deleted.
- The isolated Chromium scenario uses two tabs to create, checkpoint-save,
  reload, and delete a private draft. It verifies exact idempotency headers and
  request bodies, cross-tab create/update/delete convergence, durable local
  persistence, and a valid stale cache being displayed and then replaced by
  the canonical server snapshot.

## Verification results

At the implementation checkpoint:

- `npm run workspace-gateway:check` — green;
- `npm run workspace:check` — green;
- `npm run workspace-collaboration:check` — green;
- `npm run architecture:check` — green;
- `npm run typecheck:all` — green;
- complete `npm run verify` manifest — 70/70 green, including the optimized
  Next.js build and hydration checks;
- `npm run proof:check` — green;
- isolated tracked-tree Workspace browser canary — 1/1 green after the test
  selectors and cache setup were corrected; the application paths themselves
  completed successfully;
- complete tracked-tree browser canary — 13/13 expected, 0 skipped, 0
  unexpected, and 0 flaky;
- deterministic cache-precedence stress run after replacing the fixed timing
  delay with an explicit response gate — 5/5 green;
- isolated install audited 230 packages with 0 known vulnerabilities;
- `git diff --check` — green.

Protected GitHub checks, merge-SHA deployments, readiness, and production smoke
remain release gates and must be recorded before closeout.

## Limitations

- The browser canary proves credential-free local preview and two-tab browser
  behavior; it does not claim every authenticated production collaboration
  role or failure state was exercised through the UI.
- Direct gateway proof covers every request contract but does not replace the
  existing database transaction, migration, attachment, publication, and
  permission checks.
- This environment had no `initdb`, `DATABASE_URL`, `POSTGRES_URL`, or
  `POSTGRES_PRISMA_URL`, so the pass could not add a live PostgreSQL mutation
  run beyond the permanent database and transaction checks in the manifest.
- No production data or database was mutated by this pass.
- Exact merge SHA, GitHub, Vercel, Render/API, and authenticated production
  identity remain unproven until the protected release completes.
