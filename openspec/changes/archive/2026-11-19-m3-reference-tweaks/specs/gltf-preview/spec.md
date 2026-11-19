# Spec Delta

## REMOVED Requirements

### Requirement: Pass-through save with no dirty state

**Reason**: Saving after a reference repair must return the edited document, so the plugin can no longer always answer with the bytes it read.

**Migration**: The separate plugin capability `gltf-reference-tweaks` owns the edit and dirty lifecycle; the replacement requirement below keeps byte-identical saving for documents with no unsaved edits.

## ADDED Requirements

### Requirement: Save reflects the current document

The plugin SHALL answer every save request within the shell's
save-response timeout: with the current saved baseline — the bytes last
read, or the last successfully saved output — while no reference edit is
unsaved, and otherwise with the current document re-serialized in its
original format (`.gltf` as text, `.glb` as bytes).

#### Scenario: Unmodified save

- **WHEN** the shell requests a save and no reference edit is unsaved
- **THEN** the written file is byte-for-byte identical to the current baseline and the tab is not dirty

#### Scenario: Edited save

- **WHEN** the shell requests a save after a reference was relinked
- **THEN** the plugin returns the re-serialized document in its original format containing the new URI and the saved file reopens cleanly in the plugin

#### Scenario: Rapid successive relinks

- **WHEN** a save request follows several quick relinks
- **THEN** the plugin answers from the pre-serialized state of the latest edit without exceeding the save-response timeout

#### Scenario: Serialization fails

- **WHEN** the edited document cannot be re-serialized
- **THEN** the plugin shows a serialization-failure notice, sends no content, keeps the in-memory document intact, and leaves the tab dirty

### Requirement: Saving preserves extension data

The plugin SHALL register its supported glTF extensions for reading and
writing, SHALL preserve their declarations and payloads when
re-serializing, and SHALL NOT silently drop an extension it cannot
serialize.

#### Scenario: Extension-bearing asset saved

- **WHEN** a document whose extensions the plugin supports is relinked and saved
- **THEN** the saved file keeps those extension declarations and payloads and reopens with the same structure and rendering

## MODIFIED Requirements

### Requirement: External references resolve through the workspace

The plugin SHALL resolve external buffer and texture URIs within the
workspace — relative URIs against the opened file's directory and
root-absolute URIs as given — and read them through the shell's file-read
facility only.

#### Scenario: External buffer and textures present

- **WHEN** a `.gltf` references a sibling `.bin` and texture files that exist in the workspace
- **THEN** each reference resolves and the complete scene renders

#### Scenario: A referenced texture is missing

- **WHEN** a referenced texture file cannot be read
- **THEN** the affected surfaces render with a placeholder material, a notice names the unresolved reference, and the remainder of the scene still renders

#### Scenario: A referenced buffer is missing

- **WHEN** a referenced buffer file cannot be read
- **THEN** the plugin shows an explicit notice naming the file and renders no partial scene

### Requirement: External change reload

The plugin SHALL reload and re-render the preview when the shell reports
the open file changed externally and no reference edit is unsaved, SHALL
keep the current content and offer an explicit reload when an edit is
unsaved, and SHALL show a notice when the file was deleted, without
silent retry loops.

#### Scenario: File changed on disk

- **WHEN** the shell delivers an external change notification for the open file and the document has no unsaved edits
- **THEN** the plugin re-reads the file and the preview reflects the new content

#### Scenario: File deleted on disk

- **WHEN** the shell reports the open file deleted
- **THEN** the plugin shows a deletion notice and keeps its last rendered state without further read attempts

#### Scenario: Unsaved edits exist when the file changes

- **WHEN** the shell delivers an external change notification while a reference edit is unsaved
- **THEN** the plugin keeps the edited content and dirty state, shows a notice, and does not re-read the file until the user explicitly reloads
