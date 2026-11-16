import sharp from 'sharp'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { leafSources, leafMask, maskIoU } from '../tree-raster.mjs'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const failures = [], results = []
for (const id of ['island_tree_01','island_tree_02','tree_small_02']) {
  const reference=JSON.parse(fs.readFileSync('scripts/fixtures/canopy/reference.json','utf8'))[id]
  const masks=[]
  for(const name of reference.views)masks.push(await sharp(`scripts/fixtures/canopy/${name}`).greyscale().raw().toBuffer())
  const raw=reference
  if(process.argv.includes('--raw')){
    const source=`.qa/realistic/raw/${id}/model.gltf`
    assert(fs.existsSync(source),`Raw model required for authoring: ${id}`)
    const original=await leafSources(await io.read(source))
    for(const [i,a] of [0,Math.PI/2,Math.PI/4,-Math.PI/4].entries())assert.equal(maskIoU(masks[i],leafMask(original,a)),1,'baseline must match original source')
  }
  for(const level of ['high','low']){
    const doc=await io.read(`public/assets/realistic/${id}-${level}.glb`),data=await leafSources(doc)
    const scores=[0,Math.PI/2,Math.PI/4,-Math.PI/4].map((a,i)=>maskIoU(masks[i],leafMask(data,a,raw)))
    const budget={island_tree_01:{high:16000,low:7200},island_tree_02:{high:6000,low:2600},tree_small_02:{high:4800,low:2200}}[id][level]
    const triangles=doc.getRoot().listMeshes().flatMap(mesh=>mesh.listPrimitives()).reduce((sum,p)=>sum+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0)
    assert.ok(triangles<=budget,`${id}/${level} exceeds its original ${budget} triangle budget: ${triangles}`)
    const threshold=level==='high'?.8:.7
    results.push({id,level,triangles,budget,scores})
    if(scores.some(x=>x<threshold))failures.push(`${id}/${level}: ${scores.map(x=>x.toFixed(3)).join(',')} < ${threshold}`)
    console.log('F04 masks',JSON.stringify(results.at(-1)))
  }
}
fs.mkdirSync('.qa/regression',{recursive:true})
fs.writeFileSync('.qa/regression/f04-masks.json',JSON.stringify(results,null,2))
assert.equal(failures.length,0,failures.join('\n'))
