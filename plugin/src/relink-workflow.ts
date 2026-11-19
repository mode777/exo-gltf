/**
 * Testable relink workflow.
 *
 * The editor owns the session state and signals; this module owns the
 * decisions: ask the shell picker, read the selected file, write the URI, and
 * trial-parse the result before the editor commits it.
 */

import type { Document } from '@gltf-transform/core'
import { parseDocument } from './document'
import { buildRepairModel, type RepairItem, type RepairModel } from './repair-model'
import {
  applyRelinks,
  relinkOverrides,
  type RelinkMap,
} from './relink'
import {
  normalizeWorkspacePath,
  referenceUri,
  type PrefetchResult,
} from './resources'

export class RelinkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
  ) {
    super(message)
    this.name = 'RelinkError'
  }
}

export interface RelinkFileReader {
  readFile(path: string, encoding: 'binary'): Promise<{ bytes: ArrayBuffer }>
}

export interface PickerEditor {
  capabilities: { filePicker: boolean; requestFiles: boolean }
  requestFiles(options: { multiple?: boolean; directory?: string }): Promise<string[]>
}

export type PickResult =
  | { status: 'picked'; path: string }
  | { status: 'cancelled' }
  | { status: 'unsupported' }

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'internal'
}

/**
 * Opens the shell picker for one file. `unsupported` means the shell has no
 * picker; every other failure (rate limit, permission) is rethrown for the
 * caller to show as a notice.
 */
export async function pickReplacement(
  editor: PickerEditor,
  directory: string,
): Promise<PickResult> {
  if (!editor.capabilities.filePicker) return { status: 'unsupported' }
  try {
    const paths = await editor.requestFiles({ multiple: false, directory })
    if (paths.length === 0) return { status: 'cancelled' }
    return { status: 'picked', path: paths[0] }
  } catch (error) {
    if (errorCode(error) === 'unsupported-message') return { status: 'unsupported' }
    throw error
  }
}

export interface RelinkPlan {
  relinks: RelinkMap
  document: Document
  repair: RepairModel
}

interface PlanContext {
  sourceBytes: Uint8Array<ArrayBuffer>
  prefetch: PrefetchResult
  relinks: RelinkMap
}

async function prepare(
  context: PlanContext,
  next: RelinkMap,
  selectedPath?: string,
): Promise<RelinkPlan> {
  const parsed = await parseDocument(context.sourceBytes, context.prefetch, {
    overrides: relinkOverrides(next),
  })
  if (!parsed.document) {
    throw new RelinkError(
      'invalid-document',
      parsed.error ?? 'The replacement file could not be parsed as part of the document.',
      selectedPath,
    )
  }
  // Build the repair model before rewriting URIs: its map keys are originals.
  const repair = buildRepairModel(parsed.document, context.prefetch.probes, next)
  applyRelinks(parsed.document, next)
  return { relinks: next, document: parsed.document, repair }
}

export interface PlanRelinkInput extends PlanContext, RelinkFileReader {
  item: Pick<RepairItem, 'originalUri'>
  documentDir: string
  targetPath: string
}

export async function planRelink(input: PlanRelinkInput): Promise<RelinkPlan> {
  const combined = input.targetPath.startsWith('/')
    ? input.targetPath
    : `${input.documentDir === '/' ? '' : input.documentDir}/${input.targetPath}`
  const target = normalizeWorkspacePath(combined)
  if (target === null) {
    throw new RelinkError('invalid-path', 'The selected path is not a valid workspace path.')
  }

  let bytes: Uint8Array<ArrayBuffer>
  try {
    const content = await input.readFile(target, 'binary')
    bytes = new Uint8Array(content.bytes)
  } catch (error) {
    throw new RelinkError(
      errorCode(error),
      `The workspace could not read ${target}.`,
      target,
    )
  }
  if (bytes.byteLength === 0) {
    throw new RelinkError('empty-file', `${target} is empty.`, target)
  }

  const uri = referenceUri(input.documentDir, target)
  if (uri === null) {
    throw new RelinkError('invalid-path', `${target} cannot be written as a glTF URI.`, target)
  }

  const next = new Map(input.relinks)
  next.set(input.item.originalUri, { path: target, uri, bytes })
  return prepare(input, next, target)
}

export interface PlanRevertInput extends PlanContext {
  originalUri: string
}

export async function planRevert(input: PlanRevertInput): Promise<RelinkPlan> {
  const next = new Map(input.relinks)
  next.delete(input.originalUri)
  return prepare(input, next)
}
