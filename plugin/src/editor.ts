import type { Document } from '@gltf-transform/core'
import { effect } from '@preact/signals'
import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import {
  clearNotice,
  clearNotices,
  mountApp,
  pushNotice,
  selection,
  setDocumentCapabilities,
  setExplorer,
  setManualEntry,
  setPhase,
  setPickerAvailable,
  setRepair,
  setRepairActions,
  setRepairPending,
  viewportHost,
} from './app'
import { parseDocument } from './document'
import { buildExplorerModel, focusNodeIndex } from './explorer-model'
import { GlbParseError, readDocumentJson } from './glb'
import {
  noticeForDeletion,
  noticeForExternalChangeWhileDirty,
  noticeForInvalidDocument,
  noticeForMissingReferences,
  noticeForReadError,
  noticeForRelinkFailure,
  noticeForSerializationFailure,
  noticeForStructureUnavailable,
  noticeForUnsupportedExtensions,
} from './notices'
import { buildRepairModel, type RepairItem } from './repair-model'
import {
  refreshProbes,
  relinkState,
  relinkStatesEqual,
  type RelinkMap,
} from './relink'
import { RelinkError, pickReplacement, planRelink, planRevert } from './relink-workflow'
import {
  collectExternalReferences,
  prefetchReferences,
  revokeResourceUrls,
  type PrefetchResult,
} from './resources'
import { SaveQueue } from './save-queue'
import {
  copyArrayBuffer,
  copySaveContent,
  formatForFileName,
  serializeDocument,
  type DocumentFormat,
  type SaveContent,
} from './serialization'
import { createViewport, type ThemeName, type Viewport } from './viewport'
import './styles.css'

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'internal'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function main(): Promise<void> {
  const connection = await connectBrowserPlugin()
  if (connection.mode !== 'editor') {
    throw new Error('The editor entry must be mounted in editor mode.')
  }
  const editor = connection.editor
  const root = document.getElementById('app')
  if (!root) throw new Error('Missing #app root element.')

  const initialTheme = connection.init.theme
  applyTheme(initialTheme)
  mountApp(root)

  let path = editor.file.path
  let format: DocumentFormat = formatForFileName(editor.file.name)
  let sourceBytes: Uint8Array<ArrayBuffer> | null = null
  let baselineContent: SaveContent | null = null
  let resources: PrefetchResult | null = null
  let documentModel: Document | null = null
  let relinks: RelinkMap = new Map()
  let savedRelinks = new Map<string, string>()
  let unsupported: string[] = []
  let viewport: Viewport | null = null
  let relinkUrls: string[] = []
  let dirty = false
  let disposed = false
  let pending: Promise<void> | null = null
  let applying: Promise<void> | null = null
  let lastSaveContent: SaveContent | null = null
  let lastSaveRelinks: Map<string, string> | null = null

  const saveQueue = new SaveQueue(() => serializeCurrent())

  function sourceArrayBuffer(): ArrayBuffer {
    if (!sourceBytes) throw new Error('No document content is loaded.')
    return sourceBytes.byteOffset === 0 && sourceBytes.byteLength === sourceBytes.buffer.byteLength
      ? (sourceBytes.buffer as ArrayBuffer)
      : (sourceBytes.slice().buffer as ArrayBuffer)
  }

  function documentDir(): string {
    const index = path.lastIndexOf('/')
    return index <= 0 ? '/' : path.slice(0, index)
  }

  function currentProbes() {
    return resources ? refreshProbes(resources.probes, relinks) : []
  }

  function reportReadError(error: unknown): void {
    documentModel = null
    unsupported = []
    setDocumentCapabilities(false, [])
    setRepair(null)
    setExplorer(null)
    if (error instanceof GlbParseError) {
      pushNotice(noticeForInvalidDocument(error.message))
    } else {
      pushNotice(noticeForReadError(path, errorCode(error)))
    }
    setPhase('error')
  }

  function ensureViewport(): Viewport {
    if (viewport) return viewport
    const host = viewportHost.value
    if (!host) throw new Error('The viewport host was not mounted.')
    viewport = createViewport(host, {
      onEmpty: () => {
        pushNotice({
          id: 'empty-document',
          level: 'warning',
          title: 'The file contains no renderable scene',
          detail: 'The glTF document parsed but defines no visible geometry.',
        })
        setPhase('error')
      },
      onLoadError: (message) => {
        pushNotice({
          id: 'load-error',
          level: 'error',
          title: 'The preview could not be rendered',
          detail: message,
        })
        setPhase('error')
      },
    })
    viewport.setTheme(initialTheme)
    return viewport
  }

  function revokeRelinkUrls(): void {
    for (const url of relinkUrls) URL.revokeObjectURL(url)
    relinkUrls = []
  }

  function previewUrls(): Map<string, string> {
    const urls = new Map(resources?.urls ?? [])
    if (resources) {
      for (const [originalUri, entry] of relinks) {
        const url = URL.createObjectURL(new Blob([entry.bytes]))
        urls.set(originalUri, url)
        relinkUrls.push(url)
      }
    }
    return urls
  }

  async function loadPreview(): Promise<void> {
    if (disposed || !sourceBytes || !resources) return
    revokeRelinkUrls()
    const probes = currentProbes()
    if (probes.some((probe) => !probe.ok && probe.kind === 'buffer')) {
      setPhase('error')
      return
    }
    try {
      await ensureViewport().load(sourceArrayBuffer(), previewUrls())
      setPhase('ready')
    } catch (error) {
      pushNotice({
        id: 'load-error',
        level: 'error',
        title: 'The preview could not be rendered',
        detail: errorMessage(error),
      })
      setPhase('error')
    }
  }

  function updateNotices(): void {
    clearNotice('missing-references')
    if (resources) {
      const missing = noticeForMissingReferences(currentProbes())
      if (missing) pushNotice(missing)
    }
    if (unsupported.length > 0) {
      pushNotice(noticeForUnsupportedExtensions(unsupported))
    } else {
      clearNotice('unsupported-extensions')
    }
  }

  function syncDirty(): void {
    const next = !relinkStatesEqual(relinkState(relinks), savedRelinks)
    if (next !== dirty) {
      dirty = next
      if (!disposed) editor.setDirty(dirty)
    }
    if (dirty) saveQueue.markEdited()
    else saveQueue.reset()
  }

  async function serializeCurrent(): Promise<SaveContent> {
    if (!documentModel) throw new Error('The document is not available for serialization.')
    return serializeDocument(documentModel, {
      format,
      unresolved: currentProbes().filter((probe) => !probe.ok),
      unsupportedExtensions: unsupported,
    })
  }

  async function reloadFromDisk(): Promise<void> {
    if (disposed) return
    setPhase('loading')
    const content = await editor.readFile(path, 'binary')
    sourceBytes = new Uint8Array(content.bytes)
    baselineContent = { bytes: copyArrayBuffer(content.bytes) }
    const { json } = readDocumentJson(sourceArrayBuffer())
    const references = collectExternalReferences(json)

    revokeRelinkUrls()
    if (resources) revokeResourceUrls(resources.urls)
    resources = await prefetchReferences(
      { readFile: (target, encoding) => editor.readFile(target, encoding) },
      documentDir(),
      references,
    )
    console.debug('EXO_GLTF_PROBES', resources.probes)

    relinks = new Map()
    savedRelinks = new Map()
    const parsed = await parseDocument(sourceBytes, resources)
    documentModel = parsed.document
    unsupported = parsed.unsupportedExtensions
    setDocumentCapabilities(documentModel !== null && unsupported.length === 0, unsupported)

    if (documentModel) {
      setRepair(buildRepairModel(documentModel, resources.probes, relinks))
      setExplorer(buildExplorerModel(documentModel, resources.probes))
    } else {
      setRepair(null)
      setExplorer(null)
      pushNotice(noticeForStructureUnavailable(parsed.error))
    }

    clearNotices(
      (notice) =>
        notice.id.startsWith('relink-failed:') ||
        notice.id.startsWith('read-error:') ||
        notice.id === 'save-failed' ||
        notice.id === 'serialization-failed' ||
        notice.id === 'external-change-dirty' ||
        notice.id === 'invalid-document' ||
        notice.id === 'load-error' ||
        notice.id === 'empty-document' ||
        notice.id === 'structure-unavailable',
    )
    updateNotices()
    syncDirty()
    await loadPreview()
  }

  function applyPlan(plan: { relinks: RelinkMap; document: Document; repair: ReturnType<typeof buildRepairModel> }): void {
    if (disposed || !resources) return
    documentModel = plan.document
    relinks = plan.relinks
    setRepair(plan.repair)
    setExplorer(buildExplorerModel(plan.document, currentProbes()))
    updateNotices()
    syncDirty()
    void loadPreview()
  }

  function setPending(uri: string | null): void {
    setRepairPending(uri)
  }

  function planContext() {
    if (!sourceBytes || !resources) throw new Error('The document is not ready.')
    return { sourceBytes, prefetch: resources, relinks }
  }

  async function commitRelink(item: RepairItem, targetPath: string): Promise<void> {
    const plan = await planRelink({
      ...planContext(),
      item,
      documentDir: documentDir(),
      targetPath,
      readFile: (target, encoding) => editor.readFile(target, encoding),
    })
    applyPlan(plan)
  }

  function relinkFailure(item: RepairItem, error: unknown, selectedPath = ''): void {
    const code = errorCode(error)
    const readCodes = new Set(['not-found', 'too-large', 'permission-denied', 'not-a-file'])
    if (error instanceof RelinkError && readCodes.has(error.code)) {
      pushNotice(noticeForReadError(error.path ?? (selectedPath || item.path), error.code))
      return
    }
    const path = error instanceof RelinkError ? (error.path ?? selectedPath) : selectedPath
    pushNotice(noticeForRelinkFailure(item.originalUri, path, code, errorMessage(error)))
  }

  function startOperation(uri: string, task: () => Promise<void>, errorFor: (error: unknown) => void): Promise<void> {
    const running = (async () => {
      setPending(uri)
      try {
        await task()
      } catch (error) {
        errorFor(error)
      } finally {
        applying = null
        setPending(null)
        pending = null
      }
    })()
    pending = running
    applying = running
    return running
  }

  async function relink(item: RepairItem): Promise<void> {
    if (disposed || pending !== null || !documentModel) return
    if (!editor.capabilities.filePicker) {
      setPickerAvailable(false)
      setManualEntry(item.originalUri)
      return
    }

    let pickedPath: string | null = null
    await startOperation(
      item.originalUri,
      async () => {
        const picked = await pickReplacement(
          { capabilities: editor.capabilities, requestFiles: (options) => editor.requestFiles(options) },
          item.path.startsWith('/') ? item.path.slice(0, item.path.lastIndexOf('/')) || '/' : documentDir(),
        )
        if (picked.status === 'unsupported') {
          setPickerAvailable(false)
          setManualEntry(item.originalUri)
          return
        }
        if (picked.status === 'cancelled') return
        pickedPath = picked.path
        await commitRelink(item, picked.path)
      },
      (error) => relinkFailure(item, error, pickedPath ?? ''),
    )
  }

  async function manualRelink(item: RepairItem, inputPath: string): Promise<void> {
    if (disposed || pending !== null || !documentModel) return
    await startOperation(
      item.originalUri,
      async () => {
        await commitRelink(item, inputPath)
        setManualEntry(null)
      },
      (error) => relinkFailure(item, error, inputPath),
    )
  }

  async function revert(item: RepairItem): Promise<void> {
    if (disposed || pending !== null || !documentModel) return
    await startOperation(
      item.originalUri,
      async () => {
        const plan = await planRevert({
          ...planContext(),
          originalUri: item.originalUri,
        })
        applyPlan(plan)
      },
      (error) => relinkFailure(item, error),
    )
  }

  // Node selection is the only spatial action; other kinds never move the camera.
  const disposeSelectionEffect = effect(() => {
    const index = focusNodeIndex(selection.value)
    if (index !== null) viewport?.focusNode(index)
  })

  setRepairActions({
    relink: (item) => void relink(item),
    revert: (item) => void revert(item),
    applyManual: (item, value) => void manualRelink(item, value),
    runNoticeAction: (id) => {
      if (id !== 'reload') return
      void reloadFromDisk().catch(reportReadError)
    },
  })
  setPickerAvailable(editor.capabilities.filePicker)

  editor.onSaveRequest(async () => {
    if (!baselineContent) throw new Error('No content has been read yet.')
    if (applying) await applying
    try {
      // Capture the edit state before serialization starts; if another edit
      // commits while the save is in flight, the tab must stay dirty.
      const requestRelinks = relinkState(relinks)
      const started = performance.now()
      const content = await saveQueue.save(dirty, () => baselineContent!)
      console.debug('EXO_GLTF_SAVE_MS', Math.round(performance.now() - started))
      // The SDK transfers the buffer; keep an independent copy as the baseline.
      lastSaveContent = copySaveContent(content)
      lastSaveRelinks = requestRelinks
      return content
    } catch (error) {
      pushNotice(noticeForSerializationFailure(errorMessage(error)))
      throw error
    }
  })

  editor.onSaveResult((result) => {
    if (result.ok) {
      if (lastSaveContent) baselineContent = lastSaveContent
      if (lastSaveRelinks) savedRelinks = lastSaveRelinks
      lastSaveContent = null
      lastSaveRelinks = null
      clearNotice('save-failed')
      clearNotice('serialization-failed')
      clearNotice('external-change-dirty')
      syncDirty()
      return
    }
    lastSaveContent = null
    lastSaveRelinks = null
    pushNotice({
      id: 'save-failed',
      level: 'error',
      code: result.code,
      title: 'Saving the file failed',
      detail:
        result.message ??
        `The shell reported ${result.code}. Your repairs are kept and the tab stays dirty.`,
    })
  })

  editor.onFileChanged((change) => {
    if (disposed) return
    if (change.kind === 'renamed') {
      path = change.path
      format = formatForFileName(change.path)
    }
    if (change.kind === 'deleted') {
      pushNotice(noticeForDeletion(path))
      if (!dirty) setPhase('error')
      return
    }
    if (dirty) {
      pushNotice(noticeForExternalChangeWhileDirty())
      return
    }
    void reloadFromDisk().catch(reportReadError)
  })

  editor.onError((error) => {
    pushNotice({
      id: `shell-error:${error.code}`,
      level: 'error',
      code: error.code,
      title: 'The shell reported an error',
      detail: error.message ?? error.code,
    })
  })

  editor.onDispose(() => {
    disposed = true
    saveQueue.dispose()
    disposeSelectionEffect()
    viewport?.dispose()
    viewport = null
    revokeRelinkUrls()
    if (resources) {
      revokeResourceUrls(resources.urls)
      resources = null
    }
    documentModel = null
    sourceBytes = null
    baselineContent = null
    relinks = new Map()
    setRepair(null)
    setRepairActions(null)
    setRepairPending(null)
    setExplorer(null)
  })

  // Theme changes are optional; older shells simply never emit them.
  editor.subscribe('theme/changed').catch(() => undefined)
  editor.onEvent('theme/changed', (event) => {
    applyTheme(event.payload.theme)
    viewport?.setTheme(event.payload.theme)
  })

  try {
    await reloadFromDisk()
  } catch (error) {
    reportReadError(error)
  }
}

main().catch((error: unknown) => {
  // Boot failure: no app UI exists yet, so surface actionable text.
  document.body.textContent =
    error instanceof Error ? `glTF Viewer failed to start: ${error.message}` : String(error)
})
