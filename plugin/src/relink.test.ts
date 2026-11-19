import { Document } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import type { ProbeResult } from './resources'
import {
  applyRelinks,
  refreshProbes,
  relinkOverrides,
  relinkState,
  relinkStatesEqual,
  type RelinkMap,
} from './relink'

function relinks(): RelinkMap {
  return new Map([
    [
      'missing.png',
      {
        path: '/models/assets/Logo.png',
        uri: 'assets/Logo.png',
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
    ['missing.bin', { path: '/models/assets/scene.bin', uri: 'assets/scene.bin', bytes: new Uint8Array([4]) }],
  ])
}

describe('applyRelinks', () => {
  it('rewrites every buffer and texture that used the original URI', () => {
    const document = new Document()
    document.createBuffer('buffer').setURI('missing.bin')
    const first = document.createTexture('one').setURI('missing.png')
    const second = document.createTexture('two').setURI('missing.png')
    document.createTexture('untouched').setURI('ok.png')

    applyRelinks(document, relinks())

    expect(document.getRoot().listBuffers()[0].getURI()).toBe('assets/scene.bin')
    expect(first.getURI()).toBe('assets/Logo.png')
    expect(second.getURI()).toBe('assets/Logo.png')
    expect(document.getRoot().listTextures()[2].getURI()).toBe('ok.png')
  })

  it('does nothing for an empty map', () => {
    const document = new Document()
    document.createTexture('one').setURI('missing.png')
    applyRelinks(document, new Map())
    expect(document.getRoot().listTextures()[0].getURI()).toBe('missing.png')
  })
})

describe('relinkOverrides', () => {
  it('keys the replacement bytes by the original URI', () => {
    const overrides = relinkOverrides(relinks())
    expect(Array.from(overrides.get('missing.png') ?? [])).toEqual([1, 2, 3])
    expect(Array.from(overrides.get('missing.bin') ?? [])).toEqual([4])
  })
})

describe('refreshProbes', () => {
  it('reports relinked references as resolved with their new URI and path', () => {
    const probes: ProbeResult[] = [
      { uri: 'missing.png', kind: 'image', path: '/models/missing.png', ok: false, code: 'not-found' },
      { uri: 'ok.png', kind: 'image', path: '/models/ok.png', ok: true },
    ]
    const refreshed = refreshProbes(probes, relinks())
    expect(refreshed[0]).toEqual({
      uri: 'assets/Logo.png',
      kind: 'image',
      path: '/models/assets/Logo.png',
      ok: true,
      code: undefined,
    })
    expect(refreshed[1]).toEqual(probes[1])
  })
})

describe('relink state', () => {
  it('compares the applied original-to-current mapping', () => {
    const state = relinkState(relinks())
    expect(relinkStatesEqual(state, relinkState(relinks()))).toBe(true)
    expect(relinkStatesEqual(state, new Map())).toBe(false)
    expect(relinkStatesEqual(state, new Map([['missing.png', 'other.png']]))).toBe(false)
  })
})
