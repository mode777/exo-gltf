# Verification

## Dependency and bundle size

- `@gltf-transform/core` resolves to **4.5.1** and is pinned in
  `package-lock.json` (`^4.5.1` in `plugin/package.json`).
- Baseline editor bundle before M2: `editor-DYZ2DEy4.js` 719.91 kB
  (gzip 199.12 kB).
- Final M2 build: `editor-C7ToNjA-.js` 797.71 kB (gzip 220.87 kB).
  Delta: **+77.80 kB minified / +21.75 kB gzip**.
- `npm run build --workspace plugin` succeeds; `npm test --workspace
  plugin` passes (9 files, 58 tests).

## Explorer model

`@gltf-transform/core` represents glTF **images** as `Texture` properties
and folds glTF texture definitions (sampler + source) into `TextureInfo`.
The document graph therefore has no separate image collection, so the
explorer exposes one **Textures** group instead of duplicate
Textures/Images groups; each texture entry still shows its image URI,
MIME type and resolved/missing status. This matches the capability spec
("scenes, nodes, meshes, materials, textures, animations and extensions")
and avoids presenting the same property twice. Raw glTF texture counts
can differ from the graph when several texture definitions share one
image.

## End-to-end suite

The extended Playwright suite (9 tests) was run against the live Exo
shell (`https://mode777.github.io/exo-editor/`) with the local production
build served through request interception:

- `external references, pass-through save, external change, delete and
  disposal` — explorer groups/counts, node selection + inspector,
  save round-trip with a selection, external content change (nodes 2 → 3,
  expansion and selection cleared), close/reopen freshness, delete
  notice, final disposal.
- `texture selection shows the external URI and status`.
- `missing texture renders a placeholder and is flagged in the explorer`.
- `missing buffer blocks the scene while the structure stays browsable`.
- The existing GLB, Draco, KTX2, oversized-file and theme tests.

Result: **9 passed** (1.5 min). The suite ran on the verification box
because this container is Alpine/musl and the Playwright Chromium build
is glibc-only.

## Deployment pipeline

To be recorded after the GitHub Actions run on `main`: run URL and the
deployed-suite result.
