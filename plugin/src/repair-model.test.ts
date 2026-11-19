import { Document } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { buildRepairModel } from './repair-model'
import type { RelinkMap } from './relink'
import type { ProbeResult } from './resources'

function probes(): ProbeResult[] {
  return [
    { uri: 'missing.bin', kind: 'buffer', path: '/models/missing.bin', ok: false, code: 'not-found' },
    { uri: 'missing.png', kind: 'image', path: '/models/missing.png', ok: false, code: 'not-found' },
    { uri: 'ok.png', kind: 'image', path: '/models/ok.png', ok: true },
  ]
}

function documentWithReferences(): Document {
  const document = new Document()
  document.createBuffer('buffer').setURI('missing.bin')
  document.createTexture('one').setURI('missing.png')
  document.createTexture('two').setURI('missing.png')
  document.createTexture('resolved').setURI('ok.png')
  return document
}

describe('buildRepairModel', () => {
  it('lists one row per URI with every target for shared URIs', () => {
    const model = buildRepairModel(documentWithReferences(), probes(), new Map())

    expect(model.items.map((item) => item.originalUri)).toEqual([
      'missing.bin',
      'missing.png',
      'ok.png',
    ])
    expect(model.missing.map((item) => item.originalUri)).toEqual(['missing.bin', 'missing.png'])
    expect(model.relinked).toEqual([])
    expect(model.isEmpty).toBe(false)

    const shared = model.items[1]
    expect(shared.kind).toBe('image')
    expect(shared.status).toBe('missing')
    expect(shared.code).toBe('not-found')
    expect(shared.path).toBe('/models/missing.png')
    expect(shared.targets).toHaveLength(2)
    expect(shared.targets.map((target) => target.index)).toEqual([0, 1])
  })

  it('marks a relinked row resolved and reports its new URI and path', () => {
    const relinks: RelinkMap = new Map([
      [
        'missing.png',
        {
          path: '/models/assets/Logo.png',
          uri: 'assets/Logo.png',
          bytes: new Uint8Array([1]),
        },
      ],
    ])
    const model = buildRepairModel(documentWithReferences(), probes(), relinks)

    const relinked = model.items.find((item) => item.originalUri === 'missing.png')!
    expect(relinked.status).toBe('resolved')
    expect(relinked.relinked).toBe(true)
    expect(relinked.uri).toBe('assets/Logo.png')
    expect(relinked.path).toBe('/models/assets/Logo.png')
    expect(model.missing.map((item) => item.originalUri)).toEqual(['missing.bin'])
    expect(model.relinked.map((item) => item.originalUri)).toEqual(['missing.png'])
  })

  it('returns to the missing state when the relink is reverted', () => {
    const relinks: RelinkMap = new Map([
      ['missing.png', { path: '/models/ok.png', uri: 'ok.png', bytes: new Uint8Array([1]) }],
    ])
    const applied = buildRepairModel(documentWithReferences(), probes(), relinks)
    expect(applied.missing.map((item) => item.originalUri)).toEqual(['missing.bin'])

    const reverted = buildRepairModel(documentWithReferences(), probes(), new Map())
    expect(reverted.missing.map((item) => item.originalUri)).toEqual(['missing.bin', 'missing.png'])
    expect(reverted.relinked).toEqual([])
  })

  it('reports an empty model for documents without external references', () => {
    const model = buildRepairModel(new Document(), [], new Map())
    expect(model.items).toEqual([])
    expect(model.missing).toEqual([])
    expect(model.isEmpty).toBe(true)
  })
})
