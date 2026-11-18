import { connectBrowserPlugin } from '@exo/plugin-sdk/browser'
import { mountApp, pushNotice, setFileName, setPhase, viewportHost } from './app'
import { GlbParseError, readDocumentJson } from './glb'
import {
  noticeForDeletion,
  noticeForInvalidDocument,
  noticeForMissingReferences,
  noticeForReadError,
} from './notices'
import {
  collectExternalReferences,
  prefetchReferences,
  revokeResourceUrls,
  type PrefetchResult,
} from './resources'
import { passThroughSave } from './save'
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
  setFileName(editor.file.name)
  mountApp(root)

  let path = editor.file.path
  let bytes: Uint8Array | null = null
  let resources: PrefetchResult | null = null
  let viewport: Viewport | null = null
  let disposed = false
  const reportReadError = (error: unknown): void => {
    if (error instanceof GlbParseError) {
      pushNotice(noticeForInvalidDocument(error.message))
    } else {
      pushNotice(noticeForReadError(path, errorCode(error)))
    }
    setPhase('error')
  }

  const ensureViewport = (): Viewport => {
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

  const reload = async (): Promise<void> => {
    if (disposed) return
    setPhase('loading')
    const content = await editor.readFile(path, 'binary')
    const documentBytes = content.bytes
    bytes = new Uint8Array(documentBytes)
    const { json } = readDocumentJson(documentBytes)
    const references = collectExternalReferences(json)

    if (resources) revokeResourceUrls(resources.urls)
    resources = await prefetchReferences(
      { readFile: (target, encoding) => editor.readFile(target, encoding) },
      editor.file.dir,
      references,
    )
    console.debug('EXO_GLTF_PROBES', resources.probes)

    const missing = noticeForMissingReferences(resources.probes)
    if (missing) pushNotice(missing)
    if (resources.missingBuffers.length > 0) {
      setPhase('error')
      return
    }

    await ensureViewport().load(documentBytes, resources.urls)
    setPhase('ready')
  }

  // M1 performs no edits: every save returns the exact bytes last read.
  editor.onSaveRequest(() => {
    if (!bytes) throw new Error('No content has been read yet.')
    return passThroughSave(bytes)
  })

  editor.onSaveResult((result) => {
    if (result.ok) return
    pushNotice({
      id: 'save-failed',
      level: 'error',
      code: result.code,
      title: 'Saving the file failed',
      detail:
        result.message ??
        `The shell reported ${result.code}. The file may have changed on disk or is read-only.`,
    })
  })

  editor.onFileChanged((change) => {
    if (disposed) return
    if (change.kind === 'renamed') path = change.path
    if (change.kind === 'deleted') {
      pushNotice(noticeForDeletion(path))
      setPhase('error')
      return
    }
    // The preview is never dirty, so an external change always reloads.
    void reload().catch(reportReadError)
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
    viewport?.dispose()
    viewport = null
    if (resources) {
      revokeResourceUrls(resources.urls)
      resources = null
    }
    bytes = null
  })

  // Theme changes are optional; older shells simply never emit them.
  editor.subscribe('theme/changed').catch(() => undefined)
  editor.onEvent('theme/changed', (event) => {
    applyTheme(event.payload.theme)
    viewport?.setTheme(event.payload.theme)
  })

  try {
    await reload()
  } catch (error) {
    reportReadError(error)
  }
}

main().catch((error: unknown) => {
  // Boot failure: no app chrome exists yet, so surface actionable text.
  document.body.textContent =
    error instanceof Error ? `glTF Viewer failed to start: ${error.message}` : String(error)
})
