# Authored artifact provenance and rights review

## Review result

Review date: July 29, 2026.

The production registry, isolated Design Lab, deterministic builders, preserved
source files, edit masters, and SHA-256 records establish a complete technical
lineage for the 53 runtime artifacts in
`public/symposium-artifacts/v1`. Runtime files are immutable, registered, and
reproducible where a builder exists.

That technical lineage does **not** establish external-use rights. The
repository contains no acquisition URLs, creator names, license terms,
receipts, public-domain determinations, commissions, or owner attestations for
the externally supplied source imagery listed below. The source filename
`paper-sun-corner-licensed-source-v1.jpg` is not, by itself, license evidence.
Transforming, recolouring, isolating, or combining a source does not clear the
underlying rights.

Therefore:

- technical and design provenance: **complete**;
- runtime inventory and derivative traceability: **complete**;
- legal/public-distribution clearance evidence: **not established by the
  repository**.

This is a factual repository audit, not a legal opinion. Before relying on
these images for continued public distribution, the product owner should
retain acquisition and license evidence for every external source family, or
replace that family with commissioned, original, or clearly licensed artwork.

## Source-family ledger

All preserved sources below live only in the isolated Design Lab at
`/Users/udayansharma/Documents/Symposium Design Lab/paper-muse-study-2026-07-24`.
They are deliberately excluded from the production runtime.

| Runtime family | Preserved source or master | Source SHA-256 | Repository evidence | Rights status |
| --- | --- | --- | --- | --- |
| Calliope | `public/design-lab/calliope-amphora-full-pour-no-name-source-v1.png` | `b16f2ea3ce8e6fad0e0409cfa8a710b6aeeb8db69b83ee9f30b77d7633c22566` | Preserved source and deterministic theme builder | Evidence required |
| Urania | `public/design-lab/urania-globe-chalice-pour-bowl-core-v1.png` | Recorded by the frozen lab registry/check | Prepared core and deterministic theme builder | Evidence required |
| Erato | `design-studies/thought-muse-erato-original-v1.webp` | Recorded by the frozen lab registry/check | User-supplied original and deterministic extraction | Evidence required |
| Thalia | `design-studies/thought-muse-thalia-original-v1.webp`; `design-studies/thought-muse-thalia-no-name-master-v1.png` | Original recorded by the frozen lab registry/check; master `2d4f86d9e4003e25bc61adffb86c3886f85cd8f0b80bf7098101652666bfab2f` | User-supplied original, lettering-removal master, deterministic extraction | Evidence required |
| Pegasus corners and Thought emblem | `design-studies/thought-corner-pegasus-reference-close.webp` | `22d8a7ee1eab0c0ef151da48b58902789d5695ed959bc7b158462992ba13bf70` | Preserved reference and deterministic extraction | Evidence required |
| Apollonian sun corners and compact emblem | `public/design-lab/paper-sun-corner-licensed-source-v1.jpg` | `e486b87870be98c8592fabd37c14af27239ae7bc7af5843ffae50ba161c048bf` | Source is labelled licensed; compact emblem is a deterministic alpha recovery from the approved corner | License evidence required |
| Resting Warrior | `public/design-lab/resting-warrior-source-v1.webp` | `9d22984a58e5daf37376e19c9c6343d17a12cdc85335a83e205ad84c0b6969a7` | Preserved source and deterministic material builder | Evidence required |
| Flute Girl | `public/design-lab/flute-girl-original-source-v1.png` | `df9c59efbfae00d69d2b67418d73a297409dad0501a722216f3079ed357166f5` | Preserved original, prepared transparent source, deterministic material builder | Evidence required |
| Discus Thrower | `public/design-lab/discus-thrower-original-source-v1.jpg` | `dc1c032bd1710cf9eac64fd5dc228a4a2a36ca6e912fec65bdc78ede51806a00` | Preserved original, precise-object edit master, normalized source, deterministic material builder | Evidence required |
| Harp Girl | `public/design-lab/harp-girl-original-source-v1.png` | `009a201f4b0e5b354d611f406a5a10fefe436e2ba840d29f6c76c6cee79b0032` | Preserved original, material-map source, deterministic material builder | Evidence required |
| Wanderer | `public/design-lab/wanderer-original-source-v1.jpg` | `f314e9cdf040a0eac87e0df65f257b0fee1f9f5c052812dbea5542e1a22feeef` | Preserved original and deterministic cleanup/material builder | Evidence required |
| Lovers | `public/design-lab/lovers-original-source-v1.webp` | `231ca6cc770b124bdb7fe5f0ebc1214da61550190d4e67298096bb866f337ac0` | Preserved original, isolation master/source, deterministic material builder | Evidence required |
| Chariot | `public/design-lab/chariot-original-source-v1.jpg` | `7e9b68d9e4003e25bc61adffb86c3886f85cd8f0b80bf7098101652666bfab2f` | Preserved original, cleanup master/source, deterministic material builder | Evidence required |
| Paper and Thought surface textures | `public/design-lab/greek-paper-reference.webp` and frozen lab surface masters | Reference `7c18cd58a1fc58fcc589c40cc66bdb2edc0d845f7bef3566a144eb789c8108a5` | Frozen texture derivatives and registered runtime hashes | Evidence required for any externally sourced texture |
| Greek-key and wave geometry | Frozen lab SVG/PNG masters and deterministic construction scripts | Recorded by the frozen lab checks | Code-constructed geometry with immutable runtime hashes | Internal construction; confirm no unlicensed traced source was used |

## Runtime controls

- `features/posts/artifacts/authoredArtifactRegistry.ts` is the production
  runtime inventory and digest authority.
- `npm run authored-artifacts:check` rejects missing, extra, renamed, modified,
  dimension-drifted, or alpha-drifted runtime files.
- `scripts/buildThoughtBottomCaricatureVariants.mjs` derives the six additional
  Thought surface-through pairs without changing source silhouettes.
- `scripts/buildCompactPostEmblems.mjs` derives the transparent Paper emblem
  from the approved Paper sun without introducing new artwork.
- Source photography, external references, edit masters, and rejected studies
  are not deployed under `public/symposium-artifacts/v1`.

## Evidence needed to close rights clearance

For each row marked `Evidence required`, retain at least one of:

- a license or purchase receipt permitting the intended public/commercial use;
- a source URL and archived license terms;
- a creator assignment or commission agreement;
- an owner attestation that the supplied work is original and owned;
- a documented public-domain determination for the exact source reproduction.

Record the evidence location and reviewer/date in this document. Do not add
license receipts or contracts to a public repository.
