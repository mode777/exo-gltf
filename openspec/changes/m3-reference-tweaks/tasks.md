# Tasks

## 1. Vendor refresh and extension support

- [x] 1.1 Replace `sdk/` with upstream `packages/plugin-sdk` at 1.3.0 unmodified, update `plugin/package.json` to `@exo/plugin-sdk` 1.3.0 and refresh the lockfile; verify `diff -r sdk/src <upstream>/src` is empty, `npm test --workspace sdk` and `npm run typecheck --workspace sdk` pass, and `npm run build --workspace plugin` still succeeds
- [x] 1.2 Add `@gltf-transform/extensions` at the `@gltf-transform/core` line (4.5.1), pin it in the lockfile, and verify `npm run build --workspace plugin` succeeds and the production bundle delta is recorded for the change notes
- [x] 1.3 Add an extension registry module that registers every extension without `readDependencies` and reports declared-but-unregistered names from `extensionsUsed`/`extensionsRequired`; verify unit tests cover the supported set (KTX2/materials) and treat Draco/Meshopt as unsupported
- [x] 1.4 Register the supported extensions on the workspace IO adapter and mark documents with unsupported extensions non-editable; verify unit tests show a Draco document parses for preview/explorer while a KTX2 document is editable, and the editor hides repair actions with a naming notice

## 2. Reference model and URI rewriting

- [x] 2.1 Implement `referenceUri(documentDir, targetPath)` for relative/root-absolute, percent-encoded URIs; verify unit tests cover sibling, subdirectory, outside-directory, and space/`#`/`%` names, and that `resolveReferencePath` round-trips each result
- [x] 2.2 Build the repair model from the document, probes, and current relinks: one row per distinct URI, all targets for shared URIs, current/original URI, status and relinked state; verify unit tests cover dedupe, shared-URI updates, missing/all-resolved, and revert state
- [x] 2.3 Extend document parsing with per-URI byte overrides so a relinked file replaces M2's zero-filled buffer or empty image during the trial reparse; verify unit tests prove real bytes reach the accessors, a broken override fails the parse, and the committed document exposes the new URI

## 3. Relink workflow and repair UI

- [x] 3.1 Implement the relink workflow: one `requestFiles({ multiple: false, directory })` with a start hint, read via `readFile`, trial reparse, commit/change/revert, pending lock, and manual path fallback when `capabilities.filePicker` is false or `unsupported-message` is returned; verify unit tests with a fake editor cover pick, cancel, read failure, unparsable buffer, shared URI, revert and the fallback
- [x] 3.2 Add the **Missing references** repair section, inspector Relink/Change/Revert actions, inline manual path field and pending disabled state with stable `data-*` hooks; verify the existing preview e2e suite still passes and a component/unit test covers each action state
- [x] 3.3 Add the `relink/` fixture (broken image and broken buffer with the real files at other paths, including a name with spaces/`#`) and verify it opens with the expected missing status while both candidate files exist in the workspace

## 4. Dirty lifecycle, serialization and save

- [x] 4.1 Implement serialization: re-serialize via the extension-registered workspace IO, `.gltf` as pretty-printed text and `.glb` as bytes, with the placeholder and unsupported-extension guards; verify unit tests round-trip both formats, keep a still-missing `.gltf` URI untouched, block an unresolved `.glb`, and preserve a registered extension such as KHR_texture_basisu
- [x] 4.2 Implement dirty tracking, debounced pre-serialization with revision cache, clean-byte and edited saves, save-result success/conflict handling, external-change-while-dirty protection with explicit reload, and disposal cleanup; verify reducer/timer unit tests cover each transition and that a save after several relinks returns the latest serialized content
- [x] 4.3 Extend the Playwright suite: relink through the shell picker, see the reference resolve and the tab go dirty, save, reopen from disk and preview; add a conflict step that writes externally while dirty and confirms the edit/tab survive until explicit reload; verify `npm test --workspace e2e` and keep the M1/M2 clean pass-through save assertion green

## 5. Integration and verification

- [ ] 5.1 Run the full pipeline (build → e2e-local → deploy → e2e-deployed), record the run URL, the measured save latency and the bundle deltas in `openspec/changes/m3-reference-tweaks/verification.md`, and verify the deployed relink/save/reopen and conflict steps pass
- [x] 5.2 Update `docs/decisions.md`: D-08 records the picker-only choice and unchanged consent, D-05 records `@gltf-transform/extensions` 4.5.1 and the measured bundle delta, D-06 notes the clean-save pass-through and read-only fallback for unsupported extensions; verify the register matches the lockfile, manifest and build output
- [ ] 5.3 Verify the deployed manifest still declares only `workspace:read`, `workspace:write` and `events:subscribe`, contains no `workspace:list`, and that the deployed e2e consent flow shows the unchanged permission set

## Workflow follow-up

- Archive M2 (`m2-structure-explorer`) first so `gltf-structure-explorer` exists in the main specs; the M3 MODIFIED delta assumes that base.
- Archive this change after the deployed suite is green and the owner has reviewed.
- Update the roadmap's M3 status and the decision-register change log after archive.
