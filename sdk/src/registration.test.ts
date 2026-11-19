import { describe, expect, it } from 'vitest'
import { MessageGate } from './gate'
import { connectPlugin } from './handshake'
import { RegistrationClient } from './registration'
import type { RegistrationInit } from './protocol'
import { FakePluginTransport } from './testing'

const SHELL_ORIGIN = 'https://editor.example.com'
const SESSION_ID = 'session-1'

function init(): RegistrationInit {
  return {
    protocolVersion: '1',
    mode: 'register',
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.template', version: '1.0.0' },
    shell: { version: '0.1.0', origin: SHELL_ORIGIN },
    workspace: { name: 'demo' },
    theme: 'dark',
    permissions: ['workspace:read', 'workspace:write'],
    locale: 'en',
    settings: {},
  }
}

async function connect() {
  const transport = new FakePluginTransport({
    hostOrigin: SHELL_ORIGIN,
    sessionId: SESSION_ID,
    mode: 'register',
  })
  const promise = connectPlugin({ transport })
  transport.emit({ exo: 1, type: 'shell/init', payload: init() })
  const connection = await promise
  if (connection.mode !== 'register') throw new Error('expected register mode')
  return { transport, registration: connection.registration }
}

describe('registration client', () => {
  it('registers and completes once', async () => {
    const { transport, registration } = await connect()
    registration.register({ glob: '**/*.template.txt', entry: 'editor.html' })
    expect(transport.last('plugin/register')?.payload).toEqual({
      fileEditors: [{ glob: '**/*.template.txt', entry: 'editor.html' }],
    })

    const result = registration.complete()
    expect(
      transport.posted.filter((item) => item.type === 'plugin/register-complete'),
    ).toHaveLength(1)
    transport.emit({
      exo: 1,
      type: 'shell/register-ack',
      payload: { accepted: ['**/*.template.txt'], rejected: [] },
    })
    await expect(result).resolves.toEqual({
      accepted: ['**/*.template.txt'],
      rejected: [],
    })
    await expect(registration.complete()).rejects.toMatchObject({ code: 'protocol-violation' })
    expect(
      transport.posted.filter((item) => item.type === 'plugin/register-complete'),
    ).toHaveLength(1)
  })

  it('preserves accepted and rejected contributions', async () => {
    const { transport, registration } = await connect()
    const result = registration.complete()
    transport.emit({
      exo: 1,
      type: 'shell/register-ack',
      payload: {
        accepted: ['**/*.template.txt'],
        rejected: [{ index: 1, reason: 'not-declared', message: 'not in the manifest' }],
      },
    })
    await expect(result).resolves.toEqual({
      accepted: ['**/*.template.txt'],
      rejected: [{ index: 1, reason: 'not-declared', message: 'not in the manifest' }],
    })
  })

  it('refuses to register on an editor-mode initialization', () => {
    const transport = new FakePluginTransport({
      hostOrigin: SHELL_ORIGIN,
      sessionId: SESSION_ID,
      mode: 'editor',
    })
    const gate = new MessageGate(transport)
    const editorInit = {
      ...init(),
      mode: 'editor',
      file: {
        path: '/a.txt',
        name: 'a.txt',
        dir: '/',
        size: 1,
        mtime: 1,
        version: 'v1',
      },
      capabilities: {
        read: true,
        write: true,
        requestFiles: true,
        filePicker: true,
        directoryListing: true,
      },
      limits: { maxFileSize: 1, maxRequestBytes: 1 },
    } as unknown as RegistrationInit
    expect(() => new RegistrationClient(gate, editorInit)).toThrow(/register-mode/)
    expect(transport.posted).toHaveLength(0)
    gate.close()
  })
})
