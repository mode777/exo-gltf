# exo-gltf plugin

The Exo editor plugin that opens glTF (`.gltf`) and binary glTF (`.glb`)
files with a 3D preview. Part of the `exo-gltf` repository; decisions live
in [`../docs/decisions.md`](../docs/decisions.md) and the milestone plan in
[`../docs/roadmap.md`](../docs/roadmap.md).

Built only with the vendored `@exo/plugin-sdk`; every protocol concern
(handshake, envelopes, origin checks) belongs to the SDK.

## Develop against the deployed shell

Do not run the shell yourself; the deployed shell is the test surface.

```bash
npm run dev --workspace plugin   # serves http://localhost:5175/ with CORS
```

1. Open <https://mode777.github.io/exo-editor/> in Chrome or Edge and open a
   local folder as the workspace.
2. Add the plugin with manifest `http://localhost:5175/exo-manifest.json`
   (through the Plugins settings surface or an `exo.json` entry).
3. Approve consent and open a `.gltf`/`.glb` file from the workspace.

Sample assets for each manual pass live in `test-assets/` (see its README).

## Build and test

```bash
npm test --workspace plugin
npm run build --workspace plugin   # tsc --noEmit + vite build -> dist/
```

The production build targets the GitHub Pages project path `/exo-gltf/`
(override with `EXO_PLUGIN_BASE_PATH` if the site moves).

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`, which publishes
`plugin/dist` to GitHub Pages. The manifest URL is:

```text
https://mode777.github.io/exo-gltf/exo-manifest.json
```
