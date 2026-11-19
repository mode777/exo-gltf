// @vitest-environment jsdom
import { render } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mountApp,
  pushNotice,
  selection,
  setDocumentCapabilities,
  setExplorer,
  setManualEntry,
  setPickerAvailable,
  setRepair,
  setRepairActions,
  setRepairPending,
  ui,
} from './app'
import type { ExplorerEntry } from './explorer-model'
import type { RepairItem, RepairModel } from './repair-model'

function makeItem(overrides: Partial<RepairItem> = {}): RepairItem {
  return {
    id: 'reference:0',
    originalUri: 'missing.png',
    uri: 'missing.png',
    kind: 'image',
    targets: [],
    path: '/relink/missing.png',
    status: 'missing',
    relinked: false,
    ...overrides,
  }
}

function makeModel(items: RepairItem[]): RepairModel {
  return {
    items,
    missing: items.filter((item) => item.status === 'missing'),
    relinked: items.filter((item) => item.relinked),
    isEmpty: items.length === 0,
  }
}

function resourceEntry(uri: string): ExplorerEntry {
  return {
    id: 'resources:0',
    kind: 'resource',
    index: 0,
    label: 'missing.png',
    detail: 'image · missing',
    details: [],
    status: 'missing',
    uri,
  }
}

let root: HTMLElement | null = null

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>'
  root = document.getElementById('app')
  mountApp(root!)
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  if (root) render(null, root)
  root = null
  setDocumentCapabilities(true, [])
  setRepair(null)
  setPickerAvailable(true)
  setRepairPending(null)
  setManualEntry(null)
  setRepairActions(null)
  setExplorer(null)
  selection.value = null
  ui.value = { phase: 'loading', notices: [] }
  document.body.innerHTML = ''
})

describe('reference repair UI', () => {
  it('offers relink for a missing reference and calls the action', async () => {
    const relink = vi.fn()
    setRepairActions({ relink, revert: vi.fn(), applyManual: vi.fn(), runNoticeAction: vi.fn() })
    setRepair(makeModel([makeItem()]))
    mount()

    const row = root!.querySelector('[data-repair-uri="missing.png"]')!
    expect(row.getAttribute('data-status')).toBe('missing')
    const button = row.querySelector('[data-action="relink"]') as HTMLButtonElement
    expect(button).not.toBeNull()
    expect(row.querySelector('[data-action="revert"]')).toBeNull()
    button.click()
    expect(relink).toHaveBeenCalledTimes(1)
  })

  it('offers change and revert for a relinked reference', async () => {
    const revert = vi.fn()
    setRepairActions({ relink: vi.fn(), revert, applyManual: vi.fn(), runNoticeAction: vi.fn() })
    setRepair(
      makeModel([
        makeItem({ status: 'resolved', relinked: true, uri: 'assets/Logo.png', id: 'reference:1' }),
      ]),
    )
    mount()

    const row = root!.querySelector('[data-repair-uri="missing.png"]')!
    expect(row.querySelector('[data-action="change"]')).not.toBeNull()
    expect(row.querySelector('[data-action="relink"]')).toBeNull()
    ;(row.querySelector('[data-action="revert"]') as HTMLButtonElement).click()
    expect(revert).toHaveBeenCalledTimes(1)
  })

  it('shows the inline path field on a shell without the picker', async () => {
    setPickerAvailable(false)
    setRepair(makeModel([makeItem()]))
    mount()

    expect(root!.querySelector('[data-action="relink"]')).toBeNull()
    expect(root!.querySelector('input[aria-label="Workspace path for missing.png"]')).not.toBeNull()
    expect(root!.querySelector('[data-action="apply-manual"]')).not.toBeNull()
  })

  it('disables repair actions while a read is in flight', async () => {
    setRepairPending('missing.png')
    setRepair(makeModel([makeItem()]))
    mount()

    const button = root!.querySelector('[data-action="relink"]') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(root!.textContent).toContain('Reading the replacement')
  })

  it('hides all repair actions for a read-only document', async () => {
    setDocumentCapabilities(false, ['KHR_draco_mesh_compression'])
    setRepair(makeModel([makeItem()]))
    mount()

    expect(root!.querySelector('.repairs')).toBeNull()
  })

  it('shows relink in the inspector for a selected resource', async () => {
    setRepair(makeModel([makeItem()]))
    setExplorer(null)
    selection.value = resourceEntry('missing.png')
    mount()

    expect(root!.querySelector('.inspector-actions [data-action="relink"]')).not.toBeNull()
  })

  it('renders a notice action and invokes it', async () => {
    const runNoticeAction = vi.fn()
    setRepairActions({ relink: vi.fn(), revert: vi.fn(), applyManual: vi.fn(), runNoticeAction })
    pushNotice({
      id: 'external-change-dirty',
      level: 'warning',
      title: 'The file changed on disk',
      action: { id: 'reload', label: 'Reload from disk (discard edits)' },
    })
    mount()
    await tick()

    const action = root!.querySelector('[data-notice-action="reload"]') as HTMLButtonElement
    expect(action).not.toBeNull()
    action.click()
    expect(runNoticeAction).toHaveBeenCalledWith('reload')
  })
})
