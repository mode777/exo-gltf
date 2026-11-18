# Design

## Context

M1 shipped the visible-frame preview: binary read, workspace resource
pre-fetch (`resources.ts`), three.js viewport, notices, pass-through save.
M2 adds the structure explorer around that pipeline without changing the
manifest, permissions or protocol. Authoritative choices: D-05
(`@gltf-transform` is the document model), D-06 (no serialization yet),
D-09 (read-only reference checks). See proposal.md for motivation and the
delta spec for required behavior.

## Goals / Non-Goals

**Goals:**

- Parse each reloaded document once with `@gltf-transform/core`, reusing
  the workspace bytes M1 already reads — no new IO paths, no network.
- A lazy explorer model and a compact sidebar/inspector UI that scales to
  realistic scene sizes without new performance machinery.
- Node selection drives the existing camera; nothing else in the scene
  changes.

**Non-Goals:**

- Any editing, dirty state or serialization changes (M3).
- Node highlighting/isolation or material previews (stretch, deferred).
- Virtualized trees, search/filtering, thumbnails, image decoding.
- Upgrading the vendored SDK (stays 1.1.0 until M3).

## Decisions

### D1 Parse with a workspace-backed IO adapter

Add `@gltf-transform/core` (latest 4.x, pinned by the lockfile). New
`src/document.ts` exposes `parseDocument(bytes, prefetch)`. The adapter
extends the library's browser IO and overrides `readURI(uri)` to return
bytes from the M1 pre-fetch pass instead of `fetch`.

- `PrefetchResult` gains `raw: Map<uri, Uint8Array>` next to the blob
  URLs: the viewport keeps its blob URLs, the adapter consumes raw bytes.
- Missing **textures** return an empty array (the document model does not
  decode images).
- Missing **buffers** return a zero-filled array of the declared
  `byteLength` so the document graph still parses; the probe stays
  "missing", the preview keeps M1's no-scene behavior, and the explorer
  flags the file.
- If parsing throws despite this, the explorer shows a
  structure-unavailable notice while the preview error handling is
  unchanged.

Alternatives rejected: letting the library fetch URIs (bypasses the
workspace and the shell's limits); hand-parsing JSON for the explorer
(duplicates D-05's model and M3 would need the document anyway).

### D2 Lazy explorer model, index-based ids

New `src/explorer-model.ts` builds a `ExplorerModel` from
`Document + probes`:

- One group per non-empty collection (scenes, nodes, meshes, materials,
  textures, images, animations, skins, extensions) with a count, plus a
  synthetic **Resources** group (external buffers/images with status).
- Entries carry `id` = `${collection}:${index}` (stable within one parsed
  document; selection is cleared on reload by design), display label,
  short detail, and optional children.
- Groups expose `getEntries()` that materialises entries on first
  expansion, so a collapsed group costs O(1) rendering and the panel
  never renders thousands of rows eagerly.

Alternatives: a fully materialised tree (simple but unbounded DOM for
large scenes); full virtualization (unnecessary for M2's fixture scale).

### D3 UI: explorer sidebar + inspector inside the Preact shell

`app.tsx` becomes a three-region layout: header, a main row (viewport
stage + sidebar), footer. The sidebar holds the tree (top, scrolls) and
the inspector (bottom, selected property details). Signals add
`explorer` and `selection` state; the viewport remains the imperative
island it already is. Tree markup follows the shell's own pattern
(`role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-selected`) so
the existing accessibility and e2e selectors stay conventional.

### D4 Node → object mapping for camera focus

`Viewport.load` now records a `Map<nodeIndex, THREE.Object3D>` from
`GLTFLoader`'s `parser.associations` (each three object lists its glTF
node indices). New `Viewport.focusNode(index)` frames that object:
`Box3.setFromObject` → reuse the existing auto-frame math (same camera
direction, fov-based distance) → update `controls.target` → render.
Non-spatial selections are a no-op. No animation and no highlighting in
M2; both are additive later.

Pure helper `frameBounds(box, camera, direction)` is exported for unit
tests of the math.

### D5 Reload rebuilds everything, selection clears

External change path stays M1's: re-read → re-prefetch → parse document →
rebuild model → render. Explorer expansion and selection reset. Missing
buffers skip `viewport.load` (M1 rule) while the explorer still shows the
structure.

### D6 No new persistence or consent surface

No manifest change, no new storage. Expansion state is ephemeral; theme
and viewport preferences behave as in M1.

## Risks / Trade-offs

- [Bundle growth from `@gltf-transform/core`] → measured in the build
  task; the Pages artifact has no hard budget and the preview already
  dominates; record the delta in the change notes.
- [Two document representations in memory (three parser + document
  model, plus raw bytes and blob URLs)] → bounded by the 16 MiB read cap;
  reload revokes blob URLs and drops the previous document. M3 unifies
  editing/serialization on the document model, which is when the balance
  shifts further.
- [Zero-filled buffers could confuse debugging] → probes and the
  Resources group always report the file as missing; the viewport still
  refuses partial scenes.
- [Very large node hierarchies] → lazy groups keep the DOM small; counts
  are O(n) once per reload. If real files still stutter, add
  virtualization in a follow-up.
- [Selection cleared on external change] → deliberate, documented
  behavior; stable-index reuse across versions would be misleading.

## Migration Plan

Additive deploy through the existing pipeline (build → e2e-local → deploy
→ e2e-deployed). Rollback is the previous Pages deployment; no data or
protocol state changes.
