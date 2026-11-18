# Design

## Context

Greenfield plugin; no code exists yet. Everything at the "what" level is
already settled: see [proposal.md](proposal.md), the requirement delta in
[specs/gltf-preview/spec.md](specs/gltf-preview/spec.md), and the
authoritative choices in [docs/decisions.md](../../../docs/decisions.md)
(D-02..D-14). The Exo contracts (skill: create-exo-plugin) fix the
communication model: vendored SDK only, reads by path, save handler
answers within 5 s, one visible frame per open document.

## Goals / Non-Goals

**Goals:**

- A scaffold that later milestones extend without restructuring (M2 adds
  the explorer sidebar; M3 adds the edit/save path).
- Correct, soft-failing external-resource resolution through
  `editor.readFile()` — the only novel integration point of M1.
- Bounded resource usage per frame (lazy viewport init, full disposal).

**Non-Goals:**

- Any editing, dirty state or re-serialization (M3; pass-through save only).
- The structure explorer and `@gltf-transform` (M2; deliberately not a
  dependency yet).
- Golden-image verification (later option, D-11).
- Choosing viewport UX details beyond M1 basics (lighting rig, grid,
  gizmos) — defaults now, `contributes.configuration` later.

## Decisions

### D1 Scaffold exactly per the create-exo-plugin skill

npm workspaces with vendored `sdk/` (unmodified) and `plugin/` from
`@exo/plugin-template`; mismatch fixture removed; Vite `base:
'/exo-gltf/'` for the Pages project path; Actions deploy from the skill.
Alternative (custom minimal Vite setup) rejected: the template is the
reference layout the skill documents and tests against (D-13).

### D2 Module layout inside `plugin/src`

```text
controller.ts      register mode: register declared glob, complete
editor.ts          editor mode: SDK lifecycle, handlers, wiring
app.tsx            Preact root: layout + notice area (signals-based store)
viewport.ts        imperative three.js wrapper (init/frame/render/dispose)
resources.ts       uri collection, pre-fetch map, URL-modifier, probe cache
glb.ts             minimal GLB header/JSON-chunk reader (uri collection only)
notices.ts         notice model + mapping from SDK error codes
```

Preact renders only chrome (status bar, notices, later sidebar); the
viewport is an imperative three.js island it hosts. No react-three-fiber
(D-07).

### D3 Always read the file as binary; derive text when needed

`.gltf` and `.glb` are both read via `readFile(path, 'binary')`. The JSON
for uri collection is decoded from those bytes with `TextDecoder`, and the
save handler returns those exact bytes. Alternative (read `.gltf` as
`utf8`) rejected: pass-through save would then need re-encoding and risks
normalizing line endings or BOMs — byte-exactness is cheaper and safer.

### D4 External resources: pre-fetch, then parse, with a URL-modifier map

1. Decode the JSON (directly for `.gltf`; for `.glb` via the minimal
   chunk reader in `glb.ts` — buffers must be embedded in GLB, only
   `images[].uri` can be external).
2. Collect external uris (`buffers[].uri`, `images[].uri`), resolve each
   against `editor.file.dir`, read all in parallel (SDK allows 64 in-flight
   requests; well under).
3. Build `Map<uri, blobURL>`; run `GLTFLoader` with a
   `LoadingManager.setURLModifier` that looks uris up in the map.
4. Record resolve/miss per uri in a probe cache — M2's reference-status
   panel consumes it unchanged.
5. Revoke all blob URLs on reload and on dispose.

Alternatives rejected: async URL modification inside the modifier (the
hook is synchronous); data URLs instead of blob URLs (large textures
double memory as base64).

Soft-fail semantics differ by resource type, and the spec reflects this:
a missing **texture** renders a placeholder while the rest of the scene
renders; a missing **buffer** means meshes cannot exist, so the plugin
shows an explicit notice naming the file and renders no partial scene.
Pretending otherwise would produce broken geometry.

### D5 Compressed payloads via bundled decoder assets

`three` addons (`DRACOLoader`, `KTX2Loader`, `MeshoptDecoder`) configured
with wasm/assets imported through Vite `?url` so they are emitted into
`plugin/dist` and referenced relative to the Pages base. No CDN (D-10).
The decoders are wired into `GLTFLoader` upfront — probing compression
type by hand is redundant; the loader dispatches.

### D6 Viewport: on-demand rendering, lazy init, rigorous disposal

`WebGLRenderer` created when the first file loads, never before (a frame
that only shows a notice owns no GL context). Camera:
`OrbitControls` + damping; render loop runs only while interacting or
when the scene/theme changes (on-demand render), so an idle visible
preview costs ~0 CPU and hidden tabs cost nothing (rAF is throttled).
Auto-frame from the scene's bounding box. Pixel ratio capped at 2.
`ResizeObserver` drives canvas sizing. `dispose()` tears down renderer,
controls, geometries, materials and textures, and revokes blob URLs —
this is what keeps 20 open tabs (the shell's frame cap) survivable.

### D7 Notices as first-class UI state

Every failure path lands in one notice model (code, path, human text):
read errors (`too-large`, `not-found`, `permission-denied`, `io`),
missing references from the probe cache, invalid/empty payloads,
deletion notices. The Preact layer renders the store; nothing throws
through to a blank frame. Boot errors (SDK handshake) fall back to
plain `document.body` text per the skill's editor skeleton.

### D8 Theme via CSS custom properties

Shell theme from `shell/init` plus `theme/changed` (permission already
granted, D-02) drives one `data-theme` attribute; component CSS and the
viewport clear color read from the same custom properties.

## Risks / Trade-offs

- [Browsers cap live WebGL contexts (~16), shell allows 20 frames] →
  dispose rigor in D6; if users report context loss, add an LRU that
  disposes idle viewports and re-inits on tab focus.
- [Blob URL leaks on repeated reloads] → central revoke in the reload and
  dispose paths; a single `resources.ts` owner makes it auditable.
- [KTX2/DRACO wasm size on first load (~hundreds of KB)] → acceptable per
  D-10; decoders are fetched lazily by their loaders, only when a payload
  needs them.
- [three.js GLTFLoader rejects some real-world assets] → loader errors
  surface as an invalid-payload notice (spec scenario); sample-asset
  coverage keeps the common paths honest.
- [First release = first consent prompt for users] → manifest fields are
  final at deploy (D-02/D-03); any later change re-prompts, so M1 ships
  the complete permission set even though it only reads.

## Migration Plan

Deploy is additive (new Pages site + Actions workflow; repo setting
Pages -> GitHub Actions). Rollback = revert the deploy commit or disable
the plugin entry in a workspace's `exo.json`; no data or protocol state
is affected. Local verification always precedes deploy (skill step 6).
