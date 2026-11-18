# Change request: workspace file access for plugins

**To:** exo-editor development
**From:** exo-gltf plugin (mode777/exo-gltf)
**Date:** 2026-11-18
**Target contracts:** `docs/contracts/plugin-protocol.md` (v1),
`docs/contracts/plugin-sdk.md` (v1), `docs/contracts/workspace-api.md` (v1)
**Kind:** additive within protocol major 1 (subject to the open questions in
section 6)

This document is written so it can be dropped into an exo-editor OpenSpec
change with minimal editing. It follows the repo's own rules: contracts
first, additive optional fields and message types are allowed within a
protocol major, removal or reinterpretation requires a new major.

## 1. Problem

A glTF file routinely references sibling files: external `.bin` buffers,
`.png`/`.jpg` textures, and increasingly KTX2/DRACO assets. When a glTF is
moved without its siblings (or the siblings were renamed), the references
break. Repairing such a file inside the Exo shell is exactly the use case
of the exo-gltf plugin's "small tweaks" milestone: rewrite the `uri`
pointers to files that actually exist in the workspace.

The plugin protocol cannot express this today:

- Reads are `plugin/request-file` by exact path only
  (`plugin-protocol.md` section 5.2). There is **no way to discover** which
  paths exist: no listing, no globbing, no search.
- The only user-facing fallback is asking the user to type or paste the
  correct workspace-relative path blind, validated by trial reads.

This is not a glTF-specific problem. Any plugin that works on
multi-file formats (HTML with local images, Markdown with relative links,
subtitle files next to video, `.obj`+`.mtl`+textures, font families)
hits the same wall.

Notably, the shell-side session already has the capability: the
`WorkspaceAccess` interface exposes `list(path, { depth })`
(`workspace-api.md` section 2), and `forPlugin(pluginId)` already filters
reserved paths from listings. The gap is purely in the plugin protocol and
SDK surface. In addition, `shell/init` already carries a
`capabilities.requestFiles` flag (`plugin-protocol.md` section 3.2) that no
v1 message exercises - a natural hook for the picker design below.

## 2. Proposed designs

Two complementary designs, ordered by our preference. They are independent;
either one unblocks the use case, and they share all security properties
below.

### Design A (recommended): shell-owned workspace file picker

Give the existing `capabilities.requestFiles` bit meaning.

```text
plugin/request-files   { id, multiple?: boolean, accept?: string[] }
                       -> shell/files-selected { replyTo, paths: WorkspacePath[] }
                       |  shell/error { replyTo, code: 'aborted' | ... }
```

- The shell renders a picker over the workspace it already owns (the
  session's `list()`), confined to the workspace root, with reserved paths
  (`/exo.json`, `/.exo/**`) filtered by the existing `forPlugin` facade.
- The reply carries **workspace-relative paths only** - never handles,
  blobs or content. The plugin then reads the picked paths through the
  existing `plugin/request-file` flow, subject to `workspace:read` and
  `editor.limits` as usual.
- `accept` would be advisory extension filters (e.g. `["png","jpg","webp","ktx2"]`).
- Gesture-bound like `requestPermission`: the shell may reject a request
  that arrives without a recent user gesture (`code: 'aborted'`).
- One picker open at a time per frame; a second request rejects locally
  (`rate-limited`).

Why this shape: the user sees and chooses exactly what the plugin receives.
No new disclosure surface, no new permission debate - the picker *is* the
consent gesture, mirroring how `showDirectoryPicker` gates the folder
provider. It also matches the existing capability bit, so no manifest
schema change is implied.

### Design B: directory listing API

Let plugins enumerate directories directly.

```text
plugin/request-list   { id, path, depth: 'one' | 'recursive' }
                      -> shell/list-content { replyTo, entries: FileStat[] }
                      |  shell/error { replyTo, code: 'not-found' | 'not-a-directory' | 'too-large' | ... }
```

- Backed by the existing `WorkspaceAccess.list()`; reserved paths filtered
  by `forPlugin` exactly as for the shell's own explorer.
- `recursive` needs a result cap (analogous to `limits.maxRequestBytes`,
  e.g. a max entry count, error `too-large`) so a plugin cannot force an
  unbounded traversal.
- Privacy consideration: unlike reads-by-guessed-path, listing confirms the
  *existence* of files the user never named. Two options, deliberately left
  open in section 6: gate it on the existing `workspace:read`, or introduce
  a separate `workspace:list` permission so consent stays explicit.

For our use case, B alone still needs UX work in the plugin (tree-walking a
large workspace to find candidates); A alone fully unblocks the repair flow
and is why we recommend it first. B is the better primitive for
auto-detection features later (e.g. "scan nearby folders for files named
like the missing reference").

## 3. Security and privacy analysis

| Property | Design A (picker) | Design B (listing) |
|---|---|---|
| What the plugin learns | Only paths the user explicitly picked | Existence + metadata of every file in listed subtrees |
| User awareness | Explicit (picker UI) | Implicit (permission grant at most) |
| New handles/bytes crossing | None (paths only; content still via request-file) | None (paths only; content still via request-file) |
| Reserved paths | Filtered by `forPlugin` before the picker shows them | Filtered by `forPlugin` before reply |
| Gesture binding | Yes (required) | Not applicable |
| Abuse potential | Re-prompt spam (mitigate: one picker per frame, deny without gesture) | Traversal volume (mitigate: entry caps, rate limits, depth limit) |

Both keep every existing invariant: no `FileSystemHandle`/`Blob` crosses to
a frame, bytes still move only through `plugin/request-file`, and the shell
never replies to malformed envelopes. Error messages should keep the
existing rule of not disclosing paths outside the requested scope
(`workspace-api.md` section 9 already mandates this style for the shell).

## 4. Compatibility

- New message types are additive within protocol major 1
  (`plugin-protocol.md` section 8). A shell that predates them answers
  `unsupported-message`, and the SDK can surface that; plugins must keep a
  fallback (for us: manual path entry).
- SDK: new helpers arrive as a MINOR bump (e.g. `editor.requestFiles()`,
  `editor.listDir()`), per the compatibility table in `plugin-sdk.md`
  section 9.
- Manifest: design A needs no schema or permission change (the capability
  is advertised in `shell/init` per shell build). Design B *may* warrant a
  new permission string; if so that is a manifest-affecting change and
  belongs in the consent fingerprint discussion - see open questions.
- Docs: `plugin-protocol.md` phase rules (section 3.3) gain the new
  message types in the editor-phase row; `plugin-sdk.md` section 7 gains
  the helpers; `workspace-api.md` needs no change.

## 5. Consumer sketch (how exo-gltf would use it)

Milestone 3 of exo-gltf ("resolve missing external references") with
design A:

```text
1. Parse the glTF; for each buffer/image with an external uri,
   probe via editor.readFile(dir + uri).
2. Collect the misses; show "3 missing references".
3. User clicks "relink" on one; plugin sends plugin/request-files
   { accept: ["png","jpg","webp","ktx2"] } from the click gesture.
4. Shell picker opens (workspace-scoped, reserved paths hidden).
5. On shell/files-selected, the plugin reads the picked path to verify,
   rewrites the uri in the gltf-transform document, marks dirty.
6. Save re-serializes and writes via the existing save handler.
```

Steps 1-2 and 5-6 work on current shells already; only step 3-4 needs this
change. The fallback on shells without the message is a manual path input
validated by read.

## 6. Open questions for exo-editor

1. Should design B's capability be covered by `workspace:read` or a new
   `workspace:list` permission (consent-fingerprint implications)?
2. Does `capabilities.requestFiles` in `shell/init` already anticipate
   design A, or is the bit currently vestigial (in which case: is a
   picker on the shell roadmap independently)?
3. Entry-count cap and rate-limit values for listing; depth limit policy.
4. Should the picker accept a starting directory hint from the plugin
   (e.g. the open file's dir), or always open at the workspace root to
   avoid leaking that the plugin knows a directory exists?
5. Interaction with the Stratofold provider: `list()` is server-backed
   there; do picker and listing need provider capability flags
   (cf. `WorkspaceCapabilities`)?

## 7. Alternatives considered (and why insufficient)

- **Manual path entry only** (no platform change): works, but degrades the
  repair UX to blind typing for every plugin and every multi-file format.
- **Data-URI embedding on export** (glTF can inline everything): changes
  the user's file layout rather than repairing it; not a real fix.
- **Guessing/probing**: allowed today, but only finds files whose exact
  path the plugin can construct; useless after renames and generates
  noise in the workspace log.

---

*Prepared in OpenSpec explore mode for mode777/exo-gltf; decision D-08 in
`docs/decisions.md` tracks the dependency. Please route through an
exo-editor OpenSpec change if accepted.*
