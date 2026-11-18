import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

interface Manifest {
  schemaVersion: number
  id: string
  name: string
  version: string
  license?: string
  publisher: { name: string }
  engines: { exo: string }
  permissions: string[]
  runtime: { entry: string }
  contributes: {
    fileEditors: Array<{
      glob: string
      entry: string
      label: string
      priority?: number
      rendering?: string
    }>
  }
}

describe('manifest', () => {
  const manifest = JSON.parse(read('public/exo-manifest.json')) as Manifest

  it('carries the agreed identity and permission set', () => {
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.id).toBe('io.github.mode777.gltf')
    expect(manifest.name).toBe('glTF Viewer')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.license).toBe('MIT')
    expect(manifest.publisher.name).toBe('Alex Klingenbeck')
    expect(manifest.engines.exo).toBe('>=0.1.0')
    expect(manifest.permissions.sort()).toEqual([
      'events:subscribe',
      'workspace:read',
      'workspace:write',
    ])
  })

  it('declares exactly one visible-frame editor for glTF and GLB', () => {
    expect(manifest.contributes.fileEditors).toHaveLength(1)
    const [editor] = manifest.contributes.fileEditors
    expect(editor.glob).toBe('**/*.{gltf,glb}')
    expect(editor.label).toBe('glTF')
    expect(editor.priority).toBe(0)
    expect(editor.rendering).toBe('frame')
  })

  it('points at pages that exist inside the plugin root', () => {
    expect(existsSync(join(root, manifest.runtime.entry))).toBe(true)
    for (const editor of manifest.contributes.fileEditors) {
      expect(existsSync(join(root, editor.entry))).toBe(true)
    }
  })

  it('is registered by the controller with the same glob, entry and label', () => {
    const controller = read('src/controller.ts')
    const [editor] = manifest.contributes.fileEditors
    expect(controller).toContain(`glob: '${editor.glob}'`)
    expect(controller).toContain(`entry: '${editor.entry}'`)
    expect(controller).toContain(`label: '${editor.label}'`)
  })
})

describe('protocol hygiene', () => {
  const sources = [
    'src/controller.ts',
    'src/editor.ts',
    'src/app.tsx',
    'src/viewport.ts',
    'src/resources.ts',
    'src/glb.ts',
    'src/notices.ts',
    'src/save.ts',
    'src/observation.ts',
    'plugin.html',
    'editor.html',
  ]

  it('contains no hand-written protocol plumbing', () => {
    const banned = ['postMessage(', "addEventListener('message')", 'exo: 1', 'plugin/ready']
    const violations = sources.flatMap((path) => {
      const source = read(path)
      return banned.filter((marker) => source.includes(marker)).map((marker) => `${path}: ${marker}`)
    })
    expect(violations).toEqual([])
  })

  it('connects both pages through the SDK browser adapter', () => {
    for (const path of ['src/controller.ts', 'src/editor.ts']) {
      expect(read(path), path).toContain("from '@exo/plugin-sdk/browser'")
    }
  })
})

describe('vendored decoder assets', () => {
  it('ships the Draco and Basis transcoders inside the plugin root', () => {
    for (const asset of [
      'public/draco/draco_decoder.js',
      'public/draco/draco_decoder.wasm',
      'public/draco/draco_wasm_wrapper.js',
      'public/basis/basis_transcoder.js',
      'public/basis/basis_transcoder.wasm',
    ]) {
      expect(existsSync(join(root, asset)), asset).toBe(true)
    }
  })
})
