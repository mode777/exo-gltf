# Tasks

## 1. Dependency and workspace-backed document parsing

- [ ] 1.1 Add `@gltf-transform/core` to the plugin workspace, pin the resolved 4.x version in the lockfile, and verify `npm run build --workspace plugin` succeeds with the bundle-size delta recorded in the change notes
- [ ] 1.2 Extend `resources.ts` so the pre-fetch result carries raw bytes alongside blob URLs (`raw: Map<uri, Uint8Array>`), update existing unit tests, and verify `npm test --workspace plugin` passes
- [ ] 1.3 Implement `src/document.ts` with the workspace IO adapter (external refs from the pre-fetch map, empty bytes for missing images, zero-filled buffers of declared length for missing buffers, parse-error fallback) and verify unit tests cover a `.gltf` with external refs, a GLB, missing-texture, missing-buffer and invalid-input cases

## 2. Explorer model

- [ ] 2.1 Implement `buildExplorerModel(document, probes)` with one group per non-empty collection and counts, and verify unit tests cover counts for a synthetic document and the empty-document case
- [ ] 2.2 Add lazy `getEntries()` materialisation and index-based stable ids per group, and verify unit tests prove entries are produced on demand and ids are unique within a document
- [ ] 2.3 Add the Extensions group from `extensionsUsed`/`extensionsRequired` and the synthetic Resources group from probes, and verify unit tests cover extension listings and resolved/missing resource status

## 3. Explorer UI and inspector

- [ ] 3.1 Restructure `app.tsx` into header / (viewport stage + sidebar) / footer with `explorer` and `selection` signals, and verify the existing e2e preview suite still passes (build + `npm test --workspace e2e` locally or in CI)
- [ ] 3.2 Implement the tree component (role=tree/treeitem, aria-expanded, aria-selected, expansion toggling, selection) and verify a new e2e assertion opens `box-textured/BoxTextured.gltf` and sees collection groups with counts
- [ ] 3.3 Implement the inspector (kind, label/index, children counts, mesh/material links, URI + status) and verify an e2e assertion selecting a node shows its details and selecting a texture shows the external URI

## 4. Viewport navigation from the tree

- [ ] 4.1 Add `frameBounds(box, camera, direction)` as a pure helper and record the node→object map from `parser.associations` in `Viewport.load`, and verify unit tests cover framing math and mapping from a fake association map
- [ ] 4.2 Wire node selection to `Viewport.focusNode(index)` and verify an e2e assertion selects a node, sees the selection state in the tree, and the preview stays rendered without errors; non-spatial selection leaves the camera untouched (unit-tested no-op)

## 5. Reference status in the explorer

- [ ] 5.1 Render per-resource status (resolved/missing, file names) in the Resources group and inspector, and verify e2e assertions on `box-missing-texture` flag `missing.png` and on `missing-buffer` keep the structure browsable while the preview shows no scene

## 6. Reload, disposal and read-only guarantees

- [ ] 6.1 Rebuild the document, model and explorer on external change and clear selection/expansion state, and verify an e2e step changes the file externally while the explorer is open and sees updated structure with no stale selection
- [ ] 6.2 Release explorer state on disposal and verify the existing close-tab e2e step leaves no handler frame and reopening builds a fresh explorer
- [ ] 6.3 Confirm the explorer path never marks dirty and saves byte-identically, and verify the existing save round-trip e2e step plus unit save tests still pass

## 7. Integration and verification

- [ ] 7.1 Run the full pipeline (build → e2e-local → deploy → e2e-deployed) with the extended suite and record the run URL plus bundle-size delta in `openspec/changes/m2-structure-explorer/verification.md`
- [ ] 7.2 Update `docs/decisions.md` (D-05) with the resolved `@gltf-transform` version and the measured bundle delta, and verify the register matches the lockfile and build output

## Workflow follow-up

- Archive this change after the deployed suite is green and the owner has reviewed.
- After archive, propose M3 (reference tweaks) including the decision between picker-only and adding `workspace:list`, and refresh the vendored SDK to upstream 1.3.0 unmodified before using either helper.
