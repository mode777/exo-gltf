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

interface GlbChunk {
  type: number
  data: Uint8Array
}

function readGlbChunks(bytes: ArrayBuffer): GlbChunk[] {
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

  const chunks: GlbChunk[] = []
  let offset = 12
  while (offset + 8 <= totalLength) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const dataStart = offset + 8
    const dataEnd = dataStart + chunkLength
    if (dataEnd > totalLength) {
      throw new GlbParseError('GLB chunk extends past the declared container length.')
    }
    chunks.push({ type: chunkType, data: new Uint8Array(bytes, dataStart, chunkLength) })
    offset = dataEnd
  }
  return chunks
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
  const chunks = readGlbChunks(bytes)
  for (const chunk of chunks) {
    if (chunk.type !== CHUNK_JSON) continue
    const text = new TextDecoder().decode(chunk.data)
    try {
      return JSON.parse(text)
    } catch {
      throw new GlbParseError('GLB JSON chunk is not valid JSON.')
    }
  }
  throw new GlbParseError('GLB has no JSON chunk.')
}

/**
 * Rebuilds a GLB with a replacement JSON chunk, preserving every other chunk
 * byte-for-byte. Used only to make a read-only document browsable when a
 * required extension has no decoder; the original bytes stay authoritative
 * for preview and save.
 */
export function rewriteGlbJson(bytes: ArrayBuffer, json: unknown): ArrayBuffer {
  const chunks = readGlbChunks(bytes)
  const jsonChunkIndex = chunks.findIndex((chunk) => chunk.type === CHUNK_JSON)
  if (jsonChunkIndex === -1) throw new GlbParseError('GLB has no JSON chunk.')

  const encoded = new TextEncoder().encode(JSON.stringify(json))
  chunks[jsonChunkIndex] = { type: CHUNK_JSON, data: encoded }

  const paddedLength = (length: number): number => Math.ceil(length / 4) * 4
  const totalLength =
    12 +
    chunks.reduce((sum, chunk) => sum + 8 + paddedLength(chunk.data.byteLength), 0)
  const output = new ArrayBuffer(totalLength)
  const view = new DataView(output)
  const out = new Uint8Array(output)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, GLB_VERSION, true)
  view.setUint32(8, totalLength, true)

  let offset = 12
  for (const chunk of chunks) {
    const length = paddedLength(chunk.data.byteLength)
    view.setUint32(offset, length, true)
    view.setUint32(offset + 4, chunk.type, true)
    out.set(chunk.data, offset + 8)
    // JSON is space-padded, binary chunks are zero-padded (glTF 2.0 §4.4.2).
    out.fill(chunk.type === CHUNK_JSON ? 0x20 : 0, offset + 8 + chunk.data.byteLength, offset + 8 + length)
    offset += 8 + length
  }
  return output
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
