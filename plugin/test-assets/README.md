# Test assets

Curated sample files for manual verification of the plugin against the Exo
shell (and for future golden captures). Nothing here is shipped in
`plugin/dist`; the automated tests read these files offline.

Staging a workspace for a manual pass: copy one fixture directory's
contents into a workspace folder and open the `.gltf`/`.glb` file there.

| Fixture | Covers | Source | License |
|---|---|---|---|
| `damaged-helmet/DamagedHelmet.glb` | Self-contained GLB, PBR materials, embedded textures | [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DamagedHelmet) | CC-BY-4.0 and CC-BY-NC-4.0 (see upstream `LICENSE.md`) |
| `box-draco/Box.gltf` + `Box.bin` | Draco-compressed mesh with an external buffer | [Box, glTF-Draco](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box) | CC-BY-4.0 |
| `box-textured/` | `.gltf` with an external `.bin` and external PNG texture | [BoxTextured](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BoxTextured) | CC-BY-4.0 (texture contains the Cesium logo, see upstream notices) |
| `box-missing-texture/` | Same scene with `images[0].uri` pointed at `missing.png` — texture placeholder path | Derived from BoxTextured | CC-BY-4.0 |
| `missing-buffer/` | Valid JSON whose only buffer is missing — fatal missing-buffer path | Hand-written fixture | MIT (this repo) |

KTX2 verification is not covered by a vendored fixture (the smallest
upstream KTX2 sample is 12 MB); use any KTX2-textured asset when
verifying that decoder path manually.
