import { describe, expect, it, vi } from 'vitest'
import { connectPlugin } from './handshake'
import type { EditorInit, EventTopic, SaveResult } from './protocol'
import { FakePluginTransport } from './testing'

const SHELL_ORIGIN = 'https://editor.example.com'
const SESSION_ID = 'session-1'

function init(): EditorInit {
  return {
    protocolVersion: '1',
    mode: 'editor',
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.template', version: '1.0.0' },
    shell: { version: '0.1.0', origin: SHELL_ORIGIN },
    workspace: { name: 'demo' },
    theme: 'dark',
    permissions: ['workspace:read', 'workspace:write', 'events:subscribe'],
    locale: 'en',
    settings: { 'template.greeting': 'hello' },
    file: {
      path: '/notes.template.txt',
      name: 'notes.template.txt',
      dir: '/',
      size: 5,
      mtime: 1000,
      version: 'v1',
    },
    capabilities: { read: true, write: true, requestFiles: true },
    limits: { maxFileSize: 10 * 1024 * 1024, maxRequestBytes: 16 * 1024 * 1024 },
  }
}

async function connect() {
  const transport = new FakePluginTransport({
    hostOrigin: SHELL_ORIGIN,
    sessionId: SESSION_ID,
    mode: 'editor',
  })
  const promise = connectPlugin({ transport })
  transport.emit({ exo: 1, type: 'shell/init', payload: init() })
  const connection = await promise
  if (connection.mode !== 'editor') throw new Error('expected editor mode')
  return { transport, editor: connection.editor }
}

function postedId(transport: FakePluginTransport, type: string): string {
  const envelope = transport.last(type)
  if (!envelope?.id) throw new Error(`no ${type} id`)
  return envelope.id
}

describe('editor client', () => {
  it('exposes metadata without reading content', async () => {
    const { transport, editor } = await connect()
    expect(editor.file).toMatchObject({ path: '/notes.template.txt', version: 'v1' })
    expect(editor.capabilities).toEqual({ read: true, write: true, requestFiles: true })
    expect(editor.settings).toEqual({ 'template.greeting': 'hello' })
    expect(transport.posted.filter((item) => item.type === 'plugin/request-file')).toHaveLength(0)
  })

  it('reads text and binary content by correlated id', async () => {
    const { transport, editor } = await connect()
    const text = editor.readFile('/notes.template.txt')
    const textId = postedId(transport, 'plugin/request-file')
    transport.emit({
      exo: 1,
      type: 'shell/file-content',
      replyTo: textId,
      payload: { path: '/notes.template.txt', version: 'v1', text: 'hello' },
    })
    await expect(text).resolves.toEqual({
      path: '/notes.template.txt',
      version: 'v1',
      text: 'hello',
    })

    const bytes = new Uint8Array([1, 2, 3]).buffer
    const binary = editor.readFile('./other.bin', 'binary')
    const binaryId = postedId(transport, 'plugin/request-file')
    expect(transport.last('plugin/request-file')?.payload).toEqual({
      path: './other.bin',
      encoding: 'binary',
    })
    transport.emit({
      exo: 1,
      type: 'shell/file-content',
      replyTo: binaryId,
      payload: { path: '/other.bin', version: 'v2', bytes },
    })
    await expect(binary).resolves.toEqual({ path: '/other.bin', version: 'v2', bytes })
  })

  it('keeps an unrelated request pending after one error', async () => {
    const { transport, editor } = await connect()
    const first = editor.readFile('/a.txt').catch((error: unknown) => error)
    const firstId = postedId(transport, 'plugin/request-file')
    const second = editor.readFile('/b.txt')
    const secondId = postedId(transport, 'plugin/request-file')

    transport.emit({
      exo: 1,
      type: 'shell/error',
      replyTo: firstId,
      payload: { code: 'permission-denied', message: 'no' },
    })
    await expect(first).resolves.toMatchObject({ code: 'permission-denied' })
    transport.emit({
      exo: 1,
      type: 'shell/file-content',
      replyTo: secondId,
      payload: { path: '/b.txt', version: 'v1', text: 'b' },
    })
    await expect(second).resolves.toMatchObject({ text: 'b' })
  })

  it('caps in-flight requests', async () => {
    const { transport, editor } = await connect()
    const pending: Promise<unknown>[] = []
    for (let index = 0; index < 64; index += 1) {
      pending.push(editor.readFile(`/file-${index}.txt`).catch(() => undefined))
    }
    await expect(editor.readFile('/overflow.txt')).rejects.toMatchObject({ code: 'rate-limited' })
    expect(transport.posted.filter((item) => item.type === 'plugin/request-file')).toHaveLength(64)
    editor.close()
    await Promise.all(pending)
  })

  it('reports dirty state', async () => {
    const { transport, editor } = await connect()
    editor.setDirty(true)
    expect(transport.last('plugin/dirty')?.payload).toEqual({ dirty: true })
    editor.setDirty(false)
    expect(transport.last('plugin/dirty')?.payload).toEqual({ dirty: false })
  })

  it('sends one id-less save intent and nothing after close', async () => {
    const { transport, editor } = await connect()
    editor.requestSave()
    expect(transport.last('plugin/request-save')).toEqual({ exo: 1, type: 'plugin/request-save' })
    expect(transport.posted.filter((message) => message.type === 'plugin/save-content')).toEqual([])

    editor.close()
    const posted = transport.posted.length
    editor.requestSave()
    expect(transport.posted).toHaveLength(posted)
  })

  it('answers a save request and exposes the result', async () => {
    const { transport, editor } = await connect()
    editor.onSaveRequest(() => ({ text: 'saved text' }))
    const results: SaveResult[] = []
    editor.onSaveResult((result) => results.push(result))

    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-1', payload: {} })
    await Promise.resolve()
    expect(transport.last('plugin/save-content')).toEqual({
      exo: 1,
      type: 'plugin/save-content',
      replyTo: 'save-1',
      payload: { text: 'saved text' },
    })

    transport.emit({
      exo: 1,
      type: 'shell/save-result',
      replyTo: 'save-1',
      payload: { ok: true, version: 'v2' },
    })
    expect(results).toEqual([{ ok: true, version: 'v2' }])
    expect(editor.file.version).toBe('v2')
  })

  it('does not write when the save handler throws or is absent', async () => {
    const { transport, editor } = await connect()
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-0', payload: {} })
    await Promise.resolve()
    expect(transport.last('plugin/save-content')).toBeUndefined()

    editor.onSaveRequest(() => {
      throw new Error('no content')
    })
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-1', payload: {} })
    await Promise.resolve()
    expect(transport.last('plugin/save-content')).toBeUndefined()

    editor.onSaveRequest(() => ({ text: 'ok' }))
    const off = editor.onSaveRequest(() => ({ text: 'first' }))
    off()
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-2', payload: {} })
    await Promise.resolve()
    expect(transport.last('plugin/save-content')?.replyTo).toBe('save-2')
  })

  it('surfaces a failed save without changing the version', async () => {
    const { transport, editor } = await connect()
    editor.onSaveRequest(() => ({ text: 'saved' }))
    const results: SaveResult[] = []
    editor.onSaveResult((result) => results.push(result))
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-1', payload: {} })
    await Promise.resolve()
    transport.emit({
      exo: 1,
      type: 'shell/save-result',
      replyTo: 'save-1',
      payload: { ok: false, code: 'conflict' },
    })
    expect(results).toEqual([{ ok: false, code: 'conflict' }])
    expect(editor.file.version).toBe('v1')
  })

  it('delivers external changes without changing dirty state', async () => {
    const { transport, editor } = await connect()
    const changes: unknown[] = []
    editor.onFileChanged((change) => changes.push(change))
    transport.emit({
      exo: 1,
      type: 'shell/file-changed',
      payload: { path: '/notes.template.txt', kind: 'changed', version: 'v2' },
    })
    expect(changes).toEqual([{ path: '/notes.template.txt', kind: 'changed', version: 'v2' }])
    expect(transport.last('plugin/dirty')).toBeUndefined()
  })

  it('acknowledges dispose once, rejects pending work and ignores later messages', async () => {
    const { transport, editor } = await connect()
    const pending = editor.readFile('/a.txt').catch((error: unknown) => error)
    const reasons: string[] = []
    editor.onDispose((reason) => reasons.push(reason))
    transport.emit({ exo: 1, type: 'shell/dispose', payload: { reason: 'workspace-switch' } })
    await expect(pending).resolves.toMatchObject({ code: 'closed' })
    expect(reasons).toEqual(['workspace-switch'])
    expect(editor.closed).toBe(true)
    expect(transport.posted.filter((item) => item.type === 'plugin/dispose-ack')).toHaveLength(1)

    transport.emit({ exo: 1, type: 'shell/dispose', payload: { reason: 'closed' } })
    expect(transport.posted.filter((item) => item.type === 'plugin/dispose-ack')).toHaveLength(1)
    expect(transport.last('plugin/request-file')).toBeDefined()
    expect(transport.posted.filter((item) => item.type === 'plugin/request-file')).toHaveLength(1)
  })

  it('subscribes, delivers typed events and contains a throwing listener', async () => {
    const { transport, editor } = await connect()
    const subscription = editor.subscribe('theme/changed')
    const subscribeId = postedId(transport, 'plugin/subscribe')
    transport.emit({
      exo: 1,
      type: 'shell/subscribed',
      replyTo: subscribeId,
      payload: { topic: 'theme/changed', seq: 3 },
    })
    await expect(subscription).resolves.toEqual({ topic: 'theme/changed', seq: 3 })

    const seen: unknown[] = []
    editor.onEvent('theme/changed', (event) => seen.push(event))
    editor.onEvent('theme/changed', () => {
      throw new Error('listener')
    })
    transport.emit({
      exo: 1,
      type: 'shell/event',
      payload: { topic: 'theme/changed', seq: 4, payload: { theme: 'light' } },
    })
    transport.emit({
      exo: 1,
      type: 'shell/event',
      payload: { topic: 'theme/changed', seq: 5, payload: { theme: 'dark' } },
    })
    expect(seen).toEqual([
      { topic: 'theme/changed', seq: 4, payload: { theme: 'light' } },
      { topic: 'theme/changed', seq: 5, payload: { theme: 'dark' } },
    ])
  })

  it('rejects unsupported topics and missing subscriptions', async () => {
    const { transport, editor } = await connect()
    const unsupported = editor.subscribe('not/a-topic' as EventTopic)
    const unsupportedId = postedId(transport, 'plugin/subscribe')
    transport.emit({
      exo: 1,
      type: 'shell/subscribed',
      replyTo: unsupportedId,
      payload: { topic: 'not/a-topic', code: 'unsupported-topic' },
    })
    await expect(unsupported).rejects.toMatchObject({ code: 'unsupported-topic' })

    const denied = editor.subscribe('config/changed')
    const deniedId = postedId(transport, 'plugin/subscribe')
    transport.emit({
      exo: 1,
      type: 'shell/error',
      replyTo: deniedId,
      payload: { code: 'permission-denied' },
    })
    await expect(denied).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('unsubscribes locally and immediately', async () => {
    const { transport, editor } = await connect()
    const subscription = editor.subscribe('theme/changed')
    const subscribeId = postedId(transport, 'plugin/subscribe')
    transport.emit({
      exo: 1,
      type: 'shell/subscribed',
      replyTo: subscribeId,
      payload: { topic: 'theme/changed', seq: 0 },
    })
    await subscription
    const seen: unknown[] = []
    editor.onEvent('theme/changed', (event) => seen.push(event))
    editor.unsubscribe('theme/changed')
    expect(transport.last('plugin/unsubscribe')?.payload).toEqual({ topic: 'theme/changed' })
    transport.emit({
      exo: 1,
      type: 'shell/event',
      payload: { topic: 'theme/changed', seq: 1, payload: { theme: 'light' } },
    })
    expect(seen).toEqual([])
  })

  it('surfaces unsolicited errors without closing', async () => {
    const { transport, editor } = await connect()
    const errors: unknown[] = []
    editor.onError((error) => errors.push(error))
    transport.emit({ exo: 1, type: 'shell/error', payload: { code: 'rate-limited' } })
    expect(errors).toEqual([{ code: 'rate-limited' }])
    expect(editor.closed).toBe(false)
  })

  it('contains a throwing save-result listener', async () => {
    const { transport, editor } = await connect()
    editor.onSaveRequest(() => ({ text: 'saved' }))
    editor.onSaveResult(() => {
      throw new Error('listener')
    })
    const later = vi.fn()
    editor.onSaveResult(later)
    transport.emit({ exo: 1, type: 'shell/request-save', id: 'save-1', payload: {} })
    await Promise.resolve()
    transport.emit({
      exo: 1,
      type: 'shell/save-result',
      replyTo: 'save-1',
      payload: { ok: true, version: 'v2' },
    })
    expect(later).toHaveBeenCalledWith({ ok: true, version: 'v2' })
  })
})
