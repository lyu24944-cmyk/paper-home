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
const localRawOnly=process.argv.includes('--local-raw');
let existingManifest=null;
try{existingManifest=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8'))}catch{}
const existingRecords=new Map((existingManifest?.records||[]).map(r=>[r.name||r.id,r]));
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
 const prev=existingRecords.get(name);
 if(localRawOnly&&prev){records.push(prev);continue}
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
const primTri=p=>(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3;
async function simplifyTreeDoc(doc,target,level,err){
 const trunkCap=level==='high'?1400:750;
 const branchCap=Math.round(target*0.26);
 const leavesCap=Math.max(1200,target-trunkCap-branchCap);
 const meshes=doc.getRoot().listMeshes();
 const backups=meshes.map(m=>({mesh:m,prims:m.listPrimitives()}));
 await doc.transform(dedup());
 const buckets=[
  {match:name=>!name.includes('leaves')&&!name.includes('branches'),cap:trunkCap,e:level==='high'?0.03:0.06},
  {match:name=>name.includes('branches'),cap:branchCap,e:err*0.8},
  {match:name=>name.includes('leaves'),cap:leavesCap,e:err},
 ];
 for(const bucket of buckets){
  let currentTris=0;
  for(const {mesh,prims} of backups){
   for(const p of prims)mesh.removePrimitive(p);
   for(const p of prims){
    const matName=(p.getMaterial()?.getName()||'').toLowerCase();
    if(bucket.match(matName)){mesh.addPrimitive(p);currentTris+=primTri(p);}
   }
  }
  const r=currentTris>0?Math.min(1,bucket.cap/currentTris):1;
  if(r<1)await doc.transform(weld(),simplify({simplifier:MeshoptSimplifier,ratio:r,error:bucket.e,lockBorder:false}));
  for(const {mesh,prims} of backups){
   for(const p of mesh.listPrimitives())mesh.removePrimitive(p);
  }
 }
 for(const {mesh,prims} of backups){
  for(const p of prims)if(!p.isDisposed())mesh.addPrimitive(p);
 }
}
const models=[
 ['island_tree_01',{high:[16000,1024,.12],low:[7200,512,.22]}],
 ['island_tree_02',{high:[6000,1024,.15],low:[2600,512,.25]}],
 ['potted_plant_02',{high:[5400,1024,.04],low:[2600,512,.08]}],
 ['tree_small_02',{high:[4800,1024,.14],low:[2200,512,.24]}],
 ['shrub_sorrel_01',{high:[1800,512,.08],low:[900,512,.16]}],
 ['shrub_03',{high:[2400,512,.12],low:[1100,512,.22]}],
 ['shrub_04',{high:[1500,512,.18],low:[750,512,.3]}],
 ['fern_02',{high:[1800,512,.08],low:[900,512,.16]}],
 ['celandine_01',{high:[2200,512,.09],low:[1100,512,.18]}],
 ['periwinkle_plant',{high:[2800,512,.22],low:[1400,512,.35]}],
 ['grass_medium_02',{high:[1800,512,.14],low:[800,512,.25]}],
 ['rock_moss_set_02',{high:[3200,512,.08],low:[1600,512,.16]}],
];
for(const [id,cfg] of models){
 const folder=path.join(raw,id),prev=(existingManifest?.records||[]).find(r=>r.id===id);
 let info,assets;
 if(localRawOnly&&prev){
  info={authors:prev.authors};
  assets=prev.assets;
 }else{
  const files=await json('https://api.polyhaven.com/files/'+id);info=await meta(id);const file=files.gltf['2k'].gltf;assets=[];
  assets.push(await download(file,path.join(folder,'model.gltf')));
  const entries=Object.entries(file.include);
  for(let i=0;i<entries.length;i+=3)await Promise.all(entries.slice(i,i+3).map(async([rel,f])=>assets.push(await download(f,path.join(folder,rel)))));
 }
 const source=await io.read(path.join(folder,'model.gltf')),originalTriangles=tri(source),bounds=getBounds(source.getRoot().listScenes()[0]),lod=[];
 for(const [level,[target,texsize,err]] of Object.entries(cfg)){
  const doc=await io.read(path.join(folder,'model.gltf'));
  const ratio=Math.min(1,target/originalTriangles);
  if(originalTriangles>500000){
   await simplifyTreeDoc(doc,target,level,err);
   await doc.transform(prune(),textureCompress({encoder:sharp,targetFormat:'webp',resize:[texsize,texsize]}),meshopt({encoder:MeshoptEncoder,level:'high'}));
  }else{
   const ops=[dedup(),weld()];
   if(ratio<1)ops.push(simplify({simplifier:MeshoptSimplifier,ratio,error:err,lockBorder:false}));
   ops.push(prune(),textureCompress({encoder:sharp,targetFormat:'webp',resize:[texsize,texsize]}),meshopt({encoder:MeshoptEncoder,level:'high'}));
   await doc.transform(...ops);
  }
  const dest=path.join(out,id+'-'+level+'.glb');await io.write(dest,doc);const data=await fs.readFile(dest);
  lod.push({level,triangles:tri(doc),bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});console.log(id,level,lod.at(-1));
 }
 records.push({id,source:'https://polyhaven.com/a/'+id,authors:info.authors,license:'CC0-1.0',originalTriangles,bounds,lod,assets});
}
const prevEnv=existingRecords.get('kloofendal_48d_partly_cloudy_puresky');
if(localRawOnly&&prevEnv){
 records.push(prevEnv);
}else{
 const id='kloofendal_48d_partly_cloudy_puresky',files=await json('https://api.polyhaven.com/files/'+id),info=await meta(id);
 const env=await download(files.hdri['1k'].hdr,path.join(out,'daylight.hdr'));
 records.push({id,source:'https://polyhaven.com/a/'+id,authors:info.authors,license:'CC0-1.0',assets:[env]});
}
if(!localRawOnly)await generate1kTextures({outDir:out,updateManifest:false});
const served=[];for(const filename of (await fs.readdir(out)).sort((a,b)=>a.localeCompare(b))){if(filename==='manifest.json')continue;let data=await fs.readFile(path.join(out,filename));served.push({filename,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')})}
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({generated:new Date().toISOString(),records,served},null,2));
console.log('All assets ready',served.reduce((a,b)=>a+b.bytes,0));
