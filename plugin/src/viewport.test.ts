import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { collectNodeObjects, frameBounds } from './viewport'

describe('frameBounds', () => {
  it('centers the camera on the box and fits it along the direction', () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2))
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
    const direction = new THREE.Vector3(2, 1.4, 2)
    const center = frameBounds(box, camera, direction)

    expect(center?.toArray()).toEqual([1, 1, 1])
    const radius = Math.sqrt(12) / 2
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(25))
    expect(camera.position.distanceTo(center!)).toBeCloseTo(distance)
    expect(camera.near).toBeCloseTo(radius / 100)
    expect(camera.far).toBeCloseTo(radius * 100)
    const expected = new THREE.Vector3(1, 0.7, 1).normalize()
    const offset = camera.position.clone().sub(center!).normalize()
    expect(offset.x).toBeCloseTo(expected.x)
    expect(offset.y).toBeCloseTo(expected.y)
    expect(offset.z).toBeCloseTo(expected.z)
  })

  it('leaves the camera untouched for an empty box', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
    camera.position.set(4, 5, 6)
    const before = camera.position.clone()
    expect(frameBounds(new THREE.Box3(), camera, new THREE.Vector3(1, 0, 0))).toBeNull()
    expect(camera.position.toArray()).toEqual(before.toArray())
  })
})

describe('collectNodeObjects', () => {
  it('maps node indices to objects and ignores other associations', () => {
    const first = new THREE.Object3D()
    const second = new THREE.Object3D()
    const material = new THREE.MeshBasicMaterial()
    const associations = new Map<unknown, { nodes?: number; materials?: number }>([
      [first, { nodes: 0 }],
      [second, { nodes: 2 }],
      [material, { materials: 1 }],
      [{}, {}],
    ])

    const objects = collectNodeObjects(associations)
    expect(objects.get(0)).toBe(first)
    expect(objects.get(2)).toBe(second)
    expect(objects.size).toBe(2)
  })
})
