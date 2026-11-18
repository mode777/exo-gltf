# Third-party decoder assets

These files are vendored verbatim from the `three` npm package
(`three/examples/jsm/libs/`) so the plugin previews compressed glTF
payloads without third-party network requests (decision D-10).

| Directory | Origin | License |
|---|---|---|
| `draco/` | Draco 3D compression library (Google), shipped with three.js | Apache-2.0 |
| `basis/` | Basis Universal / KTX2 transcoder (Binomial), shipped with three.js | Apache-2.0 |

`three` itself is MIT-licensed. Re-copy these files when upgrading `three`.
