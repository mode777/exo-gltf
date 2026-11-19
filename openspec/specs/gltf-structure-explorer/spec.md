# gltf-structure-explorer Specification

## Purpose

Opening a glTF or GLB file exposes its document structure next to the 3D
preview: users can browse and inspect scenes, nodes, meshes, materials,
textures, animations and extensions, see which external resources are
missing, and navigate the viewport from the tree.

## Requirements

### Requirement: Document structure is browsable after opening

After a document is opened and parsed, the plugin SHALL present its
structure grouped by glTF collections with a count per collection, and
each group SHALL reveal its entries on request.

#### Scenario: Rich asset opens

- **WHEN** an asset containing scenes, nodes, meshes, materials and textures is opened
- **THEN** the explorer lists a group per non-empty collection with counts matching the document

#### Scenario: Collapsed group hides its entries

- **WHEN** a collection group is collapsed
- **THEN** its entries are not exposed until the group is expanded

#### Scenario: Empty document

- **WHEN** the parsed document contains no scenes, nodes or other collections
- **THEN** the explorer shows an explicit empty-structure state instead of an empty panel

### Requirement: Selecting an entry shows its details in an inspector

The explorer SHALL allow selecting any listed entry and SHALL show the
selected property's details: its kind, display name or index, and its
references (parent and children for nodes, mesh/material links, texture
image sources, and external URIs where applicable).

#### Scenario: Node selected

- **WHEN** a node entry is selected
- **THEN** the inspector shows the node's name or index, its children count and its mesh reference when present

#### Scenario: Texture selected

- **WHEN** a texture-backed entry with an external image is selected
- **THEN** the inspector shows the image's URI and whether it is resolved or missing

### Requirement: Selecting a node frames it in the viewport

Selecting a node entry SHALL move the camera to frame that node's bounds
without otherwise changing the rendered scene; selecting a non-spatial
property SHALL NOT move the camera.

#### Scenario: Node focus

- **WHEN** a node with geometry is selected
- **THEN** the camera frames that node's bounding volume while the scene, lighting and materials stay unchanged

#### Scenario: Non-spatial selection

- **WHEN** a material or texture entry is selected
- **THEN** the camera keeps its current position and target

### Requirement: External resources expose their status

For every external buffer and image the document references, the explorer
SHALL show whether the resource is resolved or missing, and SHALL name
missing files.

#### Scenario: All references resolved

- **WHEN** every external reference was read successfully
- **THEN** the resources section reports all references as resolved and shows no warning

#### Scenario: Missing texture

- **WHEN** an external image could not be read
- **THEN** its entry is flagged as missing with the file name and the preview keeps the placeholder behavior

#### Scenario: Missing buffer

- **WHEN** an external buffer could not be read
- **THEN** the explorer still presents the document structure and flags the buffer as missing, while the preview shows no scene

### Requirement: Structure follows document reloads

When the shell reports an external change and the document reloads, the
explorer SHALL rebuild from the new content and SHALL NOT keep entries or
selection state from the previous version.

#### Scenario: External change while exploring

- **WHEN** the document changes on disk and the plugin reloads it
- **THEN** the explorer shows the new structure, any previous selection is cleared, and no stale entries remain

### Requirement: Exploring never edits the document

The structure explorer SHALL be read-only: browsing, expanding and
selecting entries SHALL NOT modify the document or report the editor
dirty. Only explicit reference-repair actions may edit the document.

#### Scenario: Save while exploring

- **WHEN** the shell requests a save with the explorer open and no reference edits
- **THEN** the written file is byte-for-byte unchanged and the tab shows no dirty indicator

### Requirement: Explorer disposal

When the shell disposes the editor frame, the explorer SHALL release its
state and make no further UI updates.

#### Scenario: Tab closed

- **WHEN** the tab holding the preview and explorer is closed
- **THEN** the frame acknowledges disposal and a reopened document builds a fresh explorer
