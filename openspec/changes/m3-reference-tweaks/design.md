# Design

## Context

M2 left the plugin with a workspace-backed `@gltf-transform` document, a
lazy explorer model, per-reference probes, and a pass-through save. The
vendored SDK is `1.1.0`; exo-editor ships the picker in SDK `1.2.0+` and
listing in `1.3.0`, and the register leaves the M3 UX open (D-08). The
picker needs only `workspace:read`; listing would add `workspace:list`
and re-prompt every user (C10). See proposal.md for motivation and the
delta specs for required behavior.

## Goals / Non-Goals

**Goals:**

- Relink missing buffers and textures through the shell picker with no
  manifest, permission or consent change; keep a manual fallback for
  older shells.
- Edit only reference URIs, with a reparse-based validation path that
  never serializes M2's placeholder bytes.
- Meet the 5 s save contract through debounced pre-serialization, and
  keep edits intact across save failures and external changes.
- Preserve glTF extension data; refuse to serialize what cannot be
  preserved instead of silently dropping it.

**Non-Goals:**

- Directory listing, an in-plugin workspace browser, or `workspace:list`
  (deferred; picker-only decision).
- Editing anything except external reference URIs (no node/material/
  texture authoring, no UV editing).
- Draco/Meshopt decoding in the document model; those documents stay
  read-only in M3.
- Multi-document operations, file copying/moving, or writing anything
  except the open document.
- A general undo stack; only per-reference change/revert.

## Decisions

### D1 Picker-only relink, manual path fallback

The repair action calls `editor.requestFiles({ multiple: false,
directory: <start hint> })`. The start hint is the directory of the
missing reference when it is a workspace path, otherwise the document's
directory. The plugin never calls `editor.listDirectory()`, never adds
`workspace:list`, and keeps the manifest permissions unchanged.

Only the returned paths are used; each is read with `editor.readFile()`.
Cancellation is an empty array and is a no-op. While a picker request is
pending, further relink actions are disabled (the shell also returns
`rate-limited` for a second request).

When `capabilities.filePicker` is false, or `requestFiles()` rejects with
`unsupported-message`, the repair row shows a manual path field. The
entered path is normalized with the existing `normalizeWorkspacePath`
(relative values resolve against the document directory) and trial-read
before applying. `permission-denied` and `rate-limited` are surfaced as
notices instead of switching modes.

Alternatives rejected: listing/browsing (re-consent for a marginal M3
gain), typed-path-only (the blind path entry the picker was shipped to
replace), drag-and-drop (no protocol support).

### D2 Vendor the SDK at 1.3.0 unmodified

Replace `sdk/` contents from upstream `packages/plugin-sdk` at the 1.3.0
state (`package.json`, `README.md`, `tsconfig.json`, `vitest.config.ts`
and `src/` including tests), update `plugin/package.json` to `1.3.0` and
refresh the lockfile. No local patches: the extra `gate` module and tests
arrive with the vendored copy, and the SDK's own typecheck/tests run as
part of verification. The init parser defaults an absent `filePicker` or
`directoryListing` bit to false, which is exactly the old-shell fallback
condition.

Alternatives rejected: cherry-picking `requestFiles()` into 1.1.0
(violates D-13 and makes future diffs noisy).

### D3 Register dependency-free extensions; unsupported documents are read-only

Add `@gltf-transform/extensions` at the same 4.5.x line and register every
extension whose `readDependencies` is empty. That excludes
`KHR_draco_mesh_compression` and `EXT_meshopt_compression`, which need
`draco3d.decoder` / `meshopt.decoder`; no decoder packages are added for
the document model.

Before parsing, inspect `extensionsUsed` and `extensionsRequired` from the
already-parsed document JSON. If any declared extension is not registered,
mark the document `editable: false`: preview and explorer keep working as
in M2 (unregistered extensions are ignored by the parser), repair actions
are hidden and a notice names the extension. Saving an unedited document
still returns the original bytes, so no extension data can be lost.

Rationale: `@gltf-transform` silently omits unregistered extensions on
write ("Some extensions were not registered for I/O, and will not be
written"), which would strip extension payloads from a repaired file.
Registering the dependency-free set covers KTX2, materials, lights,
variants and similar extensions; refusing the rest is safer than a
lossy save.

Alternatives rejected: JSON-only URI patching (rejected by D-06 and
fragile across nested extension payloads); adding Draco/Meshopt decoders
(bundle cost and out of M3 scope); registering everything and letting
parse fail (would regress the M2 explorer for compressed assets).

### D4 Relink state: source bytes plus overrides, reparse on change

Keep three byte levels:

- `sourceBytes` — the document as last read from disk (never mutated by
  edits).
- `baselineBytes` — what a save returns when nothing is unsaved:
  `sourceBytes` initially, the serialized output after a successful save.
- `relinks: Map<originalUri, { path, newUri, bytes }>` — edits applied in
  this session.

Applying a relink is a trial, not a mutation of the degraded M2 document:

1. Read the selected path (binary, subject to `editor.limits`).
2. Build a merged prefetch result whose lookup for the original URI
   returns the new bytes.
3. Reparse `sourceBytes` with that map (`parseDocument`), which gives a
   document whose buffers/images are complete for that URI.
4. Apply `setURI(newUri)` to every `Buffer`/`Texture` that used the old
   URI.
5. Only if the parse succeeded, commit the map entry, rebuild the repair
   model/explorer, point the preview's URL map at the new bytes, and mark
   dirty.

Preview loading still feeds three.js the original `sourceBytes`; its URI
modifier maps the original URIs to blob URLs, including relinked ones.
That keeps one loader path and avoids rewriting bytes before save.

Why not mutate the document parsed with M2's placeholders: a missing
buffer was zero-filled to its declared length, so mutating and writing it
would bake zeros into the save. Reparsing from `sourceBytes` with the real
bytes keeps the graph correct and gives the trial parse for free.

Reverting removes the map entry and repeats the rebuild, which restores
the original URI and the M2 placeholder status.

### D5 Repair model and UI

A new repair model derives one row per distinct missing or relinked
external URI from the document plus probes:

- `id`, `uri` (current), `originalUri`, `kind` (buffer/image), the target
  `Buffer`/`Texture` objects, probe path/code, status, and `relinked`.
- Shared URIs produce one row but apply to every target object.
- The explorer's Resources group keeps its M2 entries and links to the
  same reference data; status comes from the repair model so relinks
  update both views.

UI additions in the Preact sidebar:

- A **Missing references** section above the tree, only when a missing
  fixable reference exists. Each row shows file name, kind and URI, with
  a **Relink…** button.
- The inspector for a missing resource shows the same action; a relinked
  resource shows **Change…** and **Revert**.
- The manual fallback is an inline path field on the row (not a modal),
  with Apply; invalid input keeps the row unchanged and shows a notice.
- A pending flag disables relink buttons while a picker or read is in
  flight, so a second request cannot race.

Stable `data-*` hooks (`data-repair-uri`, `data-action`) are added for
e2e tests. No new shell surface is needed; the picker is shell-owned.

### D6 URI computation

`referenceUri(documentDir, targetPath)` writes:

- a relative URI when the target is the document directory or below it
  (`CesiumLogoFlat.png`, `assets/logo.png`);
- a workspace-root-absolute URI starting with `/` otherwise.

Segments are percent-encoded for URI use (spaces, `#`, `?`, `%`), with
`/` kept as the separator; names are normalized through the existing
workspace path normalizer first. Existing `resolveReferencePath` already
decodes and accepts relative or root-absolute URIs, so the preview and
reload paths work unchanged.

Alternatives rejected: always absolute (valid but less portable outside
Exo); always relative with `../` segments (valid in glTF but needlessly
fragile and hard to read in the inspector).

### D7 Serialization, pre-serialization and save

New `serialization.ts` owns the write path:

- `.gltf` → `PlatformIO.writeJSON(document)` (no network; registered
  extensions) → `JSON.stringify(json, null, 2)` → `{ text }`.
- `.glb` → `PlatformIO.writeBinary(document)` → copied `ArrayBuffer` →
  `{ bytes }`.
- The same override-aware `WorkspaceIO` is used for reading and writing;
  the writer's `resources` map is ignored because only the document is
  writable (C2).

Guards run before returning content:

- **Placeholder guard**: for `.gltf`, each still-missing external entry
  must keep its original URI and must not become a data URI; for `.glb`,
  any still-missing external resource blocks the save (the binary writer
  embeds resources). The guard throws a typed error that the UI renders
  as a notice naming the resources.
- **Extension guard**: declared-but-unregistered extensions already make
  the document non-editable; the serializer asserts the set again to
  avoid future regressions.

Dirty edits schedule a debounced (~250 ms) serialization keyed by a
revision counter. The last completed result is cached with its revision;
a newer edit invalidates it. On `shell/request-save`:

- a relink still in flight is awaited first (bounded by the same
  deadline), so a save cannot overtake an edit that is about to commit;
- no unsaved edits → return a fresh copy of `baselineBytes` (M1/M2
  byte-identical behavior);
- unsaved edits → await the pending serialization (with an internal
  deadline well below the 5 s contract) and return the cached content;
- serialization failure → show an explicit notice and send nothing. The
  protocol has no save-cancel message, so the shell's timeout is the
  outcome; the in-memory edits and dirty state stay intact.

On `shell/save-result` `ok: true`, `baselineBytes` becomes the serialized
content and dirty clears; revision/cache are reset. On `ok: false`, the
content and dirty state are untouched and a notice names the code.

Trade-off: a `.glb` save embeds formerly external resources, because the
binary writer embeds everything it has bytes for. That is acceptable after
a successful repair (self-contained output) and is why unresolved
resources block `.glb` saves.

### D8 Dirty and conflict lifecycle

Dirty is derived from the relink map (`size > 0`) and the last save
outcome, and is pushed to the shell with `editor.setDirty()` only on
changes. External events:

- **Clean document**: M1 behavior — re-read, clear relinks, rebuild.
- **Dirty document**: do not read; keep `sourceBytes`, the map and the
  preview. Show a notice with an explicit **Reload from disk (discard
  edits)** action; choosing it clears the map, dirty and caches and
  performs the normal reload.
- **Deleted**: keep the current notice behavior; if dirty, keep edits and
  let a save fail with the shell's error.

Disposal cancels the debounce, drops the serialization cache, revokes all
blob URLs, clears the map and ignores late save/serialization results.

### D9 Testing and fixtures

- New fixture `relink/BoxTextured.gltf` copies the M2 textured box but
  references `missing.png`; the real texture sits at
  `relink/assets/CesiumLogoFlat.png` and a name with spaces/`#` covers
  encoding. A buffer variant references `assets/BoxTextured0.bin`.
- Unit tests: URI computation (sibling, subdirectory, outside, special
  characters, shared URI), override parse (real bytes replace zeros),
  repair model dedupe/status, serialization round-trip for `.gltf`/`.glb`,
  placeholder guard, extension registry/read-only detection, and the
  dirty/save reducer.
- E2E: open the relink fixture, see the repair row, click **Relink…**,
  choose the file in the shell picker (backed by the existing fake FSA
  route), see resolved status and a dirty tab, verify the scene renders,
  Save, check the saved hash changed, close/reopen and see the reference
  resolved from disk; add a conflict step that writes the file externally
  while dirty, asserts the edit/tab survive, then reloads explicitly.
  The manual-path branch is unit- and component-tested; driving an old
  shell is not practical in the deployed e2e.
- SDK: run the vendored SDK's own typecheck and tests after the refresh.
- Bundle: record the extension package and editor deltas in verification
  and update D-05.

### D10 Documentation updates

Update `docs/decisions.md`: D-08 becomes picker-only (no listing, no
re-consent), D-05 records `@gltf-transform/extensions` 4.5.x and the
measured bundle delta, and D-06 gains the clean-save/unsupported-extension
clarification. The roadmap's M3 status is updated when the change is
verified, not during planning.

## Risks / Trade-offs

- [Extension package grows the bundle] → measure the production delta;
  register the dependency-free set only; no hard Pages budget exists.
- [Draco/Meshopt assets cannot be repaired] → explicit read-only notice;
  a decoder-backed follow-up remains possible without changing the UX.
- [`.glb` save embeds external resources] → self-contained output is
  acceptable; unresolved resources block the save, so no placeholder is
  ever embedded.
- [Reparse on every relink costs time] → one document at the read limit
  and a handful of relinks are bounded; the trial parse doubles as
  validation and there is no background work.
- [Picker e2e depends on shell DOM] → keep shell interaction in one
  helper; plugin-side hooks are stable `data-*` attributes.
- [Wrong image bytes pass the document parse] → images are not decoded by
  the document model; the preview shows a notice, and the relink stays
  changeable/revertible.
- [Save deadline] → pre-serialize with a revision cache and cap the wait;
  on timeout fail explicitly rather than exceed the contract.
- [M2 archive ordering] → M2 must land in the main specs before this
  change is archived; implementation and verification can proceed first.

## Migration Plan

Ship additively through the existing build → e2e-local → deploy →
e2e-deployed pipeline. No manifest or consent change, so existing
installations update without re-prompting. Rollback is the previous Pages
deployment; no workspace data is migrated. The SDK refresh and extension
dependency are bundled with the plugin build and have no protocol effect.
