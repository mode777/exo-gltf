/**
 * Document serialization for the save path.
 *
 * Only reference URIs change, but the whole document is re-serialized through
 * gltf-transform (D-06): `.gltf` becomes pretty-printed JSON text, `.glb`
 * becomes bytes. Guards make sure a still-missing reference never turns into
 * placeholder data, and an extension the plugin cannot write never gets
 * silently dropped.
 */

import { PlatformIO, type Document } from '@gltf-transform/core'
import { SUPPORTED_EXTENSION_CLASSES } from './extensions'
import type { ProbeResult } from './resources'

export type DocumentFormat = 'gltf' | 'glb'
export type SaveContent = { text: string } | { bytes: ArrayBuffer }

export class SerializationError extends Error {
  constructor(
    readonly code: 'unresolved' | 'unsupported-extension',
    message: string,
  ) {
    super(message)
    this.name = 'SerializationError'
  }
}

export function formatForFileName(name: string): DocumentFormat {
  return name.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf'
}

export function copyArrayBuffer(source: ArrayBuffer): ArrayBuffer {
  const copy = new ArrayBuffer(source.byteLength)
  new Uint8Array(copy).set(new Uint8Array(source))
  return copy
}

export function copySaveContent(content: SaveContent): SaveContent {
  return 'text' in content ? { text: content.text } : { bytes: copyArrayBuffer(content.bytes) }
}

export function saveContentBytes(content: SaveContent): Uint8Array {
  if ('text' in content) return new TextEncoder().encode(content.text)
  return new Uint8Array(content.bytes)
}

/** `PlatformIO` is abstract; writing needs no read implementation. */
class WriterIO extends PlatformIO {
  protected async readURI(_uri: string, _type: 'view'): Promise<Uint8Array<ArrayBuffer>>
  protected async readURI(_uri: string, _type: 'text'): Promise<string>
  protected async readURI(_uri: string, _type: 'view' | 'text'): Promise<Uint8Array | string> {
    throw new Error('The writer does not read external resources.')
  }

  protected resolve(_base: string, path: string): string {
    return path
  }

  protected dirname(): string {
    return ''
  }
}

function resolveNames(probes: ProbeResult[]): string {
  return probes.map((probe) => probe.path || probe.uri).join(', ')
}

export interface SerializationOptions {
  format: DocumentFormat
  /** External references that still could not be read. */
  unresolved?: ProbeResult[]
  /** Declared extensions without a registered handler (editing is disabled). */
  unsupportedExtensions?: string[]
}

export async function serializeDocument(
  document: Document,
  options: SerializationOptions,
): Promise<SaveContent> {
  if (options.unsupportedExtensions && options.unsupportedExtensions.length > 0) {
    throw new SerializationError(
      'unsupported-extension',
      `This document uses extensions the plugin cannot write: ${options.unsupportedExtensions.join(', ')}.`,
    )
  }

  const unresolved = options.unresolved ?? []
  const io = new WriterIO().registerExtensions(SUPPORTED_EXTENSION_CLASSES)

  if (options.format === 'glb') {
    if (unresolved.length > 0) {
      throw new SerializationError(
        'unresolved',
        `Saving a GLB would embed placeholder data for missing references: ${resolveNames(unresolved)}.`,
      )
    }
    const bytes = await io.writeBinary(document)
    const buffer =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.slice().buffer as ArrayBuffer)
    return { bytes: copyArrayBuffer(buffer) }
  }

  const jsonDocument = await io.writeJSON(document)
  for (const probe of unresolved) {
    const entries = (
      probe.kind === 'buffer'
        ? (jsonDocument.json.buffers ?? [])
        : (jsonDocument.json.images ?? [])
    ) as Array<{ uri?: string }>
    const kept = entries.some((entry) => entry.uri === probe.uri)
    if (!kept) {
      throw new SerializationError(
        'unresolved',
        `The saved document would lose the unresolved ${probe.kind} reference "${probe.uri}".`,
      )
    }
  }

  return { text: JSON.stringify(jsonDocument.json, null, 2) }
}
