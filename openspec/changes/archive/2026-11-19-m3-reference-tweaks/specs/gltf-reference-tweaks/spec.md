# Spec Delta

## Purpose

Missing external buffer and texture references can be relinked to workspace
files through the shell picker, tracked as unsaved edits, and saved as a
repaired document without data loss.

## ADDED Requirements

### Requirement: Missing references offer a relink action

The plugin SHALL list every external buffer or image reference that could
not be read in a repair area and SHALL offer a relink action for each,
including references whose URI uses a non-workspace scheme.

#### Scenario: Missing texture listed

- **WHEN** a document is opened whose external image could not be read
- **THEN** the repair area lists the reference by file name and kind, offers a relink action, and the explorer still flags it missing

#### Scenario: Missing buffer listed

- **WHEN** a document is opened whose external buffer could not be read
- **THEN** the repair area lists the buffer and the preview keeps its no-scene state

#### Scenario: All references resolved

- **WHEN** every external reference was read successfully
- **THEN** the repair area is absent and no relink action is offered

### Requirement: Relinking uses the shell picker or a manual fallback

A relink action SHALL ask the shell's workspace file picker for exactly one
file using only already-granted permissions, and SHALL offer manual
workspace path entry when the shell does not advertise picker support.

#### Scenario: User picks a file

- **WHEN** the user activates a relink action and selects a workspace file in the picker
- **THEN** the plugin requests one picker with the missing reference's directory as starting hint and reads only the returned path

#### Scenario: User cancels the picker

- **WHEN** the picker returns no paths
- **THEN** the document, repair area, dirty state and preview stay unchanged and no error notice appears

#### Scenario: Shell without picker support

- **WHEN** the editor capabilities report no workspace picker
- **THEN** the plugin issues no picker request, shows a manual path field, and resolves an entered path against the document's directory before a trial read

#### Scenario: Picker request already pending

- **WHEN** a picker request is still outstanding
- **THEN** no second request is issued and the document stays unchanged

### Requirement: A relink is applied only after a successful read and parse

The plugin SHALL read the selected workspace path through the shell's
file-read facility and SHALL apply the relink only when that read succeeds
and the rebuilt document parses.

#### Scenario: Successful relink

- **WHEN** the selected file reads successfully and the rebuilt document parses
- **THEN** the reference reports resolved, the preview uses the new bytes, the explorer reflects the new status, and the document becomes dirty

#### Scenario: Selected file cannot be read

- **WHEN** the read fails with any error, including not found, too large, permission denied or a directory
- **THEN** the document, reference status, dirty state and preview stay unchanged and a notice names the path and the reason

#### Scenario: Unparsable buffer replacement

- **WHEN** the selected bytes are not a usable buffer and the rebuilt document fails to parse
- **THEN** the relink is rejected, the previous document and preview are kept, and a notice explains the failure

### Requirement: Relinking rewrites the reference URI

A successful relink SHALL rewrite the glTF URI to the selected workspace
path, relative to the document's directory when the file is at or below
it and otherwise workspace-root-absolute, with URI-special characters
percent-encoded; references that shared the old URI SHALL be updated
together.

#### Scenario: File next to the document

- **WHEN** the selected file is in the document's directory
- **THEN** the written URI is its percent-encoded file name with no leading slash

#### Scenario: File in a subdirectory

- **WHEN** the selected file is in a subdirectory of the document's directory
- **THEN** the written URI is a relative forward-slash path from the document's directory

#### Scenario: File outside the document directory

- **WHEN** the selected file is outside the document's directory
- **THEN** the written URI is workspace-root-absolute and starts with `/`

#### Scenario: Special characters in the file name

- **WHEN** the selected file name contains spaces, `#` or `%`
- **THEN** the saved URI percent-encodes those characters and the saved file reopens with the reference resolved

#### Scenario: References sharing one missing URI

- **WHEN** two references used the same missing URI
- **THEN** one relink marks both resolved and the saved document contains the new URI for both

### Requirement: Relinked references can be changed or reverted

A reference relinked in this session SHALL remain editable, offering both
relinking it again and reverting to the URI it had when the document was
opened; reverting to the current saved state SHALL clear dirty.

#### Scenario: Change a relinked reference again

- **WHEN** the user relinks a reference that was already relinked
- **THEN** the new selection replaces the previous one and the reference stays resolved

#### Scenario: Revert the last edit

- **WHEN** every relink is reverted before any repaired save
- **THEN** each reference reports its original status, saving returns the original bytes, and the tab is no longer dirty

#### Scenario: Revert after a repaired save

- **WHEN** a relink was saved and is then reverted
- **THEN** the original URI is restored and the document is dirty again because the saved file still contains the repair

#### Scenario: Revert one of several edits

- **WHEN** one relink is reverted while others remain
- **THEN** only that reference returns to its original URI, the other edits stay applied, and the document remains dirty

### Requirement: Reference edits follow a dirty lifecycle

The plugin SHALL report the document dirty while reference edits are
unsaved, SHALL clear dirty only after a successful save or when no edits
remain, and SHALL keep the edits in memory when a save fails.

#### Scenario: First relink marks the document dirty

- **WHEN** a relink is applied
- **THEN** the tab shows the document as dirty

#### Scenario: Save succeeds

- **WHEN** the shell reports a successful save
- **THEN** the dirty indicator clears and the saved content becomes the new baseline

#### Scenario: Save fails

- **WHEN** the shell reports a failed or conflicting save
- **THEN** the in-memory document and every edit stay intact, the tab stays dirty, and a notice names the failure code

#### Scenario: External change while dirty

- **WHEN** the shell reports the open file changed on disk while edits are unsaved
- **THEN** the plugin does not reload or discard the edits and offers an explicit reload that would do so

#### Scenario: Explicit reload discards edits

- **WHEN** the user confirms reloading the changed file
- **THEN** the disk content replaces the edits and the document is no longer dirty

### Requirement: Saving never embeds unresolved placeholders

When saving an edited document, the plugin SHALL NOT write placeholder or
zero-filled data for references that remain missing, and SHALL refuse the
save with a notice naming them when the output format would embed such
data.

#### Scenario: External text document keeps unresolved URIs

- **WHEN** a `.gltf` still has a missing external reference and another reference is relinked and saved
- **THEN** the saved text keeps the original URI for the missing file and writes no placeholder bytes for it

#### Scenario: Embedded format would capture placeholders

- **WHEN** saving a `.glb` would embed a still-missing external resource
- **THEN** the plugin refuses the save, names the unresolved resource, and keeps the tab dirty

#### Scenario: Every reference resolved

- **WHEN** all missing references were relinked before saving
- **THEN** the save proceeds and the saved file contains no placeholder data

### Requirement: Unsupported extensions keep the document read-only

The plugin SHALL NOT edit or re-serialize a document that declares a glTF
extension it cannot round-trip, SHALL keep the preview and explorer
available, and SHALL explain why repair actions are unavailable.

#### Scenario: Document declares an unsupported extension

- **WHEN** an opened document declares an extension the plugin has no registered handler for
- **THEN** no relink action is offered, a notice names the extension, and a save request returns the original bytes with the tab not dirty

#### Scenario: Document uses only supported extensions

- **WHEN** an opened document declares only extensions the plugin registers
- **THEN** relink actions are available and a repaired save keeps those extensions intact
