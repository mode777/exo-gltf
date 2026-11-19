# Verification

## Dependencies and bundle

- Vendored `@exo/plugin-sdk` refreshed to upstream **1.3.0**, unmodified:
  `diff -r sdk/src <upstream>/src` is empty. SDK typecheck passes and its
  suite reports **7 files / 59 tests passed**.
- `@gltf-transform/extensions` resolves to **4.5.1**, pinned with
  `@gltf-transform/core` 4.5.1 in `package-lock.json`. Only
  dependency-free extensions are registered; Draco and Meshopt remain
  read-only.
- Editor bundle measurements (production build):
  - M2 baseline: 797.71 kB minified / 220.87 kB gzip.
  - After the SDK refresh: 797.45 kB / 220.81 kB.
  - After adding `@gltf-transform/extensions`: 897.80 kB / 241.96 kB
    (+100.35 kB / +21.15 kB for the extension package).
  - Final M3 build: **911.28 kB / 246.44 kB**, a total M3 delta of
    **+113.57 kB minified / +25.57 kB gzip**.
- Plugin typecheck passes; `npm test --workspace plugin` reports
  **16 files / 118 tests passed**.

## Unit and component coverage

- Extension registry: supported KTX2/material extensions, Draco/Meshopt
  rejected, malformed declarations ignored.
- Document parsing: extension registration, KTX2 editable, Draco
  read-only with a browsable structure, per-URI overrides replace empty
  images and zero-filled buffers, unparsable replacements rejected.
- URI computation: sibling, subdirectory, outside-directory, percent
  encoding and round-trip through `resolveReferencePath`.
- Repair model: one row per URI, shared-URI targets, relinked/reverted
  states, resolved and empty documents.
- Relink workflow: pick, cancel, unsupported picker, relative manual
  path, read failure, empty file, unparsable buffer, shared URI, revert.
- Serialization: pretty-printed `.gltf`, binary `.glb` round-trip,
  unresolved `.gltf` URI preserved without placeholder data, unresolved
  `.glb` refused, KHR_texture_basisu preserved, unsupported extension
  refused.
- Save queue: clean baseline, debounced cache, on-demand serialization,
  latest-edit wins, defensive copy, timeout and reset.
- UI component states: missing/relinked rows, relink/change/revert,
  manual path field, pending disabled, read-only hiding and notice
  actions.

## End-to-end suite

The extended Playwright suite now has **11 tests** and passes both
against the local production build (`e2e-local`) and the deployed plugin
(`e2e-deployed`):

- `relink repairs missing references, saves and reopens` — opens the
  `relink/` fixture, relinks the missing buffer through the shell picker,
  verifies the canvas and dirty tab, reverts and relinks again, relinks
  the texture, saves, inspects the saved URIs
  (`assets/BoxTextured0.bin`, `assets/CesiumLogoFlat.png`), then closes
  and reopens the saved file from disk with resolved resources and no
  repair rows.
- `external change while dirty keeps repairs until explicit reload` —
  writes the file externally while a relink is dirty, verifies the
  change notice and kept repair, attempts a save and verifies the
  conflict notice with the tab still dirty, then uses the explicit reload
  action and verifies the missing rows return and dirty clears.
- The existing M1/M2 preview, explorer, missing-reference, GLB, Draco,
  KTX2, oversized-file, clean pass-through save, delete and theme tests
  all stay green.

Measured save latency: `EXO_E2E_SAVE_MS 0` in both workflows — the save
arrives after the debounced pre-serialization and is answered from the
revision cache. The internal preparation deadline is 4 s and the suite
asserts the measured value stays below it.

An earlier deployed run hit the shell's known plugin-registration race on
a missing-buffer fixture; the e2e helper now retries the mount for both
`ready` and `error` phases, and the run above is green without retries.

## Deployment pipeline

GitHub Actions run on `main` (commit `f9284e6`, workflow "Deploy plugin
to GitHub Pages"):

- URL: <https://github.com/mode777/exo-gltf/actions/runs/44498420133>
- Jobs **build**, **e2e-local**, **deploy**, **e2e-deployed**: all
  succeeded. Both e2e jobs report 11 passed; deployed e2e took ~2.5 min.

Deployed manifest check:
`https://mode777.github.io/exo-gltf/exo-manifest.json` returns version
`0.1.0`, editor glob `**/*.{gltf,glb}`, and permissions exactly
`workspace:read`, `workspace:write`, `events:subscribe`. It contains no
`workspace:list`. The deployed e2e consent flow asserts the same three
permission descriptions and asserts the listing description is absent.

## M3 exit criteria

- A broken-reference sample is repaired and saved; the saved file exposes
  `assets/BoxTextured0.bin` and `assets/CesiumLogoFlat.png`, reopens
  cleanly and previews.
- An external concurrent write leaves the in-memory repair intact and the
  tab dirty; the save conflict is surfaced and only an explicit reload
  discards the edits.

## Notes and limitations

- The manual path fallback is covered by workflow/component tests; it is
  not driven against a real old shell in the deployed e2e.
- Draco/Meshopt documents stay read-only by design (no codec modules for
  the document model); preview and explorer remain available.
- M2 (`m2-structure-explorer`) must be archived before this change so the
  `gltf-structure-explorer` MODIFIED delta has a main-spec base.
