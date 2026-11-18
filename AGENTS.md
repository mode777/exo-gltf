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

## Skill: create-exo-plugin

This repository vendors the `create-exo-plugin` skill at
[`.agents/skills/create-exo-plugin/SKILL.md`](.agents/skills/create-exo-plugin/SKILL.md),
copied verbatim from
[mode777/exo-editor](https://github.com/mode777/exo-editor/blob/main/.agents/skills/create-exo-plugin/SKILL.md).

Use this skill whenever the plugin is scaffolded, built, tested or deployed:
it encodes the Exo plugin contracts and workflow. Keep the vendored copy
unmodified so it can be diffed and refreshed against upstream.

## Status

The first iteration's technical decisions are settled and recorded in
[`docs/decisions.md`](docs/decisions.md) — treat that register as
authoritative for stack, architecture, layout, tooling and hosting. The
milestone plan lives in [`docs/roadmap.md`](docs/roadmap.md); work is
managed as OpenSpec changes under `openspec/changes/`. The M3
(reference-tweaks) milestone is blocked on an upstream exo-editor API ask
tracked in [`docs/exo-editor-api-request.md`](docs/exo-editor-api-request.md).

For anything the register does not already cover, the rule stands: do not
treat any technology, library, architecture, layout, tooling or hosting
choice as decided unless it has been agreed with the user and recorded in
this repository first.
