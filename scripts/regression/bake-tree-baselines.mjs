import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder} from 'meshoptimizer'
import {leafSources,leafMask} from '../tree-raster.mjs'
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
const folder='scripts/fixtures/canopy';fs.mkdirSync(folder,{recursive:true})
const records={}
for(const id of ['island_tree_01','island_tree_02','tree_small_02']){
 const file=`.qa/realistic/raw/${id}/model.gltf`,raw=await leafSources(await io.read(file))
 records[id]={min:raw.min,max:raw.max,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),views:[]}
 for(const [i,angle] of [0,Math.PI/2,Math.PI/4,-Math.PI/4].entries()){
  const mask=leafMask(raw,angle),name=`${id}-${i}.png`
  await sharp(Buffer.from(mask),{raw:{width:256,height:256,channels:1}}).png().toFile(path.join(folder,name))
  records[id].views.push(name)
 }
 console.log('Baked original canopy baseline:',id)
}
fs.writeFileSync(path.join(folder,'reference.json'),JSON.stringify(records,null,2))
