import { describe, expect, it } from 'vitest'
import { connectPlugin } from './handshake'
import {
  ExoProtocolError,
  type EditorInit,
  type PluginPermission,
  type RegistrationInit,
} from './protocol'
import { FakePluginTransport } from './testing'

const SHELL_ORIGIN = 'https://editor.example.com'
const SESSION_ID = 'session-1'

function base(mode: 'register' | 'editor') {
  return {
    protocolVersion: '1',
    mode,
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.template', version: '1.0.0' },
    shell: { version: '0.1.0', origin: SHELL_ORIGIN },
    workspace: { name: 'demo' },
    theme: 'dark' as const,
    permissions: ['workspace:read', 'workspace:write'] as PluginPermission[],
    locale: 'en',
    settings: { 'template.greeting': 'hello' },
  }
}

function registerInit(overrides: Partial<RegistrationInit> = {}): RegistrationInit {
  return { ...base('register'), mode: 'register', ...overrides }
}

function editorInit(overrides: Partial<EditorInit> = {}): EditorInit {
  return {
    ...base('editor'),
    mode: 'editor',
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
    ...overrides,
  }
}

function transport(mode: 'register' | 'editor' = 'register') {
  return new FakePluginTransport({
    hostOrigin: SHELL_ORIGIN,
    sessionId: SESSION_ID,
    mode,
  })
}

describe('handshake', () => {
  it('sends one ready and returns the typed registration client', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake })
    expect(fake.last('plugin/ready')?.payload).toEqual({
      protocolVersion: '1',
      sessionId: SESSION_ID,
    })
    fake.emit({ exo: 1, type: 'shell/init', payload: registerInit() })
    const connection = await promise
    expect(connection.mode).toBe('register')
    if (connection.mode === 'register') {
      expect(connection.init.plugin.id).toBe('com.example.template')
      expect(connection.init.settings).toEqual({ 'template.greeting': 'hello' })
    }
    expect(fake.posted.filter((envelope) => envelope.type === 'plugin/ready')).toHaveLength(1)
  })

  it('returns the typed editor client with metadata', async () => {
    const fake = transport('editor')
    const promise = connectPlugin({ transport: fake })
    fake.emit({ exo: 1, type: 'shell/init', payload: editorInit() })
    const connection = await promise
    expect(connection.mode).toBe('editor')
    if (connection.mode === 'editor') {
      expect(connection.editor.file.path).toBe('/notes.template.txt')
      expect(connection.editor.capabilities.write).toBe(true)
      expect(connection.editor.limits.maxRequestBytes).toBe(16 * 1024 * 1024)
    }
  })

  it('surfaces a shell unsupported-version rejection with both versions', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake, protocolVersion: '2' })
    fake.emit({ exo: 1, type: 'shell/error', payload: { code: 'unsupported-version' } })
    const error = await promise.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ExoProtocolError)
    expect(error).toMatchObject({
      code: 'unsupported-version',
      expected: '1',
      received: '2',
    })
  })

  it('rejects an init with a different protocol major', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake })
    fake.emit({
      exo: 1,
      type: 'shell/init',
      payload: { ...registerInit(), protocolVersion: '2' },
    })
    await expect(promise).rejects.toMatchObject({
      code: 'unsupported-version',
      expected: '1',
      received: '2',
    })
  })

  it('rejects a wrong mode and a wrong session as identity errors', async () => {
    const wrongMode = transport()
    const modePromise = connectPlugin({ transport: wrongMode })
    wrongMode.emit({ exo: 1, type: 'shell/init', payload: editorInit() })
    await expect(modePromise).rejects.toMatchObject({ code: 'identity' })

    const wrongSession = transport()
    const sessionPromise = connectPlugin({ transport: wrongSession })
    wrongSession.emit({
      exo: 1,
      type: 'shell/init',
      payload: registerInit({ sessionId: 'other' }),
    })
    await expect(sessionPromise).rejects.toMatchObject({ code: 'identity' })
  })

  it('rejects a malformed init', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake })
    fake.emit({ exo: 1, type: 'shell/init', payload: {} })
    await expect(promise).rejects.toMatchObject({ code: 'protocol-violation' })
  })

  it('times out when no init arrives', async () => {
    const fake = transport()
    await expect(connectPlugin({ transport: fake, timeoutMs: 5 })).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('ignores init from a foreign origin', async () => {
    const fake = transport()
    const promise = connectPlugin({ transport: fake, timeoutMs: 5 })
    fake.emit(
      { exo: 1, type: 'shell/init', payload: registerInit() },
      { origin: 'https://evil.example.com' },
    )
    await expect(promise).rejects.toMatchObject({ code: 'timeout' })
  })
})
