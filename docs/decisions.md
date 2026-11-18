# exo-gltf decision register

Agreed with the plugin owner on 2026-11-18 and recorded here, as AGENTS.md
requires ("Do not treat any technology, library, architecture, layout,
tooling or hosting choice as decided unless it has been agreed with the user
and recorded in this repository first").

Scope: the first iteration (open, preview, explore, small tweaks). Later
iterations open new entries here; they do not silently amend these.

## Platform constraints (forced, not decisions)

Source: exo-editor contracts,
<https://github.com/mode777/exo-editor/tree/main/docs/contracts> (read
2026-11-18). These shape every design below.

| # | Constraint | Consequence for exo-gltf |
|---|---|---|
| C1 | The plugin protocol has **no directory listing**; reads are `plugin/request-file` by path only | Missing-reference resolution cannot offer a workspace browser today; see D-08 and `docs/exo-editor-api-request.md` |
| C2 | A plugin **writes only its own open document**, via the `onSaveRequest` handler (`{ text }` / `{ bytes }`) | Re-linking a reference means rewriting the `uri` inside the glTF; the plugin can never copy/move the referenced file |
| C3 | Save handler must answer within **5 s**; reads capped by `editor.limits` (default 16 MiB); message payload cap 16 MiB | Serialize ahead of the save request (debounced); mandatory explicit "too large" state |
| C4 | A visible surface requires `rendering: "frame"` in the manifest contribution | The 3D viewport is a visible handler frame; shell owns tabs/header/Save |
| C5 | Cross-origin plugin (GitHub Pages) keeps its own storage (`allow-scripts allow-same-origin`) | Viewport preferences may use `localStorage` |
| C6 | Max **20 handler frames** per plugin per workspace; each open file is one frame with its own engine instance | Lazy viewport init; full disposal on `onDispose` |
| C7 | Widening permissions, globs or switching to `rendering: "frame"` later **re-prompts every user's consent** | Choose the v1 permission set once, for the whole iteration (D-02) |
| C8 | Manifest globs **do** support brace alternation per the contract (`**/*.{gltf,glb}`) — the vendored skill's "no braces" note is outdated, and the skill itself defers to the contracts | One editor entry covers both extensions |
| C9 | Reads of `/exo.json` and `/.exo/**` are denied; bytes arrive only through `editor.readFile()`; no postMessage outside the vendored SDK | Hard rules; restated because they are security-relevant |

## Decisions

### D-01 Roadmap phasing — staged milestones

**Decision.** The first iteration is delivered as three shippable
milestones: M1 open + 3D preview, M2 structure explorer, M3 reference
tweaks. Each is verified against the deployed shell on its own before the
next begins.

**Rationale.** Earliest possible feedback on the riskiest integration (the
visible-frame editor in the shell); the save path (M3) lands last and is
informed by two milestones of read-path experience.

**Status.** Agreed.

### D-02 Manifest permissions — `workspace:write` + `events:subscribe`

**Decision.** v1 declares `workspace:write` (implies `workspace:read`,
covers M3 saving) and `events:subscribe` (theme-follow via `theme/changed`;
`config/changed` if settings are contributed later). One stable consent
surface for the whole iteration.

**Rationale.** C7: any later widening re-prompts every user, so the set is
chosen once for everything the iteration needs.

**Status.** Agreed.

### D-03 Identity — `io.github.mode777.gltf`

**Decision.** Plugin id `io.github.mode777.gltf` (tied to the GitHub owner
hosting the Pages site). Display name "glTF Viewer". Publisher
"Alex Klingenbeck". Initial version `0.1.0`, `engines.exo: ">=0.1.0"`.

**Rationale.** Id must be stable forever (consent and settings key on it);
the GitHub-owner form needs no personal domain.

**Status.** Agreed. Id, name, publisher and version as above; plugin code
is MIT-licensed.

### D-04 3D engine — three.js (WebGL2)

**Decision.** three.js with `GLTFLoader` renders the preview; WebGL2
(`WebGLRenderer`) backend. WebGPU is a later option, not v1.

**Rationale.** Reference-grade glTF loader, DRACO/KTX2/Meshopt addons,
~600 KB min+gz, largest ecosystem. WebGL2 maximizes shell-user compatibility.

**Status.** Agreed (engine). Backend is a recommended default; revisit at
M1 spike if a concrete need for WebGPU appears.

### D-05 Structure and edit model — three.js + `@gltf-transform`

**Decision.** three.js is used only to render. The structure explorer and
all edits are modeled on a `@gltf-transform` document (full property graph,
extensions included), which also reads and writes both `.gltf` and `.glb`.

**Rationale.** One document model for explore + tweak + serialize; correct
GLB packing for free; the loader's object graph is lossy for structure
display.

**Status.** Agreed.

### D-06 Serialization policy — always re-serialize via gltf-transform

**Decision.** Saving re-serializes the whole document: `.gltf` as `{ text }`,
`.glb` as `{ bytes }`. Formatting is not preserved (a minified `.gltf` gets
pretty-printed); diffs can be large. No minimal-diff string patching.

**Rationale.** One deterministic code path for both formats. Accepted
trade-off for a repair tool.

**Status.** Agreed.

### D-07 Editor UI stack — Preact (React API)

**Decision.** The editor surface (tree, inspector, toolbar around the
imperative three.js viewport) uses Preact with the React-compatible API.
Switching to React proper remains open if a React-only dependency (e.g.
react-three-fiber) is ever adopted; the imperative three.js integration
does not need it.

**Rationale.** Owner chose the React family; Preact is the leanest member
and fits a Pages-hosted plugin budget.

**Status.** Agreed — Preact. Owner chose the React family and delegated
the specific pick; the lightweight option fits because three.js dominates
the surface and no React-only dependency (e.g. react-three-fiber) is
planned — the three.js integration stays imperative.

### D-08 Missing-reference UX — deferred; blocked on upstream exo-editor API

**Decision.** The M3 interaction design is deferred. The plugin protocol
cannot list or browse the workspace (C1), so the owner will request an
upstream exo-editor extension (workspace file picker and/or directory
listing for plugins). M3's UX is designed once that API's shape is known.

**Rationale.** A manual path-entry-only UX would be the fallback for every
future plugin; extending the platform once benefits the whole ecosystem.

**Status.** Agreed. Change request drafted in
`docs/exo-editor-api-request.md`, to be forwarded to exo-editor
development. M3 is blocked on its outcome (fallback: manual path entry).

### D-09 Validation — missing-reference checks only

**Decision.** v1 detects broken external references (buffer/texture uris)
via reads. No full Khronos glTF-Validator (WASM) in the first iteration;
loader errors are surfaced as-is otherwise.

**Status.** Agreed.

### D-10 Decoder assets — vendored in the plugin root

**Decision.** DRACO / KTX2 / Meshopt decoders ship inside the plugin root
(the directory of `runtime.entry`) and are loaded from there.

**Rationale.** Self-contained deploy; consent already covers the root; no
third-party CDN dependency.

**Status.** Agreed.

### D-11 Testing — unit + curated sample assets

**Decision.** Vitest unit tests plus a small curated set of CC0 Khronos
sample assets (at minimum: DamagedHelmet.glb, a `.gltf` with external
`.bin`/textures, a broken-reference fixture) and the create-exo-plugin
skill's local dev checklist against the deployed shell. Golden viewport
captures (verification server, llvmpipe) are a later option, not v1.

**Status.** Agreed.

### D-12 Hosting — GitHub Pages project page

**Decision.** Deploy via the skill's GitHub Actions workflow to
`https://mode777.github.io/exo-gltf/`; Vite build `base: '/exo-gltf/'`.

**Status.** Agreed (follows from the repo remote; recorded for completeness).

### D-13 Repo layout — skill scaffold

**Decision.** Follow the create-exo-plugin skill exactly: npm workspaces
with vendored `sdk/` (unmodified `@exo/plugin-sdk`) and `plugin/` (from
`@exo/plugin-template`, diagnostic mismatch fixture removed).

**Status.** Agreed (skill-mandated; restated because the vendored SDK must
stay diffable against upstream).

### D-14 Editor contribution — single glob, visible frame

**Decision.** One `contributes.fileEditors` entry: glob `**/*.{gltf,glb}`
(brace alternation is contract-supported, C8), entry `editor.html`, label
"glTF", `rendering: "frame"`, priority 0 (default; no known competing
plugin today).

**Status.** Agreed. Priority 0 is a default — revisit if another plugin
claims the same glob.

## Open items

- **`contributes.configuration`** (workspace settings such as lighting or
  grid defaults) — deferred; would use the already-granted `config/changed`
  channel, no new permission needed.
- **M3 unblocked**: outcome of `docs/exo-editor-api-request.md`. Owner
  confirmed the blocker is acceptable for now; M1/M2 proceed independently.

## Change log

- 2026-11-18 (2) Owner closed the open defaults: license is MIT; UI stack
  is Preact (lightweight pick delegated). M3 blocker accepted as-is.
- 2026-11-18 (1) Initial register created from the first-iteration
  discovery session (OpenSpec explore mode); OpenSpec initialized the same
  day.
