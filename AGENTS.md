# AGENTS.md

## What this repository is

`exo-gltf` is a plugin for the Exo editor. Its purpose is to make glTF
(`*.gltf`) and binary glTF (`*.glb`) files first-class citizens in the Exo
shell.

## Goals for the first iteration

- **Open** glb/gltf files from an Exo workspace.
- **Preview** the contents of the asset.
- **Explore** the structure of the asset — scenes, nodes, meshes, materials
  and the other concepts glTF files are built from — so users can orient
  themselves inside the file.
- **Perform small tweaks**, such as resolving missing external references
  (e.g. buffers or textures that the file points to but cannot find where it
  expects them).

## Out of scope (for now)

More powerful editing features, such as UV editing. They are a possible
direction once the first iteration above is solid, but they are explicitly
not part of the initial scope. Do not build towards them yet.

## Status

This repository is at the very beginning. The intentions above are settled;
the technical decisions needed to realize them are not. Do not treat any
technology, library, architecture, layout, tooling or hosting choice as
decided unless it has been agreed with the user and recorded in this
repository first.
