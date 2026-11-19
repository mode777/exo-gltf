/**
 * Missing-reference repair model.
 *
 * One row per distinct external URI, even when several buffers or textures
 * share it. The row carries every target property so one action updates all
 * of them, plus the original/current URI and the last probe status.
 */

import type { Buffer, Document, Texture } from '@gltf-transform/core'
import type { ProbeResult } from './resources'
import type { RelinkMap } from './relink'

export type RepairKind = 'buffer' | 'image'

export interface RepairTarget {
  kind: RepairKind
  index: number
  property: Buffer | Texture
}

export interface RepairItem {
  id: string
  /** URI as written when the document was opened. */
  originalUri: string
  /** URI currently written into the document. */
  uri: string
  kind: RepairKind
  targets: RepairTarget[]
  /** Workspace path used for reads and picker hints. */
  path: string
  status: 'resolved' | 'missing'
  code?: string
  relinked: boolean
}

export interface RepairModel {
  items: RepairItem[]
  missing: RepairItem[]
  relinked: RepairItem[]
  /** True when the document has no external references at all. */
  isEmpty: boolean
}

function collectTargets(document: Document): Map<string, RepairTarget[]> {
  const targets = new Map<string, RepairTarget[]>()
  const push = (uri: string, target: RepairTarget): void => {
    const list = targets.get(uri)
    if (list) list.push(target)
    else targets.set(uri, [target])
  }
  document.getRoot().listBuffers().forEach((buffer, index) => {
    const uri = buffer.getURI()
    if (uri) push(uri, { kind: 'buffer', index, property: buffer })
  })
  document.getRoot().listTextures().forEach((texture, index) => {
    const uri = texture.getURI()
    if (uri) push(uri, { kind: 'image', index, property: texture })
  })
  return targets
}

/**
 * Builds the repair model from the document *before* `applyRelinks` rewrites
 * its URIs, so the original URI remains the map key.
 */
export function buildRepairModel(
  document: Document,
  probes: ProbeResult[],
  relinks: RelinkMap,
): RepairModel {
  const probeByUri = new Map(probes.map((probe) => [probe.uri, probe]))
  const targets = collectTargets(document)
  const items: RepairItem[] = []

  for (const [originalUri, references] of targets) {
    const probe = probeByUri.get(originalUri)
    const entry = relinks.get(originalUri)
    const kind: RepairKind = references.some((reference) => reference.kind === 'buffer')
      ? 'buffer'
      : 'image'
    const status: RepairItem['status'] = entry
      ? 'resolved'
      : probe
        ? probe.ok
          ? 'resolved'
          : 'missing'
        : 'resolved'

    items.push({
      id: `reference:${items.length}`,
      originalUri,
      uri: entry?.uri ?? originalUri,
      kind,
      targets: references,
      path: entry?.path ?? probe?.path ?? originalUri,
      status,
      ...(status === 'missing' && probe?.code ? { code: probe.code } : {}),
      relinked: entry !== undefined,
    })
  }

  return {
    items,
    missing: items.filter((item) => item.status === 'missing'),
    relinked: items.filter((item) => item.relinked),
    isEmpty: items.length === 0,
  }
}
