/**
 * Lazy explorer model over the parsed `@gltf-transform` document (D-05/D2).
 *
 * Groups are cheap: counts are read once from the property graph, while the
 * entries of a group are materialised the first time the user expands it.
 * Ids are index-based (`collection:index`) and therefore stable only within
 * one parsed document — selection resets on reload by design.
 *
 * Note on `images`: `@gltf-transform/core` models glTF images as `Texture`
 * properties and folds texture definitions into `TextureInfo`, so the model
 * exposes one Textures group instead of duplicate Textures/Images groups.
 * Image URIs and resource status remain inspectable on each texture entry.
 */

import type {
  Animation,
  Document,
  Material,
  Mesh,
  Node,
  Scene,
  Skin,
  Texture,
} from '@gltf-transform/core'
import type { ProbeResult } from './resources'

export type ExplorerCollectionId =
  | 'scenes'
  | 'nodes'
  | 'meshes'
  | 'materials'
  | 'textures'
  | 'animations'
  | 'skins'
  | 'extensions'
  | 'resources'

export type ExplorerEntryKind =
  | 'scene'
  | 'node'
  | 'mesh'
  | 'material'
  | 'texture'
  | 'animation'
  | 'skin'
  | 'extension'
  | 'resource'

export interface ExplorerDetail {
  label: string
  value: string
}

export interface ExplorerEntry {
  /** `${collection}:${index}` — unique within one parsed document. */
  id: string
  kind: ExplorerEntryKind
  index: number
  label: string
  /** Short muted text shown next to the label in the tree. */
  detail: string
  /** Inspector fields (references, counts, URIs). */
  details: ExplorerDetail[]
  status?: 'resolved' | 'missing'
  uri?: string
}

export interface ExplorerGroup {
  id: ExplorerCollectionId
  label: string
  count: number
  /** True when any resource in this group is missing. */
  hasMissing?: boolean
  /** Materialises entries on first call and caches them. */
  getEntries(): ExplorerEntry[]
}

export interface ExplorerModel {
  groups: ExplorerGroup[]
  /** True when the document has no collections and no resources. */
  isEmpty: boolean
}

function displayName(property: { getName(): string }, fallback: string): string {
  const name = property.getName()
  return name.trim().length > 0 ? name : fallback
}

function baseName(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function makeGroup<Item>(
  id: ExplorerCollectionId,
  label: string,
  items: Item[],
  build: (item: Item, index: number) => ExplorerEntry,
  options: { hasMissing?: boolean } = {},
): ExplorerGroup {
  let entries: ExplorerEntry[] | null = null
  return {
    id,
    label,
    count: items.length,
    ...(options.hasMissing !== undefined ? { hasMissing: options.hasMissing } : {}),
    getEntries(): ExplorerEntry[] {
      if (entries === null) entries = items.map((item, index) => build(item, index))
      return entries
    },
  }
}

function buildSceneEntry(scene: Scene, index: number): ExplorerEntry {
  const children = scene.listChildren()
  return {
    id: `scenes:${index}`,
    kind: 'scene',
    index,
    label: displayName(scene, `Scene ${index}`),
    detail: plural(children.length, 'root node'),
    details: [{ label: 'Root nodes', value: String(children.length) }],
  }
}

function buildNodeEntry(
  node: Node,
  index: number,
  nodeIndices: Map<Node, number>,
  meshIndices: Map<Mesh, number>,
  meshNames: Map<Mesh, string>,
  skinIndices: Map<Skin, number>,
  skinNames: Map<Skin, string>,
): ExplorerEntry {
  const children = node.listChildren()
  const mesh = node.getMesh()
  const skin = node.getSkin()
  const camera = node.getCamera()
  const parent = node.getParentNode()
  const details: ExplorerDetail[] = [{ label: 'Children', value: String(children.length) }]
  if (children.length > 0) {
    const names = children
      .slice(0, 8)
      .map((child) => `#${nodeIndices.get(child) ?? '?'} ${displayName(child, 'node')}`)
    const extra = children.length > names.length ? ` and ${children.length - names.length} more` : ''
    details.push({ label: 'Child nodes', value: `${names.join(', ')}${extra}` })
  }
  details.push({
    label: 'Parent',
    value: parent ? `#${nodeIndices.get(parent) ?? '?'} ${displayName(parent, 'node')}` : 'scene root',
  })
  if (mesh) {
    const meshIndex = meshIndices.get(mesh)
    details.push({
      label: 'Mesh',
      value: meshIndex === undefined ? (meshNames.get(mesh) ?? 'mesh') : `#${meshIndex} ${meshNames.get(mesh) ?? 'mesh'}`,
    })
  }
  if (skin) {
    const skinIndex = skinIndices.get(skin)
    details.push({
      label: 'Skin',
      value: skinIndex === undefined ? (skinNames.get(skin) ?? 'skin') : `#${skinIndex} ${skinNames.get(skin) ?? 'skin'}`,
    })
  }
  if (camera) details.push({ label: 'Camera', value: displayName(camera, 'camera') })
  return {
    id: `nodes:${index}`,
    kind: 'node',
    index,
    label: displayName(node, `Node ${index}`),
    detail: mesh ? `mesh: ${meshNames.get(mesh) ?? 'mesh'}` : plural(children.length, 'child'),
    details,
  }
}

function buildMeshEntry(
  mesh: Mesh,
  index: number,
  materialIndices: Map<Material, number>,
  materialNames: Map<Material, string>,
): ExplorerEntry {
  const primitives = mesh.listPrimitives()
  const materials = new Set<Material>()
  for (const primitive of primitives) {
    const material = primitive.getMaterial()
    if (material) materials.add(material)
  }
  const names = Array.from(materials, (material) => {
    const materialIndex = materialIndices.get(material)
    return materialIndex === undefined
      ? (materialNames.get(material) ?? 'material')
      : `#${materialIndex} ${materialNames.get(material) ?? 'material'}`
  })
  return {
    id: `meshes:${index}`,
    kind: 'mesh',
    index,
    label: displayName(mesh, `Mesh ${index}`),
    detail: plural(primitives.length, 'primitive'),
    details: [
      { label: 'Primitives', value: String(primitives.length) },
      { label: 'Materials', value: names.length > 0 ? names.join(', ') : 'none' },
    ],
  }
}

function buildMaterialEntry(
  material: Material,
  index: number,
  materialMeshes: Map<Material, Set<number>>,
  meshes: Mesh[],
  meshNames: Map<Mesh, string>,
): ExplorerEntry {
  const usedBy = materialMeshes.get(material)
  const meshNamesList = usedBy
    ? Array.from(usedBy, (meshIndex) => `#${meshIndex} ${meshNames.get(meshes[meshIndex]) ?? 'mesh'}`)
    : []
  const details: ExplorerDetail[] = [
    { label: 'Used by meshes', value: meshNamesList.length > 0 ? meshNamesList.join(', ') : 'none' },
  ]
  const baseColor = material.getBaseColorTexture()
  if (baseColor) {
    details.push({
      label: 'Base color texture',
      value: baseColor.getURI() || 'embedded image',
    })
  }
  return {
    id: `materials:${index}`,
    kind: 'material',
    index,
    label: displayName(material, `Material ${index}`),
    detail: meshNamesList.length > 0 ? plural(meshNamesList.length, 'mesh') : 'unused',
    details,
  }
}

function buildTextureEntry(
  texture: Texture,
  index: number,
  probeByUri: Map<string, ProbeResult>,
): ExplorerEntry {
  const uri = texture.getURI()
  const probe = uri ? probeByUri.get(uri) : undefined
  const status = probe ? (probe.ok ? 'resolved' : 'missing') : undefined
  const details: ExplorerDetail[] = [
    { label: 'Image', value: uri ? 'external' : 'embedded' },
    { label: 'MIME type', value: texture.getMimeType() || 'unknown' },
  ]
  if (uri) details.push({ label: 'URI', value: uri })
  if (status) details.push({ label: 'Status', value: status })
  const image = texture.getImage()
  if (image) details.push({ label: 'Image bytes', value: String(image.byteLength) })
  return {
    id: `textures:${index}`,
    kind: 'texture',
    index,
    label: displayName(texture, uri ? baseName(uri) : `Texture ${index}`),
    detail: uri || 'embedded image',
    details,
    ...(status ? { status } : {}),
    ...(uri ? { uri } : {}),
  }
}

function buildAnimationEntry(animation: Animation, index: number): ExplorerEntry {
  const channels = animation.listChannels()
  return {
    id: `animations:${index}`,
    kind: 'animation',
    index,
    label: displayName(animation, `Animation ${index}`),
    detail: plural(channels.length, 'channel'),
    details: [
      { label: 'Channels', value: String(channels.length) },
      { label: 'Samplers', value: String(animation.listSamplers().length) },
    ],
  }
}

function buildSkinEntry(
  skin: Skin,
  index: number,
  nodeIndices: Map<Node, number>,
): ExplorerEntry {
  const joints = skin.listJoints()
  const skeleton = skin.getSkeleton()
  return {
    id: `skins:${index}`,
    kind: 'skin',
    index,
    label: displayName(skin, `Skin ${index}`),
    detail: plural(joints.length, 'joint'),
    details: [
      { label: 'Joints', value: String(joints.length) },
      {
        label: 'Skeleton',
        value: skeleton
          ? `#${nodeIndices.get(skeleton) ?? '?'} ${displayName(skeleton, 'node')}`
          : 'none',
      },
    ],
  }
}

/** Names from `extensionsUsed`, plus any extension only listed as required. */
function collectExtensionNames(document: Document): { names: string[]; required: Set<string> } {
  const root = document.getRoot()
  const used = root.listExtensionsUsed().map((extension) => extension.extensionName)
  const required = new Set(root.listExtensionsRequired().map((extension) => extension.extensionName))
  const names = [...used]
  for (const name of required) if (!names.includes(name)) names.push(name)
  return { names, required }
}

/**
 * Node entries are the only spatial selection; selecting anything else
 * leaves the camera untouched.
 */
export function focusNodeIndex(entry: ExplorerEntry | null): number | null {
  return entry?.kind === 'node' ? entry.index : null
}

/**
 * Builds the explorer model: one lazy group per non-empty document
 * collection, the Extensions group, and the synthetic Resources group.
 */
export function buildExplorerModel(document: Document, probes: ProbeResult[]): ExplorerModel {
  const root = document.getRoot()
  const scenes = root.listScenes()
  const nodes = root.listNodes()
  const meshes = root.listMeshes()
  const materials = root.listMaterials()
  const textures = root.listTextures()
  const animations = root.listAnimations()
  const skins = root.listSkins()

  const nodeIndices = new Map(nodes.map((node, index) => [node, index]))
  const meshIndices = new Map(meshes.map((mesh, index) => [mesh, index]))
  const materialIndices = new Map(materials.map((material, index) => [material, index]))
  const skinIndices = new Map(skins.map((skin, index) => [skin, index]))
  const meshNames = new Map(meshes.map((mesh, index) => [mesh, displayName(mesh, `Mesh ${index}`)]))
  const materialNames = new Map(
    materials.map((material, index) => [material, displayName(material, `Material ${index}`)]),
  )
  const skinNames = new Map(skins.map((skin, index) => [skin, displayName(skin, `Skin ${index}`)]))

  const materialMeshes = new Map<Material, Set<number>>()
  meshes.forEach((mesh, meshIndex) => {
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial()
      if (!material) continue
      const set = materialMeshes.get(material) ?? new Set<number>()
      set.add(meshIndex)
      materialMeshes.set(material, set)
    }
  })

  const groups: ExplorerGroup[] = []

  if (scenes.length > 0) {
    groups.push(makeGroup('scenes', 'Scenes', scenes, (scene, index) => buildSceneEntry(scene, index)))
  }
  if (nodes.length > 0) {
    groups.push(
      makeGroup('nodes', 'Nodes', nodes, (node, index) =>
        buildNodeEntry(node, index, nodeIndices, meshIndices, meshNames, skinIndices, skinNames),
      ),
    )
  }
  if (meshes.length > 0) {
    groups.push(
      makeGroup('meshes', 'Meshes', meshes, (mesh, index) =>
        buildMeshEntry(mesh, index, materialIndices, materialNames),
      ),
    )
  }
  if (materials.length > 0) {
    groups.push(
      makeGroup('materials', 'Materials', materials, (material, index) =>
        buildMaterialEntry(material, index, materialMeshes, meshes, meshNames),
      ),
    )
  }
  if (textures.length > 0) {
    const probeByUri = new Map(probes.map((probe) => [probe.uri, probe]))
    groups.push(
      makeGroup('textures', 'Textures', textures, (texture, index) =>
        buildTextureEntry(texture, index, probeByUri),
      ),
    )
  }
  if (animations.length > 0) {
    groups.push(
      makeGroup('animations', 'Animations', animations, (animation, index) =>
        buildAnimationEntry(animation, index),
      ),
    )
  }
  if (skins.length > 0) {
    groups.push(
      makeGroup('skins', 'Skins', skins, (skin, index) => buildSkinEntry(skin, index, nodeIndices)),
    )
  }

  const { names: extensionNames, required } = collectExtensionNames(document)
  if (extensionNames.length > 0) {
    groups.push(
      makeGroup('extensions', 'Extensions', extensionNames, (name, index) => ({
        id: `extensions:${index}`,
        kind: 'extension',
        index,
        label: name,
        detail: required.has(name) ? 'required' : 'used',
        details: [{ label: 'Required', value: required.has(name) ? 'yes' : 'no' }],
      })),
    )
  }

  if (probes.length > 0) {
    const hasMissing = probes.some((probe) => !probe.ok)
    groups.push(
      makeGroup(
        'resources',
        'Resources',
        probes,
        (probe, index) => ({
          id: `resources:${index}`,
          kind: 'resource',
          index,
          label: baseName(probe.path || probe.uri),
          detail: `${probe.kind} · ${probe.ok ? 'resolved' : 'missing'}`,
          details: [
            { label: 'Resource', value: probe.kind },
            { label: 'URI', value: probe.uri },
            { label: 'Path', value: probe.path },
            { label: 'Status', value: probe.ok ? 'resolved' : 'missing' },
            ...(probe.ok ? [] : [{ label: 'Error', value: probe.code ?? 'unknown' }]),
          ],
          status: probe.ok ? 'resolved' : 'missing',
          uri: probe.uri,
        }),
        { hasMissing },
      ),
    )
  }

  return { groups, isEmpty: groups.length === 0 }
}
