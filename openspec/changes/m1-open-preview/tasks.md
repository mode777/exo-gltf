# Tasks

## 1. Scaffold the plugin repository

- [x] 1.1 Copy `packages/plugin-sdk` and `packages/plugin-template` from upstream exo-editor into `sdk/` and `plugin/` per the create-exo-plugin skill, create the root `package.json` workspaces file, and verify `npm install` succeeds with a committed lockfile
- [x] 1.2 Remove the mismatch diagnostic fixture (`negative/protocol-mismatch.html`, `public/exo-manifest-mismatch.json`, `src/mismatch.ts`, their `vite.config.ts` inputs and `src/template.test.ts` references) and verify `npm run build --workspace plugin` and the template tests pass without them
- [x] 1.3 Set Vite `base: '/exo-gltf/'`, add `three` and `preact` dependencies, and verify a production build emits `plugin/dist` with correct asset URLs

## 2. Manifest and controller

- [x] 2.1 Author `plugin/public/exo-manifest.json` (id `io.github.mode777.gltf`, name "glTF Viewer", publisher "Alex Klingenbeck", license MIT, version `0.1.0`, `engines.exo >=0.1.0`, permissions `workspace:write` + `events:subscribe`, single editor `**/*.{gltf,glb}` -> `editor.html`, label "glTF", `rendering: "frame"`, priority 0) and verify it validates against the upstream `exo.schema.json`
- [x] 2.2 Replace the template controller with `src/controller.ts` registering exactly the declared glob and completing, and verify via `npm run dev --workspace plugin` against the deployed shell that the registration ack lists the glob as accepted

## 3. Editor core and resource pipeline

- [x] 3.1 Implement `src/editor.ts` (connect in editor mode, binary read of the open file, handler wiring) and verify in the dev shell that opening a `.glb` reads exactly once and a boot failure degrades to visible body text, never a blank frame
- [x] 3.2 Implement `src/glb.ts` (GLB header + JSON-chunk reader) and `src/resources.ts` uri collection for `buffers[].uri` / `images[].uri`, and verify vitest unit tests pass for embedded GLB, GLB with external image uri, and `.gltf` with external refs using small synthetic fixtures
- [x] 3.3 Implement the pre-fetch pass (resolve against `editor.file.dir`, parallel reads within the 64-request budget, `Map<uri, blobURL>`, per-uri probe cache, central revoke) and verify a `.gltf` with sibling `.bin` + textures renders in the dev shell while a broken-reference fixture produces notices naming the missing files

## 4. Viewport

- [x] 4.1 Implement `src/viewport.ts` (lazy WebGL renderer, OrbitControls with damping, auto-framing from the scene bounds, on-demand render loop, ResizeObserver, pixel-ratio cap 2, full `dispose()`) and verify an idle visible preview draws no frames and a closed tab frees GPU resources on reopen
- [x] 4.2 Wire `GLTFLoader` with the URL-modifier map and vendored DRACO/KTX2/Meshopt decoders (Vite `?url` assets, relative to base), and verify in the dev shell: embedded GLB, DRACO-compressed GLB, and KTX2-textured asset all render with no third-party requests (DevTools network tab)
- [x] 4.3 Implement soft-fail semantics — placeholder material + notice for a missing texture, explicit no-partial-scene notice for a missing buffer, invalid/empty-payload notice — and verify each against fixtures in the dev shell

## 5. Lifecycle, notices and save

- [x] 5.1 Implement `src/notices.ts` (notice model + mapping from SDK error codes) and the Preact shell (`src/app.tsx`, `data-theme` attribute, CSS custom properties), and verify `too-large`, `not-found` and `permission-denied` reads each show their specific notice text in the dev shell
- [x] 5.2 Implement theme follow (`shell/init` theme + `theme/changed` subscription) and verify switching the shell theme live updates viewport background and UI colors
- [x] 5.3 Implement pass-through save (never dirty; save handler returns a fresh copy of the exact bytes read) and verify vitest unit tests cover byte-exactness and copy semantics, plus a shell Save leaves the file unchanged with no dirty dot beforehand
- [x] 5.4 Implement external-change handling (reload on `onFileChanged` when clean, deletion notice without retry loops, blob-URL revocation on reload) and verify in the dev shell that an external edit re-renders and an external delete shows the notice

## 6. Sample assets and unit tests

- [x] 6.1 Vendor the curated CC0 sample set (DamagedHelmet GLB, a DRACO GLB, a `.gltf` with external `.bin`/textures, a broken-reference fixture) with license attribution, and a synthetic over-limit fixture generator, and verify the files load in tests without network access
- [x] 6.2 Complete vitest coverage for uri collection, GLB chunk parsing, notice mapping and save byte-exactness, and verify `npm test` passes from a clean checkout

## 7. Integration and deployment

- [ ] 7.1 Run the skill's local dev checklist (step 6) against the deployed shell end to end and record the result in the change notes
- [x] 7.2 Add the GitHub Actions deploy workflow (skill step 7), push to `main`, enable Pages source "GitHub Actions", and verify the workflow is green
- [ ] 7.3 Verify the deployed plugin: `curl -sI` on `https://mode777.github.io/exo-gltf/exo-manifest.json` returns 200 with JSON content type and CORS; then run the skill's deployed checklist (step 8) — consent shows no cross-origin storage warning, matching file mounts one handler, no bytes move before the plugin asks, save round-trips, external change visible, tab close disposes, disabling falls back to the shell surface

## Workflow follow-up

- Archive this change once the deployed checklist is green and the owner has reviewed.
- After archive, propose M2 (structure explorer) as a new change; `@gltf-transform` enters the dependency set there.
