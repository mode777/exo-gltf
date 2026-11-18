# M1 verification record

Date: 2026-11-18 (automated; no interactive session required)

## How it was verified

The create-exo-plugin checklist requires a browser session against the
deployed shell. That session is automated as a Playwright suite
(`e2e/`) that runs in CI:

- Shell: the deployed <https://mode777.github.io/exo-editor/>.
- Workspace: an in-memory File System Access handle injected before page
  load (`e2e/fake-fsa.js`), seeded per test from the curated fixtures. The
  shell's real folder provider, workspace session, explorer, consent,
  tab and save flows all run unchanged; only the interactive directory
  picker dialog is replaced by the same standard FSA API surface.
- Plugin: the local production build (`e2e-local` job) and the deployed
  Pages build (`e2e-deployed` job), the latter gated on a hash check that
  the deployed `plugin.html`/`editor.html` reference this checkout's
  assets before any test runs.
- Fixtures and the local plugin build are served through Playwright
  request interception at a fake https origin, avoiding Chromium's Local
  Network Access gate for public pages.

Result — run
[44324388291](https://github.com/mode777/exo-gltf/actions/runs/44324388291)
(all jobs success; 8 tests, also reproduced twice against the deployed
build from the verification server with Chromium 131):

| Job | Result |
|---|---|
| build (unit tests + production build) | success |
| e2e-local (8 tests vs local build) | success |
| deploy (GitHub Pages) | success |
| e2e-deployed (8 tests vs deployed build) | success |

Cross-checked on the verification server (Chromium 131 headless shell,
same suite): 8/8 passed.

## Coverage against the M1 spec

| Spec requirement | Evidence |
|---|---|
| Editor registration for `.gltf`/`.glb` | Consent dialog asserts plugin name and `**/*.{gltf,glb}`; opening each fixture mounts exactly one `glTF editor` frame |
| Interactive 3D preview | Canvas present and phase `ready` for GLB and glTF fixtures; orbit controls initialized (camera framing ran) |
| Compressed payloads, no third-party origins | Draco fixture and KTX2 fixture render; decoder assets served from the plugin origin (network log free of CDN requests) |
| External references through the workspace | `BoxTextured.gltf` renders its `.bin` + PNG; missing texture shows a warning naming `missing.png` with the rest rendered |
| Oversized files | 17 MiB fixture shows "exceeds the editor size limit"; no canvas, no partial scene |
| Pass-through save, no dirty state | Shell Save (Ctrl+S) writes; SHA-256 of stored bytes unchanged; no dirty indicator before or after |
| External change reload | `touch` + focus polling triggers a re-read and the preview returns to `ready` |
| Deletion notice | Removing the file externally surfaces "was deleted from the workspace" with no retry loop |
| Disposal | Closing the tab removes the handler frame (dispose acknowledged) |
| Theme follows the shell | Switching theme in shell settings updates the plugin frame's `data-theme` and viewport colors |
| Published plugin endpoint | Deployed manifest, pages, hashed assets and decoder assets return 200 with JSON content type and CORS `*`; deployed suite hash-verifies the artifact |

## Defect found and fixed

The first deployed manifest failed the shell's semantic validation:
`workspace:write requires workspace:read` — the permission must be
declared explicitly, not only implied. The manifest now lists
`workspace:read`, `workspace:write` and `events:subscribe`; the decision
register records the rule.

## Known limitations

- The real interactive directory-picker dialog is not exercised; the fake
  implements the standard FSA surface the provider consumes.
- Only Chromium is covered (the shell itself only supports
  Chromium-family browsers for folder workspaces).
- Golden-image comparison is out of scope (decision D-11); canvas
  presence plus successful load is the rendering signal.
- Shell-owned race: if a matching file is opened while plugins are still
  registering, the shell opens its text fallback and does not switch to
  the plugin automatically. The suite reopens the file after the plugin
  mounts, mirroring what a user would do; flag to the exo-editor side if
  auto-switch is desired.
