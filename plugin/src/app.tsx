/** Preact root. Owns the UI around the imperative three.js island. */

import { signal } from '@preact/signals'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import type { ExplorerEntry, ExplorerGroup, ExplorerModel } from './explorer-model'
import { appendNotice, removeNotice, type Notice } from './notices'
import type { RepairItem, RepairModel } from './repair-model'

export type UiPhase = 'loading' | 'ready' | 'error'

export interface UiState {
  phase: UiPhase
  notices: Notice[]
}

export const ui = signal<UiState>({ phase: 'loading', notices: [] })

/** Set by the stage ref; the editor creates the viewport inside it. */
export const viewportHost = signal<HTMLElement | null>(null)

/** Null until the document has parsed (or when parsing failed). */
export const explorer = signal<ExplorerModel | null>(null)

/** False when the document declares an extension that cannot be round-tripped. */
export const documentEditable = signal(true)

/** Declared extensions the plugin cannot serialize, for the read-only notice. */
export const unsupportedExtensions = signal<readonly string[]>([])

export function setDocumentCapabilities(
  editable: boolean,
  unsupported: readonly string[],
): void {
  documentEditable.value = editable
  unsupportedExtensions.value = unsupported
}

/** The selected explorer entry, shared by the tree and the inspector. */
export const selection = signal<ExplorerEntry | null>(null)

/** Expanded group ids; reset whenever a new model is installed. */
export const expandedGroups = signal<ReadonlySet<string>>(new Set())

/** Missing/relinked references; null until the document parses. */
export const repair = signal<RepairModel | null>(null)

/** Original URI of the reference currently being picked/read, if any. */
export const repairPending = signal<string | null>(null)

/** False on shells without the workspace picker; the manual path field is used. */
export const pickerAvailable = signal(true)

/** Reference whose manual path field was explicitly revealed. */
export const manualEntryUri = signal<string | null>(null)

export interface RepairActions {
  relink(item: RepairItem): void
  revert(item: RepairItem): void
  applyManual(item: RepairItem, path: string): void
  runNoticeAction(id: 'reload'): void
}

/** Editor-installed callbacks for the repair UI. */
export const repairActions: { current: RepairActions | null } = { current: null }

export function setRepair(model: RepairModel | null): void {
  repair.value = model
  if (model === null) manualEntryUri.value = null
}

export function setRepairPending(uri: string | null): void {
  repairPending.value = uri
}

export function setPickerAvailable(available: boolean): void {
  pickerAvailable.value = available
}

export function setManualEntry(uri: string | null): void {
  manualEntryUri.value = uri
}

export function setRepairActions(actions: RepairActions | null): void {
  repairActions.current = actions
}

export function setPhase(phase: UiPhase): void {
  ui.value = { ...ui.value, phase }
}

export function pushNotice(notice: Notice): void {
  ui.value = { ...ui.value, notices: appendNotice(ui.value.notices, notice) }
}

export function clearNotice(id: string): void {
  ui.value = { ...ui.value, notices: removeNotice(ui.value.notices, id) }
}

export function clearNotices(predicate: (notice: Notice) => boolean): void {
  ui.value = { ...ui.value, notices: ui.value.notices.filter((notice) => !predicate(notice)) }
}

/** Installs a freshly built model and clears selection/expansion state. */
export function setExplorer(model: ExplorerModel | null): void {
  explorer.value = model
  selection.value = null
  expandedGroups.value = new Set()
}

export function selectEntry(entry: ExplorerEntry | null): void {
  selection.value = entry
}

export function toggleGroup(id: string): void {
  const next = new Set(expandedGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedGroups.value = next
}

export function mountApp(root: HTMLElement): void {
  render(<App />, root)
}

function App() {
  const state = ui.value
  return (
    <div class="app" data-phase={state.phase}>
      <div class="main">
        <div class="stage-wrap">
          <div
            class="stage"
            ref={(element) => {
              viewportHost.value = element as HTMLElement | null
            }}
          />
          <div class="notices" role="status">
            {state.notices.map((notice) => (
              <article key={notice.id} class={`notice notice-${notice.level}`}>
                <strong>{notice.title}</strong>
                {notice.detail ? <p>{notice.detail}</p> : null}
                {notice.action ? (
                  <button
                    type="button"
                    class="notice-action"
                    data-notice-action={notice.action.id}
                    onClick={() => repairActions.current?.runNoticeAction(notice.action!.id)}
                  >
                    {notice.action.label}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </div>
        <aside class="sidebar">
          <Repairs />
          <Explorer />
          <Inspector />
        </aside>
      </div>
      <footer class="hint">Drag to orbit · Scroll to zoom · Right-drag to pan</footer>
    </div>
  )
}

function Repairs() {
  const model = repair.value
  if (!documentEditable.value || model === null) return null
  const rows = [...model.missing, ...model.relinked]
  if (rows.length === 0) return null
  return (
    <section class="repairs" aria-labelledby="repairs-heading" aria-label="Reference repairs">
      <h2 id="repairs-heading">Reference repairs</h2>
      <ul class="repair-list">
        {rows.map((item) => (
          <RepairRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  )
}

function baseName(uri: string): string {
  const index = uri.lastIndexOf('/')
  return index === -1 ? uri : uri.slice(index + 1)
}

function RepairRow({ item }: { item: RepairItem }) {
  const pending = repairPending.value !== null
  const busy = repairPending.value === item.originalUri
  const manual = !pickerAvailable.value || manualEntryUri.value === item.originalUri
  return (
    <li
      class={`repair-row repair-row-${item.status}`}
      data-repair-uri={item.originalUri}
      data-status={item.status}
      data-relinked={item.relinked ? 'true' : 'false'}
    >
      <div class="repair-summary">
        <span class="repair-name">{baseName(item.uri)}</span>
        <span class="repair-kind">
          {item.kind}
          {item.relinked ? ' · relinked' : item.status === 'missing' ? ' · missing' : ''}
        </span>
      </div>
      <div class="repair-uri">{item.uri}</div>
      <div class="repair-actions">
        {pickerAvailable.value ? (
          <button
            type="button"
            data-action={item.relinked ? 'change' : 'relink'}
            disabled={pending}
            onClick={() => repairActions.current?.relink(item)}
          >
            {item.relinked ? 'Change…' : 'Relink…'}
          </button>
        ) : null}
        {item.relinked ? (
          <button
            type="button"
            data-action="revert"
            disabled={pending}
            onClick={() => repairActions.current?.revert(item)}
          >
            Revert
          </button>
        ) : null}
      </div>
      {manual ? <ManualEntry item={item} disabled={pending} /> : null}
      {busy ? <p class="repair-busy">Reading the replacement…</p> : null}
    </li>
  )
}

function ManualEntry({ item, disabled }: { item: RepairItem; disabled: boolean }) {
  const [value, setValue] = useState('')
  return (
    <form
      class="repair-manual"
      onSubmit={(event) => {
        event.preventDefault()
        const path = value.trim()
        if (path.length === 0) return
        repairActions.current?.applyManual(item, path)
      }}
    >
      <input
        aria-label={`Workspace path for ${baseName(item.uri)}`}
        placeholder="path/to/file"
        value={value}
        disabled={disabled}
        onInput={(event) => setValue(event.currentTarget.value)}
      />
      <button
        type="submit"
        data-action="apply-manual"
        disabled={disabled || value.trim().length === 0}
      >
        Apply
      </button>
    </form>
  )
}

function Explorer() {
  const model = explorer.value
  return (
    <section class="explorer" aria-labelledby="explorer-heading">
      <h2 id="explorer-heading">Structure</h2>
      {model === null ? (
        <p class="explorer-empty">The document structure is unavailable.</p>
      ) : model.isEmpty ? (
        <p class="explorer-empty">
          No structure to explore. The document defines no scenes, nodes, meshes, materials,
          textures, animations, skins or extensions.
        </p>
      ) : (
        <ul class="tree" role="tree" aria-label="Document structure">
          {model.groups.map((group) => (
            <TreeGroup key={group.id} group={group} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TreeGroup({ group }: { group: ExplorerGroup }) {
  const expanded = expandedGroups.value.has(group.id)
  return (
    <li
      class="tree-group"
      role="treeitem"
      aria-expanded={expanded}
      aria-selected={false}
      data-group={group.id}
    >
      <button
        type="button"
        class="tree-row tree-group-row"
        aria-expanded={expanded}
        onClick={() => toggleGroup(group.id)}
      >
        <span class="tree-twisty" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span class="tree-name">{group.label}</span>
        <span class="tree-count">{group.count}</span>
        {group.hasMissing ? <span class="badge badge-missing">missing</span> : null}
      </button>
      {expanded ? (
        <ul class="tree-children" role="group">
          {group.getEntries().map((entry) => (
            <TreeEntry key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function TreeEntry({ entry }: { entry: ExplorerEntry }) {
  const selected = selection.value?.id === entry.id
  return (
    <li
      class={`tree-entry${selected ? ' is-selected' : ''}`}
      role="treeitem"
      aria-selected={selected}
      data-entry-id={entry.id}
      data-kind={entry.kind}
    >
      <button
        type="button"
        class="tree-row"
        aria-selected={selected}
        onClick={() => selectEntry(entry)}
      >
        <span class="tree-name">{entry.label}</span>
        <span class="tree-detail">{entry.detail}</span>
        {entry.status === 'missing' ? <span class="badge badge-missing">missing</span> : null}
      </button>
    </li>
  )
}

function repairItemFor(entry: ExplorerEntry): RepairItem | null {
  if (!entry.uri) return null
  const model = repair.value
  if (model === null) return null
  return (
    model.items.find(
      (item) => item.uri === entry.uri || item.originalUri === entry.uri,
    ) ?? null
  )
}

function Inspector() {
  const entry = selection.value
  const repairItem = entry === null ? null : repairItemFor(entry)
  const pending = repairPending.value !== null
  return (
    <section class="inspector" aria-labelledby="inspector-heading" aria-label="Inspector">
      <h2 id="inspector-heading">Inspector</h2>
      {entry === null ? (
        <p class="explorer-empty">Select an entry to see its details.</p>
      ) : (
        <div class="inspector-body" data-entry-id={entry.id}>
          <dl>
            <div class="inspector-row">
              <dt>Kind</dt>
              <dd>{entry.kind}</dd>
            </div>
            <div class="inspector-row">
              <dt>Name</dt>
              <dd>{entry.label}</dd>
            </div>
            <div class="inspector-row">
              <dt>Index</dt>
              <dd>{entry.index}</dd>
            </div>
            {entry.details.map((detail) => (
              <div key={detail.label} class="inspector-row">
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
          {entry.status ? (
            <p class={`status status-${entry.status}`}>
              {entry.status === 'missing' ? 'Missing' : 'Resolved'}
            </p>
          ) : null}
          {repairItem !== null && documentEditable.value ? (
            <div class="inspector-actions" data-repair-uri={repairItem.originalUri}>
              {pickerAvailable.value ? (
                <button
                  type="button"
                  data-action={repairItem.relinked ? 'change' : 'relink'}
                  disabled={pending}
                  onClick={() => repairActions.current?.relink(repairItem)}
                >
                  {repairItem.relinked ? 'Change…' : 'Relink…'}
                </button>
              ) : (
                <p class="explorer-empty">Enter a workspace path in Reference repairs.</p>
              )}
              {repairItem.relinked ? (
                <button
                  type="button"
                  data-action="revert"
                  disabled={pending}
                  onClick={() => repairActions.current?.revert(repairItem)}
                >
                  Revert
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
