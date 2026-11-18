/**
 * Imperative three.js island. Preact owns the UI around it; this module
 * owns the WebGL lifecycle, which must be created lazily (a notice-only
 * frame owns no GL context) and torn down completely on disposal.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

export type ThemeName = 'dark' | 'light' | 'high-contrast'

const THEME_COLORS: Record<ThemeName, number> = {
  dark: 0x1e1f22,
  light: 0xf2f3f5,
  'high-contrast': 0x000000,
}

export interface ViewportCallbacks {
  /** Called when the asset parsed but contains nothing renderable. */
  onEmpty(): void
  /** Called for loader failures that prevent any scene from appearing. */
  onLoadError(message: string): void
}

export interface Viewport {
  load(bytes: ArrayBuffer, urls: Map<string, string>): Promise<void>
  /** Frames the glTF node with this index; no-op for unknown/non-spatial nodes. */
  focusNode(index: number): void
  setTheme(theme: ThemeName): void
  dispose(): void
}

interface SceneResources {
  scene: THREE.Scene
  environmentTarget: THREE.WebGLRenderTarget | null
}

/** Same viewing direction M1 used for the initial auto-frame. */
const FRAME_DIRECTION = new THREE.Vector3(1, 0.7, 1).normalize()

/**
 * Fits `camera` to a bounding box along `direction` and returns the box
 * center so the caller can retarget its controls. Pure framing math: the
 * only side effect is on the supplied camera.
 */
export function frameBounds(
  box: THREE.Box3,
  camera: THREE.PerspectiveCamera,
  direction: THREE.Vector3,
): THREE.Vector3 | null {
  if (box.isEmpty()) return null
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(size.length() / 2, 0.001)
  const distance = radius / Math.max(Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2), 0.1)
  camera.near = radius / 100
  camera.far = radius * 100
  camera.position.copy(center).add(direction.clone().normalize().multiplyScalar(distance))
  camera.updateProjectionMatrix()
  return center
}

/**
 * Collects the three.js object for each glTF node index from the loader's
 * association map. Materials and textures are ignored.
 */
export function collectNodeObjects(
  associations: Map<unknown, { nodes?: number }>,
): Map<number, THREE.Object3D> {
  const objects = new Map<number, THREE.Object3D>()
  for (const [object, reference] of associations) {
    if (reference.nodes === undefined || !(object instanceof THREE.Object3D)) continue
    if (!objects.has(reference.nodes)) objects.set(reference.nodes, object)
  }
  return objects
}

export function createViewport(host: HTMLElement, callbacks: ViewportCallbacks): Viewport {
  let theme: ThemeName = 'dark'
  let renderer: THREE.WebGLRenderer | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: OrbitControls | null = null
  let pmrem: THREE.PMREMGenerator | null = null
  let loaded: SceneResources | null = null
  let nodeObjects = new Map<number, THREE.Object3D>()
  let resizeObserver: ResizeObserver | null = null
  let frameHandle = 0
  let disposed = false

  const requestRender = (): void => {
    if (disposed || !renderer || !camera) return
    if (frameHandle !== 0) return
    frameHandle = requestAnimationFrame(() => {
      frameHandle = 0
      if (disposed || !renderer || !camera) return
      controls?.update()
      renderer.render(loadedScene(), camera)
    })
  }

  const loadedScene = (): THREE.Scene => loaded?.scene ?? new THREE.Scene()

  const resize = (): void => {
    if (!renderer || !camera) return
    const width = Math.max(host.clientWidth, 1)
    const height = Math.max(host.clientHeight, 1)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    requestRender()
  }

  const ensureInitialized = (): void => {
    if (renderer !== null) return
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    host.appendChild(renderer.domElement)

    camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.addEventListener('change', requestRender)

    pmrem = new THREE.PMREMGenerator(renderer)
    resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(host)
    resize()
    applyThemeColor()
  }

  const applyThemeColor = (): void => {
    if (!renderer) return
    const color = THEME_COLORS[theme]
    renderer.setClearColor(color, 1)
  }

  const disposeScene = (): void => {
    if (!loaded) return
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    loaded.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) geometries.add(mesh.geometry)
      const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
      if (Array.isArray(material)) material.forEach((entry) => materials.add(entry))
      else if (material) materials.add(material)
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
    loaded.environmentTarget?.dispose()
    loaded = null
    nodeObjects.clear()
  }

  const load = async (bytes: ArrayBuffer, urls: Map<string, string>): Promise<void> => {
    ensureInitialized()
    if (!renderer || !camera || !controls) return
    const rendererInstance = renderer
    const manager = new THREE.LoadingManager()
    manager.setURLModifier((url) => {
      const direct = urls.get(url)
      if (direct !== undefined) return direct
      try {
        const decoded = urls.get(decodeURIComponent(url))
        if (decoded !== undefined) return decoded
      } catch {
        // A malformed escape falls through to the loader unchanged.
      }
      return url
    })

    const draco = new DRACOLoader(manager)
    draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
    const ktx2 = new KTX2Loader(manager)
    ktx2.setTranscoderPath(`${import.meta.env.BASE_URL}basis/`)
    ktx2.detectSupport(rendererInstance)
    const loader = new GLTFLoader(manager)
    loader.setDRACOLoader(draco)
    loader.setKTX2Loader(ktx2)
    loader.setMeshoptDecoder(MeshoptDecoder)

    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(bytes, '', (result) => resolve(result), (error) => reject(error))
    })

    disposeScene()
    const scene = new THREE.Scene()
    scene.add(gltf.scene)

    const environmentTarget = pmrem ? pmrem.fromScene(new RoomEnvironment(), 0.04) : null
    if (environmentTarget) scene.environment = environmentTarget.texture
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(4, 8, 6)
    scene.add(key)

    const box = new THREE.Box3().setFromObject(gltf.scene)
    if (box.isEmpty()) {
      callbacks.onEmpty()
      scene.clear()
      return
    }
    nodeObjects = collectNodeObjects(gltf.parser.associations)
    const center = frameBounds(box, camera, FRAME_DIRECTION)
    if (center) controls.target.copy(center)
    controls.update()

    loaded = { scene, environmentTarget }
    resize()
    requestRender()
  }

  const focusNode = (index: number): void => {
    if (!camera || !controls) return
    const object = nodeObjects.get(index)
    if (!object) return
    const box = new THREE.Box3().setFromObject(object)
    const center = frameBounds(box, camera, FRAME_DIRECTION)
    if (!center) return
    controls.target.copy(center)
    controls.update()
    requestRender()
  }

  const setTheme = (next: ThemeName): void => {
    theme = next
    applyThemeColor()
    requestRender()
  }

  const dispose = (): void => {
    disposed = true
    if (frameHandle !== 0) cancelAnimationFrame(frameHandle)
    frameHandle = 0
    resizeObserver?.disconnect()
    resizeObserver = null
    controls?.dispose()
    controls = null
    disposeScene()
    pmrem?.dispose()
    pmrem = null
    if (renderer) {
      renderer.dispose()
      renderer.domElement.remove()
      renderer = null
    }
    camera = null
  }

  return { load, focusNode, setTheme, dispose }
}
