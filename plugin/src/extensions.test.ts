import { describe, expect, it } from 'vitest'
import {
  SUPPORTED_EXTENSION_CLASSES,
  SUPPORTED_EXTENSION_NAMES,
  findUnsupportedExtensions,
} from './extensions'

describe('extension registry', () => {
  it('supports dependency-free extensions used by the preview fixtures', () => {
    expect(SUPPORTED_EXTENSION_NAMES.has('KHR_texture_basisu')).toBe(true)
    expect(SUPPORTED_EXTENSION_NAMES.has('KHR_materials_unlit')).toBe(true)
    expect(SUPPORTED_EXTENSION_NAMES.has('KHR_lights_punctual')).toBe(true)
    expect(SUPPORTED_EXTENSION_CLASSES.length).toBeGreaterThan(10)
  })

  it('leaves decoder-backed extensions out of the editable set', () => {
    expect(SUPPORTED_EXTENSION_NAMES.has('KHR_draco_mesh_compression')).toBe(false)
    expect(SUPPORTED_EXTENSION_NAMES.has('EXT_meshopt_compression')).toBe(false)
  })

  it('reports declared extensions that cannot be round-tripped', () => {
    expect(
      findUnsupportedExtensions({
        extensionsUsed: ['KHR_texture_basisu', 'KHR_draco_mesh_compression'],
        extensionsRequired: ['EXT_meshopt_compression', 'KHR_draco_mesh_compression'],
      }),
    ).toEqual(['EXT_meshopt_compression', 'KHR_draco_mesh_compression'])
  })

  it('accepts supported and malformed declarations without noise', () => {
    expect(
      findUnsupportedExtensions({
        extensionsUsed: ['KHR_texture_basisu', 'KHR_materials_unlit', 7],
        extensionsRequired: 'not-an-array',
      }),
    ).toEqual([])
    expect(findUnsupportedExtensions({})).toEqual([])
  })
})
