# Authored Paper and Thought artifacts

## Production contract

Paper and Thought visual identity has two independently persisted fields:

- `museId`: Calliope or Urania for Paper; Erato or Thalia for Thought.
- `bottomCaricatureId`: one member of the frozen seven-entry shared pool.

The server selects both once, after an idempotent create mutation is known not
to be a replay. The schema-versioned assignment is stored in
`posts.design_assignment`, returned by every full and bounded post read, and
preserved through client normalization and local fallback storage. Renderers
never select or randomize an artifact. Day and Night remain interface state and
are never persisted as post identity.

Migration `0064_authored_artifact_design_assignments` assigns compatibility
identities to existing Paper and Thought rows, removes historical Thought
titles from search vectors, and installs a strict type-to-muse database check.
Unknown, malformed, cross-type, missing persisted, or non-artifact assignments
fail closed after migration. A deterministic read-time fallback exists only for
pre-migration and local compatibility records that have no assignment yet.

## Rendering boundaries

- Full frames, muse ceremonies, and bottom caricatures mount only on Paper and
  Thought detail pages selected by `postType`.
- Paper title ink is measured from the authored muse anchor to the first
  semantic grapheme without breaking the title's shaped text run. It remeasures
  after translation, font readiness, or geometry changes.
- Thoughts have no public title and no Thought indicator. Existing stored
  titles are hidden from UI, search, translation context, quotes, citations,
  analytics, deletion prompts, and Assistant context.
- Feed and profile cards use only a restrained Apollonian-sun or Pegasus
  emblem. Comments are emblem-free.
- The post and its complete discussion share one continuous authored surface.
- Both theme assets occupy identical geometry. Foundational and selected
  figure assets for both themes are eagerly warmed by the active detail
  renderer, so theme switching does not wait on a new image request.
- Chariot uses its approved Thought surface-through pair. The other six shared
  figures retain their frozen Paper-surface assets.

## Asset ownership

The production runtime owns exactly 39 immutable files under
`public/symposium-artifacts/v1`. Rejected studies, source photography, edit
masters, and extraction intermediates are excluded. The registry records every
runtime SHA-256 digest, and `npm run authored-artifacts:check` rejects missing,
extra, renamed, modified, or non-versioned files. Versioned assets receive a
one-year immutable cache header.

## Verification and release gates

Focused checks:

```text
npm run post-design:check
npm run authored-artifacts:check
npm run styles:check
npm run typecheck:all
```

`npm run verify` includes those checks plus the complete application suite,
both TypeScript projects, production build, and production hydration check.

Before a public deployment:

- execute migration `0064` in a production-like PostgreSQL transaction and
  verify assignment coverage and constraints;
- complete the asset-rights/provenance review;
- visually approve Thalia at compact, tablet, and mobile sizes (desktop
  Day/Night is the currently frozen approval scope);
- complete a real-browser matrix for both themes, both Paper muses, both
  Thought muses, all seven bottom figures, RTL and complex-script Paper titles,
  short/long/no-comment discussions, translation switching, refresh,
  rehydration, and theme switching;
- verify the deployed revision through `/readyz`.

This integration is local and reversible until those gates are closed and an
explicit deployment is authorized.
