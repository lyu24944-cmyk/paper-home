import { TextureLoader, SRGBColorSpace, RepeatWrapping, EquirectangularReflectionMapping, type Texture } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'

RectAreaLightUniformsLib.init()

export type Quality = 'high' | 'low'
export type Surface = 'brick'|'roof'|'plaster'|'wood'|'stone'|'grass'
export type ResourcePack = {textures:Record<Surface,{map:Texture;normalMap:Texture;roughnessMap:Texture}>;tree:GLTF;plant:GLTF;environment:Texture;quality:Quality}
const packs=new Map<Quality,Promise<ResourcePack>>()
const base='/assets/realistic/'
export function loadResources(quality:Quality,onProgress?:(v:number)=>void):Promise<ResourcePack>{
  if(packs.has(quality))return packs.get(quality)!
  let done=0
  const tick=()=>onProgress?.(++done/21)
  const promise=(async()=>{
    const loader=new TextureLoader(),gltf=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const textures={} as ResourcePack['textures']
    await Promise.all((['brick','roof','plaster','wood','stone','grass'] as Surface[]).map(async kind=>{
      const [map,normalMap,roughnessMap]=await Promise.all(['color','normal','roughness'].map(async(slot)=>{const t=await loader.loadAsync(base+kind+'-'+slot+'.webp');t.wrapS=t.wrapT=RepeatWrapping;t.anisotropy=8;if(slot==='color')t.colorSpace=SRGBColorSpace;tick();return t}))
      textures[kind]={map,normalMap,roughnessMap}
    }))
    const [tree,plant,environment]=await Promise.all([
      gltf.loadAsync(base+'island_tree_01-'+quality+'.glb').then(v=>{tick();return v}),
      gltf.loadAsync(base+'potted_plant_02-'+quality+'.glb').then(v=>{tick();return v}),
      new RGBELoader().loadAsync(base+'daylight.hdr').then(v=>{v.mapping=EquirectangularReflectionMapping;tick();return v}),
    ])
    return {textures,tree,plant,environment,quality}
  })().catch(e=>{packs.delete(quality);throw e})
  packs.set(quality,promise);return promise
}
