import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readDocumentJson } from './glb'
import { collectExternalReferences, resolveReferencePath } from './resources'

const root = fileURLToPath(new URL('..', import.meta.url))
const asset = (path: string): ArrayBuffer => {
  const bytes = readFileSync(join(root, 'test-assets', path))
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

describe('curated fixtures', () => {
  it('DamagedHelmet is a self-contained GLB', () => {
    const { json, container } = readDocumentJson(asset('damaged-helmet/DamagedHelmet.glb'))
    expect(container).toBe('glb')
    expect(collectExternalReferences(json)).toEqual([])
  })

  it('Box uses Draco compression with an external buffer', () => {
    const { json, container } = readDocumentJson(asset('box-draco/Box.gltf'))
    expect(container).toBe('gltf')
    expect(json.extensionsUsed).toContain('KHR_draco_mesh_compression')
    expect(collectExternalReferences(json)).toEqual([{ uri: 'Box.bin', kind: 'buffer', index: 0 }])
    expect(resolveReferencePath('/models', 'Box.bin')).toBe('/models/Box.bin')
  })

  it('BoxTextured references an external buffer and texture', () => {
    const { json } = readDocumentJson(asset('box-textured/BoxTextured.gltf'))
    const references = collectExternalReferences(json)
    expect(references.map((reference) => reference.uri).sort()).toEqual([
      'BoxTextured0.bin',
      'CesiumLogoFlat.png',
    ])
  })

  it('Box with a missing texture still references an existing buffer', () => {
    const { json } = readDocumentJson(asset('box-missing-texture/BoxTextured.gltf'))
    const references = collectExternalReferences(json)
    expect(references.find((reference) => reference.kind === 'image')?.uri).toBe('missing.png')
    expect(references.find((reference) => reference.kind === 'buffer')?.uri).toBe('BoxTextured0.bin')
  })

  it('the missing-buffer fixture is parseable JSON with one broken buffer', () => {
    const { json } = readDocumentJson(asset('missing-buffer/scene.gltf'))
    const references = collectExternalReferences(json)
    expect(references).toEqual([{ uri: 'missing.bin', kind: 'buffer', index: 0 }])
  })

  it('the relink fixture has both references missing and replacement candidates present', () => {
    const { json } = readDocumentJson(asset('relink/BoxTextured.gltf'))
    const references = collectExternalReferences(json)
    expect(references).toEqual([
      { uri: 'missing.bin', kind: 'buffer', index: 0 },
      { uri: 'missing.png', kind: 'image', index: 0 },
    ])
    expect(existsSync(join(root, 'test-assets', 'relink', 'missing.bin'))).toBe(false)
    expect(existsSync(join(root, 'test-assets', 'relink', 'missing.png'))).toBe(false)
    expect(existsSync(join(root, 'test-assets', 'relink', 'assets', 'BoxTextured0.bin'))).toBe(true)
    expect(existsSync(join(root, 'test-assets', 'relink', 'assets', 'CesiumLogoFlat.png'))).toBe(true)
    expect(existsSync(join(root, 'test-assets', 'relink', 'assets', 'Box #1.png'))).toBe(true)
  })
})
