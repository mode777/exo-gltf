/**
 * Minimal GLB container reader.
 *
 * A GLB is a 12-byte header (magic, version, total length) followed by
 * chunks of `{ length, type, data }`. The first chunk is always JSON; a
 * second BIN chunk may follow. M1 only needs the JSON chunk to discover
 * external `images[].uri` references (buffers are required to be embedded
 * in GLB), and to hand the container to the three.js loader untouched.
 */

const GLB_MAGIC = 0x46546c67 // 'glTF' little-endian
const CHUNK_JSON = 0x4e4f534a // 'JSON'
const GLB_VERSION = 2

export class GlbParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GlbParseError'
  }
}

export function isGlb(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false
  return new DataView(bytes).getUint32(0, true) === GLB_MAGIC
}

/**
 * Reads and parses the JSON chunk of a GLB. Throws `GlbParseError` for a
 * malformed container; never validates the glTF document itself.
 */
export function readGlbJson(bytes: ArrayBuffer): unknown {
  if (bytes.byteLength < 12) {
    throw new GlbParseError('GLB is shorter than its 12-byte header.')
  }
  const view = new DataView(bytes)
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new GlbParseError('GLB magic is missing.')
  }
  const version = view.getUint32(4, true)
  if (version !== GLB_VERSION) {
    throw new GlbParseError(`Unsupported GLB version ${version}.`)
  }
  const totalLength = view.getUint32(8, true)
  if (totalLength > bytes.byteLength) {
    throw new GlbParseError('GLB header declares more bytes than were read.')
  }

  let offset = 12
  while (offset + 8 <= totalLength) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const dataStart = offset + 8
    const dataEnd = dataStart + chunkLength
    if (dataEnd > totalLength) {
      throw new GlbParseError('GLB chunk extends past the declared container length.')
    }
    if (chunkType === CHUNK_JSON) {
      const text = new TextDecoder().decode(new Uint8Array(bytes, dataStart, chunkLength))
      try {
        return JSON.parse(text)
      } catch {
        throw new GlbParseError('GLB JSON chunk is not valid JSON.')
      }
    }
    offset = dataEnd
  }
  throw new GlbParseError('GLB has no JSON chunk.')
}

export interface DocumentJson {
  json: Record<string, unknown>
  container: 'glb' | 'gltf'
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GlbParseError('The glTF document is not a JSON object.')
  }
  return value as Record<string, unknown>
}

/** Parses either a `.gltf` (UTF-8 JSON) or a `.glb` (binary container). */
export function readDocumentJson(bytes: ArrayBuffer): DocumentJson {
  const glb = isGlb(bytes)
  const raw = glb ? readGlbJson(bytes) : parseGltfJson(bytes)
  return { json: asRecord(raw), container: glb ? 'glb' : 'gltf' }
}

function parseGltfJson(bytes: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new GlbParseError('The .gltf file is not valid JSON.')
  }
}
