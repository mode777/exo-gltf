import { Document, Extension } from '@gltf-transform/core'
import { describe, expect, it, vi } from 'vitest'
import { buildExplorerModel, focusNodeIndex } from './explorer-model'
import type { ProbeResult } from './resources'

class TestExtension extends Extension {
  static EXTENSION_NAME = 'KHR_test_extension'
  readonly extensionName = 'KHR_test_extension'
  read(): this {
    return this
  }
  write(): this {
    return this
  }
}

function syntheticDocument(): Document {
  const document = new Document()
  const buffer = document.createBuffer('Buffer A')
  const scene = document.createScene('Scene A')
  const nodeA = document.createNode('Node A')
  const nodeB = document.createNode('Node B')
  scene.addChild(nodeA)
  nodeA.addChild(nodeB)

  const material = document.createMaterial('Material A')
  const texture = document.createTexture('Texture A').setURI('tex.png')
  material.setBaseColorTexture(texture)

  const position = document
    .createAccessor('Position')
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0]))
    .setBuffer(buffer)
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', position)
    .setMaterial(material)
  const mesh = document.createMesh('Mesh A').addPrimitive(primitive)
  nodeA.setMesh(mesh)

  document.createAnimation('Animation A')
  document.createSkin('Skin A').addJoint(nodeB)
  document.createExtension(TestExtension).setRequired(true)
  return document
}

const probes: ProbeResult[] = [
  { uri: 'tex.png', kind: 'image', path: '/models/tex.png', ok: true },
  { uri: 'missing.bin', kind: 'buffer', path: '/models/missing.bin', ok: false, code: 'not-found' },
]

describe('buildExplorerModel', () => {
  it('creates one group per non-empty collection with document counts', () => {
    const model = buildExplorerModel(syntheticDocument(), probes)
    expect(model.groups.map((group) => [group.id, group.count])).toEqual([
      ['scenes', 1],
      ['nodes', 2],
      ['meshes', 1],
      ['materials', 1],
      ['textures', 1],
      ['animations', 1],
      ['skins', 1],
      ['extensions', 1],
      ['resources', 2],
    ])
    expect(model.isEmpty).toBe(false)
  })

  it('reports an empty document explicitly', () => {
    const model = buildExplorerModel(new Document(), [])
    expect(model.groups).toEqual([])
    expect(model.isEmpty).toBe(true)
  })

  it('materialises entries lazily and caches them', () => {
    const document = syntheticDocument()
    const model = buildExplorerModel(document, [])
    const nodesGroup = model.groups.find((group) => group.id === 'nodes')!
    const node = document.getRoot().listNodes()[0]
    const listChildren = vi.spyOn(node, 'listChildren')

    expect(listChildren).not.toHaveBeenCalled()
    const entries = nodesGroup.getEntries()
    expect(entries).toHaveLength(2)
    expect(listChildren).toHaveBeenCalled()

    const calls = listChildren.mock.calls.length
    expect(nodesGroup.getEntries()).toBe(entries)
    expect(listChildren.mock.calls.length).toBe(calls)
  })

  it('uses unique index-based ids across the whole document', () => {
    const model = buildExplorerModel(syntheticDocument(), probes)
    const ids = model.groups.flatMap((group) => group.getEntries().map((entry) => entry.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('nodes:0')
    expect(ids).toContain('resources:1')
  })

  it('lists used and required extensions', () => {
    const model = buildExplorerModel(syntheticDocument(), [])
    const group = model.groups.find((entry) => entry.id === 'extensions')!
    expect(group.count).toBe(1)
    expect(group.getEntries()[0]).toMatchObject({
      id: 'extensions:0',
      label: 'KHR_test_extension',
      detail: 'required',
    })
  })

  it('reports resolved and missing resources', () => {
    const model = buildExplorerModel(syntheticDocument(), probes)
    const group = model.groups.find((entry) => entry.id === 'resources')!
    expect(group.hasMissing).toBe(true)
    const entries = group.getEntries()
    expect(entries[0]).toMatchObject({
      kind: 'resource',
      label: 'tex.png',
      status: 'resolved',
      detail: 'image · resolved',
    })
    expect(entries[1]).toMatchObject({
      label: 'missing.bin',
      status: 'missing',
      detail: 'buffer · missing',
    })
    expect(entries[1].details).toContainEqual({ label: 'Path', value: '/models/missing.bin' })
    expect(entries[1].details).toContainEqual({ label: 'Error', value: 'not-found' })
  })

  it('builds inspector details for nodes and textures', () => {
    const model = buildExplorerModel(syntheticDocument(), probes)
    const node = model.groups.find((group) => group.id === 'nodes')!.getEntries()[0]
    expect(node).toMatchObject({ label: 'Node A', kind: 'node' })
    expect(node.details).toContainEqual({ label: 'Children', value: '1' })
    expect(node.details).toContainEqual({ label: 'Mesh', value: '#0 Mesh A' })

    const texture = model.groups.find((group) => group.id === 'textures')!.getEntries()[0]
    expect(texture).toMatchObject({ label: 'Texture A', uri: 'tex.png', status: 'resolved' })
    expect(texture.details).toContainEqual({ label: 'URI', value: 'tex.png' })
    expect(texture.details).toContainEqual({ label: 'Status', value: 'resolved' })
  })

  it('treats only node entries as spatial selections', () => {
    const model = buildExplorerModel(syntheticDocument(), probes)
    const node = model.groups.find((group) => group.id === 'nodes')!.getEntries()[0]
    const texture = model.groups.find((group) => group.id === 'textures')!.getEntries()[0]
    const material = model.groups.find((group) => group.id === 'materials')!.getEntries()[0]

    expect(focusNodeIndex(node)).toBe(0)
    expect(focusNodeIndex(texture)).toBeNull()
    expect(focusNodeIndex(material)).toBeNull()
    expect(focusNodeIndex(null)).toBeNull()
  })
})
