import { ExoProtocolError } from '@exo/plugin-sdk'

export interface ErrorDetails {
  code?: string
  expected?: string
  received?: string
  message: string
}

export function errorDetails(error: unknown): ErrorDetails {
  if (error instanceof ExoProtocolError) {
    return {
      code: error.code,
      ...(error.expected === undefined ? {} : { expected: error.expected }),
      ...(error.received === undefined ? {} : { received: error.received }),
      message: error.message,
    }
  }
  return { message: error instanceof Error ? error.message : String(error) }
}

/** Mirror hidden-frame state where devtools and the manual checks can read it. */
export function renderObservation(state: unknown, title: string): void {
  const element = document.getElementById('observation')
  if (element) element.textContent = JSON.stringify(state, null, 2)
  document.title = title
}
