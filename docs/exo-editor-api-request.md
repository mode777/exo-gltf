# Change request: workspace file access for plugins

**To:** exo-editor development
**From:** exo-gltf plugin (mode777/exo-gltf)
**Date:** 2026-11-18
**Target contracts:** `docs/contracts/plugin-protocol.md` (v1),
`docs/contracts/plugin-sdk.md` (v1), `docs/contracts/workspace-api.md` (v1)
**Kind:** additive within protocol major 1 (open questions resolved 2026-11-18;
see section 6)

> **Resolved 2026-11-18.** exo-editor shipped both designs: the shell-owned
> workspace picker (`plugin/request-files` / `shell/files-selected`, SDK
> `1.2.0`) and permissioned one-level directory listing
> (`plugin/request-list` / `shell/list-result` with the `workspace:list`
> permission, SDK `1.3.0`). Protocol major, manifest schema and existing
> consents are unchanged. Section 6 now records the answers and section 8
> the shipped shape and its differences from this request. Kept as the
> historical ask; M3 is unblocked.

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

## 6. Open questions for exo-editor (answered 2026-11-18)

1. Should design B's capability be covered by `workspace:read` or a new
   `workspace:list` permission (consent-fingerprint implications)?
   **Answered:** a separate `workspace:list` permission. It requires
   `workspace:read`; adding it changes the consent fingerprint and
   re-prompts an already-approved reader, while read-only plugins keep
   their stored consent.
2. Does `capabilities.requestFiles` in `shell/init` already anticipate
   design A, or is the bit currently vestigial (in which case: is a
   picker on the shell roadmap independently)?
   **Answered:** `requestFiles` remains the permission bit. A new
   `capabilities.filePicker` support bit was added for the shell-owned
   picker, and `capabilities.directoryListing` for listing; older shells
   omit both and the SDK treats them as false.
3. Entry-count cap and rate-limit values for listing; depth limit policy.
   **Answered:** one directory level only, 1,000 entries per page with an
   opaque `nextCursor`, at most four in-flight listing requests per frame
   and twenty per rolling second, and a five-second page deadline. Pages
   come from a handler-bound snapshot cache; recursive listing, globbing
   and search remain out of scope.
4. Should the picker accept a starting directory hint from the plugin
   (e.g. the open file's dir), or always open at the workspace root to
   avoid leaking that the plugin knows a directory exists?
   **Answered:** an optional `directory` start hint is accepted, normalized
   and contained. It is not a grant; the shell silently falls back to the
   handler file's directory when the hint is absent, invalid, reserved or
   missing. The plugin cannot supply any other picker text or a
   preselection.
5. Interaction with the Stratofold provider: `list()` is server-backed
   there; do picker and listing need provider capability flags
   (cf. `WorkspaceCapabilities`)?
   **Answered:** no provider change and no new flags. Both features go
   through the existing `forPlugin(pluginId).list()` facade, so the remote
   provider works like the folder provider; the new bounds are enforced in
   the shell broker, not the provider.

## 7. Alternatives considered (and why insufficient)

- **Manual path entry only** (no platform change): works, but degrades the
  repair UX to blind typing for every plugin and every multi-file format.
- **Data-URI embedding on export** (glTF can inline everything): changes
  the user's file layout rather than repairing it; not a real fix.
- **Guessing/probing**: allowed today, but only finds files whose exact
  path the plugin can construct; useless after renames and generates
  noise in the workspace log.

## 8. Resolution in exo-editor (2026-11-18)

Checked against exo-editor `main` (`feb5461`, "Record plugin workspace
listing verification"; contracts re-read 2026-11-18). Relevant upstream
commits: `a868f08` (file picker), `f274a59` (directory listing), with
verification recorded in `3554812`, `5aa1382` and `feb5461`. OpenSpec
changes: `plugin-file-picker` (implemented and verified; SDK `1.2.0`) and
`plugin-workspace-listing` (implemented and verified; SDK `1.3.0`).

Both core designs were accepted, additively, with protocol `1`, manifest
schema `1` and shell `0.1.0`. The only dropped detail is the advisory
`accept` extension filter (see Design A below); the rest of the request was
implemented as proposed.

### Design A — shipped

- Wire messages: `plugin/request-files { multiple?, directory? }` and
  `shell/files-selected { paths }`, where `[]` means the user cancelled.
- Requires `workspace:read` and `capabilities.filePicker`; the request is
  rejected unless the handler is active, visible, focused and not
  disposing. One picker per frame; a second request is `rate-limited`.
- The picker is shell-owned and lazy-lists the workspace through the
  plugin-scoped facade. `/exo.json` and `/.exo/**` are never shown or
  returned; the plugin cannot supply a title, message or preselection.
- Replies carry `/`-rooted paths only. Content is still read through
  `plugin/request-file`.
- Deviations from this request: the advisory `accept` extension filter was
  **not** implemented (upstream records it as future work), and
  cancellation is an empty `files-selected`, not an `aborted` error.
  `multiple` selections are capped at 32 paths in selection order.
- SDK: `editor.requestFiles()` with local `unsupported-message`,
  `permission-denied` and `rate-limited` preflight; manual path entry
  remains the fallback on shells without the support bit.

### Design B — shipped

- Wire messages: `plugin/request-list { path, cursor? }` and
  `shell/list-result { entries, nextCursor? }`, with
  `DirectoryEntry = { path, kind: 'file' | 'directory', size? }`.
- Requires the new manifest permission `workspace:list` (which requires
  `workspace:read`); `capabilities.directoryListing` is the shell support
  bit, not a permission. A handler without the permission gets
  `permission-denied` and no listing is performed.
- One directory level only. Pages hold up to 1,000 direct children from a
  handler-bound snapshot, sorted directories before files then by path;
  an invalid or expired cursor is `not-found` and the plugin relists.
- Reserved entries are filtered and reserved directories denied. Entries
  carry no `mtime`, version, content, handle, `File` or `Blob`.
- Limits: four in-flight listings per frame, twenty per rolling second,
  five-second page deadline; snapshots are dropped on disposal, tab close,
  plugin removal and workspace switch. Listing is neither a watcher nor a
  write grant.
- SDK: `editor.listDirectory(path, { cursor? })` with
  `unsupported-message`/`permission-denied` preflight, opaque cursor
  pass-through and `readFile()` / picker as fallbacks.

### Consequences for exo-gltf

- M3 is unblocked. Its relink UX can use the picker, listing, or both; the
  choice is M3 design work, not settled by this request.
- The picker adds no permission. Listing requires adding `workspace:list`
  to the manifest, which changes the consent fingerprint and **re-prompts
  every user** (D-08 / C10 in `docs/decisions.md`).
- The SDK vendored in this repository is `1.1.0`; it must be refreshed
  unmodified to upstream `1.3.0` before M3 uses either helper (D-13).

Contract references:

- [`plugin-protocol.md` §5.2.1](https://github.com/mode777/exo-editor/blob/main/docs/contracts/plugin-protocol.md#521-user-mediated-file-selection)
  and [§5.2.2](https://github.com/mode777/exo-editor/blob/main/docs/contracts/plugin-protocol.md#522-permissioned-directory-listing)
- [`plugin-sdk.md` §7](https://github.com/mode777/exo-editor/blob/main/docs/contracts/plugin-sdk.md#7-editor-client)
- [`plugin-manifest.md` §3](https://github.com/mode777/exo-editor/blob/main/docs/contracts/plugin-manifest.md#fields)
  (permissions) and
  [§6](https://github.com/mode777/exo-editor/blob/main/docs/contracts/plugin-manifest.md#6-consent)
  (consent fingerprint)

---

*Prepared in OpenSpec explore mode for mode777/exo-gltf; decision D-08 in
`docs/decisions.md` tracks the dependency. Please route through an
exo-editor OpenSpec change if accepted.*
