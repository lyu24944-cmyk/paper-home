import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
const filename=new URL('./.layout-check.mjs',import.meta.url),source=await fs.readFile(new URL('../src/layout.ts',import.meta.url),'utf8');
await fs.writeFile(filename,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
try{
const {yardPose,yardSubjects,makeRoute,stablePose,doorStops,stopProgress}=await import(filename.href+'?t='+Date.now());
const {Vector3}=await import('three');
let count=0;
for(const [width,height] of [[1440,900],[1920,1080],[2560,1440],[768,1024],[390,844],[640,900]]){
 const a=width/height,p=yardPose(a),inv=p.orientation.clone().invert(),tan=Math.tan(p.fov*Math.PI/360);
 for(const bounds of yardSubjects)for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
  const v=new Vector3(x,y,z).sub(p.position).applyQuaternion(inv);assert(v.z<0);assert(Math.abs(v.x/-v.z)<tan*a);assert(Math.abs(v.y/-v.z)<tan);
 }
 for(const from of ['yard','hall','gallery','study','blank'])for(const to of ['yard','hall','gallery','study','blank'])if(from!==to){
  let progress=from==='hall'?.72:from==='yard'?0:stopProgress(doorStops.find(d=>d.id===from).depth);
  let prior=stablePose(from,progress,a);const points=makeRoute(from,to,progress,a);
  for(const point of points){for(let s=0;s<=100;s++){
   const t=s/100,pos=prior.position.clone().lerp(point.pose.position,t),q=prior.orientation.clone().slerp(point.pose.orientation,t),forward=new Vector3(0,0,-1).applyQuaternion(q);
   assert([...pos.toArray(),...q.toArray()].every(Number.isFinite));assert(Math.abs(q.length()-1)<1e-6);assert(Math.abs(forward.y)<.7,'camera must keep a recognizable horizontal anchor');
   // Every partition crossing must pass through a door opening, above the floor and below the lintel.
   if(Math.abs(Math.abs(pos.x)-1.16)<.075&&pos.z<-.2&&pos.z> -14.8){assert(doorStops.some(d=>Math.sign(pos.x)===d.side&&Math.abs(pos.z+d.depth)<.56),'partition collision');assert(pos.y>0&&pos.y<2.2)}
   if(Math.abs(pos.z)<.17&&Math.abs(pos.x)<5.5){assert(Math.abs(pos.x)<.55,'facade collision');assert(pos.y<2.22)}
   count++;
  }prior=point.pose}
 }
}
console.log(JSON.stringify({passed:true,samples:count,viewports:6,routePairs:120,checks:['finite poses','unit quaternions','no camera flip','doorway crossings','all yard bounds in frame']},null,2));
}finally{await fs.unlink(filename)}
