import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDocument } from './document'
import { readDocumentJson } from './glb'
import { collectExternalReferences, prefetchReferences, type PrefetchResult } from './resources'
import {
  SerializationError,
  copySaveContent,
  formatForFileName,
  saveContentBytes,
  serializeDocument,
} from './serialization'
import { isGlb } from './glb'

const root = fileURLToPath(new URL('..', import.meta.url))
const assets = join(root, 'test-assets')

function fixtureBytes(path: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(join(assets, path))) as Uint8Array<ArrayBuffer>
}

function fixtureReader(directory: string) {
  return {
    readFile: async (path: string, _encoding: 'binary'): Promise<{ bytes: ArrayBuffer }> => {
      const prefix = '/models/'
      if (!path.startsWith(prefix)) throw Object.assign(new Error('not found'), { code: 'not-found' })
      try {
        const bytes = readFileSync(join(assets, directory, path.slice(prefix.length)))
        const copy = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(copy).set(bytes)
        return { bytes: copy }
      } catch {
        throw Object.assign(new Error('not found'), { code: 'not-found' })
      }
    },
  }
}

async function parsedFixture(directory: string, file: string) {
  const bytes = fixtureBytes(`${directory}/${file}`)
  const { json } = readDocumentJson(bytes.buffer as ArrayBuffer)
  const prefetch = await prefetchReferences(
    fixtureReader(directory),
    '/models',
    collectExternalReferences(json),
    { createObjectUrl: (buffer) => `blob:fake/${buffer.byteLength}` },
  )
  const parsed = await parseDocument(bytes, prefetch)
  if (!parsed.document) throw new Error(parsed.error ?? 'fixture did not parse')
  return { document: parsed.document, prefetch, bytes }
}

describe('formatForFileName', () => {
  it('detects GLB case-insensitively and defaults to glTF text', () => {
    expect(formatForFileName('Model.GLB')).toBe('glb')
    expect(formatForFileName('model.glb')).toBe('glb')
    expect(formatForFileName('model.gltf')).toBe('gltf')
    expect(formatForFileName('model.gltf.backup')).toBe('gltf')
  })
})

describe('serializeDocument', () => {
  it('writes a .gltf as pretty-printed text that keeps external URIs', async () => {
    const { document } = await parsedFixture('box-textured', 'BoxTextured.gltf')
    const content = await serializeDocument(document, { format: 'gltf' })

    if (!('text' in content)) throw new Error('expected text content')
    expect(content.text).toContain('\n  "asset"')
    const json = JSON.parse(content.text) as {
      buffers: Array<{ uri?: string }>
      images: Array<{ uri?: string }>
    }
    expect(json.buffers[0].uri).toBe('BoxTextured0.bin')
    expect(json.images[0].uri).toBe('CesiumLogoFlat.png')
  })

  it('writes a .glb as binary that reopens with the same structure', async () => {
    const { document } = await parsedFixture('box-textured', 'BoxTextured.gltf')
    const content = await serializeDocument(document, { format: 'glb' })
    if (!('bytes' in content)) throw new Error('expected binary content')
    expect(isGlb(content.bytes)).toBe(true)

    const reopened = await parseDocument(new Uint8Array(content.bytes), {
      urls: new Map(),
      raw: new Map(),
      probes: [],
      missingBuffers: [],
    })
    expect(reopened.error).toBeNull()
    expect(reopened.document!.getRoot().listMeshes()).toHaveLength(1)
    expect(reopened.document!.getRoot().listNodes()).toHaveLength(2)
  })

  it('keeps an unresolved external URI in .gltf text and writes no placeholder', async () => {
    const sourceBytes = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'missing.bin', byteLength: 12 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'SCALAR' }],
      }),
    ) as Uint8Array<ArrayBuffer>
    const prefetch: PrefetchResult = {
      urls: new Map(),
      raw: new Map(),
      probes: [
        {
          uri: 'missing.bin',
          kind: 'buffer',
          path: '/models/missing.bin',
          ok: false,
          code: 'not-found',
        },
      ],
      missingBuffers: [],
    }
    const parsed = await parseDocument(sourceBytes, prefetch)
    const content = await serializeDocument(parsed.document!, {
      format: 'gltf',
      unresolved: prefetch.probes.filter((probe) => !probe.ok),
    })
    if (!('text' in content)) throw new Error('expected text content')
    const json = JSON.parse(content.text) as {
      buffers: Array<{ uri?: string; byteLength?: number }>
    }
    expect(json.buffers[0].uri).toBe('missing.bin')
    expect(content.text).not.toContain('data:application/octet-stream')
  })

  it('refuses to embed an unresolved reference in a .glb', async () => {
    const { document } = await parsedFixture('box-missing-texture', 'BoxTextured.gltf')
    const missing = {
      uri: 'missing.png',
      kind: 'image' as const,
      path: '/models/missing.png',
      ok: false,
      code: 'not-found',
    }
    await expect(
      serializeDocument(document, { format: 'glb', unresolved: [missing] }),
    ).rejects.toMatchObject({ code: 'unresolved' })
  })

  it('preserves a registered extension when re-serializing', async () => {
    const { document } = await parsedFixture('chronograph-watch', 'ChronographWatch.gltf')
    const content = await serializeDocument(document, { format: 'gltf' })
    if (!('text' in content)) throw new Error('expected text content')
    const json = JSON.parse(content.text) as { extensionsUsed?: string[] }
    expect(json.extensionsUsed).toContain('KHR_texture_basisu')
  })

  it('refuses to write a document with an unsupported extension', async () => {
    const { document } = await parsedFixture('box-textured', 'BoxTextured.gltf')
    await expect(
      serializeDocument(document, {
        format: 'gltf',
        unsupportedExtensions: ['KHR_draco_mesh_compression'],
      }),
    ).rejects.toBeInstanceOf(SerializationError)
  })
})

describe('save content copies', () => {
  it('copies binary content so a transferred buffer cannot corrupt the cache', () => {
    const source = { bytes: new Uint8Array([1, 2, 3]).buffer }
    const copy = copySaveContent(source)
    if (!('bytes' in copy)) throw new Error('expected binary content')
    new Uint8Array(copy.bytes)[0] = 9
    expect(Array.from(new Uint8Array(source.bytes))).toEqual([1, 2, 3])
  })

  it('encodes text content to UTF-8 bytes', () => {
    expect(Array.from(saveContentBytes({ text: 'abc' }))).toEqual([97, 98, 99])
  })
})
