/**
 * Reference-relink state and document application.
 *
 * Relinks are kept as a map keyed by the *original* URI from the opened
 * document, so re-parses can feed the replacement bytes to the old URI and
 * then rewrite the document to the new one. The map also makes shared URIs
 * and session revert behavior explicit.
 */

import type { Document } from '@gltf-transform/core'
import type { ProbeResult } from './resources'

export interface RelinkEntry {
  /** Workspace path the user selected. */
  path: string
  /** URI written into the glTF document. */
  uri: string
  /** Bytes read from the workspace. */
  bytes: Uint8Array<ArrayBuffer>
}

/** Original URI -> replacement. */
export type RelinkMap = Map<string, RelinkEntry>

/** Rewrites every buffer and texture that still uses an original URI. */
export function applyRelinks(document: Document, relinks: RelinkMap): void {
  if (relinks.size === 0) return
  const root = document.getRoot()
  for (const buffer of root.listBuffers()) {
    const entry = relinks.get(buffer.getURI())
    if (entry) buffer.setURI(entry.uri)
  }
  for (const texture of root.listTextures()) {
    const entry = relinks.get(texture.getURI())
    if (entry) texture.setURI(entry.uri)
  }
}

/** Byte overrides keyed by the original URI, for the workspace IO adapter. */
export function relinkOverrides(relinks: RelinkMap): Map<string, Uint8Array<ArrayBuffer>> {
  const overrides = new Map<string, Uint8Array<ArrayBuffer>>()
  for (const [originalUri, entry] of relinks) overrides.set(originalUri, entry.bytes)
  return overrides
}

/**
 * UI-facing probes: a relinked reference reports its new URI/path and is
 * resolved even though the original prefetch missed it.
 */
export function refreshProbes(probes: ProbeResult[], relinks: RelinkMap): ProbeResult[] {
  return probes.map((probe) => {
    const entry = relinks.get(probe.uri)
    return entry
      ? { ...probe, uri: entry.uri, path: entry.path, ok: true, code: undefined }
      : probe
  })
}

/** Comparable snapshot of the applied edits (original URI -> written URI). */
export function relinkState(relinks: RelinkMap): Map<string, string> {
  const state = new Map<string, string>()
  for (const [originalUri, entry] of relinks) state.set(originalUri, entry.uri)
  return state
}

export function relinkStatesEqual(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) if (right.get(key) !== value) return false
  return true
}
