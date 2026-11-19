# Proposal

## Why

A glTF that lost its sibling `.bin` or texture files opens in M1/M2 with a
notice but cannot be repaired there: the plugin can name the missing
reference but not point it at a file that exists. That is the repository
goal "perform small tweaks, such as resolving missing external references"
and the last milestone of the first iteration. exo-editor now ships the
shell-owned workspace picker, so the repair can be done without blind path
typing — and without adding a permission.

## What Changes

- Refresh the vendored `@exo/plugin-sdk` from `1.1.0` to upstream `1.3.0`
  unmodified (D-13), which provides `editor.requestFiles()` (SDK 1.2.0+)
  and leaves the protocol, manifest and existing consents untouched.
- Add a relink flow for missing external buffers and textures: the
  repair panel and the resource inspector offer **Relink…**, the shell
  picker returns the chosen workspace path, and the picked file is read
  through `editor.readFile()` and applied to the document only after the
  read succeeds. The picker uses the existing `workspace:read`; **no
  `workspace:list`, no manifest change, no re-consent** (picker-only
  choice recorded for D-08/C10).
- Add `@gltf-transform/extensions` (same 4.5.x line) so re-serialization
  preserves extension declarations and payloads. Documents that declare
  an extension the plugin cannot round-trip (for example Draco or
  Meshopt, whose decoders are not added) stay read-only: preview and
  explorer work, repair actions are unavailable, and saving returns the
  original bytes.
- Keep a manual path-entry fallback for shells without the picker
  (`capabilities.filePicker` false), validated by a trial read.
- Apply relinks to the `@gltf-transform` document by rewriting the
  reference `uri`, and update reference status, the explorer, and the
  preview in place. A relink that cannot be re-parsed is rejected and
  the previous state is kept. References from this session can be
  changed again or reverted.
- Introduce the dirty lifecycle: a successful relink marks the document
  dirty (`editor.setDirty(true)`); save re-serializes the document
  (`.gltf` as text, `.glb` as bytes) from a debounced pre-serialization
  so the 5 s save contract is met; success clears dirty, `ok:false`
  keeps the in-memory edits and the tab dirty.
- Protect data: unresolved placeholders are never written into the saved
  file (a format that would embed them refuses the save and names them),
  and an external change while dirty no longer silently reloads — the
  edits are kept and the user can explicitly reload and discard.
- Extend the unit and Playwright suites with a relink fixture: repair a
  broken reference, save, reopen and preview the saved file; verify a
  save conflict leaves the buffer intact and dirty; verify cancel and
  read-failure paths leave the document unchanged.

## Capabilities

### New Capabilities

- `gltf-reference-tweaks`: after a document is opened, missing external
  buffer and texture references can be relinked to workspace files
  through the shell picker (with a manual fallback), the edit is tracked
  as unsaved changes, and the repaired document saves without losing
  content or embedding placeholders.

### Modified Capabilities

- `gltf-preview`: the pass-through save requirement is replaced by a
  save that returns the current baseline bytes while unedited and the
  re-serialized document after a relink, with dirty state and conflict
  behavior; the external-change requirement is narrowed so a dirty
  document is not silently reloaded.
- `gltf-structure-explorer`: the read-only requirement is scoped to
  browsing/selection; explicit reference repairs may edit the document
  and mark it dirty.

## Impact

- **Dependency**: vendored `sdk/` refreshed to 1.3.0 (unmodified; extra
  `gate` module and tests), `plugin/package.json` dependency updated,
  lockfile refreshed. `@gltf-transform/extensions` 4.5.x is added next
  to the existing `@gltf-transform/core`; no decoder packages are added.
- **Code**: new relink/repair and serialization modules; `document.ts`
  gains extension registration, override-aware parsing and URI
  rewriting; `resources.ts` records relinked bytes; `editor.ts` owns
  dirty/pre-serialize/save and conflict handling; `app.tsx` gains the
  missing-references panel and inspector actions (plus a manual path
  input).
- **Manifest/permissions**: unchanged (`workspace:read`,
  `workspace:write`, `events:subscribe`) — the picker needs no new
  permission; `workspace:list` is deliberately not requested.
- **Tests**: new unit coverage for URI computation, serialization,
  dirty/conflict logic and override parsing; new `relink/` fixture that
  references a file present at another path; extended e2e relink,
  save/reopen and conflict steps. Deployment pipeline unchanged.
- **Sequencing**: M2 is still an in-flight change; its
  `gltf-structure-explorer` capability must be archived into the main
  specs before this change is archived (MODIFIED deltas assume that
  base). M3 implementation does not depend on the archive.
- **Constraints honored**: D-05/D-06 edit and serialization model,
  D-08 picker-only UX, C2 (only the open document is written), C3
  (pre-serialized save), C10 (no listing permission), D-13 (unmodified
  vendored SDK).
