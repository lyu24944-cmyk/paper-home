import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import type { Place } from './content'

export type V3 = [number, number, number]
export type CameraPose = { position: Vector3; orientation: Quaternion; fov: number }
export type TransitionState = { from: Place; to: Place; phase: 'loading' | 'approach' | 'threshold' | 'settling' | 'complete' | 'failed'; progress: number }
export const layout = { width: 11, length: 15, wallHeight: 2.9, hallWidth: 2.2, hallLength: 13.5, walkLength: 12.5, stepDistance:1.1, eyeHeight: 1.65, doorWidth: 1.02, doorHeight: 2.2, front: 0, back: -15 }
export const doorStops = [
  { id: 'gallery' as Place, name: '收藏展廊', depth: 3.2, side: -1, width: 5.7 },
  { id: 'study' as Place, name: '书房', depth: 7, side: 1, width: 7 },
  { id: 'blank' as Place, name: '空白房间', depth: 10.8, side: -1, width: 7.4 },
]
const up = new Vector3(0, 1, 0)
export const stopProgress = (depth: number) => (depth - 1.45) / layout.walkLength
export function pose(position: V3 | Vector3, target: V3 | Vector3, fov = 62): CameraPose {
  const p = position instanceof Vector3 ? position.clone() : new Vector3(...position)
  const t = target instanceof Vector3 ? target : new Vector3(...target)
  return { position: p, orientation: new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(p,t,up)), fov }
}
export function roomTransform(id: Place) {
  const d = doorStops.find(d => d.id === id)!
  return { x: d.side * 3.3, z: -d.depth, rotation: -d.side * Math.PI / 2, width: d.width }
}
export function roomPoint(id: Place, p: V3) {
  const t = roomTransform(id)
  return new Vector3(...p).applyAxisAngle(up,t.rotation).add(new Vector3(t.x,0,t.z))
}
export function hallPose(progress: number, aspect = 1.6): CameraPose {
  const depth = .85 + Math.max(0,Math.min(1,progress))*layout.walkLength
  let yaw = 0
  for (const d of doorStops) {
    const offset = Math.abs(depth - (d.depth-.6))
    const weight = offset < 1.05 ? (1+Math.cos(offset/1.05*Math.PI))/2 : 0
    yaw += d.side * weight * .62
  }
  return pose([0,layout.eyeHeight,-depth],[Math.sin(yaw)*4,1.58,-depth-Math.cos(yaw)*4],aspect<.8?78:62)
}
export function roomPose(id: Place, aspect: number) {
  if(id==='gallery'&&aspect<=.8)return galleryPose(1)
  const distance=id==='gallery'?(aspect<.8?2.02:1.8):1.35
  const fov=id==='gallery'?Math.max(62,Math.min(116,2*Math.atan(3.9/(2*(distance+.85)*aspect))*180/Math.PI)):aspect<.8?86:62
  return pose(roomPoint(id,[0,1.65,distance]),roomPoint(id,[0,1.35,-1.65]),fov)
}
export function galleryPose(index: number) {
  const x=(index-1)*1.32
  return pose(roomPoint('gallery',[x,1.65,1.32]),roomPoint('gallery',[x,1.58,-.85]),54)
}
export const yardBounds = new Box3(new Vector3(-9.3,-.35,-15.6),new Vector3(7.8,5.8,10.2))
// Fit the actual subjects separately: the empty corners of a union box are not scenery.
export const yardSubjects = [
  new Box3(new Vector3(-6.12,-.3,-15.6),new Vector3(6.12,5.58,.65)),
  new Box3(new Vector3(-7.5,-.35,1.5),new Vector3(7.5,.65,10.3)),
  new Box3(new Vector3(-8.25,-.3,2.65),new Vector3(-2.75,5.45,7.95)),
]
export function yardPose(aspect: number): CameraPose {
  const fov=aspect<.8?57:44, center=new Vector3(-.25,1.55,-1.2), backward=new Vector3(.72,0,1).normalize(),tan=Math.tan(fov*Math.PI/360)
  const at=(d:number)=>{const p=center.clone().addScaledVector(backward,d);p.y=layout.eyeHeight-.29;return pose(p,center,fov)}
  let near=8,far=250
  // Fit all eight bounds corners while retaining a standing person's eye height.
  for(let i=0;i<24;i++){
    const distance=(near+far)/2,p=at(distance),inverse=p.orientation.clone().invert();let fits=true
    for(const bounds of yardSubjects)for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
      const v=new Vector3(x,y,z).sub(p.position).applyQuaternion(inverse)
      if(v.z>=0||Math.abs(v.x/-v.z)>tan*aspect||Math.abs(v.y/-v.z)>tan)fits=false
    }
    if(fits)far=distance;else near=distance
  }
  return at(far*1.045)
}
export function stablePose(place: Place, progress: number, aspect: number) {
  return place==='yard'?yardPose(aspect):place==='hall'?hallPose(progress,aspect):roomPose(place,aspect)
}
export type RoutePoint = { pose: CameraPose; phase: TransitionState['phase']; duration: number }
export function makeRoute(from: Place, to: Place, progress: number, aspect: number): RoutePoint[] {
  const route:RoutePoint[]=[]
  const add=(p:CameraPose,phase:RoutePoint['phase']='approach',duration=.8)=>route.push({pose:p,phase,duration})
  const insideFov=aspect<.8?78:62
  if(from==='yard'){
    add(pose([0,1.65,7.8],[0,1.4,0],50),'approach',1.5)
    add(pose([0,1.65,2.6],[0,1.5,-3],insideFov),'approach',1.35)
    add(pose([0,1.65,.65],[0,1.6,-4],insideFov),'threshold',.9)
    add(hallPose(0,aspect),'threshold',.65)
  }else if(from!=='hall'){
    const d=doorStops.find(d=>d.id===from)!
    // Back through the same door while retaining the room as the visual anchor.
    add(pose(roomPoint(from,[0,1.65,1.85]),roomPoint(from,[0,1.5,-1.5]),insideFov),'threshold',.65)
    add(pose([d.side*.65,1.65,-d.depth],[d.side*4,1.55,-d.depth],insideFov),'threshold',.65)
    add(pose([0,1.65,-d.depth],[0,1.6,-d.depth-4],insideFov),'approach',.6)
  }
  if(to==='yard'){
    add(pose([0,1.65,-.85],[0,1.6,-5],insideFov),'approach',1.5)
    add(pose([0,1.65,.65],[0,1.5,-3],insideFov),'threshold',.75)
    add(pose([0,1.65,2.6],[0,1.45,0],insideFov),'threshold',.8)
    add(pose([0,1.65,7.8],[0,1.4,0],50),'approach',1.25)
    add(yardPose(aspect),'settling',1.6)
  }else if(to==='hall'){
    add(hallPose(progress,aspect),'settling',.65)
  }else{
    const d=doorStops.find(d=>d.id===to)!
    add(pose([0,1.65,-d.depth],[0,1.6,-d.depth-4],insideFov),'approach',1.2)
    add(pose([0,1.65,-d.depth],[d.side*4,1.45,-d.depth],insideFov),'approach',.6)
    add(pose([d.side*1.5,1.65,-d.depth],[d.side*4,1.45,-d.depth],insideFov),'threshold',.8)
    add(roomPose(to,aspect),'settling',.8)
  }
  return route
}
