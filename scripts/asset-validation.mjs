import path from 'node:path'
import sharp from 'sharp'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder} from 'meshoptimizer'
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js'

const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
export async function validateAsset(file,data){
  const ext=path.extname(file).toLowerCase()
  if(['.webp','.png','.jpg','.jpeg'].includes(ext)){
    await sharp(data).raw().toBuffer()
  }else if(ext==='.glb'){
    const doc=await io.readBinary(new Uint8Array(data))
    if(!doc.getRoot().listMeshes().length)throw new Error('Empty GLB: '+file)
    for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
      const positions=primitive.getAttribute('POSITION')
      if(!positions?.getCount() || !Array.from(positions.getArray()).every(Number.isFinite))throw new Error('Invalid GLB positions: '+file)
    }
    for(const texture of doc.getRoot().listTextures()){
      if(!texture.getImage()?.length)throw new Error('Missing GLB texture: '+file)
      await sharp(texture.getImage()).raw().toBuffer()
    }
  }else if(ext==='.hdr'){
    const hdr=new HDRLoader().parse(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength))
    if(!hdr?.data?.length)throw new Error('Undecodable HDR: '+file)
  }
}
