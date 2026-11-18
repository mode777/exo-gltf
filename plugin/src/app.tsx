/** Preact root. Owns the UI around the imperative three.js island. */

import { signal } from '@preact/signals'
import { render } from 'preact'
import type { ExplorerEntry, ExplorerGroup, ExplorerModel } from './explorer-model'
import { appendNotice, type Notice } from './notices'

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

/** The selected explorer entry, shared by the tree and the inspector. */
export const selection = signal<ExplorerEntry | null>(null)

/** Expanded group ids; reset whenever a new model is installed. */
export const expandedGroups = signal<ReadonlySet<string>>(new Set())

export function setPhase(phase: UiPhase): void {
  ui.value = { ...ui.value, phase }
}

export function pushNotice(notice: Notice): void {
  ui.value = { ...ui.value, notices: appendNotice(ui.value.notices, notice) }
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
              </article>
            ))}
          </div>
        </div>
        <aside class="sidebar">
          <Explorer />
          <Inspector />
        </aside>
      </div>
      <footer class="hint">Drag to orbit · Scroll to zoom · Right-drag to pan</footer>
    </div>
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

function Inspector() {
  const entry = selection.value
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
        </div>
      )}
    </section>
  )
}
