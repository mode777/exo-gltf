# exo-gltf first-iteration roadmap

Derived from [docs/decisions.md](decisions.md) (the authoritative decision
register) and the exo-editor contracts. Three shippable milestones
(D-01); each is verified against the deployed shell on its own before the
next begins. Work on a milestone is managed as an OpenSpec change under
`openspec/changes/`.

```text
M1 open + preview   ->   M2 structure explorer   ->   M3 reference tweaks
 (archived 2026-11-18)        (planned)              (unblocked 2026-11-18)
                                                       upstream API shipped
                                                       (SDK 1.3.0; vendored SDK is 1.1.0)
```

## M1 — Open + 3D preview

**Status.** Delivered, verified (see
`openspec/changes/archive/2026-11-18-m1-open-preview/verification.md`) and
archived on 2026-11-18.

**Goal.** Opening any `.gltf` or `.glb` in an Exo workspace mounts the
plugin's visible frame and shows an interactive 3D preview of the asset.

Scope:

- Scaffold from `@exo/plugin-template` (npm workspaces, vendored unmodified
  `@exo/plugin-sdk`, mismatch fixture removed) — D-13.
- Manifest: id `io.github.mode777.gltf`, name "glTF Viewer", publisher
  "Alex Klingenbeck", license MIT, `engines.exo >=0.1.0`, single editor
  entry `**/*.{gltf,glb}` / `editor.html` / label "glTF" /
  `rendering: "frame"` / priority 0, permissions `workspace:write` +
  `events:subscribe` — D-02, D-03, D-14.
- Controller registers the declared glob and completes.
- Editor reads the file (binary) on request and renders it with three.js
  (WebGL2): orbit camera, auto-framing, neutral default lighting.
- External references (`.bin` buffers, textures) resolve through
  `editor.readFile()` via a loader URL-modifier shim; missing references
  fail soft per-resource (placeholder + notice), never a blank frame.
- DRACO / KTX2 / Meshopt decoders vendored in the plugin root — D-10.
- Pass-through save: the save handler returns the exact bytes originally
  read (M1 performs no edits; this satisfies the 5 s contract safely).
- Explicit `too-large` state when `editor.limits` is exceeded.
- Full disposal on `onDispose` (renderer, geometries, textures); theme
  follow via `theme/changed` (events permission already granted).
- GitHub Pages deploy (Actions, Vite `base: '/exo-gltf/'`) — D-12 — plus
  the create-exo-plugin skill's deployed-plugin verification checklist.

Exit criteria: checklist green against the deployed shell for a GLB with
embedded resources, a GLB with DRACO compression, and a `.gltf` with
external `.bin` + textures; tab close disposes the frame; a file over the
read limit shows the too-large state.

## M2 — Structure explorer

**Goal.** Users orient themselves inside the file: the asset's glTF
structure is browsable next to the viewport.

Scope:

- Parse with `@gltf-transform` (D-05) and present the document graph —
  scenes, nodes, meshes, materials, textures, animations, extensions — as
  a tree in a Preact sidebar.
- Inspector panel for the selected property (counts, references, uris).
- Selection ↔ viewport sync: selecting a node highlights/isolates it
  (minimum: camera focus; highlighting as stretch).
- Reference status shown per external resource (resolves / missing),
  reusing M1's probe results — the read-only half of D-09.
- Still pass-through save; no edits yet.

Exit criteria: explorer renders for all M1 exit-sample assets; selecting
nodes navigates the viewport; missing references are visibly flagged.

## M3 — Reference tweaks

**Goal.** Resolve missing external references (the "small tweaks" of the
repo goals) and save the repaired file.

**Unblocked 2026-11-18.** exo-editor shipped the requested API: the
shell-owned workspace picker (`plugin/request-files` / `shell/files-selected`,
SDK 1.2.0) and permissioned one-level directory listing (`plugin/request-list`
/ `shell/list-result`, manifest permission `workspace:list`, SDK 1.3.0). See
[docs/exo-editor-api-request.md](exo-editor-api-request.md) section 8 for the
shipped shape and differences. M1 is archived; M2 is unaffected.

The relink UX is the first task of the M3 OpenSpec change. The picker needs
no permission change; listing adds `workspace:list` and re-prompts every
user (C10/D-08). Either path also requires refreshing the vendored SDK from
`1.1.0` to upstream `1.3.0`.

Scope (UX finalized in the M3 OpenSpec change):

- Relink flow for missing buffer/texture uris through the shell picker
  (`editor.requestFiles()`) and/or permissioned listing
  (`editor.listDirectory()`); manual path entry remains the old-shell
  fallback.
- Refresh the vendored `@exo/plugin-sdk` to `1.3.0`, unmodified (D-13).
- Edits through the gltf-transform document; dirty lifecycle via
  `editor.setDirty()`; save re-serializes (`.gltf` as text, `.glb` as
  bytes) with debounced pre-serialization to answer within 5 s — D-06.
- Conflict (`shell/save-result ok:false`) surfaces without data loss.

Exit criteria: a broken-reference sample is repaired and saved; the saved
file reopens cleanly and previews; an external concurrent write leaves
the buffer intact and the tab dirty.

## Verification strategy (all milestones)

- Vitest unit tests for parsing/decision logic; curated CC0 Khronos
  sample assets including one broken-reference fixture — D-11.
- The skill's local dev checklist against the deployed shell for every
  milestone; rendering verified manually in M1/M2 (golden captures are a
  later option).

## Out of scope

Everything listed in [AGENTS.md](../AGENTS.md) (e.g. UV editing), plus
full Khronos glTF-Validator reports (D-09) and WebGPU (D-04) — all
possible later directions, not this iteration.
