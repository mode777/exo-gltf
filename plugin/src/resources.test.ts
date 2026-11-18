import { describe, expect, it } from 'vitest'
import {
  PLACEHOLDER_TEXTURE_DATA_URL,
  collectExternalReferences,
  normalizeWorkspacePath,
  prefetchReferences,
  resolveReferencePath,
  revokeResourceUrls,
  type ExternalReference,
} from './resources'

describe('collectExternalReferences', () => {
  it('collects external buffers and images with their indices', () => {
    const json = {
      buffers: [{ uri: 'scene.bin', byteLength: 10 }, { byteLength: 4 }],
      images: [{ uri: 'textures/albedo.png' }, { bufferView: 2, mimeType: 'image/png' }],
    }
    expect(collectExternalReferences(json)).toEqual([
      { uri: 'scene.bin', kind: 'buffer', index: 0 },
      { uri: 'textures/albedo.png', kind: 'image', index: 0 },
    ])
  })

  it('skips data URIs and documents without references', () => {
    expect(
      collectExternalReferences({ buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }] }),
    ).toEqual([])
    expect(collectExternalReferences({})).toEqual([])
    expect(collectExternalReferences({ buffers: 'nope', images: [null, 4] })).toEqual([])
  })
})

describe('normalizeWorkspacePath', () => {
  it('produces rooted, normalized paths', () => {
    expect(normalizeWorkspacePath('/a/b')).toBe('/a/b')
    expect(normalizeWorkspacePath('a/b')).toBe('/a/b')
    expect(normalizeWorkspacePath('/a/./b//c')).toBe('/a/b/c')
    expect(normalizeWorkspacePath('/a/../b')).toBe('/b')
  })

  it('rejects escapes and invalid characters', () => {
    expect(normalizeWorkspacePath('/../x')).toBeNull()
    expect(normalizeWorkspacePath('/a\\b')).toBeNull()
    expect(normalizeWorkspacePath('/a/\0b')).toBeNull()
  })
})

describe('resolveReferencePath', () => {
  it('resolves relative references against the document directory', () => {
    expect(resolveReferencePath('/models', 'scene.bin')).toBe('/models/scene.bin')
    expect(resolveReferencePath('/models', 'textures/a b.png')).toBe('/models/textures/a b.png')
    expect(resolveReferencePath('/models', 'textures/a%20b.png')).toBe('/models/textures/a b.png')
    expect(resolveReferencePath('/models/deep', '../shared/x.bin')).toBe('/models/shared/x.bin')
    expect(resolveReferencePath('/', 'scene.bin')).toBe('/scene.bin')
    expect(resolveReferencePath('/models', '/absolute/x.png')).toBe('/absolute/x.png')
  })

  it('rejects external schemes and root escapes', () => {
    expect(resolveReferencePath('/models', 'https://example.com/x.png')).toBeNull()
    expect(resolveReferencePath('/models', 'file:///etc/passwd')).toBeNull()
    expect(resolveReferencePath('/models', '../../x.bin')).toBeNull()
  })
})

describe('prefetchReferences', () => {
  const references: ExternalReference[] = [
    { uri: 'scene.bin', kind: 'buffer', index: 0 },
    { uri: 'tex/ok.png', kind: 'image', index: 0 },
    { uri: 'tex/missing.png', kind: 'image', index: 1 },
    { uri: 'missing.bin', kind: 'buffer', index: 1 },
  ]

  function fakeFiles(existing: Record<string, Uint8Array>) {
    return {
      readFile: async (path: string, _encoding: 'binary'): Promise<{ bytes: ArrayBuffer }> => {
        const bytes = existing[path]
        if (!bytes) throw Object.assign(new Error('not found'), { code: 'not-found' })
        const copy = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(copy).set(bytes)
        return { bytes: copy }
      },
    }
  }

  it('maps readable references, placeholders for missing textures, and fatal missing buffers', async () => {
    const files = fakeFiles({
      '/models/scene.bin': new Uint8Array([1, 2, 3]),
      '/models/tex/ok.png': new Uint8Array([9]),
    })
    const result = await prefetchReferences(files, '/models', references, {
      createObjectUrl: (bytes) => `blob:fake/${bytes.byteLength}`,
    })
    expect(result.urls.get('scene.bin')).toBe('blob:fake/3')
    expect(result.urls.get('tex/ok.png')).toBe('blob:fake/1')
    expect(result.urls.get('tex/missing.png')).toBe(PLACEHOLDER_TEXTURE_DATA_URL)
    expect(result.urls.has('missing.bin')).toBe(false)
    expect(result.missingBuffers.map((probe) => probe.uri)).toEqual(['missing.bin'])
    expect(result.missingBuffers[0].code).toBe('not-found')
    expect(result.probes.filter((probe) => probe.ok)).toHaveLength(2)
  })

  it('records unsupported schemes without reading', async () => {
    const files = {
      readFile: async () => {
        throw new Error('should not be called')
      },
    }
    const result = await prefetchReferences(
      files,
      '/models',
      [{ uri: 'https://cdn.example.com/tex.png', kind: 'image', index: 0 }],
    )
    expect(result.probes[0]).toMatchObject({ ok: false, code: 'unsupported' })
    expect(result.urls.has('https://cdn.example.com/tex.png')).toBe(false)
  })

  it('respects the concurrency bound', async () => {
    let inFlight = 0
    let peak = 0
    const files = {
      readFile: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return { bytes: new ArrayBuffer(1) }
      },
    }
    const many: ExternalReference[] = Array.from({ length: 24 }, (_, index) => ({
      uri: `tex/${index}.png`,
      kind: 'image' as const,
      index,
    }))
    await prefetchReferences(files, '/m', many, { concurrency: 6, createObjectUrl: () => 'blob:x' })
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
  })
})

describe('revokeResourceUrls', () => {
  it('clears the map and leaves data URLs alone', () => {
    const revokeCalls: string[] = []
    const original = URL.revokeObjectURL
    // Node has no blob URL support; stub it for this check.
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: (url: string) => revokeCalls.push(url),
    })
    try {
      const urls = new Map<string, string>([
        ['a', 'blob:one'],
        ['b', PLACEHOLDER_TEXTURE_DATA_URL],
      ])
      revokeResourceUrls(urls)
      expect(revokeCalls).toEqual(['blob:one'])
      expect(urls.size).toBe(0)
    } finally {
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: original })
    }
  })
})
