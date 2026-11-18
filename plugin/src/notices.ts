/** Notice model shared by every failure path; the UI never renders a blank frame. */

import type { ProbeResult } from './resources'

export type NoticeLevel = 'info' | 'warning' | 'error'

export interface Notice {
  /** Stable identity so repeated observations dedupe instead of stacking. */
  id: string
  level: NoticeLevel
  code?: string
  title: string
  detail?: string
  path?: string
}

const MAX_NAMES_IN_DETAIL = 5

function baseName(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

/** Maps a shell read-error code to a specific, user-facing notice. */
export function noticeForReadError(path: string, code: string): Notice {
  const name = baseName(path)
  switch (code) {
    case 'too-large':
      return {
        id: `too-large:${path}`,
        level: 'error',
        code,
        title: `${name} exceeds the editor size limit`,
        detail: 'The file is larger than this shell allows a plugin to read. Open it in a tool outside the workspace.',
        path,
      }
    case 'not-found':
      return {
        id: `not-found:${path}`,
        level: 'error',
        code,
        title: `${name} was not found`,
        detail: 'The file no longer exists at this path in the workspace.',
        path,
      }
    case 'permission-denied':
      return {
        id: `permission-denied:${path}`,
        level: 'error',
        code,
        title: `${name} cannot be read`,
        detail: 'The workspace denied the read (reserved path or missing permission).',
        path,
      }
    case 'not-a-file':
      return {
        id: `not-a-file:${path}`,
        level: 'error',
        code,
        title: `${name} is a directory`,
        detail: 'A glTF document was expected but the path is a directory.',
        path,
      }
    default:
      return {
        id: `read-error:${path}:${code}`,
        level: 'error',
        code,
        title: `Could not read ${name}`,
        detail: 'The shell reported an I/O failure while reading this file.',
        path,
      }
  }
}

/** Builds the summary notice for external references that could not be read. */
export function noticeForMissingReferences(probes: ProbeResult[]): Notice | null {
  const missing = probes.filter((probe) => !probe.ok)
  if (missing.length === 0) return null
  const names = missing.slice(0, MAX_NAMES_IN_DETAIL).map((probe) => baseName(probe.path || probe.uri))
  const extra = missing.length > MAX_NAMES_IN_DETAIL ? ` and ${missing.length - MAX_NAMES_IN_DETAIL} more` : ''
  const buffers = missing.filter((probe) => probe.kind === 'buffer')
  const images = missing.filter((probe) => probe.kind === 'image')
  const parts: string[] = []
  if (buffers.length > 0) parts.push(`${buffers.length} buffer${buffers.length === 1 ? '' : 's'}`)
  if (images.length > 0) parts.push(`${images.length} texture${images.length === 1 ? '' : 's'}`)
  return {
    id: 'missing-references',
    level: buffers.length > 0 ? 'error' : 'warning',
    title: `Missing external reference${missing.length === 1 ? '' : 's'}: ${parts.join(', ')}`,
    detail: `${names.join(', ')}${extra} could not be read from the workspace.${buffers.length > 0 ? ' Meshes cannot be displayed without their buffers.' : ' Textures render with a placeholder.'}`,
  }
}

export function noticeForInvalidDocument(message: string): Notice {
  return {
    id: 'invalid-document',
    level: 'error',
    title: 'This file is not a valid glTF or GLB document',
    detail: message,
  }
}

export function noticeForStructureUnavailable(message: string | null): Notice {
  return {
    id: 'structure-unavailable',
    level: 'warning',
    title: 'The document structure could not be read',
    detail: message ?? 'The document could not be parsed for the structure explorer.',
  }
}

export function noticeForDeletion(path: string): Notice {
  return {
    id: 'deleted',
    level: 'error',
    code: 'not-found',
    title: `${baseName(path)} was deleted from the workspace`,
    detail: 'The preview shows the last content that was read. Saving would fail.',
    path,
  }
}

/** Appends a notice, replacing an entry with the same id. */
export function appendNotice(notices: Notice[], notice: Notice): Notice[] {
  const next = notices.filter((existing) => existing.id !== notice.id)
  next.push(notice)
  return next
}

export function removeNotice(notices: Notice[], id: string): Notice[] {
  return notices.filter((notice) => notice.id !== id)
}
