import { describe, expect, it } from 'vitest'
import { SaveQueue, SaveTimeoutError } from './save-queue'
import type { SaveContent } from './serialization'

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('SaveQueue', () => {
  it('returns the clean baseline without serializing', async () => {
    let serialized = 0
    const queue = new SaveQueue(async () => {
      serialized += 1
      return { text: 'serialized' }
    })
    const clean = (): SaveContent => ({ text: 'clean' })

    await expect(queue.save(false, clean)).resolves.toEqual({ text: 'clean' })
    expect(serialized).toBe(0)
    queue.dispose()
  })

  it('pre-serializes after the debounce and reuses the cached result', async () => {
    let serialized = 0
    const queue = new SaveQueue(
      async () => {
        serialized += 1
        return { text: `version-${serialized}` }
      },
      { debounceMs: 5 },
    )
    queue.markEdited()
    await tick(20)

    await expect(queue.save(true, () => ({ text: 'clean' }))).resolves.toEqual({
      text: 'version-1',
    })
    await expect(queue.save(true, () => ({ text: 'clean' }))).resolves.toEqual({
      text: 'version-1',
    })
    expect(serialized).toBe(1)
    queue.dispose()
  })

  it('serializes on demand when a save beats the debounce', async () => {
    const queue = new SaveQueue(
      async () => ({ text: 'late' }),
      { debounceMs: 10_000 },
    )
    queue.markEdited()
    await expect(queue.save(true, () => ({ text: 'clean' }))).resolves.toEqual({ text: 'late' })
    queue.dispose()
  })

  it('takes the latest edit when several relinks happen quickly', async () => {
    let version = 0
    const queue = new SaveQueue(
      async () => ({ text: `edit-${version}` }),
      { debounceMs: 5 },
    )
    version = 1
    queue.markEdited()
    version = 2
    queue.markEdited()
    await tick(20)

    await expect(queue.save(true, () => ({ text: 'clean' }))).resolves.toEqual({ text: 'edit-2' })
    queue.dispose()
  })

  it('returns a fresh copy so a transferred buffer cannot corrupt the cache', async () => {
    const queue = new SaveQueue(async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer }))
    queue.markEdited()
    const first = await queue.save(true, () => ({ text: 'clean' }))
    if (!('bytes' in first)) throw new Error('expected binary content')
    new Uint8Array(first.bytes)[0] = 9

    const second = await queue.save(true, () => ({ text: 'clean' }))
    if (!('bytes' in second)) throw new Error('expected binary content')
    expect(Array.from(new Uint8Array(second.bytes))).toEqual([1, 2, 3])
    queue.dispose()
  })

  it('fails the save when preparation exceeds the internal deadline', async () => {
    const queue = new SaveQueue(
      () => new Promise<SaveContent>(() => undefined),
      { timeoutMs: 10 },
    )
    queue.markEdited()
    await expect(queue.save(true, () => ({ text: 'clean' }))).rejects.toBeInstanceOf(
      SaveTimeoutError,
    )
    queue.dispose()
  })

  it('drops cached work on reset so a later clean save uses the baseline', async () => {
    let serialized = 0
    const queue = new SaveQueue(async () => {
      serialized += 1
      return { text: 'stale' }
    })
    queue.markEdited()
    queue.reset()
    await expect(queue.save(false, () => ({ text: 'fresh' }))).resolves.toEqual({ text: 'fresh' })
    expect(serialized).toBe(0)
    queue.dispose()
  })
})
