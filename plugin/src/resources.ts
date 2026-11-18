/**
 * External reference discovery and pre-fetching.
 *
 * The Exo plugin protocol cannot list the workspace, so every external
 * resource a glTF references must be requested by exact path. M1 reads the
 * document JSON first, resolves and pre-fetches each `buffers[].uri` and
 * `images[].uri` in parallel, and hands the loader a map of uri -> blob
 * URL. Misses are recorded per uri: missing textures get a 1x1 placeholder
 * so the rest of the scene still renders; missing buffers are fatal for the
 * scene and are reported by the editor.
 */

export const PLACEHOLDER_TEXTURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export type ReferenceKind = 'buffer' | 'image'

export interface ExternalReference {
  uri: string
  kind: ReferenceKind
  index: number
}

export interface ProbeResult {
  uri: string
  kind: ReferenceKind
  path: string
  ok: boolean
  code?: string
}

export interface PrefetchResult {
  /** Loader-visible uri -> blob URL (textures that missed map to the placeholder). */
  urls: Map<string, string>
  probes: ProbeResult[]
  /** Missing external buffers: without them no scene can render. */
  missingBuffers: ProbeResult[]
}

function uriField(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return null
  const uri = (entry as { uri?: unknown }).uri
  return typeof uri === 'string' && uri.length > 0 ? uri : null
}

function isDataUri(uri: string): boolean {
  return uri.startsWith('data:')
}

function hasScheme(uri: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(uri) && !/^[a-z]:[\\/]/i.test(uri)
}

/**
 * Collects external references from a parsed glTF document. Data URIs and
 * bufferView-backed images are embedded and therefore skipped.
 */
export function collectExternalReferences(json: Record<string, unknown>): ExternalReference[] {
  const references: ExternalReference[] = []
  const buffers = Array.isArray(json.buffers) ? json.buffers : []
  buffers.forEach((entry, index) => {
    const uri = uriField(entry)
    if (uri !== null && !isDataUri(uri)) references.push({ uri, kind: 'buffer', index })
  })
  const images = Array.isArray(json.images) ? json.images : []
  images.forEach((entry, index) => {
    const uri = uriField(entry)
    if (uri !== null && !isDataUri(uri)) references.push({ uri, kind: 'image', index })
  })
  return references
}

/**
 * Normalizes a workspace-absolute path the way the shell session does:
 * `/`-rooted, no `.`/`..`/empty segments. Returns null when the path would
 * escape the root or is not resolvable.
 */
export function normalizeWorkspacePath(path: string): string | null {
  const segments: string[] = []
  for (const raw of path.split('/')) {
    if (raw === '' || raw === '.') continue
    if (raw === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    if (raw.includes('\0') || raw.includes('\\')) return null
    segments.push(raw)
  }
  return `/${segments.join('/')}`
}

/**
 * Resolves a glTF uri against the opened document's directory. glTF uris
 * are URI references, so percent-encoded characters are decoded before the
 * path is normalized. Returns null for external schemes (http, file, ...).
 */
export function resolveReferencePath(dir: string, uri: string): string | null {
  if (hasScheme(uri)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(uri)
  } catch {
    decoded = uri
  }
  const combined = decoded.startsWith('/') ? decoded : `${dir === '/' ? '' : dir}/${decoded}`
  return normalizeWorkspacePath(combined)
}

interface ReadableFile {
  readFile(path: string, encoding: 'binary'): Promise<{ bytes: ArrayBuffer }>
}

export interface PrefetchOptions {
  /** Maximum concurrent reads; the SDK allows 64 in-flight per frame. */
  concurrency?: number
  /** Injected for tests; defaults to URL.createObjectURL. */
  createObjectUrl?: (bytes: ArrayBuffer) => string
}

const errorCode = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'internal'

/**
 * Reads every external reference in parallel (bounded), producing the
 * loader map and the probe cache that later milestones reuse for their
 * reference-status UI.
 */
export async function prefetchReferences(
  files: ReadableFile,
  dir: string,
  references: ExternalReference[],
  options: PrefetchOptions = {},
): Promise<PrefetchResult> {
  const concurrency = Math.max(1, options.concurrency ?? 12)
  const createObjectUrl = options.createObjectUrl ?? ((bytes: ArrayBuffer) => URL.createObjectURL(new Blob([bytes])))
  const urls = new Map<string, string>()
  const probes: ProbeResult[] = []
  const missingBuffers: ProbeResult[] = []

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= references.length) return
      const reference = references[index]
      const path = resolveReferencePath(dir, reference.uri)
      if (path === null) {
        const probe: ProbeResult = { ...reference, path: reference.uri, ok: false, code: 'unsupported' }
        probes.push(probe)
        if (reference.kind === 'buffer') missingBuffers.push(probe)
        continue
      }
      try {
        const content = await files.readFile(path, 'binary')
        urls.set(reference.uri, createObjectUrl(content.bytes))
        probes.push({ ...reference, path, ok: true })
      } catch (error) {
        const probe: ProbeResult = { ...reference, path, ok: false, code: errorCode(error) }
        probes.push(probe)
        if (reference.kind === 'buffer') {
          missingBuffers.push(probe)
        } else {
          // Keep the loader running: a placeholder texture beats a failed parse.
          urls.set(reference.uri, PLACEHOLDER_TEXTURE_DATA_URL)
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, references.length) }, worker))
  return { urls, probes, missingBuffers }
}

/** Releases every blob URL in the map (data URLs are left alone). */
export function revokeResourceUrls(urls: Map<string, string>): void {
  for (const url of urls.values()) {
    if (url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
  }
  urls.clear()
}
