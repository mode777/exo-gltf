# Proposal

## Why

The exo-gltf repository has agreed decisions and a roadmap but no shipped
plugin: opening a `.gltf`/`.glb` in the Exo shell today falls through to the
shell's text surface, which cannot render 3D assets. Milestone M1 of
[docs/roadmap.md](../../../docs/roadmap.md) delivers the first user value —
open and preview — and lands the scaffold, manifest and deployment
pipeline that every later milestone builds on.

## What Changes

- Scaffold the plugin repository from `@exo/plugin-template` (npm
  workspaces: vendored unmodified `sdk/` + `plugin/`; diagnostic mismatch
  fixture removed).
- Author `exo-manifest.json`: id `io.github.mode777.gltf`, name "glTF
  Viewer", publisher "Alex Klingenbeck", license MIT, version `0.1.0`,
  `engines.exo >=0.1.0`, permissions `workspace:write` + `events:subscribe`,
  one file editor `**/*.{gltf,glb}` -> `editor.html`, label "glTF",
  `rendering: "frame"`, priority 0.
- Controller page registers the declared glob and completes.
- Editor page with a Preact shell around an imperative three.js (WebGL2)
  viewport: orbit camera, auto-framing, neutral default lighting.
- The open file is read as bytes on request; external references
  (`.bin` buffers, textures) resolve through `editor.readFile()` via a
  loader URL-modifier shim — missing references fail soft per resource
  (placeholder + notice), never a blank frame.
- DRACO / KTX2 / Meshopt decoder assets vendored inside the plugin root.
- Pass-through save: the save handler returns the exact bytes originally
  read (M1 performs no edits; this honors the 5 s save contract safely).
- Explicit too-large state when `editor.limits` is exceeded; full disposal
  of renderer/geometries/textures on `onDispose`; viewport theme follows
  `theme/changed`.
- GitHub Pages deployment (Actions workflow, Vite `base: '/exo-gltf/'`).

No breaking changes — this is the first delivered version of the plugin.

## Capabilities

### New Capabilities

- `gltf-preview`: opening a `.gltf` or `.glb` from an Exo workspace mounts
  the plugin's visible frame and shows an interactive 3D preview of the
  asset, including correct handling of external resources, compressed
  payloads, oversized files, external changes and disposal. Owns the
  plugin's registration and save behavior for the preview milestone.

### Modified Capabilities

(none — no existing specs; this is the project's first capability.)

## Impact

- **New code**: entire repository scaffold (`package.json` workspaces,
  `sdk/`, `plugin/` with `plugin.html`, `editor.html`,
  `public/exo-manifest.json`, `src/`).
- **New dependencies**: `three`, `preact`, and the vendored
  `@exo/plugin-sdk` (`@gltf-transform` is deferred to M2, where the
  document model is first consumed).
- **Deployment**: new GitHub Actions workflow publishing `plugin/dist` to
  GitHub Pages; repo Pages setting must be switched to "GitHub Actions".
- **Upstream surfaces used (read-only)**: Exo plugin protocol v1 messages
  via the vendored SDK only; no exo-editor changes required.
- **Constraints honored**: docs/decisions.md D-02..D-14 (notably D-04
  three.js/WebGL2, D-07 Preact, D-10 vendored decoders, D-12 Pages
  hosting, D-13 skill scaffold).
