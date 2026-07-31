# Pass 04 checkpoint 06 — C1 canonical view authority

## Verdict

Slice C1 is implemented and verified. The client shell no longer owns
independent writable state cells for room, post/comment/application selection,
profile/social selection, community selection, messages, Assistant workspace,
Office mode, Workspace view, or comment-segment navigation. One typed
`useSymposiumViewController` state owns that view snapshot, while
`nextViewSnapshot` owns the transition policy used by programmatic navigation.

This is a real authority cutover, not a completed Pass 04. Inquiry
projection/synchronization, profile/social activity, and final shell retirement
remain C2-C4. Experimental C2/C3 groundwork was rejected before release because
it moved code without completing live, persistence, and activity ownership and
increased total source. No part of that draft is in this candidate.

## Exact scope

Execution baseline:
`b0b071c79962976f2c56b8692057225862860d7f`. It is a documentation-only
successor to released runtime SHA `b0ce00548a29e2111d74c4e90acb9bcf27404bf0`
and has the same source inventory.

The candidate contains only:

- the new navigation view controller;
- the pure canonical view-transition authority;
- shell cutover and deletion of the superseded independent view state and
  transition branches;
- route, architecture, and Assistant construction proof updates; and
- the exact source-ceiling ratchet.

No schema, migration, API route, provider, visual, Design Lab, authored-artifact
identity, or Assistant capability changed. The compatibility surface remains
exactly 85 route modules and 116 exported HTTP methods.

## Authority replaced

Before C1, `SymposiumExperience` independently instantiated 18 view state
cells and implemented the same transition policy through many setters. Initial
route application, browser-history restoration, programmatic navigation, and
exceptional selection changes could therefore write the same logical snapshot
through separate paths.

After C1:

- `features/navigation/useSymposiumViewController.ts` owns one stored snapshot
  and stable typed replacement/field commands;
- `features/navigation/viewState.ts` owns the pure transition from current
  snapshot plus navigation intent to the next snapshot;
- initial route application and browser-history restoration replace the
  snapshot atomically;
- programmatic navigation computes and records the same next snapshot before
  one replacement;
- comment creation, profile rename, messages, Assistant thread selection, and
  comment clearing write through the controller; and
- `architectureBoundaryCheck` fails if selected legacy independent state cells
  return.

The shell remains responsible for DOM scroll-anchor capture/restoration and
top-level composition. Those are intentionally not hidden inside the state
owner.

## Exact inventory

| Metric | Baseline | Candidate | Delta |
| --- | ---: | ---: | ---: |
| Tracked source files | 476 | 477 | +1 |
| Physical source lines | 125,725 | 125,721 | -4 |
| Nonblank source lines | 117,682 | 117,671 | -11 |
| Production | 87,285 | 87,245 | -40 |
| Styles | 16,200 | 16,200 | 0 |
| Checks and tools | 22,240 | 22,276 | +36 |
| `components/SymposiumV0.tsx` | 5,030 | 4,903 | -127 |

The exact `sourcePolicy.passMaximum` remains ratcheted to 125,722; this
candidate is one line below it. The candidate remains 10,722 physical lines
above the Pass 04 ceiling of 114,999, so Pass 04
is explicitly incomplete.

## Verification

Final candidate results:

- `npm run verify` — 61/61 ordered stages passed in one uninterrupted final
  report, including strict frontend/API unused-code typechecks, optimized Next
  build, and production hydration;
- `npm run proof:check` — passed;
- focused routing, architecture, Assistant, entity, revision, mutation,
  reconciliation, cross-tab, live-transport, local-persistence, profile,
  entry-session, security, migration, recovery, and infrastructure checks —
  passed;
- `npm run browser:canary` — 6/6 serial clean-candidate canaries passed with
  zero skipped, unexpected, flaky, or retried cases; exact report validation
  passed;
- the navigation/PDF/history journey that failed once on the first hosted Linux
  run passed 15/15 local stress repetitions across two equivalent corrected
  teardown implementations, including 5/5 against the exact final candidate;
- `npm run storage-filesystem:integration` — passed on isolated PostgreSQL 17
  through `0065_comment_deletion_reconciliation`, comprehensive read/write and
  public/private delivery checks, authorization, receipts, audit/events/ranges,
  API restart persistence, durable canonical/staging deletion, deterministic
  cleanup, and zero remaining object files;
- `npm audit --audit-level=high` — zero vulnerabilities;
- `git diff --check` — passed; and
- the user-owned `scripts/browserCanaryServer 2.ts` remains byte-exact at
  SHA-256 `9ca3d8239ffb43186453d70feb5b5d8e4f023d9dc3ec411abc82c687197e2b4a`;
  it and `output/` remain untracked and unstaged.

Passing this matrix proves the named states. It does not mean every theoretical
production state was visited.

## Stopped attempts

The pass stopped and corrected four non-product issues instead of bypassing
them:

1. The first clean-candidate browser packaging attempt omitted the new
   untracked controller. The file was staged, and the exact staged candidate
   passed 6/6.
2. The first full verification run reached the Assistant construction check,
   whose old regex required the deleted `setAssistantThreadId` setter. The
   behavior was already present in the atomic replacement. The proof was
   updated to require that replacement and collapse fields.
3. The next full run passed the first 60 stages, then Next's broader build scan
   rejected a route-test literal widened to generic `string`. The fixture was
   made literal-safe; the optimized build passed, and the entire 61-stage
   manifest was rerun from stage one and passed.
4. The first database integration selected the known non-SSL-linked PostgreSQL
   binary and failed loading `pgcrypto` before an application assertion. The
   compatible SSL-linked PostgreSQL 17 server then passed the complete harness.
5. The first exact-SHA GitHub run passed every non-browser stage and five of six
   canaries. Its retained Playwright trace proved that navigation and history
   were correct, but a feed PDF range reader emitted an uncaught vendor
   `AbortError` while its loading task was destroyed during route replacement.
   PDF teardown now allows the finite download to settle before worker
   destruction, without filtering diagnostics or disabling the assertion. The
   journey then passed 10/10 stress repetitions; the source-equivalent
   simplified final form passed another 5/5.

## Next authority

C2 should begin from the rejected-groundwork lesson: the inquiry controller
must own bounded reads, mutations, live/cross-tab reconciliation, and snapshot
persistence as one completed cutover before old shell policy is deleted.
Transport-only extraction is insufficient. C3 should follow with the complete
profile activity, follow, cache, abort, live, and cross-tab authority. C4 then
retires the remaining shell glue and reconciles another exact net source
reduction.
