/**
 * Pass-through save for M1.
 *
 * The preview performs no edits, so the save handler answers with the exact
 * bytes the shell last delivered. Every call returns a *fresh* ArrayBuffer
 * copy: the SDK transfers the buffer across the frame boundary (detaching
 * it), and a detached source would break the next save or the next render.
 */

export function copyBytes(source: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(source.byteLength)
  new Uint8Array(output).set(source)
  return output
}

export function passThroughSave(source: Uint8Array): { bytes: ArrayBuffer } {
  return { bytes: copyBytes(source) }
}
