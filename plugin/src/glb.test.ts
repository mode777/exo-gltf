import { describe, expect, it } from 'vitest'
import { GlbParseError, isGlb, readDocumentJson, readGlbJson } from './glb'

const MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a

function buildGlb(json: unknown, options: { version?: number; padByte?: number } = {}): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const paddedLength = Math.ceil(jsonBytes.length / 4) * 4
  const total = 12 + 8 + paddedLength
  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, options.version ?? 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, paddedLength, true)
  view.setUint32(16, CHUNK_JSON, true)
  bytes.fill(options.padByte ?? 0x20, 20)
  bytes.set(jsonBytes, 20)
  return buffer
}

function gltfBytes(json: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer
}

describe('isGlb', () => {
  it('detects the glTF magic', () => {
    expect(isGlb(buildGlb({ asset: { version: '2.0' } }))).toBe(true)
    expect(isGlb(gltfBytes({ asset: { version: '2.0' } }))).toBe(false)
    expect(isGlb(new ArrayBuffer(2))).toBe(false)
  })
})

describe('readGlbJson', () => {
  it('parses the JSON chunk of a valid container', () => {
    const json = { asset: { version: '2.0' }, buffers: [{ byteLength: 4 }] }
    expect(readGlbJson(buildGlb(json))).toEqual(json)
  })

  it('rejects a missing magic', () => {
    const buffer = buildGlb({})
    new DataView(buffer).setUint32(0, 0, true)
    expect(() => readGlbJson(buffer)).toThrow(GlbParseError)
  })

  it('rejects an unsupported version', () => {
    expect(() => readGlbJson(buildGlb({}, { version: 1 }))).toThrow(/version 1/)
  })

  it('rejects a truncated header', () => {
    expect(() => readGlbJson(new ArrayBuffer(8))).toThrow(/12-byte header/)
  })

  it('rejects a declared length beyond the read bytes', () => {
    const buffer = buildGlb({})
    new DataView(buffer).setUint32(8, buffer.byteLength + 8, true)
    expect(() => readGlbJson(buffer)).toThrow(/more bytes/)
  })

  it('rejects a chunk that overruns the container', () => {
    const buffer = buildGlb({})
    new DataView(buffer).setUint32(12, buffer.byteLength, true)
    expect(() => readGlbJson(buffer)).toThrow(/past the declared/)
  })

  it('rejects a container without a JSON chunk', () => {
    const buffer = buildGlb({})
    new DataView(buffer).setUint32(16, 0x004e4942, true) // 'BIN\0'
    expect(() => readGlbJson(buffer)).toThrow(/no JSON chunk/)
  })
})

describe('readDocumentJson', () => {
  it('reads .gltf JSON and .glb containers', () => {
    expect(readDocumentJson(gltfBytes({ asset: { version: '2.0' } }))).toEqual({
      json: { asset: { version: '2.0' } },
      container: 'gltf',
    })
    expect(readDocumentJson(buildGlb({ asset: { version: '2.0' } }))).toEqual({
      json: { asset: { version: '2.0' } },
      container: 'glb',
    })
  })

  it('rejects invalid JSON and non-object documents', () => {
    expect(() => readDocumentJson(new TextEncoder().encode('not json').buffer as ArrayBuffer)).toThrow(
      GlbParseError,
    )
    expect(() => readDocumentJson(gltfBytes([1, 2, 3]))).toThrow(/not a JSON object/)
  })
})
