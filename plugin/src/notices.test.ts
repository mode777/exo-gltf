import { describe, expect, it } from 'vitest'
import {
  appendNotice,
  noticeForDeletion,
  noticeForInvalidDocument,
  noticeForMissingReferences,
  noticeForReadError,
  removeNotice,
  type Notice,
} from './notices'
import type { ProbeResult } from './resources'

describe('noticeForReadError', () => {
  it('maps stable codes to specific notices', () => {
    expect(noticeForReadError('/w/model.glb', 'too-large')).toMatchObject({
      id: 'too-large:/w/model.glb',
      level: 'error',
      title: 'model.glb exceeds the editor size limit',
    })
    expect(noticeForReadError('/w/model.gltf', 'not-found').title).toBe('model.gltf was not found')
    expect(noticeForReadError('/w/a.png', 'permission-denied').title).toBe('a.png cannot be read')
    expect(noticeForReadError('/w/dir', 'not-a-file').title).toBe('dir is a directory')
  })

  it('falls back to a generic read notice for unknown codes', () => {
    const notice = noticeForReadError('/w/x.bin', 'io')
    expect(notice.id).toBe('read-error:/w/x.bin:io')
    expect(notice.title).toBe('Could not read x.bin')
  })
})

describe('noticeForMissingReferences', () => {
  const probe = (path: string, kind: 'buffer' | 'image', ok = false): ProbeResult => ({
    uri: path,
    path,
    kind,
    ok,
  })

  it('returns null when every reference resolved', () => {
    expect(noticeForMissingReferences([probe('/w/a.png', 'image', true)])).toBeNull()
  })

  it('warns when only textures are missing', () => {
    const notice = noticeForMissingReferences([
      probe('/w/models/tex/a.png', 'image'),
      probe('/w/models/tex/b.png', 'image'),
    ])
    expect(notice).toMatchObject({ id: 'missing-references', level: 'warning' })
    expect(notice?.title).toContain('2 textures')
    expect(notice?.detail).toContain('a.png, b.png')
  })

  it('errors when buffers are missing and lists names compactly', () => {
    const probes: ProbeResult[] = [
      probe('/w/scene.bin', 'buffer'),
      ...Array.from({ length: 6 }, (_, index) => probe(`/w/tex/${index}.png`, 'image')),
    ]
    const notice = noticeForMissingReferences(probes)
    expect(notice).toMatchObject({ level: 'error' })
    expect(notice?.detail).toContain('scene.bin')
    expect(notice?.detail).toContain('and 2 more')
  })
})

describe('other notices and list helpers', () => {
  it('builds deletion and invalid-document notices', () => {
    expect(noticeForDeletion('/w/model.gltf').title).toBe('model.gltf was deleted from the workspace')
    expect(noticeForInvalidDocument('bad json').detail).toBe('bad json')
  })

  it('appends with dedupe by id and removes by id', () => {
    const first: Notice = { id: 'a', level: 'info', title: 'first' }
    const replacement: Notice = { id: 'a', level: 'error', title: 'replacement' }
    const other: Notice = { id: 'b', level: 'warning', title: 'other' }
    const list = appendNotice(appendNotice(appendNotice([], first), other), replacement)
    expect(list.map((notice) => notice.title)).toEqual(['other', 'replacement'])
    expect(removeNotice(list, 'b').map((notice) => notice.id)).toEqual(['a'])
  })
})
