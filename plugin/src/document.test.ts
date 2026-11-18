import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDocument } from './document'
import { readDocumentJson } from './glb'
import { collectExternalReferences, prefetchReferences, type PrefetchResult } from './resources'

const root = fileURLToPath(new URL('..', import.meta.url))
const assets = join(root, 'test-assets')

function fixtureBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(assets, path)))
}

function fixtureReader(directory: string) {
  return {
    readFile: async (path: string, _encoding: 'binary'): Promise<{ bytes: ArrayBuffer }> => {
      const prefix = `/models/`
      if (!path.startsWith(prefix)) throw Object.assign(new Error('not found'), { code: 'not-found' })
      const relative = join(assets, directory, path.slice(prefix.length))
      if (!existsSync(relative)) throw Object.assign(new Error('not found'), { code: 'not-found' })
      const bytes = readFileSync(relative)
      const copy = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(copy).set(bytes)
      return { bytes: copy }
    },
  }
}

async function prefetchFixture(directory: string, document: string): Promise<{
  bytes: Uint8Array
  prefetch: PrefetchResult
}> {
  const bytes = fixtureBytes(`${directory}/${document}`)
  const { json } = readDocumentJson(bytes.buffer as ArrayBuffer)
  const references = collectExternalReferences(json)
  const prefetch = await prefetchReferences(fixtureReader(directory), '/models', references, {
    createObjectUrl: (buffer) => `blob:fake/${buffer.byteLength}`,
  })
  return { bytes, prefetch }
}

describe('parseDocument', () => {
  it('parses a .gltf with external buffers and images from the pre-fetch result', async () => {
    const { bytes, prefetch } = await prefetchFixture('box-textured', 'BoxTextured.gltf')
    const { document, error } = await parseDocument(bytes, prefetch)

    expect(error).toBeNull()
    expect(document).not.toBeNull()
    const rootNode = document!.getRoot()
    expect(rootNode.listNodes()).toHaveLength(2)
    expect(rootNode.listMeshes()).toHaveLength(1)
    expect(rootNode.listMaterials()).toHaveLength(1)
    expect(rootNode.listTextures()[0].getURI()).toBe('CesiumLogoFlat.png')
    expect(rootNode.listTextures()[0].getImage()).not.toBeNull()
    expect(rootNode.listBuffers()[0].getURI()).toBe('BoxTextured0.bin')
    expect(prefetch.raw.get('BoxTextured0.bin')?.byteLength ?? 0).toBeGreaterThan(0)
    expect(rootNode.listAccessors()[0].getArray()).not.toBeNull()
  })

  it('parses a self-contained GLB', async () => {
    const bytes = fixtureBytes('damaged-helmet/DamagedHelmet.glb')
    const { document, error } = await parseDocument(bytes, {
      urls: new Map(),
      raw: new Map(),
      probes: [],
      missingBuffers: [],
    })

    expect(error).toBeNull()
    expect(document).not.toBeNull()
    expect(document!.getRoot().listNodes().length).toBeGreaterThan(0)
    expect(document!.getRoot().listMeshes().length).toBeGreaterThan(0)
  })

  it('keeps parsing with an empty resource for a missing texture', async () => {
    const { bytes, prefetch } = await prefetchFixture('box-missing-texture', 'BoxTextured.gltf')
    const { document, error } = await parseDocument(bytes, prefetch)

    expect(error).toBeNull()
    expect(document).not.toBeNull()
    const texture = document!.getRoot().listTextures()[0]
    expect(texture.getURI()).toBe('missing.png')
    expect(texture.getImage()?.byteLength).toBe(0)
  })

  it('keeps parsing with a zero-filled buffer for a missing buffer', async () => {
    const bytes = fixtureBytes('missing-buffer/scene.gltf')
    const prefetch: PrefetchResult = {
      urls: new Map(),
      raw: new Map(),
      probes: [{ uri: 'missing.bin', kind: 'buffer', path: '/models/missing.bin', ok: false, code: 'not-found' }],
      missingBuffers: [
        { uri: 'missing.bin', kind: 'buffer', path: '/models/missing.bin', ok: false, code: 'not-found' },
      ],
    }
    const { document, error } = await parseDocument(bytes, prefetch)

    expect(error).toBeNull()
    expect(document).not.toBeNull()
    expect(document!.getRoot().listBuffers()[0].getURI()).toBe('missing.bin')

    // A document whose accessor needs the missing bytes parses with zeros of
    // the declared length, so the structure stays browsable.
    const synthetic = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'missing.bin', byteLength: 12 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'SCALAR' }],
      }),
    )
    const fallback = await parseDocument(synthetic, prefetch)
    expect(fallback.error).toBeNull()
    const array = fallback.document!.getRoot().listAccessors()[0].getArray() as Float32Array
    expect(Array.from(array)).toEqual([0])
  })

  it('reports invalid input instead of throwing', async () => {
    const { document, error } = await parseDocument(new TextEncoder().encode('not a gltf document'), {
      urls: new Map(),
      raw: new Map(),
      probes: [],
      missingBuffers: [],
    })

    expect(document).toBeNull()
    expect(error).toContain('not valid JSON')
  })
})
