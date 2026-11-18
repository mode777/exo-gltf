import {
  ExoProtocolError,
  isPlainObject,
  type EditorCapabilities,
  type EditorInit,
  type EditorLimits,
  type FileMetadata,
  type PluginMode,
  type PluginPermission,
  type RegistrationInit,
  type ShellErrorCode,
  type ShellErrorPayload,
  type ShellInit,
  type SettingValues,
  type ThemeName,
} from './protocol'

const THEMES: ThemeName[] = ['dark', 'light', 'high-contrast']

const SHELL_ERROR_CODES: ShellErrorCode[] = [
  'unsupported-message',
  'unsupported-version',
  'protocol-violation',
  'timeout',
  'loading-failed',
  'permission-denied',
  'not-found',
  'not-a-file',
  'too-large',
  'conflict',
  'rate-limited',
  'internal',
]

function invalid(path: string, message: string): never {
  throw new ExoProtocolError('protocol-violation', `Invalid shell/init at ${path}: ${message}`)
}

function stringAt(value: Record<string, unknown>, key: string, path: string): string {
  const item = value[key]
  if (typeof item !== 'string') invalid(`${path}.${key}`, 'expected a string')
  return item
}

function numberAt(value: Record<string, unknown>, key: string, path: string): number {
  const item = value[key]
  if (typeof item !== 'number' || !Number.isFinite(item)) {
    invalid(`${path}.${key}`, 'expected a finite number')
  }
  return item
}

function booleanAt(value: Record<string, unknown>, key: string, path: string): boolean {
  const item = value[key]
  if (typeof item !== 'boolean') invalid(`${path}.${key}`, 'expected a boolean')
  return item
}

function objectAt(
  value: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> {
  const item = value[key]
  if (!isPlainObject(item)) invalid(`${path}.${key}`, 'expected an object')
  return item
}

function settingsAt(value: Record<string, unknown>, path: string): SettingValues {
  const settings = objectAt(value, 'settings', path)
  const result: SettingValues = {}
  for (const [key, item] of Object.entries(settings)) {
    if (typeof item !== 'boolean' && typeof item !== 'string' && typeof item !== 'number') {
      invalid(`${path}.settings.${key}`, 'expected a boolean, string or number')
    }
    if (typeof item === 'number' && !Number.isFinite(item)) {
      invalid(`${path}.settings.${key}`, 'expected a finite number')
    }
    result[key] = item
  }
  return result
}

function fileAt(value: Record<string, unknown>, path: string): FileMetadata {
  const file = objectAt(value, 'file', path)
  const metadata: FileMetadata = {
    path: stringAt(file, 'path', `${path}.file`),
    name: stringAt(file, 'name', `${path}.file`),
    dir: stringAt(file, 'dir', `${path}.file`),
    size: numberAt(file, 'size', `${path}.file`),
    mtime: numberAt(file, 'mtime', `${path}.file`),
    version: stringAt(file, 'version', `${path}.file`),
  }
  if (file.languageHint !== undefined) {
    metadata.languageHint = stringAt(file, 'languageHint', `${path}.file`)
  }
  return metadata
}

function capabilitiesAt(value: Record<string, unknown>, path: string): EditorCapabilities {
  const capabilities = objectAt(value, 'capabilities', path)
  return {
    read: booleanAt(capabilities, 'read', `${path}.capabilities`),
    write: booleanAt(capabilities, 'write', `${path}.capabilities`),
    requestFiles: booleanAt(capabilities, 'requestFiles', `${path}.capabilities`),
  }
}

function limitsAt(value: Record<string, unknown>, path: string): EditorLimits {
  const limits = objectAt(value, 'limits', path)
  return {
    maxFileSize: numberAt(limits, 'maxFileSize', `${path}.limits`),
    maxRequestBytes: numberAt(limits, 'maxRequestBytes', `${path}.limits`),
  }
}

export function parseShellInit(
  payload: unknown,
  transport: { mode: PluginMode; sessionId: string },
  requestedVersion: string,
): ShellInit {
  if (!isPlainObject(payload)) invalid('/', 'expected an object')
  const init = payload
  const protocolVersion = stringAt(init, 'protocolVersion', '/')
  const mode = stringAt(init, 'mode', '/')
  const sessionId = stringAt(init, 'sessionId', '/')

  if (protocolVersion !== requestedVersion) {
    throw new ExoProtocolError(
      'unsupported-version',
      `The shell reported protocol version ${protocolVersion}; this SDK requested ${requestedVersion}.`,
      { expected: requestedVersion, received: protocolVersion },
    )
  }
  if (mode !== transport.mode) {
    throw new ExoProtocolError(
      'identity',
      `The shell initialized a ${mode} frame where a ${transport.mode} frame was mounted.`,
    )
  }
  if (sessionId !== transport.sessionId) {
    throw new ExoProtocolError('identity', 'The shell session id does not match the frame session.')
  }

  const plugin = objectAt(init, 'plugin', '/')
  const shell = objectAt(init, 'shell', '/')
  const workspace = objectAt(init, 'workspace', '/')
  const theme = stringAt(init, 'theme', '/')
  if (!THEMES.includes(theme as ThemeName)) invalid('/theme', 'unknown theme')
  const permissions = init.permissions
  if (!Array.isArray(permissions) || permissions.some((item) => typeof item !== 'string')) {
    invalid('/permissions', 'expected an array of strings')
  }

  const base = {
    protocolVersion,
    sessionId,
    plugin: {
      id: stringAt(plugin, 'id', '/plugin'),
      version: stringAt(plugin, 'version', '/plugin'),
    },
    shell: {
      version: stringAt(shell, 'version', '/shell'),
      origin: stringAt(shell, 'origin', '/shell'),
    },
    workspace: { name: stringAt(workspace, 'name', '/workspace') },
    theme: theme as ThemeName,
    permissions: permissions as PluginPermission[],
    locale: stringAt(init, 'locale', '/'),
    settings: settingsAt(init, '/'),
  }

  if (mode === 'register') {
    return { ...base, mode } satisfies RegistrationInit
  }
  if (mode !== 'editor') invalid('/mode', 'expected register or editor')
  return {
    ...base,
    mode,
    file: fileAt(init, '/'),
    capabilities: capabilitiesAt(init, '/'),
    limits: limitsAt(init, '/'),
  } satisfies EditorInit
}

export function parseShellError(payload: unknown): ShellErrorPayload | null {
  if (!isPlainObject(payload)) return null
  const code = payload.code
  if (typeof code !== 'string' || !SHELL_ERROR_CODES.includes(code as ShellErrorCode)) return null
  if (payload.message !== undefined && typeof payload.message !== 'string') return null
  return {
    code: code as ShellErrorCode,
    ...(payload.message === undefined ? {} : { message: payload.message }),
  }
}
