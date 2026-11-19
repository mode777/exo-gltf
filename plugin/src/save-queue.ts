/**
 * Debounced pre-serialization and the save-time handoff.
 *
 * The shell gives the save handler a few seconds. Edits schedule a background
 * serialization, and a save returns the cached result when it matches the
 * current revision. A save can also force the latest revision; the timeout is
 * only a last resort and stays below the shell contract.
 */

import { copySaveContent, type SaveContent } from './serialization'

export class SaveTimeoutError extends Error {
  constructor() {
    super('The document could not be prepared for saving in time.')
    this.name = 'SaveTimeoutError'
  }
}

export interface SaveQueueOptions {
  debounceMs?: number
  timeoutMs?: number
}

export class SaveQueue {
  private readonly debounceMs: number
  private readonly timeoutMs: number
  private revision = 0
  private cached: { revision: number; content: SaveContent } | null = null
  private pending: Promise<SaveContent> | null = null
  private pendingRevision = -1
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    private readonly serialize: () => Promise<SaveContent>,
    options: SaveQueueOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 250
    this.timeoutMs = options.timeoutMs ?? 4_000
  }

  /** A new edit invalidates the cache and schedules pre-serialization. */
  markEdited(): void {
    this.revision += 1
    this.cached = null
    this.schedule()
  }

  /** Drops scheduled/cached work, e.g. after a reload or full revert. */
  reset(): void {
    this.revision += 1
    this.cached = null
    this.clearTimer()
  }

  /**
   * Returns content for the shell's save request. Clean documents use the
   * caller's baseline; edited documents use the latest serialization.
   */
  async save(hasEdits: boolean, cleanContent: () => SaveContent): Promise<SaveContent> {
    if (!hasEdits) return copySaveContent(cleanContent())
    this.clearTimer()
    const content = await this.withTimeout(this.start())
    return copySaveContent(content)
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.cached = null
  }

  private schedule(): void {
    if (this.disposed) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.start().catch(() => {
        // A failed background serialization is retried by the next save; the
        // save handler surfaces the error with a notice.
      })
    }, this.debounceMs)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private start(): Promise<SaveContent> {
    if (this.cached !== null && this.cached.revision === this.revision) {
      return Promise.resolve(this.cached.content)
    }
    if (this.pending !== null) {
      if (this.pendingRevision === this.revision) return this.pending
      return this.pending.catch(() => undefined).then(() => this.start())
    }

    const revision = this.revision
    const pending = this.serialize()
      .then((content) => {
        if (!this.disposed && revision === this.revision) {
          this.cached = { revision, content }
        }
        return content
      })
      .finally(() => {
        if (this.pending === pending) {
          this.pending = null
          this.pendingRevision = -1
        }
      })
    this.pending = pending
    this.pendingRevision = revision
    return pending
  }

  private withTimeout(promise: Promise<SaveContent>): Promise<SaveContent> {
    return new Promise<SaveContent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new SaveTimeoutError()), this.timeoutMs)
      promise.then(
        (content) => {
          clearTimeout(timer)
          resolve(content)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }
}
