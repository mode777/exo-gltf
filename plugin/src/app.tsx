/** Preact root. Owns the chrome around the imperative three.js island. */

import { signal } from '@preact/signals'
import { render } from 'preact'
import { appendNotice, type Notice } from './notices'

export type UiPhase = 'loading' | 'ready' | 'error'

export interface UiState {
  phase: UiPhase
  fileName: string
  notices: Notice[]
}

export const ui = signal<UiState>({ phase: 'loading', fileName: '', notices: [] })

/** Set by the stage ref; the editor creates the viewport inside it. */
export const viewportHost = signal<HTMLElement | null>(null)

export function setPhase(phase: UiPhase): void {
  ui.value = { ...ui.value, phase }
}

export function setFileName(fileName: string): void {
  ui.value = { ...ui.value, fileName }
}

export function pushNotice(notice: Notice): void {
  ui.value = { ...ui.value, notices: appendNotice(ui.value.notices, notice) }
}

export function mountApp(root: HTMLElement): void {
  render(<App />, root)
}

function App() {
  const state = ui.value
  return (
    <div class="app">
      <header class="chrome">
        <span class="chrome-title">{state.fileName || 'glTF Viewer'}</span>
        <span class={`chrome-phase chrome-phase-${state.phase}`} aria-live="polite">
          {state.phase}
        </span>
      </header>
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
      <footer class="hint">Drag to orbit · Scroll to zoom · Right-drag to pan</footer>
    </div>
  )
}
