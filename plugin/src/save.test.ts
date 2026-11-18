import { describe, expect, it } from 'vitest'
import { copyBytes, passThroughSave } from './save'

describe('pass-through save', () => {
  const source = new Uint8Array([0, 1, 2, 250, 255])

  it('returns the exact bytes read', () => {
    const result = passThroughSave(source)
    expect(new Uint8Array(result.bytes)).toEqual(source)
    expect(result.bytes.byteLength).toBe(source.byteLength)
  })

  it('returns a fresh buffer per call and never the source buffer', () => {
    const first = passThroughSave(source)
    const second = passThroughSave(source)
    expect(first.bytes).not.toBe(second.bytes)
    expect(first.bytes).not.toBe(source.buffer)
    new Uint8Array(first.bytes)[0] = 99
    expect(source[0]).toBe(0)
    expect(new Uint8Array(second.bytes)[0]).toBe(0)
  })

  it('copies respect the view offset of a subarray', () => {
    const backing = new Uint8Array([7, 7, 1, 2, 3])
    const view = backing.subarray(2)
    expect(new Uint8Array(copyBytes(view))).toEqual(new Uint8Array([1, 2, 3]))
  })
})
