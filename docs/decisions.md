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
2026-11-18; workspace-access update re-checked against `feb5461` on
2026-11-18). These shape every design below.

| # | Constraint | Consequence for exo-gltf |
|---|---|---|
| C1 | Reads are `plugin/request-file` by exact path. Discovery is limited to the shell-owned user picker (`plugin/request-files`, SDK 1.2.0+) and **one-level** directory listing behind `workspace:list` (`plugin/request-list`, SDK 1.3.0+) | Missing-reference resolution can use a picker and/or listing (D-08); recursive traversal, globbing and search remain unavailable |
| C2 | A plugin **writes only its own open document**, via the `onSaveRequest` handler (`{ text }` / `{ bytes }`) | Re-linking a reference means rewriting the `uri` inside the glTF; the plugin can never copy/move the referenced file |
| C3 | Save handler must answer within **5 s**; reads capped by `editor.limits` (default 16 MiB); message payload cap 16 MiB | Serialize ahead of the save request (debounced); mandatory explicit "too large" state |
| C4 | A visible surface requires `rendering: "frame"` in the manifest contribution | The 3D viewport is a visible handler frame; shell owns tabs/header/Save |
| C5 | Cross-origin plugin (GitHub Pages) keeps its own storage (`allow-scripts allow-same-origin`) | Viewport preferences may use `localStorage` |
| C6 | Max **20 handler frames** per plugin per workspace; each open file is one frame with its own engine instance | Lazy viewport init; full disposal on `onDispose` |
| C7 | Widening permissions, globs or switching to `rendering: "frame"` later **re-prompts every user's consent** | Choose the v1 permission set deliberately; any later addition re-prompts (D-02, C10) |
| C8 | Manifest globs **do** support brace alternation per the contract (`**/*.{gltf,glb}`) — the vendored skill's "no braces" note is outdated, and the skill itself defers to the contracts | One editor entry covers both extensions |
| C9 | Reads of `/exo.json` and `/.exo/**` are denied; bytes arrive only through `editor.readFile()`; no postMessage outside the vendored SDK | Hard rules; restated because they are security-relevant |
| C10 | `workspace:list` is a separate manifest permission that requires `workspace:read`; adding it to an already-approved plugin **re-prompts every user**. The shell picker needs only `workspace:read` | Pick only what M3 needs: the picker adds no consent prompt; listing does (D-08) |

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

### D-02 Manifest permissions — `workspace:read` + `workspace:write` + `events:subscribe`

**Decision.** v1 declares `workspace:read`, `workspace:write` and
`events:subscribe`. The shell's semantic validator requires `workspace:read`
to be listed explicitly whenever `workspace:write` is present (a write
permission does not waive the read declaration), even though the capability
itself is implied. `events:subscribe` enables theme-follow via
`theme/changed` (`config/changed` if settings are contributed later). One
stable consent surface for the whole iteration.

**Rationale.** C7: any later widening re-prompts every user, so the set is
chosen once for everything the iteration needs.

**Status.** Agreed. The 2026-11-18 upstream listing capability adds a possible
`workspace:list` grant that did not exist when this set was chosen; adding it
later re-prompts every user (C7/C10). Whether M3 needs it is tracked in D-08
and the M3 OpenSpec change; the current manifest stays `workspace:read`,
`workspace:write` and `events:subscribe`.

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

**Status.** Agreed. Implemented in M2 with `@gltf-transform/core`
**4.5.1**, pinned in `package-lock.json`. Measured bundle impact
(production build, M2): editor bundle 719.91 kB → 797.71 kB minified
(+77.80 kB); gzip 199.12 kB → 220.87 kB (+21.75 kB). The library models
glTF images as `Texture` properties and folds texture definitions into
`TextureInfo`, so the explorer presents one Textures group rather than
duplicate Textures/Images groups; each texture entry still carries its
image URI, MIME type and resolved/missing status.

M3 adds `@gltf-transform/extensions` **4.5.1** so re-serialization
preserves extension payloads. Only extensions without a codec
dependency are registered; a document declaring any other extension
(such as Draco or Meshopt) stays read-only instead of losing data on
save. Measured with the final M3 build: editor 911.28 kB minified /
246.44 kB gzip, a total M3 delta of +113.57 kB / +25.57 kB against M2;
the extension package alone accounts for +100.35 kB / +21.15 kB.

### D-06 Serialization policy — always re-serialize via gltf-transform

**Decision.** Saving re-serializes the whole document: `.gltf` as `{ text }`,
`.glb` as `{ bytes }`. Formatting is not preserved (a minified `.gltf` gets
pretty-printed); diffs can be large. No minimal-diff string patching.

**Rationale.** One deterministic code path for both formats. Accepted
trade-off for a repair tool.

**Status.** Agreed. M3 clarifies the save policy: a save with no unsaved
reference edit returns the baseline bytes unchanged; a save after a
relink re-serializes the document. A `.glb` save embeds resolved external
resources, so it refuses the save while any external reference is still
missing. Documents that declare an extension without a registered
handler stay read-only, because gltf-transform would otherwise drop the
extension payload.

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

### D-08 Missing-reference UX — upstream API available; UX deferred to the M3 change

**Decision.** The upstream dependency is satisfied. exo-editor shipped both
requested capabilities on 2026-11-18: the shell-owned workspace picker
(`plugin/request-files` / `shell/files-selected`, SDK 1.2.0) and permissioned
one-level directory listing (`plugin/request-list` / `shell/list-result`,
`workspace:list`, SDK 1.3.0). M3's concrete interaction is designed in its
OpenSpec change against that API; this register does not yet choose between
the picker, listing, or both.

**Rationale.** Both designs remove the blind-typing fallback, but they differ
in consent: the picker uses the existing `workspace:read`, while listing adds
the separate `workspace:list`, which re-prompts users (C10). The choice
belongs with the M3 UX, informed by the reference-repair flow.

**Status.** Resolved 2026-11-19. M3 ships **picker-only**: the shell-owned
workspace picker through `editor.requestFiles()` with the existing
`workspace:read`. `workspace:list` is not requested, so the manifest and
the consent fingerprint stay unchanged and existing users are not
re-prompted (C10). A manual workspace-path field remains the fallback on
shells without the picker; either relink applies only after a successful
read and trial reparse. The vendored SDK was refreshed unmodified from
`1.1.0` to upstream `1.3.0` for `requestFiles()`. The shipped API is
recorded in `docs/exo-editor-api-request.md` section 8.

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
- **Draco/Meshopt editing** — those decoders are deliberately not bundled
  for the document model in M3; affected documents stay read-only. A
  later milestone can add the codec modules without changing the relink
  UX.

## Change log

- 2026-11-19 (1) M3 reference tweaks implemented: picker-only relink with
  a manual fallback (no `workspace:list`, manifest unchanged), vendored
  SDK refreshed unmodified to `1.3.0`, `@gltf-transform/extensions`
  4.5.1 added for extension-preserving saves, dirty/pre-serialized save
  with conflict protection, and a relink/conflict e2e suite. D-05 and
  D-06 record the measured bundle and save clarifications; D-08 records
  the picker-only choice.
- 2026-11-18 (4) M2 structure explorer implemented: `@gltf-transform/core`
  4.5.1 added, workspace-backed document IO, lazy explorer model and
  sidebar/inspector, node focus, reference status, reload/disposal
  coverage. D-05 records the measured bundle delta.
- 2026-11-18 (3) exo-editor shipped the requested workspace picker and
  permissioned directory listing, both additively (SDK 1.3.0). M3 is
  unblocked; D-08 records the shipped API, and the M3 UX/permission choice
  remains open.
- 2026-11-18 (2) Owner closed the open defaults: license is MIT; UI stack
  is Preact (lightweight pick delegated). M3 blocker accepted as-is.
- 2026-11-18 (1) Initial register created from the first-iteration
  discovery session (OpenSpec explore mode); OpenSpec initialized the same
  day.
