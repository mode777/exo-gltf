import { describe, expect, it } from 'vitest'
import type { PrefetchResult } from './resources'
import {
  RelinkError,
  pickReplacement,
  planRelink,
  planRevert,
  type PickerEditor,
} from './relink-workflow'

function documentBytes(json: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(json)) as Uint8Array<ArrayBuffer>
}

function prefetchFor(uri: string, kind: 'buffer' | 'image'): PrefetchResult {
  const probe = { uri, kind, path: `/models/${uri}`, ok: false, code: 'not-found' } as const
  return {
    urls: new Map(),
    raw: new Map(),
    probes: [probe],
    missingBuffers: kind === 'buffer' ? [probe] : [],
  }
}

function readerFor(bytes: Uint8Array): { readFile: (path: string, encoding: 'binary') => Promise<{ bytes: ArrayBuffer }>; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    readFile: async (path) => {
      calls.push(path)
      const copy = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(copy).set(bytes)
      return { bytes: copy }
    },
  }
}

function missingImageDocument(): Uint8Array<ArrayBuffer> {
  return documentBytes({
    asset: { version: '2.0' },
    images: [{ uri: 'missing.png' }, { uri: 'missing.png' }],
    textures: [{ source: 0 }, { source: 1 }],
    materials: [
      { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { pbrMetallicRoughness: { baseColorTexture: { index: 1 } } },
    ],
  })
}

describe('pickReplacement', () => {
  it('returns the picked path', async () => {
    const editor: PickerEditor = {
      capabilities: { filePicker: true, requestFiles: true },
      requestFiles: async (options) => {
        expect(options).toMatchObject({ multiple: false, directory: '/models/assets' })
        return ['/models/assets/Logo.png']
      },
    }
    await expect(pickReplacement(editor, '/models/assets')).resolves.toEqual({
      status: 'picked',
      path: '/models/assets/Logo.png',
    })
  })

  it('treats an empty selection as cancellation', async () => {
    const editor: PickerEditor = {
      capabilities: { filePicker: true, requestFiles: true },
      requestFiles: async () => [],
    }
    await expect(pickReplacement(editor, '/models')).resolves.toEqual({ status: 'cancelled' })
  })

  it('does not call the picker on an old shell', async () => {
    let called = false
    const editor: PickerEditor = {
      capabilities: { filePicker: false, requestFiles: true },
      requestFiles: async () => {
        called = true
        return []
      },
    }
    await expect(pickReplacement(editor, '/models')).resolves.toEqual({ status: 'unsupported' })
    expect(called).toBe(false)
  })

  it('falls back when the shell rejects the message as unsupported', async () => {
    const editor: PickerEditor = {
      capabilities: { filePicker: true, requestFiles: true },
      requestFiles: async () => {
        throw Object.assign(new Error('unsupported'), { code: 'unsupported-message' })
      },
    }
    await expect(pickReplacement(editor, '/models')).resolves.toEqual({ status: 'unsupported' })
  })

  it('rethrows rate limits instead of switching modes', async () => {
    const editor: PickerEditor = {
      capabilities: { filePicker: true, requestFiles: true },
      requestFiles: async () => {
        throw Object.assign(new Error('busy'), { code: 'rate-limited' })
      },
    }
    await expect(pickReplacement(editor, '/models')).rejects.toMatchObject({ code: 'rate-limited' })
  })
})

describe('planRelink', () => {
  it('reads the picked file and rewrites every reference sharing the URI', async () => {
    const sourceBytes = missingImageDocument()
    const prefetch = prefetchFor('missing.png', 'image')
    const reader = readerFor(new Uint8Array([137, 80, 78, 71]))

    const plan = await planRelink({
      sourceBytes,
      prefetch,
      relinks: new Map(),
      item: { originalUri: 'missing.png' },
      documentDir: '/models',
      targetPath: '/models/assets/Logo.png',
      ...reader,
    })

    expect(reader.calls).toEqual(['/models/assets/Logo.png'])
    expect(plan.relinks.get('missing.png')).toMatchObject({
      path: '/models/assets/Logo.png',
      uri: 'assets/Logo.png',
    })
    expect(plan.document.getRoot().listTextures().map((texture) => texture.getURI())).toEqual([
      'assets/Logo.png',
      'assets/Logo.png',
    ])
    const repaired = plan.repair.items.find((item) => item.originalUri === 'missing.png')!
    expect(repaired.status).toBe('resolved')
    expect(repaired.relinked).toBe(true)
    expect(repaired.targets).toHaveLength(2)
  })

  it('normalizes a relative manual path against the document directory', async () => {
    const sourceBytes = missingImageDocument()
    const reader = readerFor(new Uint8Array([1]))
    const plan = await planRelink({
      sourceBytes,
      prefetch: prefetchFor('missing.png', 'image'),
      relinks: new Map(),
      item: { originalUri: 'missing.png' },
      documentDir: '/models/deep',
      targetPath: 'assets/Logo.png',
      ...reader,
    })
    expect(reader.calls).toEqual(['/models/deep/assets/Logo.png'])
    expect(plan.relinks.get('missing.png')?.uri).toBe('assets/Logo.png')
  })

  it('surfaces a read failure without changing the plan', async () => {
    const error = Object.assign(new Error('missing'), { code: 'not-found' })
    const reader = {
      readFile: async () => {
        throw error
      },
    }
    await expect(
      planRelink({
        sourceBytes: missingImageDocument(),
        prefetch: prefetchFor('missing.png', 'image'),
        relinks: new Map(),
        item: { originalUri: 'missing.png' },
        documentDir: '/models',
        targetPath: '/models/nope.png',
        ...reader,
      }),
    ).rejects.toMatchObject({ code: 'not-found', path: '/models/nope.png' })
  })

  it('rejects an empty replacement file', async () => {
    await expect(
      planRelink({
        sourceBytes: missingImageDocument(),
        prefetch: prefetchFor('missing.png', 'image'),
        relinks: new Map(),
        item: { originalUri: 'missing.png' },
        documentDir: '/models',
        targetPath: '/models/empty.png',
        ...readerFor(new Uint8Array(0)),
      }),
    ).rejects.toMatchObject({ code: 'empty-file' })
  })

  it('rejects a buffer replacement the document cannot parse', async () => {
    const sourceBytes = documentBytes({
      asset: { version: '2.0' },
      buffers: [{ uri: 'missing.bin', byteLength: 12 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'SCALAR' }],
    })
    const failure = planRelink({
      sourceBytes,
      prefetch: prefetchFor('missing.bin', 'buffer'),
      relinks: new Map(),
      item: { originalUri: 'missing.bin' },
      documentDir: '/models',
      targetPath: '/models/short.bin',
      ...readerFor(new Uint8Array(2)),
    })
    await expect(failure).rejects.toBeInstanceOf(RelinkError)
    await expect(failure).rejects.toMatchObject({ code: 'invalid-document', path: '/models/short.bin' })
  })

  it('rejects an invalid workspace path before reading', async () => {
    const reader = readerFor(new Uint8Array([1]))
    await expect(
      planRelink({
        sourceBytes: missingImageDocument(),
        prefetch: prefetchFor('missing.png', 'image'),
        relinks: new Map(),
        item: { originalUri: 'missing.png' },
        documentDir: '/models',
        targetPath: '/../escape.png',
        ...reader,
      }),
    ).rejects.toMatchObject({ code: 'invalid-path' })
    expect(reader.calls).toEqual([])
  })
})

describe('planRevert', () => {
  it('restores the original URI and missing status without reading', async () => {
    const sourceBytes = missingImageDocument()
    const prefetch = prefetchFor('missing.png', 'image')
    const applied = await planRelink({
      sourceBytes,
      prefetch,
      relinks: new Map(),
      item: { originalUri: 'missing.png' },
      documentDir: '/models',
      targetPath: '/models/assets/Logo.png',
      ...readerFor(new Uint8Array([1, 2])),
    })

    const reverted = await planRevert({
      sourceBytes,
      prefetch,
      relinks: applied.relinks,
      originalUri: 'missing.png',
    })

    expect(reverted.relinks.size).toBe(0)
    expect(reverted.document.getRoot().listTextures().map((texture) => texture.getURI())).toEqual([
      'missing.png',
      'missing.png',
    ])
    expect(reverted.repair.missing.map((item) => item.originalUri)).toEqual(['missing.png'])
    expect(reverted.repair.relinked).toEqual([])
  })
})
