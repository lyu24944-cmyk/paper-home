import { useEffect, useMemo } from 'react'
import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Euler, Matrix4, MeshStandardMaterial, Quaternion, Vector2, Vector3, type Material } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { V3 } from './layout'
import type { ResourcePack, Surface } from './resources'

type Part={geometry:BufferGeometry;material:string}
// Poly Haven's measured tile dimensions, in metres; color, normal and roughness share UVs.
const surfaceMeters:Record<string,number>={brick:1,roof:1.5,plaster:2.23,wood:1.7,stone:2,grass:2.51}
export class Builder{
  parts:Part[]=[]
  box(size:V3,at:V3,material:string,rotation:V3=[0,0,0],radius=0){
    const g=radius?new RoundedBoxGeometry(...size,1,Math.min(radius,Math.min(...size)/3)):new BoxGeometry(...size)
    return this.add(g,at,material,rotation)
  }
  cylinder(top:number,bottom:number,height:number,at:V3,material:string,rotation:V3=[0,0,0],segments=12){return this.add(new CylinderGeometry(top,bottom,height,segments),at,material,rotation)}
  add(g:BufferGeometry,at:V3,material:string,rotation:V3=[0,0,0]){
    g.applyMatrix4(new Matrix4().compose(new Vector3(...at),new Quaternion().setFromEuler(new Euler(...rotation)),new Vector3(1,1,1)))
    const p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv')
    const meters=surfaceMeters[material]||1
    for(let i=0;i<p.count;i++){
      const x=Math.abs(n.getX(i)),y=Math.abs(n.getY(i)),z=Math.abs(n.getZ(i))
      if(y>x&&y>z)uv.setXY(i,p.getX(i)/meters,p.getZ(i)/meters)
      else if(x>z)uv.setXY(i,p.getZ(i)/meters,p.getY(i)/meters)
      else uv.setXY(i,p.getX(i)/meters,p.getY(i)/meters)
    }
    this.parts.push({geometry:g,material});return this
  }
}
function applyGrassShader(material:MeshStandardMaterial){
  material.vertexColors=true
  material.customProgramCacheKey=()=>'countryside-grass-v2'
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>',`#include <common>
varying vec3 vGrassWorldPos;`)
      .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
vGrassWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>
varying vec3 vGrassWorldPos;
float grassHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float grassNoise(vec2 p){
  vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(grassHash(i),grassHash(i+vec2(1.0,0.0)),u.x),mix(grassHash(i+vec2(0.0,1.0)),grassHash(i+vec2(1.0,1.0)),u.x),u.y);
}
float grassFbm(vec2 p){
  float v=0.0;
  v+=0.58*grassNoise(p);
  v+=0.28*grassNoise(p*2.13+vec2(13.7,7.1));
  v+=0.14*grassNoise(p*4.41-vec2(4.9,19.3));
  return v;
}`)
      .replace('#include <map_fragment>',`#include <map_fragment>
vec2 grassCoord=vGrassWorldPos.xz;
float macroPatch=grassFbm(grassCoord*0.068);
float microPatch=grassNoise(grassCoord*0.42+vec2(macroPatch*1.4));
float fineVariation=grassNoise(grassCoord*1.35-vec2(microPatch*2.1,macroPatch*1.7));
float mossPatch=grassNoise(grassCoord*0.18+vec2(21.4,-8.2));
float elev=clamp((vGrassWorldPos.y+0.335)/3.8,0.0,1.0);
vec3 freshGreen=vec3(0.95,1.08,0.84);
vec3 warmStraw=vec3(1.18,1.06,0.74);
vec3 deepMoss=vec3(0.72,0.84,0.63);
vec3 meadowTint=mix(freshGreen,warmStraw,smoothstep(0.32,0.78,macroPatch*0.68+microPatch*0.32));
meadowTint=mix(meadowTint,deepMoss,smoothstep(0.46,0.85,mossPatch)*0.48);
meadowTint=mix(meadowTint,vec3(1.12,1.08,0.84),elev*0.32);
meadowTint*=(0.94+0.14*fineVariation);
float radialDist=length(grassCoord);
float distFade=smoothstep(26.0,76.0,radialDist);
float woodlandRing=smoothstep(18.0,32.0,radialDist)*(1.0-smoothstep(54.0,78.0,radialDist));
vec3 litMeadow=diffuseColor.rgb*meadowTint;
vec3 woodlandMoss=litMeadow*mix(vec3(0.84,0.92,0.76),vec3(1.02,0.98,0.82),macroPatch);
litMeadow=mix(litMeadow,woodlandMoss,woodlandRing*0.34);
vec3 farMeadow=vec3(0.44,0.52,0.36)*meadowTint;
diffuseColor.rgb=mix(litMeadow,farMeadow,distFade*0.38);`)
  }
}
const wetDryTint=new Color()
const wetTargetTint=new Color()
export function updateOutdoorWetness(materials:Record<string,Material>,wetness:number){
  const w=Math.max(0,Math.min(1,wetness))
  const targets:[string,number,number,string,string,number][]=[
    ['stone',.88,.34,'#bab8aa','#999b8e',.45],
    ['brick',.92,.52,'#dfb49a','#c89e85',.28],
    ['roof',.84,.42,'#5b6262','#4b5355',.35],
    ['wood',.58,.42,'#d6c6a8','#c4b290',.25],
    ['grass',.9,.74,'#a2b890','#8ca47a',.12],
  ]
  for(const [key,dryRough,wetRough,dryHex,wetHex,envBoost] of targets){
    const mat=materials[key]
    if(!(mat instanceof MeshStandardMaterial))continue
    mat.roughness=dryRough+(wetRough-dryRough)*w
    wetDryTint.set(dryHex)
    wetTargetTint.set(wetHex)
    mat.color.copy(wetDryTint).lerp(wetTargetTint,w)
    mat.envMapIntensity=1+envBoost*w
  }
}
export function makeMaterials(pack:ResourcePack){
  const result:Record<string,Material>={}
  const colors:Record<string,string>={brick:'#dfb49a',roof:'#5b6262',plaster:'#f0eee5',wood:'#d6c6a8',stone:'#bab8aa',grass:'#a2b890',trim:'#e9e5d8',dark:'#313a37',brass:'#88734c',linen:'#c4bfaa',green:'#7e8c73',terracotta:'#b17c62',paper:'#fffdf5',soil:'#3e382c',white:'#faf9f0',bookRed:'#a65e4e',bookBlue:'#687f85',bookGreen:'#7f8b69'}
  const roughness:Record<string,number>={wood:.58,plaster:.96,brick:.92,roof:.84,stone:.88,grass:.9,trim:.56,brass:.3,dark:.42,paper:.97,linen:1}
  for(const [key,color] of Object.entries(colors)){
    const surface=key in pack.textures?pack.textures[key as Surface]:{}
    const mat=new MeshStandardMaterial({color,...surface,roughness:roughness[key]??.85,normalScale:new Vector2(key==='plaster'?.28:.7,key==='plaster'?.28:.7),metalness:key==='brass'?.78:key==='dark'?.45:0})
    if(key==='grass')applyGrassShader(mat)
    result[key]=mat
  }
  return result
}
export function StaticBatch({builder,materials,castShadow=true}:{builder:Builder;materials:Record<string,Material>;castShadow?:boolean}){
  const meshes=useMemo(()=>{
    const groups=new Map<string,BufferGeometry[]>()
    for(const p of builder.parts){if(!groups.has(p.material))groups.set(p.material,[]);groups.get(p.material)!.push(p.geometry)}
    return [...groups].map(([key,geometries])=>({key,geometry:mergeGeometries(geometries.map(g=>g.index?g.toNonIndexed():g),false)!}))
  },[builder])
  useEffect(()=>()=>meshes.forEach(m=>m.geometry.dispose()),[meshes])
  return <group>{meshes.map(({key,geometry})=><mesh key={key} geometry={geometry} material={materials[key]} castShadow={castShadow} receiveShadow />)}</group>
}
