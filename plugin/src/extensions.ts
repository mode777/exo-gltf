/**
 * glTF extension support for the document model.
 *
 * `@gltf-transform` drops any extension it was not told about when writing,
 * so M3 registers every extension it can round-trip. Extensions that need a
 * decoder or encoder module on read (`KHR_draco_mesh_compression`,
 * `EXT_meshopt_compression`) are intentionally left out: this plugin does not
 * ship those modules for the document model, and a document declaring them
 * must stay read-only rather than lose data on save.
 */

import { Document, type Extension } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'

type ExtensionClass = typeof Extension
type ConstructibleExtension = new (document: Document) => Extension

interface ExtensionEntry {
  extensionClass: ExtensionClass
  name: string
  readDependencies: string[]
}

function describeExtensions(): ExtensionEntry[] {
  // Construction only inspects the class; the throwaway document is never used.
  const probe = new Document()
  return ALL_EXTENSIONS.map((ExtensionType) => {
    const extension = new (ExtensionType as unknown as ConstructibleExtension)(probe)
    return {
      extensionClass: ExtensionType,
      name: extension.extensionName,
      readDependencies: extension.readDependencies,
    }
  })
}

const extensions = describeExtensions()

/** Extensions that parse and serialize without an external codec module. */
export const SUPPORTED_EXTENSION_CLASSES: ExtensionClass[] = extensions
  .filter((entry) => entry.readDependencies.length === 0)
  .map((entry) => entry.extensionClass)

/** Names of the extensions registered on the workspace IO adapter. */
export const SUPPORTED_EXTENSION_NAMES: ReadonlySet<string> = new Set(
  extensions.filter((entry) => entry.readDependencies.length === 0).map((entry) => entry.name),
)

export interface ExtensionDeclarations {
  extensionsUsed?: unknown
  extensionsRequired?: unknown
}

/**
 * Declared extensions this plugin cannot round-trip. A non-empty result makes
 * the document read-only so a save can never silently strip their payloads.
 */
export function findUnsupportedExtensions(json: ExtensionDeclarations): string[] {
  const names = new Set<string>()
  for (const field of [json.extensionsUsed, json.extensionsRequired]) {
    if (!Array.isArray(field)) continue
    for (const name of field) {
      if (typeof name === 'string' && name.length > 0 && !SUPPORTED_EXTENSION_NAMES.has(name)) {
        names.add(name)
      }
    }
  }
  return [...names].sort()
}
