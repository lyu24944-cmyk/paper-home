import {
  TextureLoader,
  SRGBColorSpace,
  RepeatWrapping,
  EquirectangularReflectionMapping,
  Mesh,
  Texture,
  type Material,
  type Object3D,
} from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'

RectAreaLightUniformsLib.init()

export type Quality = 'high' | 'low'
export type Surface = 'brick' | 'roof' | 'plaster' | 'wood' | 'stone' | 'grass'
export type ResourcePack = {
  textures: Record<Surface, { map: Texture; normalMap: Texture; roughnessMap: Texture }>
  tree: GLTF
  treeBroad: GLTF
  plant: GLTF
  treeSmall: GLTF
  shrub: GLTF
  shrubThree: GLTF
  shrubFour: GLTF
  fern: GLTF
  wildflower: GLTF
  periwinkle: GLTF
  grassClump: GLTF
  rocks: GLTF
  environment: Texture
  quality: Quality
}

const packs = new Map<Quality, Promise<ResourcePack>>()
const rawBase = import.meta.env.BASE_URL || './'
const base = `${rawBase.endsWith('/') ? rawBase : `${rawBase}/`}assets/realistic/`

function disposeMaterialAndTextures(material: Material) {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value instanceof Texture) {
      value.dispose()
    }
  }
  material.dispose()
}

function disposeObjectTree(root: Object3D) {
  root.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry?.dispose()
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const mat of mats) {
        if (mat) disposeMaterialAndTextures(mat)
      }
    }
  })
}

export function disposeResourcePack(pack: ResourcePack | null | undefined): void {
  if (!pack) return
  packs.delete(pack.quality)
  for (const group of Object.values(pack.textures)) {
    group.map.dispose()
    group.normalMap.dispose()
    group.roughnessMap.dispose()
  }
  pack.environment.dispose()
  for (const model of [
    pack.tree,
    pack.treeBroad,
    pack.plant,
    pack.treeSmall,
    pack.shrub,
    pack.shrubThree,
    pack.shrubFour,
    pack.fern,
    pack.wildflower,
    pack.periwinkle,
    pack.grassClump,
    pack.rocks,
  ]) {
    disposeObjectTree(model.scene)
  }
}

export function clearResourcePacks(): void {
  packs.clear()
}

export function loadResources(quality: Quality, onProgress?: (v: number) => void): Promise<ResourcePack> {
  if (packs.has(quality)) return packs.get(quality)!
  let done = 0
  const tick = () => onProgress?.(++done / 31)
  const textureSuffix = quality === 'low' ? '-1k.webp' : '.webp'
  const promise = (async () => {
    const loader = new TextureLoader()
    const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const textures = {} as ResourcePack['textures']
    await Promise.all(
      (['brick', 'roof', 'plaster', 'wood', 'stone', 'grass'] as Surface[]).map(async (kind) => {
        const [map, normalMap, roughnessMap] = await Promise.all(
          ['color', 'normal', 'roughness'].map(async (slot) => {
            const t = await loader.loadAsync(`${base}${kind}-${slot}${textureSuffix}`)
            t.wrapS = t.wrapT = RepeatWrapping
            t.anisotropy = quality === 'low' ? 4 : 8
            if (slot === 'color') t.colorSpace = SRGBColorSpace
            tick()
            return t
          }),
        )
        textures[kind] = { map, normalMap, roughnessMap }
      }),
    )
    const loadGltf = (name: string) =>
      gltf.loadAsync(`${base}${name}-${quality}.glb`).then((v) => {
        tick()
        return v
      })
    const [
      tree,
      treeBroad,
      plant,
      treeSmall,
      shrub,
      shrubThree,
      shrubFour,
      fern,
      wildflower,
      periwinkle,
      grassClump,
      rocks,
      environment,
    ] = await Promise.all([
      loadGltf('island_tree_01'),
      loadGltf('island_tree_02'),
      loadGltf('potted_plant_02'),
      loadGltf('tree_small_02'),
      loadGltf('shrub_sorrel_01'),
      loadGltf('shrub_03'),
      loadGltf('shrub_04'),
      loadGltf('fern_02'),
      loadGltf('celandine_01'),
      loadGltf('periwinkle_plant'),
      loadGltf('grass_medium_02'),
      loadGltf('rock_moss_set_02'),
      new RGBELoader().loadAsync(`${base}daylight.hdr`).then((v) => {
        v.mapping = EquirectangularReflectionMapping
        tick()
        return v
      }),
    ])
    return {
      textures,
      tree,
      treeBroad,
      plant,
      treeSmall,
      shrub,
      shrubThree,
      shrubFour,
      fern,
      wildflower,
      periwinkle,
      grassClump,
      rocks,
      environment,
      quality,
    }
  })().catch((e) => {
    packs.delete(quality)
    throw e
  })
  packs.set(quality, promise)
  return promise
}
