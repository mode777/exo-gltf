# gltf-preview Specification

## Purpose

Opening a glTF or GLB file from an Exo workspace mounts the exo-gltf
plugin's visible editor frame and shows an interactive 3D preview of the
asset, with defined behavior for external references, compressed payloads,
oversized files, external changes, saving and disposal.

## Requirements

### Requirement: Editor registration for glTF and GLB files

The plugin SHALL declare and register exactly one file editor contribution
matching `**/*.{gltf,glb}`, rendered as a visible frame, and SHALL request
the file's content only after the shell mounts the editor for an opened
matching file.

#### Scenario: Matching file opens

- **WHEN** the user opens a workspace file whose name ends in `.gltf` or `.glb`
- **THEN** the shell mounts the plugin's editor frame for that document and the plugin requests the file content exactly once before rendering

#### Scenario: Non-matching file opens

- **WHEN** the user opens a file with any other extension
- **THEN** the plugin contributes no editor and the shell's fallback surface handles it

### Requirement: Interactive 3D preview of the opened asset

The plugin SHALL render the opened asset as an interactive 3D preview with
orbit-style camera rotation, zoom and pan, initially framed to show the
whole scene.

#### Scenario: Self-contained GLB

- **WHEN** a GLB whose buffers and textures are embedded is opened
- **THEN** the full scene renders and the initial camera frames the entire asset

#### Scenario: Empty or invalid glTF payload

- **WHEN** the file parses as JSON/GLB but contains no renderable scene
- **THEN** the plugin shows an explicit empty-or-invalid notice instead of a blank or broken frame

### Requirement: Compressed payload support without network access

The plugin SHALL render assets using Draco, KTX2 and Meshopt compression by
means of decoder assets served from the plugin's own deployment, without
fetching decoders from third-party origins.

#### Scenario: Draco-compressed GLB

- **WHEN** a GLB with Draco-compressed meshes is opened
- **THEN** the meshes decode and render using the plugin's own decoder assets and no third-party request is made

### Requirement: External references resolve through the workspace

The plugin SHALL resolve external buffer and texture URIs of a `.gltf`
against the opened file's directory within the workspace and read them
through the shell's file-read facility only.

#### Scenario: External buffer and textures present

- **WHEN** a `.gltf` references a sibling `.bin` and texture files that exist in the workspace
- **THEN** each reference resolves and the complete scene renders

#### Scenario: A referenced texture is missing

- **WHEN** a referenced texture file cannot be read
- **THEN** the affected surfaces render with a placeholder material, a notice names the unresolved reference, and the remainder of the scene still renders

#### Scenario: A referenced buffer is missing

- **WHEN** a referenced buffer file cannot be read
- **THEN** the plugin shows an explicit notice naming the file and renders no partial scene

### Requirement: Oversized files produce an explicit too-large state

The plugin SHALL detect when the opened file or a referenced file exceeds
the size limits advertised by the shell and display an explicit too-large
state naming the file, instead of a generic failure.

#### Scenario: Opened file exceeds the read limit

- **WHEN** the shell reports the read of the opened file as too large
- **THEN** the editor shows a too-large notice for that file and performs no further read attempts on it

### Requirement: Pass-through save with no dirty state

The plugin SHALL NOT report itself dirty and SHALL answer every save
request with the exact bytes last delivered by the shell for the open
document, within the shell's save-response timeout.

#### Scenario: Shell-initiated save

- **WHEN** the shell requests a save while the preview is open
- **THEN** the plugin returns content identical to what was read and the written file is byte-for-byte unchanged

#### Scenario: Tab state

- **WHEN** the preview is open and unmodified
- **THEN** the tab never shows a dirty indicator

### Requirement: External change reload

The plugin SHALL reload and re-render the preview when the shell reports the
open file changed externally, and SHALL show a notice when it was deleted,
without silent retry loops.

#### Scenario: File changed on disk

- **WHEN** the shell delivers an external change notification for the open file
- **THEN** the plugin re-reads the file and the preview reflects the new content

#### Scenario: File deleted on disk

- **WHEN** the shell reports the open file deleted
- **THEN** the plugin shows a deletion notice and keeps its last rendered state without further read attempts

### Requirement: Disposal releases all viewport resources

The plugin SHALL stop rendering and release renderer, geometry and texture
resources when the shell disposes the editor frame, and SHALL make no
state changes afterwards.

#### Scenario: Tab closed

- **WHEN** the tab holding the preview is closed
- **THEN** the frame acknowledges disposal and a subsequently reopened document starts from a clean state with no residual GPU resources from the closed one

### Requirement: Theme follows the shell

The editor surface SHALL adopt the shell theme delivered at init and SHALL
update its colors when the shell reports a theme change event.

#### Scenario: Theme switches while open

- **WHEN** the shell emits a theme change while the preview is open
- **THEN** the viewport and surrounding UI adopt the new theme

### Requirement: Published plugin endpoint

The plugin SHALL be published at its GitHub Pages project URL with a valid
manifest reachable at the site root, so a workspace can install it by that
URL alone.

#### Scenario: Manifest fetch after deploy

- **WHEN** the deployment workflow has completed
- **THEN** an HTTP GET of `https://mode777.github.io/exo-gltf/exo-manifest.json` returns 200 with a JSON content type and CORS allowed, and the manifest validates against the Exo plugin manifest schema
