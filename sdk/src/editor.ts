import type { MessageGate } from './gate'
import { parseShellError } from './init'
import {
  ExoProtocolError,
  MAX_IN_FLIGHT_REQUESTS,
  isPlainObject,
  type BinaryFileContent,
  type DisposeReason,
  type EditorCapabilities,
  type EditorInit,
  type EditorLimits,
  type EventPayloads,
  type EventTopic,
  type FileChangedPayload,
  type FileContent,
  type FileMetadata,
  type SaveContent,
  type SaveResult,
  type SettingValues,
  type ShellErrorPayload,
  type ShellEvent,
  type TextFileContent,
} from './protocol'

export type SaveHandler = (request: { id: string }) => SaveContent | Promise<SaveContent>
export type SaveResultListener = (result: SaveResult) => void
export type FileChangedListener = (change: FileChangedPayload) => void
export type DisposeListener = (reason: DisposeReason) => void
export type ErrorListener = (error: ShellErrorPayload) => void
export type EventListener<T extends EventTopic> = (event: ShellEvent<EventPayloads[T]>) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: ExoProtocolError) => void
}

const FILE_CHANGE_KINDS: FileChangedPayload['kind'][] = ['created', 'changed', 'deleted', 'renamed']

const DISPOSE_REASONS: DisposeReason[] = ['closed', 'workspace-switch', 'plugin-removed', 'error']

function errorOf(error: unknown): ExoProtocolError {
  if (error instanceof ExoProtocolError) return error
  return new ExoProtocolError('internal', 'The plugin operation failed.', { cause: error })
}

function parseTextOrBinary(
  payload: unknown,
): { path: string; version: string; text?: string; bytes?: ArrayBuffer } | null {
  if (!isPlainObject(payload)) return null
  if (typeof payload.path !== 'string' || typeof payload.version !== 'string') return null
  if (typeof payload.text === 'string') {
    return { path: payload.path, version: payload.version, text: payload.text }
  }
  if (payload.bytes instanceof ArrayBuffer) {
    return { path: payload.path, version: payload.version, bytes: payload.bytes }
  }
  return null
}

function isSaveContent(value: unknown): value is SaveContent {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1) return false
  if (typeof value.text === 'string') return true
  return value.bytes instanceof ArrayBuffer
}

function parseSaveResult(payload: unknown): SaveResult | null {
  if (!isPlainObject(payload)) return null
  if (payload.ok === true) {
    if (typeof payload.version !== 'string') return null
    return { ok: true, version: payload.version }
  }
  if (payload.ok !== false) return null
  const error = parseShellError(payload)
  if (!error) return null
  return {
    ok: false,
    code: error.code,
    ...(error.message === undefined ? {} : { message: error.message }),
  }
}

function parseFileChanged(payload: unknown): FileChangedPayload | null {
  if (!isPlainObject(payload)) return null
  if (typeof payload.path !== 'string') return null
  if (
    typeof payload.kind !== 'string' ||
    !FILE_CHANGE_KINDS.includes(payload.kind as FileChangedPayload['kind'])
  ) {
    return null
  }
  if (payload.version !== undefined && typeof payload.version !== 'string') return null
  return {
    path: payload.path,
    kind: payload.kind as FileChangedPayload['kind'],
    ...(payload.version === undefined ? {} : { version: payload.version }),
  }
}

function parseEvent(payload: unknown): ShellEvent | null {
  if (!isPlainObject(payload)) return null
  if (typeof payload.topic !== 'string' || typeof payload.seq !== 'number') return null
  return { topic: payload.topic as EventTopic, seq: payload.seq, payload: payload.payload }
}

/** One editor frame's protocol client. It never parses file content. */
export class EditorClient {
  private readonly gate: MessageGate
  private readonly init: EditorInit
  private readonly pending = new Map<string, PendingRequest>()
  private readonly subscriptions = new Set<string>()
  private readonly eventListeners = new Map<string, Set<(event: ShellEvent) => void>>()
  private readonly fileChangedListeners = new Set<FileChangedListener>()
  private readonly disposeListeners = new Set<DisposeListener>()
  private readonly errorListeners = new Set<ErrorListener>()
  private readonly saveResultListeners = new Set<SaveResultListener>()
  private readonly saveHandlers: SaveHandler[] = []
  private metadata: FileMetadata
  private liveSaveId: string | null = null
  private nextRequestId = 0
  private isClosed = false
  private disposed = false

  constructor(gate: MessageGate, init: EditorInit) {
    if ((init as { mode?: string }).mode !== 'editor') {
      throw new ExoProtocolError(
        'identity',
        'An editor client requires an editor-mode initialization.',
      )
    }
    this.gate = gate
    this.init = init
    this.metadata = { ...init.file }

    gate.on('shell/file-content', (envelope) =>
      this.handleContent(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/error', (envelope) => this.handleError(envelope.replyTo, envelope.payload))
    gate.on('shell/request-save', (envelope) => {
      void this.handleSaveRequest(envelope.id)
    })
    gate.on('shell/save-result', (envelope) =>
      this.handleSaveResult(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/file-changed', (envelope) => this.handleFileChanged(envelope.payload))
    gate.on('shell/subscribed', (envelope) =>
      this.handleSubscribed(envelope.replyTo, envelope.payload),
    )
    gate.on('shell/event', (envelope) => this.handleEvent(envelope.payload))
    gate.on('shell/dispose', (envelope) => this.handleDispose(envelope.payload))
  }

  get initialization(): EditorInit {
    return this.init
  }

  get file(): FileMetadata {
    return this.metadata
  }

  get capabilities(): EditorCapabilities {
    return this.init.capabilities
  }

  get limits(): EditorLimits {
    return this.init.limits
  }

  get settings(): SettingValues {
    return this.init.settings
  }

  get closed(): boolean {
    return this.isClosed
  }

  readFile(path: string, encoding?: 'utf8'): Promise<TextFileContent>
  readFile(path: string, encoding: 'binary'): Promise<BinaryFileContent>
  readFile(path: string, encoding: 'utf8' | 'binary' = 'utf8'): Promise<FileContent> {
    const id = this.nextId()
    return this.request<FileContent>(id, 'plugin/request-file', { path, encoding })
  }

  setDirty(dirty: boolean): void {
    if (this.isClosed) return
    this.gate.send('plugin/dirty', { dirty })
  }

  /**
   * Ask the shell to run its normal save action for the bound document. This is
   * an id-less intent: content still arrives only in reply to the shell's
   * `shell/request-save`, and the outcome arrives through `onSaveResult`.
   */
  requestSave(): void {
    if (this.isClosed) return
    this.gate.send('plugin/request-save')
  }

  onSaveRequest(handler: SaveHandler): () => void {
    this.saveHandlers.push(handler)
    return () => {
      const index = this.saveHandlers.lastIndexOf(handler)
      if (index >= 0) this.saveHandlers.splice(index, 1)
    }
  }

  onSaveResult(listener: SaveResultListener): () => void {
    this.saveResultListeners.add(listener)
    return () => {
      this.saveResultListeners.delete(listener)
    }
  }

  onFileChanged(listener: FileChangedListener): () => void {
    this.fileChangedListeners.add(listener)
    return () => {
      this.fileChangedListeners.delete(listener)
    }
  }

  onDispose(listener: DisposeListener): () => void {
    this.disposeListeners.add(listener)
    return () => {
      this.disposeListeners.delete(listener)
    }
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  subscribe(topic: EventTopic): Promise<{ topic: EventTopic; seq: number }> {
    const id = this.nextId()
    return this.request<{ topic: EventTopic; seq: number }>(id, 'plugin/subscribe', { topic }).then(
      (result) => {
        this.subscriptions.add(result.topic)
        return result
      },
    )
  }

  unsubscribe(topic: EventTopic): void {
    if (this.isClosed) return
    this.subscriptions.delete(topic)
    this.eventListeners.delete(topic)
    this.gate.send('plugin/unsubscribe', { topic })
  }

  onEvent<T extends EventTopic>(topic: T, listener: EventListener<T>): () => void {
    let set = this.eventListeners.get(topic)
    if (!set) {
      set = new Set()
      this.eventListeners.set(topic, set)
    }
    const wrapped = listener as (event: ShellEvent) => void
    set.add(wrapped)
    return () => {
      const current = this.eventListeners.get(topic)
      current?.delete(wrapped)
    }
  }

  close(): void {
    if (this.isClosed) return
    this.isClosed = true
    this.rejectPending()
    this.gate.close()
  }

  private nextId(): string {
    this.nextRequestId += 1
    return `exo-${this.nextRequestId}`
  }

  private request<T>(id: string, type: string, payload: unknown): Promise<T> {
    if (this.isClosed) {
      return Promise.reject(new ExoProtocolError('closed', 'The editor frame is closed.'))
    }
    if (this.pending.size >= MAX_IN_FLIGHT_REQUESTS) {
      return Promise.reject(
        new ExoProtocolError('rate-limited', 'Too many in-flight plugin requests (maximum 64).'),
      )
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      try {
        this.gate.send(type, payload, { id })
      } catch (error) {
        this.pending.delete(id)
        reject(errorOf(error))
      }
    })
  }

  private settle(id: string | undefined, error?: ExoProtocolError, value?: unknown): void {
    if (!id) return
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    if (error) pending.reject(error)
    else pending.resolve(value)
  }

  private rejectPending(): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const item of pending) {
      item.reject(new ExoProtocolError('closed', 'The editor frame was disposed.'))
    }
  }

  private handleContent(replyTo: string | undefined, payload: unknown): void {
    const content = parseTextOrBinary(payload)
    if (!content) {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent invalid file content.'),
      )
      return
    }
    this.settle(replyTo, undefined, content)
  }

  private handleError(replyTo: string | undefined, payload: unknown): void {
    const error = parseShellError(payload)
    if (replyTo) {
      if (!error) {
        this.settle(
          replyTo,
          new ExoProtocolError('protocol-violation', 'The shell sent an invalid error payload.'),
        )
        return
      }
      this.settle(
        replyTo,
        new ExoProtocolError(error.code, error.message ?? `The shell returned ${error.code}.`),
      )
      return
    }
    if (error) this.emitError(error)
  }

  private emitError(error: ShellErrorPayload): void {
    for (const listener of [...this.errorListeners]) {
      try {
        listener(error)
      } catch {
        // A listener must not break protocol dispatch.
      }
    }
  }

  private async handleSaveRequest(id: string | undefined): Promise<void> {
    const handler = this.saveHandlers.at(-1)
    if (this.isClosed || !id || !handler) return
    try {
      const content = await handler({ id })
      if (this.isClosed || !isSaveContent(content)) return
      this.liveSaveId = id
      this.gate.send('plugin/save-content', content, { replyTo: id })
    } catch {
      // The protocol has no save-cancel message; the shell's timeout is the
      // defined outcome and the document stays dirty.
    }
  }

  private handleSaveResult(replyTo: string | undefined, payload: unknown): void {
    const result = parseSaveResult(payload)
    if (!result) return
    if (this.liveSaveId !== null && replyTo !== this.liveSaveId) return
    this.liveSaveId = null
    if (result.ok) this.metadata = { ...this.metadata, version: result.version }
    for (const listener of [...this.saveResultListeners]) {
      try {
        listener(result)
      } catch {
        // Contained for the same reason as event listeners.
      }
    }
  }

  private handleFileChanged(payload: unknown): void {
    const change = parseFileChanged(payload)
    if (!change) return
    for (const listener of [...this.fileChangedListeners]) {
      try {
        listener(change)
      } catch {
        // A listener must not break later notifications.
      }
    }
  }

  private handleSubscribed(replyTo: string | undefined, payload: unknown): void {
    if (!isPlainObject(payload) || typeof payload.topic !== 'string') {
      this.settle(
        replyTo,
        new ExoProtocolError('protocol-violation', 'The shell sent an invalid subscription reply.'),
      )
      return
    }
    if (payload.code === 'unsupported-topic') {
      this.settle(
        replyTo,
        new ExoProtocolError('unsupported-topic', `The shell does not support ${payload.topic}.`),
      )
      return
    }
    if (typeof payload.seq !== 'number') {
      this.settle(
        replyTo,
        new ExoProtocolError(
          'protocol-violation',
          'The shell sent an invalid subscription sequence.',
        ),
      )
      return
    }
    this.settle(replyTo, undefined, { topic: payload.topic as EventTopic, seq: payload.seq })
  }

  private handleEvent(payload: unknown): void {
    const event = parseEvent(payload)
    if (!event) return
    const listeners = this.eventListeners.get(event.topic)
    if (listeners) {
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch {
          // One plugin listener must not stop later event delivery.
        }
      }
    }
  }

  private handleDispose(payload: unknown): void {
    if (this.isClosed) return
    const reason =
      isPlainObject(payload) &&
      typeof payload.reason === 'string' &&
      DISPOSE_REASONS.includes(payload.reason as DisposeReason)
        ? (payload.reason as DisposeReason)
        : 'closed'
    if (!this.disposed) {
      this.disposed = true
      try {
        this.gate.send('plugin/dispose-ack', {})
      } catch {
        // The frame may already be gone; disposal is still local and idempotent.
      }
    }
    this.isClosed = true
    this.rejectPending()
    for (const listener of [...this.disposeListeners]) {
      try {
        listener(reason)
      } catch {
        // A listener must not break disposal.
      }
    }
    this.gate.close()
  }
}
