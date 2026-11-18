/**
 * Workspace-backed document parsing.
 *
 * `@gltf-transform/core` builds the structure model (D-05). Its IO service
 * would normally fetch external URIs over the network; this adapter serves
 * them from the bytes M1 already read through the shell instead. Missing
 * images become empty resources (the model does not decode pixels), missing
 * buffers become zero-filled views of their declared length so the graph
 * still parses, and every failure is reported through probes.
 */

import { Document, PlatformIO } from '@gltf-transform/core'
import { readDocumentJson } from './glb'
import type { PrefetchResult } from './resources'

/** Pseudo-URI for the opened document itself; never collides with glTF URIs. */
const DOCUMENT_URI = 'exo-gltf://document'

export interface ParsedDocument {
  /** Null when parsing failed; the preview and notices are unaffected. */
  document: Document | null
  error: string | null
}

function safeDecode(uri: string): string {
  try {
    return decodeURIComponent(uri)
  } catch {
    return uri
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Declared buffer sizes by uri, used to zero-fill unreadable buffers. */
function collectBufferLengths(json: Record<string, unknown>): Map<string, number> {
  const lengths = new Map<string, number>()
  const buffers = Array.isArray(json.buffers) ? json.buffers : []
  for (const entry of buffers) {
    if (typeof entry !== 'object' || entry === null) continue
    const { uri, byteLength } = entry as { uri?: unknown; byteLength?: unknown }
    if (typeof uri !== 'string' || uri.length === 0) continue
    lengths.set(uri, typeof byteLength === 'number' && byteLength > 0 ? Math.floor(byteLength) : 0)
  }
  return lengths
}

interface WorkspaceReaderOptions {
  documentBytes: Uint8Array<ArrayBuffer>
  raw: Map<string, Uint8Array<ArrayBuffer>>
  bufferLengths: Map<string, number>
}

/**
 * `PlatformIO` without any network or file access: every read either returns
 * the opened document, a pre-fetched resource, or a documented placeholder.
 */
class WorkspaceIO extends PlatformIO {
  constructor(private readonly options: WorkspaceReaderOptions) {
    super()
  }

  protected async readURI(uri: string, type: 'view'): Promise<Uint8Array<ArrayBuffer>>
  protected async readURI(uri: string, type: 'text'): Promise<string>
  protected async readURI(uri: string, type: 'view' | 'text'): Promise<Uint8Array | string> {
    const bytes = this.lookup(uri)
    if (type === 'text') return new TextDecoder().decode(bytes)
    return bytes
  }

  /** glTF uris are already document-relative; no base resolution is needed. */
  protected resolve(_base: string, path: string): string {
    return safeDecode(path)
  }

  protected dirname(): string {
    return ''
  }

  private lookup(uri: string): Uint8Array<ArrayBuffer> {
    if (uri === DOCUMENT_URI) return this.options.documentBytes
    const candidates = uri === safeDecode(uri) ? [uri] : [uri, safeDecode(uri)]
    for (const candidate of candidates) {
      const raw = this.options.raw.get(candidate)
      if (raw) return raw
    }
    for (const candidate of candidates) {
      const declared = this.options.bufferLengths.get(candidate)
      if (declared !== undefined) return new Uint8Array(declared)
    }
    // External images are the only remaining kind the model tolerates empty.
    return new Uint8Array(0)
  }
}

/**
 * Parses the opened document with a workspace-backed IO adapter. Never throws:
 * the caller keeps M1's preview behavior and shows a structure notice instead.
 */
export async function parseDocument(
  bytes: Uint8Array,
  prefetch: PrefetchResult,
): Promise<ParsedDocument> {
  try {
    const view =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.slice().buffer as ArrayBuffer)
    const { json } = readDocumentJson(view)
    const io = new WorkspaceIO({
      documentBytes: bytes as Uint8Array<ArrayBuffer>,
      raw: prefetch.raw,
      bufferLengths: collectBufferLengths(json),
    })
    const document = await io.read(DOCUMENT_URI)
    return { document, error: null }
  } catch (error) {
    return { document: null, error: errorMessage(error) }
  }
}
