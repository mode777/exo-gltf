# Proposal

## Why

M1 lets users open a glTF/GLB and see it rendered, but not understand what
is inside it. The repository goal "explore the structure of the asset —
scenes, nodes, meshes, materials and the other concepts glTF files are
built from" is not met yet, and without it users cannot tell why an asset
looks the way it does or which external files it depends on. M2 is the
next roadmap milestone and also the read-only groundwork M3 needs for
selecting broken references.

## What Changes

- Add `@gltf-transform/core` and parse the opened document into a
  `Document` (decision D-05) with a workspace-backed IO adapter: external
  buffers and images are served from the same read pass M1 already
  performs, so parsing never touches the network or bypasses the shell.
- Build an explorer model from the document: typed collections for
  scenes, nodes, meshes, materials, textures, images, animations, skins
  and extensions, with per-collection counts and stable property ids.
- Present the model as a Preact sidebar tree next to the viewport, with
  the inspector showing the selected property's details (counts,
  references, URIs, extension data).
- Selection ↔ viewport sync: selecting a node moves the camera to frame
  it; the selected node is visibly marked (highlighting/isolating is a
  stretch, not required by this change).
- Show reference status per external buffer and image — resolved or
  missing — in the explorer and inspector, reusing M1's probe results.
- Rebuild the explorer when the document reloads after an external change.
- Saving stays pass-through: M2 performs no edits and never reports dirty.
- Extend the Playwright suite: explorer renders for the curated fixtures,
  node selection focuses the viewport, missing references are flagged,
  save round-trip and disposal still hold.

No manifest, permission, protocol or consent changes: the visible frame
already exists and no new capability is requested from the shell.

## Capabilities

### New Capabilities

- `gltf-structure-explorer`: after a glTF/GLB is opened, its document
  structure is browsable and inspectable alongside the 3D preview, with
  reference status for external resources and viewport navigation from
  the tree.

### Modified Capabilities

(none — the `gltf-preview` requirements stay as they are; M2 adds
behavior around the existing preview without changing it.)

## Impact

- **New dependency**: `@gltf-transform/core` (bundle grows; the preview
  budget absorbs it — measured during apply).
- **Code**: new document/explorer modules; `resources.ts` keeps raw bytes
  alongside blob URLs for the IO adapter; viewport gains a
  focus-on-node API; `app.tsx` gains the sidebar/inspector layout.
- **Tests**: new unit tests for the explorer model and IO adapter; e2e
  coverage extends the existing suite (same fixtures, no new ones
  required).
- **Deployment**: unchanged pipeline (build → e2e-local → deploy →
  e2e-deployed).
- **Constraints honored**: docs/decisions.md D-05 (`@gltf-transform` as
  the document model), D-06 (no serialization changes), D-09 (read-only
  reference checks), D-11 (fixtures), and the 16 MiB read/payload limits.
