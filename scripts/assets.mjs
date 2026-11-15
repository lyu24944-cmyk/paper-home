import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup,weld,simplify,prune,textureCompress,meshopt,getBounds} from '@gltf-transform/functions';
import {MeshoptDecoder,MeshoptEncoder,MeshoptSimplifier} from 'meshoptimizer';
import {generate1kTextures} from './assets-1k.mjs';
const root=process.cwd(), out=path.join(root,'public/assets/realistic'), raw=path.join(root,'.qa/realistic/raw');
await fs.mkdir(out,{recursive:true});await fs.mkdir(raw,{recursive:true});
const records=[];
async function json(url){let r=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(url+': '+r.status);return r.json()}
async function download(file,dest){
 await fs.mkdir(path.dirname(dest),{recursive:true});
 let data;try{data=await fs.readFile(dest)}catch{}
 if(!data || (file.md5&&crypto.createHash('md5').update(data).digest('hex')!==file.md5)){
  for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(file.url,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('HTTP '+r.status);data=Buffer.from(await r.arrayBuffer());if(file.md5&&crypto.createHash('md5').update(data).digest('hex')!==file.md5)throw Error('checksum mismatch');await fs.writeFile(dest,data);break}catch(e){console.log('download retry',file.url,attempt+1,e.message);if(attempt===2)throw e}}
 }
 return {url:file.url,sourceMD5:file.md5,sha256:crypto.createHash('sha256').update(data).digest('hex'),bytes:data.length};
}
async function meta(id){return json('https://api.polyhaven.com/info/'+id)}
const textures=[['brick','red_brick_03','4k',1],['roof','roof_tiles_14','2k',1.5],['plaster','plastered_wall_02','2k',2.23],['wood','wood_floor','4k',1.7],['stone','cobblestone_floor_08','2k',2],['grass','grass_ground','2k',2.51]];
for(const [name,id,res,meters] of textures){
 const files=await json('https://api.polyhaven.com/files/'+id),info=await meta(id),assets=[];
 for(const [slot,kind] of [['color','Diffuse'],['normal','nor_gl'],['roughness','Rough']]){
  const file=files[kind][res].jpg,dest=path.join(raw,id,slot+'.jpg');assets.push(await download(file,dest));
  await sharp(dest).webp({quality:slot==='normal'?88:86}).toFile(path.join(out,name+'-'+slot+'.webp'));
 }
 records.push({name,id,source:'https://polyhaven.com/a/'+id,authors:info.authors,license:'CC0-1.0',resolution:res,meters,assets});console.log('texture',name);
}
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready,MeshoptSimplifier.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const tri=d=>d.getRoot().listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((a,p)=>a+(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3,0),0);
for(const id of ['island_tree_01','potted_plant_02']){
 const files=await json('https://api.polyhaven.com/files/'+id),info=await meta(id),file=files.gltf['2k'].gltf,folder=path.join(raw,id),assets=[];
 assets.push(await download(file,path.join(folder,'model.gltf')));
 const entries=Object.entries(file.include);
 for(let i=0;i<entries.length;i+=3)await Promise.all(entries.slice(i,i+3).map(async([rel,f])=>assets.push(await download(f,path.join(folder,rel)))));
 const source=await io.read(path.join(folder,'model.gltf')),originalTriangles=tri(source),bounds=getBounds(source.getRoot().listScenes()[0]),lod=[];
 for(const [level,target,texsize] of [['high',id==='island_tree_01'?125000:22000,2048],['low',id==='island_tree_01'?38000:7000,1024]]){
  const doc=await io.read(path.join(folder,'model.gltf'));
  await doc.transform(dedup(),weld(),simplify({simplifier:MeshoptSimplifier,ratio:Math.min(1,target/originalTriangles),error:.02,lockBorder:false}),prune(),textureCompress({encoder:sharp,targetFormat:'webp',resize:[texsize,texsize]}),meshopt({encoder:MeshoptEncoder,level:'high'}));
  const dest=path.join(out,id+'-'+level+'.glb');await io.write(dest,doc);const data=await fs.readFile(dest);
  lod.push({level,triangles:tri(doc),bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});console.log(id,level,lod.at(-1));
 }
 records.push({id,source:'https://polyhaven.com/a/'+id,authors:info.authors,license:'CC0-1.0',originalTriangles,bounds,lod,assets});
}
const id='kloofendal_48d_partly_cloudy_puresky',files=await json('https://api.polyhaven.com/files/'+id),info=await meta(id);
const env=await download(files.hdri['1k'].hdr,path.join(out,'daylight.hdr'));
records.push({id,source:'https://polyhaven.com/a/'+id,authors:info.authors,license:'CC0-1.0',assets:[env]});
await generate1kTextures({outDir:out,updateManifest:false});
const served=[];for(const filename of (await fs.readdir(out)).sort((a,b)=>a.localeCompare(b))){if(filename==='manifest.json')continue;let data=await fs.readFile(path.join(out,filename));served.push({filename,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')})}
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({generated:new Date().toISOString(),records,served},null,2));
console.log('All assets ready',served.reduce((a,b)=>a+b.bytes,0));
