import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, CanvasTexture, CylinderGeometry, DoubleSide, Euler, ExtrudeGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RGBADepthPacking, Shape, ShapeGeometry, SRGBColorSpace, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import gsap from 'gsap'
import { DEFAULT_NOW_NOTES, getAtmosphereLighting } from './atmosphere'
import type { Place } from './content'
import { playSound } from './lib/sound'
import type { AtmospherePreset, GalleryDisplayItem, WeatherMode } from './types/content'
import { Builder, makeMaterials, StaticBatch } from './Geometry'
import { doorStops, gallerySlotX, layout, roomTransform, type FocusSubPoseId, type V3 } from './layout'
import type { ResourcePack } from './resources'
export { CameraController, type CameraHandle } from './Camera'
export { doorStops, hallPose } from './layout'

const on=()=>{document.body.style.cursor='pointer'},off=()=>{document.body.style.cursor=''}
function textMap(title:string,sub='',width=1600,height=420){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  const c=canvas.getContext('2d')!;c.fillStyle='#eee9dc';c.fillRect(0,0,width,height);c.fillStyle='#363d35';c.textAlign='center';c.textBaseline='middle'
  c.font=`${Math.min(180,width/(title.length+1))}px HomeHand, KaiTi, serif`;c.fillText(title,width/2,height*(sub?.37:.5),width*.9)
  if(sub){c.font='48px Microsoft YaHei, sans-serif';c.fillStyle='#595e50';c.fillText(sub,width/2,height*.77,width*.9)}
  const t=new CanvasTexture(canvas);t.colorSpace=SRGBColorSpace;t.anisotropy=8;return t
}
function Plaque({text,sub='',at,size=[1.45,.38],rotation=0}:{text:string;sub?:string;at:V3;size?:[number,number];rotation?:number}){
  const texture=useMemo(()=>textMap(text,sub),[text,sub]);useEffect(()=>()=>texture.dispose(),[texture])
  return <group position={at} rotation={[0,rotation,0]}><mesh castShadow receiveShadow><boxGeometry args={[size[0]+.04,size[1]+.04,.045]}/><meshStandardMaterial color="#6f6047" roughness={.75}/></mesh><mesh position={[0,0,.024]}><planeGeometry args={size}/><meshStandardMaterial map={texture} roughness={.85}/></mesh></group>
}
function Signage({homeName,plaqueTitle,plaqueSubtitle,materials,onTapPlaque}:{homeName:string;plaqueTitle:string;plaqueSubtitle:string;materials:ReturnType<typeof makeMaterials>;onTapPlaque?:()=>void}){
  const signs=useMemo(()=>{
    const labels=[{text:homeName,sub:'',at:[0,2.38,.13] as V3,size:[1.48,.25],r:0},{text:plaqueTitle,sub:plaqueSubtitle,at:[1.075,1.75,-1.45] as V3,size:[.9,.42],r:-Math.PI/2},...doorStops.map(d=>({text:d.name,sub:'',at:[d.side*1.075,2.43,-d.depth] as V3,size:[.88,.22],r:-d.side*Math.PI/2}))]
    const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const c=canvas.getContext('2d')!,b=new Builder(),geometries:PlaneGeometry[]=[]
    c.fillStyle='#eee9dc';c.fillRect(0,0,2048,2048)
    labels.forEach((label,index)=>{
      const t=textMap(label.text,label.sub,2048,384);c.drawImage(t.image as HTMLCanvasElement,0,index*384);t.dispose()
      b.box([label.size[0]+.04,label.size[1]+.04,.045],label.at,'brass',[0,label.r,0],.004)
      const g=new PlaneGeometry(label.size[0],label.size[1]),uv=g.getAttribute('uv')
      for(let i=0;i<uv.count;i++)uv.setY(i,(uv.getY(i)*384+2048-(index+1)*384)/2048)
      const m=new Matrix4().makeRotationY(label.r),p=new Vector3(0,0,.024).applyMatrix4(m).add(new Vector3(...label.at));m.setPosition(p);g.applyMatrix4(m);geometries.push(g)
    })
    const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.anisotropy=8
    return {b,geometry:mergeGeometries(geometries,false)!,texture}
  },[homeName,plaqueTitle,plaqueSubtitle])
  useEffect(()=>()=>{signs.geometry.dispose();signs.texture.dispose()},[signs])
  return <group onClick={e=>{e.stopPropagation();if(e.delta<8){playSound('bench');onTapPlaque?.()}}} onPointerOver={on} onPointerOut={off}><StaticBatch builder={signs.b} materials={materials}/><mesh geometry={signs.geometry} receiveShadow><meshStandardMaterial map={signs.texture} roughness={.85}/></mesh></group>
}
function doorParts(width:number){
  const b=new Builder(),h=layout.doorHeight
  b.box([width,h,.065],[width/2,h/2,0],'wood',[0,0,0],.01)
  for(const x of [.075,width-.075])b.box([.12,h-.08,.035],[x,h/2,.045],'wood',[0,0,0],.009)
  for(const y of [.12,1.05,2.08])b.box([width-.12,.12,.035],[width/2,y,.045],'wood',[0,0,0],.008)
  for(const y of [.57,1.58])b.box([width-.29,.72,.022],[width/2,y,.042],'wood',[0,0,0],.006)
  b.box([.035,.18,.018],[width-.16,1.04,.075],'brass',[0,0,0],.006)
  b.cylinder(.015,.015,.14,[width-.21,1.06,.11],'brass',[0,0,Math.PI/2],12)
  for(const y of [.24,1.16,1.98])b.cylinder(.012,.012,.095,[.025,y,.065],'brass')
  return b
}
function Door({at,rotation=0,open,click,materials,reduced}:{at:V3;rotation?:number;open:boolean;click:()=>void;materials:ReturnType<typeof makeMaterials>;reduced:boolean}){
  const pivot=useRef<Group>(null),body=useMemo(()=>doorParts(layout.doorWidth),[])
  const {gl}=useThree()
  useEffect(()=>{const ctx=gsap.context(()=>{if(pivot.current)gsap.to(pivot.current.rotation,{y:open?-1.62:0,duration:reduced?0:.7,ease:'power2.inOut',onComplete:()=>{gl.shadowMap.needsUpdate=true}})});return()=>ctx.revert()},[open,reduced])
  return <group position={at} rotation={[0,rotation,0]} onClick={e=>{e.stopPropagation();if(e.delta<8)click()}} onPointerOver={on} onPointerOut={off}>
    <group ref={pivot} position={[-layout.doorWidth/2,0,.01]}><StaticBatch builder={body} materials={materials}/></group>
  </group>
}
function windowParts(b:Builder,width:number,height:number,at:V3,rotation=0){
  const local=new Builder()
  for(const x of [-width/2,width/2])local.box([.075,height+.15,.21],[x,0,0],'trim',[0,0,0],.006)
  for(const y of [-height/2,height/2])local.box([width+.15,.075,.21],[0,y,0],'trim',[0,0,0],.006)
  local.box([.042,height,.09],[0,0,.04],'trim',[0,0,0],.004)
  local.box([width,.042,.09],[0,0,.04],'trim',[0,0,0],.004)
  // A recessed glazing bead and a darker gasket keep clear panes from reading as holes.
  for(const x of [-width/2+.047,width/2-.047])local.box([.012,height-.08,.018],[x,0,.045],'dark')
  for(const y of [-height/2+.047,height/2-.047])local.box([width-.08,.012,.018],[0,y,.045],'dark')
  local.box([.016,.12,.027],[.075,-.08,.115],'brass',[0,0,0],.004)
  local.box([width+.32,.095,.42],[0,-height/2-.07,.07],'stone',[0,0,0],.01)
  const matrix=new Matrix4().makeRotationY(rotation);matrix.setPosition(...at)
  for(const p of local.parts){p.geometry.applyMatrix4(matrix);b.parts.push(p)}
}
const windows=[
  {at:[-3.25,1.6,.015] as V3,w:1.8,h:1.35,r:0}, {at:[3.25,1.6,.015] as V3,w:1.8,h:1.35,r:0},
  ...[-1,1].flatMap(side=>[3.2,7,10.8].map(depth=>({at:[side*5.51,1.65,-depth] as V3,w:1.75,h:1.4,r:side*Math.PI/2}))),
  {at:[0,1.7,-15.015] as V3,w:1.25,h:1.5,r:Math.PI},
]
function wallWithOpenings(b:Builder,length:number,at:V3,rotation:number,holes:{x:number;w:number;y:number;h:number}[],material='brick',thickness=.24){
  const local=new Builder(),height=layout.wallHeight,sorted=holes.slice().sort((a,b)=>a.x-b.x);let left=-length/2
  for(const hole of sorted){const x=hole.x-hole.w/2,right=hole.x+hole.w/2
    if(x>left)local.box([x-left,height,thickness],[(x+left)/2,height/2,0],material)
    if(hole.y-hole.h/2>0)local.box([hole.w,hole.y-hole.h/2,thickness],[hole.x,(hole.y-hole.h/2)/2,0],material)
    const top=hole.y+hole.h/2;if(top<height)local.box([hole.w,height-top,thickness],[hole.x,(height+top)/2,0],material)
    left=right
  }
  if(left<length/2)local.box([length/2-left,height,thickness],[(length/2+left)/2,height/2,0],material)
  const m=new Matrix4().makeRotationY(rotation);m.setPosition(...at)
  for(const p of local.parts){p.geometry.applyMatrix4(m);b.parts.push(p)}
}
function shell(){
  const b=new Builder()
  b.box([11.3,.28,15.3],[0,-.16,-7.5],'stone')
  b.box([10.8,.085,14.8],[0,-.045,-7.5],'wood')
  b.box([10.8,.14,14.8],[0,2.96,-7.5],'plaster')
  const facade=[{x:0,w:1.08,y:1.11,h:2.22},...[-3.25,3.25].map(x=>({x,w:1.9,y:1.6,h:1.45}))]
  wallWithOpenings(b,11,[0,0,0],0,facade)
  wallWithOpenings(b,11,[0,0,-.14],0,facade,'plaster',.06)
  for(const side of [-1,1]){
    const holes=[3.2,7,10.8].map(depth=>({x:depth-7.5,w:1.85,y:1.65,h:1.5}))
    wallWithOpenings(b,15,[side*5.5,0,-7.5],Math.PI/2,holes)
    wallWithOpenings(b,14.75,[side*5.35,0,-7.5],Math.PI/2,holes,'plaster',.045)
    const roomDoors=doorStops.filter(d=>d.side===side).map(d=>({x:d.depth-7.5,w:1.13,y:1.11,h:2.22}))
    wallWithOpenings(b,14.7,[side*1.16,0,-7.5],Math.PI/2,roomDoors,'plaster',.12)
    // Skirting is segmented around each door opening.
    let start=.2
    for(const d of [...doorStops.filter(d=>d.side===side),{depth:15.1}]){const end=d.depth-.62;if(end>start)b.box([.055,.13,end-start],[side*1.08,.075,-(end+start)/2],'trim');start=d.depth+.62}
    b.box([.075,.07,14.7],[side*1.07,2.82,-7.5],'trim')
    b.box([.055,.13,14.7],[side*5.29,.075,-7.5],'trim')
  }
  wallWithOpenings(b,11,[0,0,-15],0,[{x:0,w:1.35,y:1.7,h:1.6}])
  wallWithOpenings(b,10.8,[0,0,-14.84],0,[{x:0,w:1.35,y:1.7,h:1.6}],'plaster',.05)
  b.box([4.15,2.9,.12],[-3.27,1.45,-6.5],'plaster')
  for(const side of [-1,1])b.box([4.1,.13,.055],[-3.27,.075,-6.5+side*.09],'trim')
  for(const z of [-2.9,-11.1]){b.box([4.15,2.9,.12],[3.27,1.45,z],'plaster');for(const side of [-1,1])b.box([4.1,.13,.055],[3.27,.075,z+side*.09],'trim')}
  b.box([10.5,.13,.055],[0,.075,-14.77],'trim')
  for(const w of windows)windowParts(b,w.w,w.h,w.at,w.r)
  const frames=[{at:[0,0,.035] as V3,r:0},...doorStops.map(d=>({at:[d.side*1.08,0,-d.depth] as V3,r:-d.side*Math.PI/2}))]
  for(const f of frames){const local=new Builder()
    for(const x of [-.575,.575])local.box([.105,2.28,.19],[x,1.14,0],'trim',[0,0,0],.005)
    local.box([1.25,.105,.19],[0,2.24,0],'trim',[0,0,0],.005)
    local.box([1.1,.025,.24],[0,.013,0],'stone',[0,0,0],.004)
    const m=new Matrix4().makeRotationY(f.r);m.setPosition(...f.at);for(const p of local.parts){p.geometry.applyMatrix4(m);b.parts.push(p)}
  }
  const pitch=Math.atan2(2.45,5.95),slope=Math.hypot(5.95,2.45)
  for(const side of [-1,1]){
    b.box([slope,.18,16],[side*2.975,4.18,-7.5],'roof',[0,0,-side*pitch],.015)
    b.box([.14,.2,16.1],[side*5.97,2.96,-7.5],'trim')
    b.cylinder(.065,.065,15.9,[side*6.03,2.9,-7.5],'dark',[Math.PI/2,0,0],12)
    b.cylinder(.045,.045,2.8,[side*5.63,1.36,-.2],'dark')
    for(const z of [.52,-15.52])b.box([slope,.13,.15],[side*2.975,4.18,z],'trim',[0,0,-side*pitch])
  }
  b.cylinder(.1,.1,16.05,[0,5.46,-7.5],'roof',[Math.PI/2,0,0])
  for(const z of [-.02,-14.99]){
    const shape=new Shape();shape.moveTo(-5.5,2.9);shape.lineTo(5.5,2.9);shape.lineTo(0,5.2);shape.closePath()
    b.add(new ExtrudeGeometry(shape,{depth:.16,bevelEnabled:false}),[0,0,z],'brick',z< -1?[0,Math.PI,0]:[0,0,0])
  }
  b.box([2.8,.18,1.8],[0,-.11,.85],'stone',[0,0,0],.025)
  b.box([3.15,.13,.65],[0,-.195,2.0],'stone',[0,0,0],.025)
  b.box([3,.13,1.6],[0,2.6,.72],'roof',[.045,0,0],.01)
  for(const side of [-1,1]){b.box([.1,2.55,.1],[side*1.35,1.22,1.38],'trim',[0,0,0],.01);b.box([.08,.65,.08],[side*1.1,2.29,1.38],'trim',[0,0,side*.6])}
  b.box([.78,.018,.42],[0,.003,.56],'linen')
  b.box([.17,.31,.1],[-.84,1.83,.24],'dark',[0,0,0],.01)
  b.box([.11,.22,.11],[-.84,1.83,.32],'brass',[0,0,0],.01)
  // Exposed end grain, fascia, post feet and a doorstep with a readable nosing.
  b.box([3.08,.14,.12],[0,2.53,1.55],'trim',[0,0,0],.008)
  b.box([2.85,.035,.09],[0,-.018,1.77],'stone',[0,0,0],.008)
  for(const side of [-1,1]){
    b.box([.15,.08,.15],[side*1.35,.02,1.38],'dark',[0,0,0],.006)
    b.box([.18,.04,.18],[side*1.35,-.025,1.38],'stone',[0,0,0],.006)
  }
  return b
}
function garden(){
  const b=new Builder()
  b.box([1000,.25,1000],[0,-.46,-10],'grass')
  for(let i=0;i<10;i++)b.box([1.12+(i%3)*.09,.105,.69],[Math.sin(i*.7)*.16,-.23,2.55+i*.79],'stone',[0,(i%2?.045:-.045),0],.035)
  for(const side of [-1,1]){
    b.box([.16,.18,16.6],[side*7.35,-.22,2.3],'stone')
    b.box([5.1,.22,.13],[side*4.45,-.21,10.1],'stone')
    for(const z of [4.1,6.4,8.6]){
      b.cylinder(.035,.035,.9,[side*6.4,.1,z],'dark')
      b.box([.16,.05,.16],[side*6.4,.56,z],'dark',[0,0,0],.015)
      b.box([.12,.14,.12],[side*6.4,.46,z],'linen',[0,0,0],.01)
    }
    for(const z of [2.3,10.15])b.box([5.1,.055,.12],[side*4.6,.35,z],'wood')
    for(const z of [3,4.2,5.4,6.6,7.8,9])b.box([.085,.85,.085],[side*7.35,.13,z],'wood',[0,0,0],.006)
    b.box([.09,.09,7.7],[side*7.35,.47,6.15],'wood')
  }
  b.box([1.65,.075,.43],[-5,.25,6.1],'wood',[0,.1,0],.015)
  for(const x of [-5.6,-4.4])b.box([.065,.5,.36],[x,-.01,6.1],'dark')
  // Soft linen seat cushion & open garden notebook on the wooden bench
  b.box([.52,.04,.34],[-4.72,.305,6.08],'linen',[0,.16,0],.012)
  b.box([.24,.016,.18],[-5.28,.296,6.12],'paper',[0,-.18,0],.004)
  b.cylinder(1.05,1.12,.08,[-5.5,-.27,5.3],'soil',[0,0,0],32)
  // Porchside wooden postbox
  b.cylinder(.042,.048,1.02,[1.72,.28,1.92],'dark')
  b.box([.32,.24,.42],[1.72,.84,1.92],'wood',[0,-.18,0],.018)
  b.box([.35,.045,.45],[1.72,.97,1.92],'roof',[0,-.18,0],.01)
  b.box([.18,.025,.02],[1.7,.89,2.13],'brass',[0,-.18,0],.004)
  return b
}
function Plant({pack,at,height=1,tree=false,rotation=0,onTap}:{pack:ResourcePack;at:V3;height?:number;tree?:boolean;rotation?:number;onTap?:()=>void}){
  const object=useMemo(()=>{
    const root=(tree?pack.tree:pack.plant).scene.clone(true),bounds=new Box3().setFromObject(root),size=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3())
    const scale=height/size.y
    root.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);root.scale.setScalar(scale)
    root.traverse(o=>{if(o instanceof Mesh){o.castShadow=true;o.receiveShadow=true
      const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>{if(m.alphaTest>0)o.customDepthMaterial=new MeshDepthMaterial({map:m.map,alphaTest:m.alphaTest,depthPacking:RGBADepthPacking,side:DoubleSide})})
    }})
    return root
  },[pack,tree,height])
  return <group position={at} rotation={[0,rotation,0]} onClick={e=>{e.stopPropagation();if(e.delta<8){playSound('foliage');onTap?.()}}} onPointerOver={on} onPointerOut={off}><primitive object={object}/></group>
}
function Grass(){
  const ref=useRef<InstancedMesh>(null),geometry=useMemo(()=>{const shape=new Shape();shape.moveTo(-.018,0);shape.quadraticCurveTo(-.018,.14,.045,.24);shape.quadraticCurveTo(.018,.1,.018,0);shape.closePath();return new ShapeGeometry(shape,3)},[])
  useEffect(()=>{if(!ref.current)return;const m=new Matrix4(),p=new Vector3(),q=new Quaternion(),s=new Vector3();for(let i=0;i<420;i++){const x=Math.sin(i*127.1)*6.8,z=2.4+((i*7.31)%7.7);p.set(Math.abs(x)<.9?x+1.8:x,-.32,z);q.setFromAxisAngle(new Vector3(0,1,0),i*2.4);s.setScalar(.65+(i%6)*.18);m.compose(p,q,s);ref.current.setMatrixAt(i,m)}ref.current.instanceMatrix.needsUpdate=true},[])
  return <instancedMesh ref={ref} args={[geometry,undefined,420]} castShadow receiveShadow><meshStandardMaterial color="#42613b" roughness={1} side={DoubleSide}/></instancedMesh>
}
function RainOverlay({count,reduced,isNight}:{count:number;reduced:boolean;isNight:boolean}){
  const ref=useRef<InstancedMesh>(null)
  const geometry=useMemo(()=>new CylinderGeometry(.0035,.0035,.58,4,1),[])
  const material=useMemo(()=>new MeshBasicMaterial({color:isNight?'#9bb8d4':'#d8e6ee',transparent:true,opacity:isNight?.32:.38,depthWrite:false}),[isNight])
  const drops=useMemo(()=>{
    const arr:{x:number;y:number;z:number;speed:number}[]=[]
    for(let i=0;i<count;i++){
      // Place drops in the yard and outside the side/front windows, never inside the house footprint [-5.6..5.6, -15.2..0.25]
      const inFrontYard=i%3!==0
      const x=inFrontYard?((i*73.17)%14.4)-7.2:((i%2===0?-1:1)*(6.0+((i*19.3)%2.4)))
      const z=inFrontYard?0.65+((i*41.9)%9.6):-((i*53.7)%14.2)
      const y=((i*29.3)%6.6)-0.2
      const speed=6.8+(i%7)*.65
      arr.push({x,y,z,speed})
    }
    return arr
  },[count])
  const dummy=useMemo(()=>({m:new Matrix4(),p:new Vector3(),q:new Quaternion().setFromEuler(new Euler(0,0,.07)),s:new Vector3(1,1,1)}),[])
  useEffect(()=>{
    if(!ref.current)return
    drops.forEach((d,i)=>{
      dummy.p.set(d.x,d.y,d.z)
      dummy.m.compose(dummy.p,dummy.q,dummy.s)
      ref.current!.setMatrixAt(i,dummy.m)
    })
    ref.current.instanceMatrix.needsUpdate=true
  },[drops,dummy])
  useEffect(()=>()=>{geometry.dispose();material.dispose()},[geometry,material])
  useFrame((_,dt)=>{
    if(reduced||!ref.current)return
    const step=Math.min(dt,.05)
    for(let i=0;i<drops.length;i++){
      const d=drops[i]
      d.y-=d.speed*step
      if(d.y<-.25)d.y=6.4+(i%5)*.2
      dummy.p.set(d.x,d.y,d.z)
      dummy.m.compose(dummy.p,dummy.q,dummy.s)
      ref.current.setMatrixAt(i,dummy.m)
    }
    ref.current.instanceMatrix.needsUpdate=true
  })
  return <instancedMesh ref={ref} args={[geometry,material,count]} userData={{skipAO:true}} frustumCulled={false} castShadow={false} receiveShadow={false}/>
}
function roomFurniture(id:Place){
  const b=new Builder()
  if(id==='study'){
    b.box([1.65,.055,.74],[-.45,.745,-.92],'wood',[0,0,0],.014)
    for(const x of [-1.12,.22])for(const z of [-1.19,-.65])b.box([.055,.72,.055],[x,.36,z],'wood',[0,0,0],.006)
    b.box([.46,.06,.46],[-.45,.45,.1],'green',[0,0,0],.02)
    b.box([.46,.42,.055],[-.45,.69,.3],'wood',[0,0,0],.015)
    for(const x of [-.62,-.28])for(const z of [-.06,.28])b.box([.04,.43,.04],[x,.215,z],'wood')
    b.box([1.25,2.05,.055],[2.3,1.025,-1.67],'wood')
    for(const x of [1.67,2.93])b.box([.055,2.05,.34],[x,1.025,-1.5],'wood')
    for(const y of [.12,.52,.93,1.35,1.78,2.04])b.box([1.3,.045,.36],[2.3,y,-1.5],'wood')
    for(let i=0;i<38;i++)b.box([.055+(i%3)*.014,.24+(i%4)*.035,.2],[1.78+(i%13)*.085,.66+Math.floor(i/13)*.415,-1.46],['bookRed','bookBlue','bookGreen','linen'][i%4],[0,0,i%11===0?.1:0],.003)
    b.cylinder(.105,.12,.03,[.08,.79,-1.08],'dark')
    b.cylinder(.009,.009,.36,[.08,.98,-1.08],'brass')
    b.box([1.5,.012,1.55],[-.45,.009,.1],'linen',[0,.04,0])
    // Apron joints, a shallow drawer and writing objects, sized in metres.
    b.box([1.38,.13,.035],[-.45,.65,-.59],'wood',[0,0,0],.005)
    for(const x of [-1.12,.22])b.box([.035,.13,.55],[x,.65,-.92],'wood',[0,0,0],.005)
    b.box([.47,.105,.028],[-.45,.65,-.565],'wood',[0,0,0],.004)
    b.cylinder(.009,.009,.115,[-.45,.65,-.54],'brass',[0,0,Math.PI/2])
    b.box([.5,.004,.32],[-.69,.779,-.87],'paper',[0,-.09,0])
    b.cylinder(.004,.004,.17,[-.34,.785,-.79],'dark',[Math.PI/2,0,.5])
    b.cylinder(.05,.045,.085,[.28,.814,-.8],'white',[0,0,0],24)
    b.cylinder(.039,.039,.002,[.28,.858,-.8],'soil',[0,0,0],24)
    for(const y of [.52,.93,1.35,1.78])for(const x of [1.7,2.9])b.box([.025,.055,.17],[x,y-.045,-1.42],'brass')
  }else if(id==='gallery'){
    b.cylinder(.018,.018,4.7,[0,2.55,-.5],'dark',[0,0,Math.PI/2])
    for(const x of [-2.25,2.25]){b.cylinder(.022,.022,2.5,[x,1.25,-.5],'dark');b.cylinder(.055,.055,.025,[x,.02,-.5],'dark')}
    b.box([4.45,.06,.09],[0,.93,-1.22],'wood',[0,0,0],.012)
    for(let i=0;i<17;i++)b.cylinder(.013,.013,.87,[-2.1+i*.26,.46,-1.22],'dark')
    b.box([1.4,.09,.4],[0,.45,.52],'wood',[0,0,0],.02)
    for(const x of [-.52,.52])b.box([.06,.4,.32],[x,.2,.52],'dark')
    b.box([4.36,.022,.23],[0,.925,-1.22],'wood',[0,0,0],.004)
    for(const x of [-2.2,0,2.2])b.box([.08,.035,.22],[x,.88,-1.22],'brass',[0,0,0],.004)
    for(const x of [-2.25,2.25]){
      b.cylinder(.04,.04,.035,[x,2.55,-.5],'brass',[0,0,Math.PI/2])
      b.box([.07,.065,.2],[x,2.55,-.6],'dark',[0,0,0],.005)
    }
  }else{
    b.box([1.35,.065,.65],[0,.39,-.6],'wood',[0,0,0],.022)
    for(const x of [-.53,.53])b.box([.07,.36,.5],[x,.18,-.6],'wood',[0,0,0],.007)
    b.box([2.1,.012,1.45],[0,.009,-.15],'linen',[0,.035,0])
    // Wooden postcard & guestbook stamp box on the left side of the table
    b.box([.28,.085,.21],[-.38,.465,-.59],'wood',[0,.12,0],.012)
    b.box([.29,.022,.22],[-.38,.515,-.59],'trim',[0,.12,0],.006)
    b.box([.055,.028,.018],[-.365,.475,-.48],'brass',[0,.12,0],.004)
    // Wooden stamp handle next to the guestbox
    b.cylinder(.024,.028,.022,[-.17,.435,-.47],'brass',[0,0,0],16)
    b.cylinder(.012,.016,.055,[-.17,.47,-.47],'wood',[0,0,0],16)
    b.cylinder(.08,.06,.2,[.42,.52,-.64],'terracotta',[0,0,0],24)
  }
  return b
}
function drawNowNoteCard(canvas:HTMLCanvasElement,text:string,index:number){
  const w=canvas.width,h=canvas.height,c=canvas.getContext('2d')!
  c.fillStyle=index===0?'#fbf7ec':index===1?'#f4f0e1':'#f8f3e6'
  c.fillRect(0,0,w,h)
  c.strokeStyle='rgba(86,110,87,.28)';c.lineWidth=4;c.strokeRect(14,14,w-28,h-28)
  c.fillStyle='#566e57';c.font='24px Microsoft YaHei, sans-serif';c.textAlign='left';c.textBaseline='top'
  c.fillText(`NOW · 0${index+1}`,28,26)
  c.fillStyle='#2f3830';c.font='36px HomeHand, KaiTi, serif';c.textAlign='center';c.textBaseline='middle'
  const clean=text.trim()||DEFAULT_NOW_NOTES[index]||DEFAULT_NOW_NOTES[0]
  const line1=clean.slice(0,10),line2=clean.slice(10,22)
  if(line2){
    c.fillText(line1,w/2,h*.5-22,w-48)
    c.fillText(line2,w/2,h*.5+26,w-48)
  }else{
    c.fillText(line1,w/2,h*.52,w-48)
  }
}
function BlankTabletopCards({nowNotes,onSelect}:{nowNotes?:string[];onSelect:()=>void}){
  const notes=useMemo(()=>{
    const list=(nowNotes&&nowNotes.length>0?nowNotes:DEFAULT_NOW_NOTES).slice(0,3)
    while(list.length<3)list.push(DEFAULT_NOW_NOTES[list.length]||'记录日常微光')
    return list
  },[nowNotes])
  const textures=useMemo(()=>{
    return notes.map((note,idx)=>{
      const cvs=document.createElement('canvas');cvs.width=360;cvs.height=240
      drawNowNoteCard(cvs,note,idx)
      const tex=new CanvasTexture(cvs);tex.colorSpace=SRGBColorSpace;tex.anisotropy=4
      return tex
    })
  },[notes])
  useEffect(()=>()=>{textures.forEach(t=>t.dispose())},[textures])
  const placements:{pos:V3;rot:number}[]=[
    {pos:[-.03,.428,-.64],rot:-.09},
    {pos:[.16,.431,-.52],rot:.11},
    {pos:[-.08,.434,-.44],rot:.04},
  ]
  return <group onClick={e=>{e.stopPropagation();if(e.delta<8)onSelect()}} onPointerOver={on} onPointerOut={off}>
    {textures.map((tex,i)=>(
      <mesh key={i} position={placements[i].pos} rotation={[-Math.PI/2,0,placements[i].rot]} receiveShadow castShadow>
        <planeGeometry args={[.22,.15]}/>
        <meshStandardMaterial map={tex} roughness={.92}/>
      </mesh>
    ))}
    <group position={[-.38,.56,-.59]} rotation={[-Math.PI/3,0,.12]}>
      <Plaque text="近况与寄语匣" sub="点击俯瞰桌面 · 盖章留念" at={[0,0,0]} size={[.34,.16]}/>
    </group>
  </group>
}
function StudyInteractiveNodes({deskLampOn,onToggleLamp,onDrawQuote}:{deskLampOn:boolean;onToggleLamp?:()=>void;onDrawQuote?:()=>void}){
  const shadeMaterial=useMemo(()=>new MeshStandardMaterial({
    color:deskLampOn?'#8fb07c':'#7e8c73',
    emissive:deskLampOn?'#ffcf75':'#000000',
    emissiveIntensity:deskLampOn?.75:0,
    roughness:.48,
  }),[deskLampOn])
  useEffect(()=>()=>shadeMaterial.dispose(),[shadeMaterial])
  return <>
    <group position={[.08,1.2,-1.08]} onClick={e=>{e.stopPropagation();if(e.delta<8)onToggleLamp?.()}} onPointerOver={on} onPointerOut={off}>
      <mesh castShadow receiveShadow material={shadeMaterial}>
        <cylinderGeometry args={[.09,.18,.15,16]}/>
      </mesh>
      <mesh position={[0,-.04,0]}>
        <sphereGeometry args={[.038,12,12]}/>
        <meshBasicMaterial color={deskLampOn?'#fff4d2':'#cfc9b8'}/>
      </mesh>
      {deskLampOn&&(
        <pointLight position={[0,-.08,.04]} color="#ffcf80" intensity={3.8} distance={4.4} decay={2}/>
      )}
    </group>
    <group position={[2.3,1.48,-1.3]} onClick={e=>{e.stopPropagation();if(e.delta<8)onDrawQuote?.()}} onPointerOver={on} onPointerOut={off}>
      <Plaque text="书架灵感签" sub="抽一张读过的句子" at={[0,0,0]} size={[.36,.18]}/>
    </group>
  </>
}
function drawGallerySheet(canvas:HTMLCanvasElement,title:string,img?:HTMLImageElement|null){
  const w=canvas.width,h=canvas.height,c=canvas.getContext('2d')!
  c.fillStyle='#eee8d9';c.fillRect(0,0,w,h)
  c.strokeStyle='rgba(72,77,65,.22)';c.lineWidth=3;c.strokeRect(18,18,w-36,h-36)
  if(img&&img.naturalWidth>0&&img.naturalHeight>0){
    const padX=34,padTop=38,areaW=w-padX*2,areaH=h-185
    const scale=Math.min(areaW/img.naturalWidth,areaH/img.naturalHeight)
    const dw=img.naturalWidth*scale,dh=img.naturalHeight*scale
    const dx=padX+(areaW-dw)/2,dy=padTop+(areaH-dh)/2
    c.fillStyle='#faf7ee';c.fillRect(dx-6,dy-6,dw+12,dh+12)
    c.drawImage(img,dx,dy,dw,dh)
    c.fillStyle='#2f3830';c.textAlign='center';c.textBaseline='middle'
    c.font='38px HomeHand, KaiTi, STKaiti, "Microsoft YaHei", serif'
    c.fillText(title,w/2,h-84,w-84)
  }else{
    c.fillStyle='#2f3830';c.textAlign='center';c.textBaseline='middle'
    c.font='44px HomeHand, KaiTi, STKaiti, "Microsoft YaHei", serif'
    c.fillText(title,w/2,h/2,w-96)
  }
}
function Paper({item,index,count,reduced,interact,onCoverExpired}:{item:GalleryDisplayItem;index:number;count:number;reduced:boolean;interact:(i:number)=>void;onCoverExpired?:(assetId:string)=>void}){
  const group=useRef<Group>(null)
  const {canvas,texture}=useMemo(()=>{
    const cvs=document.createElement('canvas');cvs.width=720;cvs.height=900
    drawGallerySheet(cvs,item.title)
    const tex=new CanvasTexture(cvs);tex.colorSpace=SRGBColorSpace;tex.anisotropy=4
    return {canvas:cvs,texture:tex}
  },[])
  useEffect(()=>{
    drawGallerySheet(canvas,item.title)
    texture.needsUpdate=true
    if(!item.coverThumbUrl)return
    let active=true
    const img=new Image()
    img.crossOrigin='anonymous'
    img.onload=()=>{if(!active)return;drawGallerySheet(canvas,item.title,img);texture.needsUpdate=true}
    img.onerror=()=>{if(active&&item.coverAssetId)onCoverExpired?.(item.coverAssetId)}
    img.src=item.coverThumbUrl
    return()=>{active=false}
  },[canvas,texture,item.title,item.coverThumbUrl,item.coverAssetId,onCoverExpired])
  useEffect(()=>()=>texture.dispose(),[texture])
  useFrame(({clock})=>{if(group.current)group.current.rotation.y=reduced?0:Math.sin(clock.elapsedTime*.5+index)*.012})
  return <group ref={group} position={[gallerySlotX(index,count),1.65,-.85]} onClick={e=>{e.stopPropagation();if(e.delta<8){playSound('paper-flip');interact(index)}}} onPointerOver={on} onPointerOut={off}>
    <mesh position={[0,.71,0]}><cylinderGeometry args={[.002,.002,.38,6]}/><meshStandardMaterial color="#7c7561"/></mesh>
    <mesh castShadow receiveShadow><planeGeometry args={[.91,1.22,20,3]} onUpdate={g=>{const p=g.getAttribute('position');for(let i=0;i<p.count;i++)p.setZ(i,Math.sin((p.getX(i)/.91+.5)*Math.PI)*.035);g.computeVertexNormals()}}/><meshStandardMaterial color="#f9f6e9" side={DoubleSide} roughness={.95}/></mesh>
    <mesh position={[0,.02,.042]} receiveShadow><planeGeometry args={[.74,.806,20,2]} onUpdate={g=>{const p=g.getAttribute('position');for(let i=0;i<p.count;i++)p.setZ(i,Math.sin((p.getX(i)/.91+.5)*Math.PI)*.035);g.computeVertexNormals()}}/><meshStandardMaterial map={texture} roughness={.92} side={DoubleSide}/></mesh>
    <mesh position={[0,.61,.035]} castShadow><boxGeometry args={[.045,.055,.03]}/><meshStandardMaterial color="#8e8a7c" metalness={.8} roughness={.28}/></mesh>
  </group>
}
function RoomDecor({id,pack,materials,interact,reduced,exterior,galleryProjects,onCoverExpired,deskLampOn=false,onToggleDeskLamp,onDrawStudyQuote,onSelectBlankTable,onTapProp,nowNotes}:{id:Place;pack:ResourcePack;materials:ReturnType<typeof makeMaterials>;interact:(i:number)=>void;reduced:boolean;exterior:boolean;galleryProjects:GalleryDisplayItem[];onCoverExpired?:(assetId:string)=>void;deskLampOn?:boolean;onToggleDeskLamp?:()=>void;onDrawStudyQuote?:()=>void;onSelectBlankTable?:()=>void;onTapProp?:(msg:string)=>void;nowNotes?:string[]}){
  const b=useMemo(()=>roomFurniture(id),[id]),t=roomTransform(id)
  const root=useRef<Group>(null),scratch=useMemo(()=>({forward:new Vector3(),delta:new Vector3()}),[])
  useFrame(({camera})=>{
    if(!root.current)return
    const side=Math.sign(t.x),inside=camera.position.x*side>1.15&&Math.abs(camera.position.z-t.z)<t.width/2
    camera.getWorldDirection(scratch.forward);scratch.delta.set(t.x,1.5,t.z).sub(camera.position).normalize()
    const close=Math.hypot(camera.position.x-side*1.1,camera.position.z-t.z)<2.3
    const visible=exterior||inside||(close&&scratch.delta.dot(scratch.forward)>.2)
    root.current.visible=visible
  })
  const displayed=galleryProjects.slice(0,3)
  return <group ref={root} userData={{skipAO:exterior}} position={[t.x,0,t.z]} rotation={[0,t.rotation,0]}><StaticBatch builder={b} materials={materials} castShadow={!exterior}/>
    {id==='gallery'&&<group name="gallery-papers">{displayed.map((item,i)=><Paper key={item.id} item={item} index={i} count={displayed.length} interact={interact} reduced={reduced} onCoverExpired={onCoverExpired}/>)}</group>}
    {id==='study'&&<>
      <group position={[-.5,.79,-.85]} rotation={[-Math.PI/2,0,-.08]} onClick={e=>{e.stopPropagation();if(e.delta<8){playSound('paper-flip');interact(0)}}} onPointerOver={on} onPointerOut={off}><Plaque text="创作手记" sub="翻开，读一会儿" at={[0,0,0]} size={[.32,.24]}/></group>
      <StudyInteractiveNodes deskLampOn={deskLampOn} onToggleLamp={onToggleDeskLamp} onDrawQuote={onDrawStudyQuote}/>
    </>}
    <Plant pack={pack} at={id==='study'?[-2.5,0,-1.35]:id==='gallery'?[2.45,0,-1.5]:[-2.5,0,-1.3]} height={id==='blank'?1.2:.9} onTap={()=>onTapProp?.('枝叶在房间光线里微微摇晃')}/>
    {id==='blank'&&<>
      <group onClick={e=>{e.stopPropagation();if(e.delta<8){playSound('bench');onTapProp?.('实木铭牌微凉沉稳，推开窗就是小院')}}} onPointerOver={on} onPointerOut={off}>
        <Plaque text="关于我" sub="认识小屋的主人" at={[1.65,1.75,-2.02]} size={[1.2,.4]}/>
      </group>
      <group position={[.42,.52,-.64]} onClick={e=>{e.stopPropagation();if(e.delta<8){playSound('ceramics');onTapProp?.('轻叩手捏素烧陶罐，传出温和清脆的窑音')}}} onPointerOver={on} onPointerOut={off}>
        <mesh visible={false}><cylinderGeometry args={[.13,.13,.26,12]}/><meshBasicMaterial/></mesh>
      </group>
      <BlankTabletopCards nowNotes={nowNotes} onSelect={()=>onSelectBlankTable?.()}/>
    </>}
  </group>
}
export function World({
  place,
  opening,
  destination,
  navigate,
  interact,
  homeName,
  plaqueTitle='欢迎回家',
  plaqueSubtitle='留一点时间，慢慢逛',
  reduced,
  pack,
  galleryProjects,
  onCoverExpired,
  atmospherePreset='daylight',
  weather='clear',
  deskLampOn=false,
  onToggleDeskLamp,
  onDrawStudyQuote,
  onSelectFocus,
  onTriggerMailbox,
  onTapProp,
  nowNotes,
}:{
  place:Place
  opening:Place|null
  destination:Place|null
  navigate:(p:Place)=>void
  interact:(i:number)=>void
  homeName:string
  plaqueTitle?:string
  plaqueSubtitle?:string
  reduced:boolean
  pack:ResourcePack
  galleryProjects:GalleryDisplayItem[]
  onCoverExpired?:(assetId:string)=>void
  atmospherePreset?:AtmospherePreset
  weather?:WeatherMode
  deskLampOn?:boolean
  onToggleDeskLamp?:()=>void
  onDrawStudyQuote?:()=>void
  onSelectFocus?:(id:FocusSubPoseId)=>void
  onTriggerMailbox?:()=>void
  onTapProp?:(msg:string)=>void
  nowNotes?:string[]
}){
  const materials=useMemo(()=>makeMaterials(pack),[pack]),house=useMemo(shell,[]),yard=useMemo(garden,[]),{scene,gl}=useThree()
  const lighting=useMemo(()=>getAtmosphereLighting(atmospherePreset,weather),[atmospherePreset,weather])
  const glass=useMemo(()=>{const b=new Builder();for(const w of windows)b.add(new PlaneGeometry(w.w-.08,w.h-.08),w.at,'glass',[0,w.r,0]);return b},[])
  // Thin architectural glazing: direct clear view plus dielectric environment reflection.
  // No volume refraction capture; flat 6 mm panes do not need a second full-scene render.
  const glassMaterials=useMemo(()=>({glass:new MeshPhysicalMaterial({color:'#d5e4de',roughness:.025,transparent:true,opacity:.14,depthWrite:false,transmission:0,thickness:.006,ior:1.5,metalness:0,envMapIntensity:.8,side:DoubleSide,forceSinglePass:true})}),[])
  useEffect(()=>{
    scene.environment=pack.environment
    scene.background=pack.environment
    return()=>{scene.environment=null;scene.background=null}
  },[pack,scene])
  useEffect(()=>{
    scene.backgroundIntensity=lighting.backgroundIntensity
    scene.environmentIntensity=lighting.environmentIntensity
    glassMaterials.glass.opacity=lighting.glassOpacity
    glassMaterials.glass.envMapIntensity=lighting.glassEnvIntensity
    gl.setClearColor(lighting.clearColor,1)
    gl.shadowMap.needsUpdate=true
  },[lighting,scene,gl,glassMaterials])
  useEffect(()=>()=>{Object.values(materials).forEach(m=>m.dispose());glassMaterials.glass.dispose()},[materials,glassMaterials])
  const outside=place==='yard'||destination==='yard'||opening==='hall'||opening==='yard'
  return <>
    <fog attach="fog" args={[lighting.fogColor,lighting.fogNear,lighting.fogFar]}/>
    <hemisphereLight args={[lighting.hemiSkyColor,lighting.hemiGroundColor,lighting.hemiIntensity]}/>
    <directionalLight position={lighting.sunPosition} intensity={lighting.sunIntensity} color={lighting.sunColor} castShadow shadow-mapSize={pack.quality==='high'?[2048,2048]:[1024,1024]} shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={18} shadow-camera-bottom={-18} shadow-camera-near={.5} shadow-camera-far={55} shadow-normalBias={.025} shadow-bias={-.00008} shadow-radius={3}/>
    <ambientLight intensity={lighting.ambientIntensity} color={lighting.ambientColor}/>
    {[1.8,6.8,11.8].map(d=><pointLight key={d} position={[0,2.55,-d]} color={lighting.hallPointColor} intensity={lighting.hallPointIntensity} distance={4.5} decay={2}/>)}
    {doorStops.map(d=><rectAreaLight key={d.id} position={[d.side*5.12,1.85,-d.depth]} rotation={[0,d.side*Math.PI/2,0]} width={1.7} height={1.3} color={lighting.windowRectColor} intensity={lighting.windowRectIntensity}/>)}
    {lighting.porchLanternIntensity>0&&(
      <pointLight position={[-.84,1.78,.48]} color={lighting.porchLanternColor} intensity={lighting.porchLanternIntensity} distance={6.5} decay={2}/>
    )}
    {lighting.roomWarmFillIntensity>0&&doorStops.map(d=>(
      <pointLight key={`warm-${d.id}`} position={[d.side*3.1,2.35,-d.depth]} color="#ffdfa8" intensity={lighting.roomWarmFillIntensity} distance={6.2} decay={2}/>
    ))}
    {weather==='rain'&&(
      <RainOverlay count={pack.quality==='high'?180:90} reduced={reduced} isNight={lighting.preset==='night'}/>
    )}
    <StaticBatch builder={house} materials={materials}/><StaticBatch builder={yard} materials={materials}/>
    <StaticBatch builder={glass} materials={glassMaterials} castShadow={false}/>
    <Door at={[0,0,.045]} open={outside&&(!!opening||!!destination)} click={()=>navigate('hall')} materials={materials} reduced={reduced}/>
    <Signage homeName={homeName} plaqueTitle={plaqueTitle} plaqueSubtitle={plaqueSubtitle} materials={materials} onTapPlaque={()=>onTapProp?.('轻叩门牌，木纹温润沉稳')}/>
    {/* Yard interactive bench and porch mailbox */}
    <group position={[-5,.42,6.1]} rotation={[0,.1,0]} onClick={e=>{e.stopPropagation();if(e.delta<8&&place==='yard')onSelectFocus?.('yard-bench')}} onPointerOver={on} onPointerOut={off}>
      <mesh visible={false}><boxGeometry args={[1.75,.55,.6]}/><meshBasicMaterial/></mesh>
    </group>
    <group position={[1.72,.84,1.92]} rotation={[0,-.18,0]} onClick={e=>{e.stopPropagation();if(e.delta<8&&place==='yard')onTriggerMailbox?.()}} onPointerOver={on} onPointerOut={off}>
      <mesh visible={false}><boxGeometry args={[.48,.52,.52]}/><meshBasicMaterial/></mesh>
      <Plaque text="寄语信箱" sub="留张便签" at={[0,.24,0]} size={[.34,.14]}/>
    </group>
    {doorStops.map(d=><group key={d.id}>
      <Door at={[d.side*1.08,0,-d.depth]} rotation={-d.side*Math.PI/2} open={place===d.id||opening===d.id||destination===d.id} click={()=>navigate(d.id)} materials={materials} reduced={reduced}/>
      <RoomDecor
        id={d.id}
        pack={pack}
        materials={materials}
        interact={interact}
        reduced={reduced}
        exterior={outside}
        galleryProjects={galleryProjects}
        onCoverExpired={onCoverExpired}
        deskLampOn={deskLampOn}
        onToggleDeskLamp={onToggleDeskLamp}
        onDrawStudyQuote={onDrawStudyQuote}
        onSelectBlankTable={()=>onSelectFocus?.('blank-table')}
        onTapProp={onTapProp}
        nowNotes={nowNotes}
      />
    </group>)}
    <Plant pack={pack} at={[-5.5,-.29,5.3]} height={5.7} tree rotation={.5} onTap={()=>onTapProp?.('风吹过院子里的老树，叶片沙沙作响')}/>
    <Plant pack={pack} at={[-1.05,0,1.15]} height={.86} onTap={()=>onTapProp?.('门廊旁的绿植轻轻晃了晃')}/>
    <Plant pack={pack} at={[1.08,0,1.12]} height={.67} onTap={()=>onTapProp?.('门廊旁的绿植轻轻晃了晃')}/>
    <Plant pack={pack} at={[-3.4,-.28,.65]} height={.8} onTap={()=>onTapProp?.('窗边花盆的叶片轻轻晃动')}/>
    <Plant pack={pack} at={[3.6,-.28,.65]} height={.9} onTap={()=>onTapProp?.('窗边花盆的叶片轻轻晃动')}/>
    <Grass/>
  </>
}
