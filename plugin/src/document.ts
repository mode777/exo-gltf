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
import { SUPPORTED_EXTENSION_CLASSES, findUnsupportedExtensions } from './extensions'
import { readDocumentJson, rewriteGlbJson } from './glb'
import type { PrefetchResult } from './resources'

/** Pseudo-URI for the opened document itself; never collides with glTF URIs. */
const DOCUMENT_URI = 'exo-gltf://document'

export interface ParsedDocument {
  /** Null when parsing failed; the preview and notices are unaffected. */
  document: Document | null
  error: string | null
  /** Declared extensions the plugin cannot round-trip; makes the document read-only. */
  unsupportedExtensions: string[]
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

/**
 * A document declaring a required extension without a registered handler
 * cannot be read by the library. Strip only those names from the read-only
 * copy so the structure stays browsable; preview and save keep the original
 * bytes and the document is marked non-editable.
 */
function readableDocumentBytes(
  view: ArrayBuffer,
  json: Record<string, unknown>,
  container: 'glb' | 'gltf',
  unsupportedExtensions: string[],
): Uint8Array {
  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : []
  const blocked = required.filter(
    (name): name is string => typeof name === 'string' && unsupportedExtensions.includes(name),
  )
  if (blocked.length === 0) return new Uint8Array(view)

  const sanitized = {
    ...json,
    extensionsRequired: required.filter((name) => !blocked.includes(name as string)),
  }
  return container === 'glb'
    ? new Uint8Array(rewriteGlbJson(view, sanitized))
    : new TextEncoder().encode(JSON.stringify(sanitized))
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
  /** Replacement bytes for a URI, used while trialing/applying a relink. */
  overrides?: ReadonlyMap<string, Uint8Array<ArrayBuffer>>
}

/**
 * `PlatformIO` without any network or file access: every read either returns
 * the opened document, a pre-fetched resource, or a documented placeholder.
 */
class WorkspaceIO extends PlatformIO {
  constructor(private readonly options: WorkspaceReaderOptions) {
    super()
    // Registering extensions keeps their payloads when the document is
    // re-serialized; unsupported ones never reach this IO (read-only guard).
    this.registerExtensions(SUPPORTED_EXTENSION_CLASSES)
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
    const override = this.options.overrides?.get(uri)
    if (override) return override
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

export interface ParseDocumentOptions {
  /** Replacement bytes keyed by the document's original URI. */
  overrides?: ReadonlyMap<string, Uint8Array<ArrayBuffer>>
}

/**
 * Parses the opened document with a workspace-backed IO adapter. Never throws:
 * the caller keeps M1's preview behavior and shows a structure notice instead.
 */
export async function parseDocument(
  bytes: Uint8Array,
  prefetch: PrefetchResult,
  options: ParseDocumentOptions = {},
): Promise<ParsedDocument> {
  let unsupportedExtensions: string[] = []
  try {
    const view =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : (bytes.slice().buffer as ArrayBuffer)
    const { json, container } = readDocumentJson(view)
    unsupportedExtensions = findUnsupportedExtensions(json)
    const io = new WorkspaceIO({
      documentBytes: readableDocumentBytes(view, json, container, unsupportedExtensions) as Uint8Array<ArrayBuffer>,
      raw: prefetch.raw,
      bufferLengths: collectBufferLengths(json),
      ...(options.overrides ? { overrides: options.overrides } : {}),
    })
    const document = await io.read(DOCUMENT_URI)
    return { document, error: null, unsupportedExtensions }
  } catch (error) {
    return { document: null, error: errorMessage(error), unsupportedExtensions }
  }
}
