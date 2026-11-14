import { createContext, forwardRef, Suspense, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree, type ThreeElements } from '@react-three/fiber'
import { Edges, Line, useTexture } from '@react-three/drei'
import { Group, MeshBasicMaterial, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three'
import gsap from 'gsap'
import { artworks, type Place } from './content'
import { artTexture, signTexture, sketchTexture, tiledTexture } from './sketch'
import { inkTexture, paperTexture, welcomeTexture } from './ink'

const Interior = createContext(false)
type V3 = [number, number, number]
type TextureKind = Parameters<typeof sketchTexture>[0]
type BoxProps = {
  size: V3; at?: V3; rotation?: V3; color?: string; texture?: TextureKind; edge?: boolean; repeat?: [number, number]
} & Pick<ThreeElements['mesh'], 'onClick' | 'onPointerOver' | 'onPointerOut'>

function Box({ size, at, rotation, color = '#fcfbf7', texture, edge = true, repeat, ...events }: BoxProps) {
  const inside = useContext(Interior)
  const map = texture ? repeat ? tiledTexture(texture, ...repeat) : sketchTexture(texture) : null
  return <mesh position={at} rotation={rotation} castShadow={!inside} receiveShadow={!inside} {...events}>
    <boxGeometry args={size} />
    {inside ? <meshBasicMaterial color={color} map={map} toneMapped={false} /> : <meshStandardMaterial color={color} map={map} roughness={1} />}
    {edge && <Edges color={inside ? '#514f46' : '#41483b'} threshold={25} />}
  </mesh>
}

function Sign({ text, sub = '', at, size = [2.2, .65] }: { text: string; sub?: string; at: V3; size?: [number, number] }) {
  return <group position={at}>
    <Box size={[size[0] + .08, size[1] + .08, .07]} color="#eae7de" />
    <mesh position={[0, 0, .041]}><planeGeometry args={size} /><meshBasicMaterial map={signTexture(text, sub)} /></mesh>
  </group>
}

function Window({ at, width = 1.55, height = 1.75 }: { at: V3; width?: number; height?: number }) {
  const inside = useContext(Interior)
  return <group position={at}>
    <Box size={[width + .18, height + .18, .18]} color="#eee3c8" />
    <Box size={[width, height, .19]} color={inside ? '#fffefa' : '#b8c9c2'} />
    <Box size={[width - .09, .055, .04]} at={[0, 0, .12]} color="#f5ecd8" />
    <Box size={[.055, height - .04, .04]} at={[0, 0, .12]} color="#f5ecd8" />
    <Box size={[width + .4, .12, .38]} at={[0, -height / 2 - .1, .08]} color="#e1d3b3" />
    <Line points={[[-width * .35, .15, .125], [-.05, height * .35, .125]]} color="#edf4e9" lineWidth={2} />
    <Line points={[[-width * .2, .05, .126], [.1, height * .25, .126]]} color="#edf4e9" lineWidth={1} />
  </group>
}

const pointerOn = () => { document.body.style.cursor = 'pointer' }
const pointerOff = () => { document.body.style.cursor = '' }

function Door({ at, rotation = 0, label, sub, open, onEnter, small = false, design = 'study', reduced = false }: {
  at: V3; rotation?: number; label: string; sub?: string; open: boolean; onEnter: () => void; color?: string; small?: boolean; design?: 'gallery' | 'study' | 'blank'; reduced?: boolean
}) {
  const pivot = useRef<Group>(null)
  useEffect(() => {
    const ctx = gsap.context(() => { if (pivot.current) gsap.to(pivot.current.rotation, { y: open ? -1.46 : 0, duration: reduced ? 0 : .9, ease: 'power2.inOut' }) })
    return () => ctx.revert()
  }, [open, reduced])
  const width = small ? 1.85 : 1.65, height = 2.8
  return <group position={at} rotation={[0, rotation, 0]} onClick={e => { e.stopPropagation(); if (e.delta < 8) onEnter() }} onPointerOver={e => { e.stopPropagation(); pointerOn() }} onPointerOut={pointerOff}>
    {[-1,1].map(side => <group key={side}>
      <Box size={[.16,height+.12,.22]} at={[side*(width/2+.08),height/2,-.03]} color="#fdfcf7" />
      <Box size={[.045,height+.21,.26]} at={[side*(width/2+.19),height/2,-.02]} color="#ece8dd" />
    </group>)}
    <Box size={[width+.47,.16,.26]} at={[0,height+.06,-.03]} color="#fcfbf7" />
    <group ref={pivot} position={[-width / 2, 0, .08]}>
      <Box size={[width, height, .1]} at={[width / 2, height / 2, 0]} color={small ? '#735344' : '#f8f6ef'} />
      <mesh position={[width/2,height/2,.056]}><planeGeometry args={[width-.07,height-.08]} /><meshBasicMaterial map={inkTexture(small ? 'door-entry' : `door-${design}`)} toneMapped={false} /></mesh>
      <Box size={[.16,.035,.08]} at={[width-.15,1.2,.13]} color="#44443b" />
      <Box size={[.04,.23,.035]} at={[width-.23,1.14,.15]} color="#c5b58e" />
      {[.45,2.3].map(y=><Box key={y} size={[.045,.19,.07]} at={[.025,y,.08]} color="#67665b" />)}
    </group>
    <Sign text={label} sub={sub} at={[0,height+.5,.06]} size={[small ? 2.5 : 2.15,.58]} />
  </group>
}

function Pot({ at, scale = 1 }: { at: V3; scale?: number }) {
  return <group position={at} scale={scale}>
    <mesh position={[0, .23, 0]} castShadow><cylinderGeometry args={[.29, .2, .45, 9]} /><meshStandardMaterial color="#b78063" /><Edges color="#615d47" /></mesh>
    <mesh position={[0, .45, 0]}><cylinderGeometry args={[.26, .26, .035, 9]} /><meshStandardMaterial color="#5e5c43" /></mesh>
    {[0, 1, 2, 3, 4].map(i => <group key={i} rotation={[0, i * 1.8, (i % 2 ? 1 : -1) * .28]}>
      <mesh position={[0, .7 + i * .05, 0]} castShadow rotation={[0, 0, .15]}><cylinderGeometry args={[.018, .025, .7, 5]} /><meshStandardMaterial color="#56704c" /></mesh>
      <mesh position={[.14, .94 + i * .04, 0]} rotation={[0, 0, -.7]} scale={[.12, .32, .06]} castShadow><sphereGeometry args={[1, 8, 6]} /><meshStandardMaterial color={i % 2 ? '#7d9667' : '#587c5c'} /></mesh>
    </group>)}
  </group>
}

function Tree({ at, scale = 1, reduced = false }: { at: V3; scale?: number; reduced?: boolean }) {
  const tree = useRef<Group>(null)
  const texture = useTexture('/assets/garden-tree.png', t => { t.colorSpace = SRGBColorSpace })
  useFrame(({ clock }) => { if (tree.current) tree.current.rotation.z = reduced ? 0 : Math.sin(clock.elapsedTime * .4 + at[0]) * .003 })
  return <group ref={tree} position={at} scale={scale}>
    <mesh position={[0,3.65,0]}><planeGeometry args={[5.45,7.3]} /><meshBasicMaterial map={texture} transparent alphaTest={.06} toneMapped={false} /></mesh>
  </group>
}


function Fence({ at, rotation = 0, count = 7 }: { at: V3; rotation?: number; count?: number }) {
  return <group position={at} rotation={[0, rotation, 0]}>
    {Array.from({ length: count }, (_, i) => <Box key={i} size={[.16, 1, .1]} at={[i * .42, .5, 0]} color="#e9e2cc" />)}
    <Box size={[(count - 1) * .42 + .3, .12, .1]} at={[(count - 1) * .21, .3, .06]} color="#e9e2cc" />
    <Box size={[(count - 1) * .42 + .3, .12, .1]} at={[(count - 1) * .21, .74, .06]} color="#e9e2cc" />
  </group>
}

function Yard({ opening, navigate, homeName, reduced }: { opening: Place | null; navigate: (p: Place) => void; homeName: string; reduced: boolean }) {
  return <group>
    <Box size={[32,.16,24]} at={[0,-.2,8]} texture="grass" repeat={[8,6]} edge={false} color="#d6d8ba" />
    {[-1,1].map(side => <group key={side}>
      <Box size={[8,7,.25]} at={[side*5.05,3.45,2.24]} texture="brick" repeat={[2,1.75]} color="#fff5de" />
      <Box size={[.22,4,6]} at={[side*3.4,1.9,-.7]} texture="wall" />
      <Window at={[side*2.45,1.95,2.43]} width={1.75} height={1.9} />
      <Box size={[2.2,.28,.45]} at={[side*2.45,.85,2.65]} color="#c5c3a1" />
      {[-.75,-.4,0,.4,.75].map((x,i)=><Pot key={x} at={[side*2.45+x,.96,2.68]} scale={.35+(i%2)*.12} />)}
    </group>)}
    <Box size={[2.1,4.2,.25]} at={[0,4.95,2.24]} texture="brick" repeat={[.5,1.05]} color="#fff5de" />
    <Door at={[0,0,2.44]} label={homeName} sub="门一直为你留着" small open={opening === 'hall' || opening === 'yard'} onEnter={() => navigate('hall')} reduced={reduced} />
    <Box size={[2.65,.13,.8]} at={[0,-.06,2.8]} color="#dbd6c9" />
    <Box size={[3,.1,.9]} at={[0,-.14,3.45]} color="#e0dbce" />
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.035,3.06]}><planeGeometry args={[1.8,.6]} /><meshBasicMaterial color="#5b6152" /></mesh>
    {Array.from({length:8},(_,i)=><mesh key={i} position={[Math.sin(i*1.9)*.12,-.1,4.1+i*.9]} rotation={[-Math.PI/2,0,i*.12]}><circleGeometry args={[.76,6]} /><meshStandardMaterial map={sketchTexture('stone')} color="#efebde" /><Edges color="#716d5e" /></mesh>)}
    <Suspense fallback={null}><Tree at={[-3.9,-.08,3.15]} scale={.96} reduced={reduced} /><Tree at={[5.2,-.08,2.85]} scale={1.12} reduced={reduced} /></Suspense>
    <Pot at={[-1.36,0,2.95]} scale={1.14} /><Pot at={[1.37,0,2.95]} scale={.93} />
    <group position={[-1.43,1.7,2.52]}>
      <Box size={[.2,.3,.22]} color="#4b5044" />
      <mesh position={[0,.01,.13]}><planeGeometry args={[.12,.17]} /><meshBasicMaterial color="#fff0bf" /></mesh>
    </group>
    <Fence at={[-8.8,-.08,4.4]} count={12} /><Fence at={[4.3,-.08,4.4]} count={12} />
    <Box size={[32,.18,.32]} at={[0,6.05,2.5]} color="#a38b6c" />
    <Box size={[32,.12,.35]} at={[0,6.23,2.49]} color="#e2d1b1" />
  </group>
}

export const doorStops = [
  { id: 'gallery' as Place, name: '收藏展廊', depth: 6, side: -1 },
  { id: 'study' as Place, name: '书房', depth: 14, side: 1 },
  { id: 'blank' as Place, name: '空白房间', depth: 22, side: -1 },
]
export function hallPose(progress: number) {
  const depth = Math.max(0, Math.min(1, progress)) * 28
  const z = 1.5 - depth
  let yaw = 0
  let lift = 0
  let lateral = 0
  for (const door of doorStops) {
    const distance = Math.abs(depth - (door.depth - 2))
    const weight = distance < 3 ? (1 + Math.cos(distance / 3 * Math.PI)) / 2 : 0
    const offset = -door.side * .65 * weight
    lateral += offset
    const doorAngle = Math.atan2(3.19 + Math.abs(offset), Math.max(.3, door.depth - depth))
    yaw += door.side * weight * doorAngle
    lift = Math.max(lift, weight * .35)
  }
  return { position: new Vector3(lateral, 1.65, z), aim: new Vector3(lateral + Math.sin(yaw) * 6, 1.65 + lift, z - Math.cos(yaw) * 6) }
}
function roomTransform(id: Place) {
  const door = doorStops.find(d => d.id === id)!
  return { x: door.side * 8.55, z: 1.5 - door.depth, rotation: -door.side * Math.PI / 2 }
}
function roomPoint(id: Place, point: V3) {
  const t = roomTransform(id)
  return new Vector3(...point).applyAxisAngle(new Vector3(0, 1, 0), t.rotation).add(new Vector3(t.x, 0, t.z))
}
function InkPlane({ kind, at, size, rotation = [0,0,0] }: { kind: Parameters<typeof inkTexture>[0]; at: V3; size: [number,number]; rotation?: V3 }) {
  return <mesh position={at} rotation={rotation}><planeGeometry args={size} /><meshBasicMaterial map={inkTexture(kind)} transparent alphaTest={.02} toneMapped={false} /></mesh>
}
function Welcome({ name }: { name: string }) {
  const {size}=useThree()
  const material = useRef<MeshBasicMaterial>(null)
  useFrame(({camera}) => { if(material.current) material.current.opacity = Math.max(0,Math.min(1,(camera.position.z + 1.4)/2.4)) })
  return <mesh position={[0,2.12,-2.8]} scale={size.width<650?.72:1}><planeGeometry args={[4.8,2]} /><meshBasicMaterial ref={material} map={welcomeTexture(name)} transparent depthWrite={false} toneMapped={false} /></mesh>
}
function Hall({ opening, destination, navigate, homeName, reduced }: { opening: Place | null; destination: Place | null; navigate: (p: Place) => void; homeName: string; reduced: boolean }) {
  return <group>
    <Box size={[6.6,.14,31]} at={[0,-.1,-13]} texture="wood" repeat={[1.5,5]} />
    <Box size={[6.6,.12,30.6]} at={[0,3.85,-13.2]} color="#fdfcf9" edge={false} />
    {[-1,1].map(side => {
      const holes = doorStops.filter(d => d.side === side).map(d => 1.5-d.depth).sort((a,b)=>a-b)
      const bounds = [-28.5,...holes.flatMap(z=>[z-1.05,z+1.05]),2.1]
      return <group key={side}>
        {Array.from({length:bounds.length/2},(_,i)=> {
          const start=bounds[i*2],end=bounds[i*2+1]
          return <group key={i}><Box size={[.18,3.85,end-start]} at={[side*3.3,1.85,(start+end)/2]} texture="wall" edge={false} /><Line points={[[side*3.2,.1,start],[side*3.2,.1,end]]} color="#746e5e" lineWidth={1} /></group>
        })}
        {holes.map(z=><Box key={z} size={[.18,.85,2.1]} at={[side*3.3,3.425,z]} texture="wall" edge={false} />)}
        <Line points={[[side*3.19,3.64,2.1],[side*3.19,3.64,-28.5]]} color="#99958a" lineWidth={.7} />
      </group>
    })}
    <Box size={[6.6,3.85,.18]} at={[0,1.85,-28.5]} color="#fffefa" edge={false} />
    <mesh position={[0,2.08,-28.39]}><planeGeometry args={[3.9,2.8]} /><meshBasicMaterial color="#ffffff" toneMapped={false} /></mesh>
    <Window at={[0,2.08,-28.43]} width={3.9} height={2.8} />
    <Welcome name={homeName} />
    {doorStops.map(d=><Door key={d.id} at={[d.side*3.19,0,1.5-d.depth]} rotation={-d.side*Math.PI/2} label={d.name} open={opening===d.id || destination===d.id} onEnter={()=>navigate(d.id)} design={d.id as 'gallery'|'study'|'blank'} reduced={reduced} />)}
    {[0,-7,-15,-23].map(z=><group key={z} position={[0,3.72,z]}>
      <Box size={[1.65,.06,.4]} color="#e4e2d9" />
      <mesh position={[0,-.037,0]} rotation={[Math.PI/2,0,0]}><planeGeometry args={[1.5,.28]} /><meshBasicMaterial color="#fffefa" /></mesh>
      {[-.5,0,.5].map(x=><Line key={x} points={[[x,-.041,-.14],[x,-.041,.14]]} color="#b6b4a9" lineWidth={.6} />)}
    </group>)}
    {[-6.2,-13.3,-21.5].map((z,i)=><group key={z} position={[(i%2?-1:1)*3.18,2,z]} rotation={[0,i%2?Math.PI/2:-Math.PI/2,0]}>
      <InkPlane kind={i===1?'botanical':'arrow'} at={[0,0,0]} size={i===1?[.8,1.2]:[1.8,1.4]} />
      {i!==1&&<Sign text={i===0?'去看一看':'留一点空白'} at={[0,-.7,.02]} size={[1.2,.3]} />}
    </group>)}
    {[8.5,16.4,24.5].map((d,i)=><group key={d} position={[(i%2?-1:1)*3.18,2.1,1.5-d]} rotation={[0,i%2?Math.PI/2:-Math.PI/2,0]}>
      <Box size={[1.2,1.1,.06]} color="#e7e3d7" /><Box size={[1.11,1.01,.07]} color="#fffefa" />
      <InkPlane kind="botanical" at={[0,0,.042]} size={[.75,.9]} />
    </group>)}
    <Pot at={[2.6,0,-26.8]} scale={1.1} />
  </group>
}

function RoomShell({ children, wall = '#fcfbf7' }: { children: React.ReactNode; wall?: string }) {
  return <group>
    <Box size={[11, .15, 12]} at={[0, -.1, -.6]} texture="wood" repeat={[2, 2]} />
    <Box size={[11, 6, .18]} at={[0, 2.9, -6.5]} color={wall} texture="wall" />
    <Box size={[.18, 6, 12]} at={[-5.5, 2.9, -.6]} color={wall} texture="wall" />
    <Box size={[.18, 6, 12]} at={[5.5, 2.9, -.6]} color={wall} texture="wall" />
    <Box size={[11, .2, .09]} at={[0, .1, -6.37]} color="#bab79f" />
    <Box size={[.09, .2, 12]} at={[-5.37, .1, -.6]} color="#bab79f" />
    {children}
  </group>
}

function Book({ at, color, rotation = 0 }: { at: V3; color: string; rotation?: number }) {
  return <group position={at} rotation={[0, 0, rotation]}><Box size={[.22, .75, .47]} color={color} /><Box size={[.15, .62, .43]} at={[0, 0, .025]} color="#e7dfc8" edge={false} /><Box size={[.22, .045, .48]} at={[0, .35, 0]} color={color} edge={false} /></group>
}

function Study({ interact }: { interact: (index: number) => void }) {
  return <RoomShell>
    <Window at={[-2.75, 3.2, -6.34]} width={2.7} height={2.85} />
    <Box size={[3.35, .11, .3]} at={[-2.75, 4.83, -6.1]} color="#716e55" />
    <Box size={[.6, 3.05, .17]} at={[-4.25, 3.28, -6]} color="#d2d6bd" />
    <Box size={[.6, 3.05, .17]} at={[-1.25, 3.28, -6]} color="#d2d6bd" />
    <group position={[2.6, 0, -5.6]}>
      <Box size={[2.75, 3.85, .08]} at={[0, 1.93, -.3]} color="#958b6e" />
      <Box size={[2.47, 3.58, .03]} at={[0, 1.95, -.245]} color="#d3c3a0" />
      {[-1.32, 1.32].map(x => <Box key={x} size={[.13, 3.85, .78]} at={[x, 1.93, .05]} color="#ad9c78" />)}
      <Box size={[2.75, .13, .78]} at={[0, 3.85, .05]} color="#ad9c78" />
      {[.35, 1.3, 2.25, 3.2].map(y => <Box key={y} size={[2.6, .09, .78]} at={[0, y, .05]} color="#ad9c78" />)}
      {Array.from({ length: 23 }, (_, i) => <Book key={i} at={[-1.04 + (i % 8) * .28, .78 + Math.floor(i / 8) * .95, .1]} color={['#8a9b7e', '#b77c60', '#d0ba82', '#6d8584', '#c0b49c'][i % 5]} rotation={i % 7 === 0 ? -.15 : 0} />)}
      <Pot at={[.5, 3.92, 0]} scale={.7} />
    </group>
    <group position={[-1.6, 0, -3.7]}>
      <Box size={[3.85, .18, 1.75]} at={[0, 1.8, 0]} texture="wood" color="#e2c8a1" />
      {[-1.6, 1.6].flatMap(x => [-.6, .6].map(z => <Box key={`${x}:${z}`} size={[.14, 1.7, .14]} at={[x, .85, z]} color="#a18d6a" />))}
      <group position={[.1, 1.94, .2]} rotation={[-Math.PI / 2, 0, -.1]} onClick={e => { e.stopPropagation(); interact(0) }} onPointerOver={pointerOn} onPointerOut={pointerOff}>
        <Box size={[.95, .66, .06]} color="#f6f0dc" />
        <mesh position={[0, 0, .035]}><planeGeometry args={[.9, .6]} /><meshBasicMaterial map={signTexture('小屋随笔', '翻开，读一会儿')} /></mesh>
      </group>
      <Pot at={[-1.35, 1.9, -.25]} scale={.55} />
      <mesh position={[1.2, 1.96, -.3]}><cylinderGeometry args={[.2, .23, .09, 12]} /><meshStandardMaterial color="#697b60" /></mesh>
      <Box size={[.04, .72, .04]} at={[1.2, 2.32, -.3]} color="#697b60" />
      <mesh position={[1.2, 2.74, -.3]}><coneGeometry args={[.42, .38, 12, 1, true]} /><meshStandardMaterial color="#a9b18a" side={2} /><Edges color="#60674f" /></mesh>
    </group>
    <group position={[-1.6, 0, -1.65]}>
      <Box size={[1.05, .15, 1.05]} at={[0, 1.12, 0]} color="#a9a282" />
      <Box size={[1.05, .95, .12]} at={[0, 1.7, .45]} color="#a9a282" />
      {[-.4, .4].flatMap(x => [-.4, .4].map(z => <Box key={`${x}:${z}`} size={[.09, 1.08, .09]} at={[x, .54, z]} color="#918b6e" />))}
    </group>
    <mesh rotation={[-Math.PI / 2, 0, .06]} position={[-1.4, .003, -1.8]} receiveShadow><planeGeometry args={[4.5, 3.5]} /><meshStandardMaterial color="#a5ad92" /></mesh>
    <Pot at={[4.3, 0, -3]} scale={1.65} />
    <Sign text="在这里，慢一点" at={[.35, 4.65, -6.36]} size={[2.1, .63]} />
  </RoomShell>
}

function Gallery({ interact, reduced }: { interact: (index: number) => void; reduced: boolean }) {
  const {size}=useThree()
  // Fit the complete row to the horizontal camera view, including portrait tablets.
  const fieldOfView = size.width < 650 ? 66 : 57
  const visibleSpan = 2 * 7.4 * Math.tan(fieldOfView * Math.PI / 360) * size.width / size.height
  const paperScale = Math.min(1, visibleSpan * .88 / 8.22)
  const paperY = 2.05 + .61 * paperScale
  const papers=useRef<Group>(null)
  useFrame(({clock})=>{ if(papers.current) papers.current.children.forEach((child,i)=>{child.rotation.y=reduced?0:Math.sin(clock.elapsedTime*.45+i*2)*.025}) })
  return <group>
    <Box size={[11,.15,13]} at={[0,-.1,-.9]} texture="wood" repeat={[2,2.4]} />
    {[-1,1].map(side=><Box key={side} size={[.15,5.7,9]} at={[side*5.5,2.75,1]} texture="wall" edge={false} />)}
    <InkPlane kind="skyline" at={[0,2.1,-10]} size={[34,8.5]} />
    {[[-7,5.3,-8],[5.8,5.7,-9],[-1.5,6.3,-12],[9,4.2,-13]].map((p,i)=><InkPlane key={i} kind="cloud" at={p as V3} size={[3.4+i*.3,3.4+i*.3]} />)}
    <Line points={[[-6,4.5,-3.2],[0,4.31,-3.2],[6,4.5,-3.2]]} color="#505148" lineWidth={1.2} />
    <group ref={papers}>
      {artworks.map((art,i)=><group key={art.kind} position={[(i-1)*2.95*paperScale,paperY,-3.2]} scale={paperScale} rotation={[0,0,[.025,-.025,.035][i]]} onClick={e=>{e.stopPropagation();if(e.delta<8)interact(i)}} onPointerOver={pointerOn} onPointerOut={pointerOff}>
        <Line points={[[0,1.45,0],[0,(4.34-paperY)/paperScale,0]]} color="#68665c" lineWidth={.8} />
        <mesh><planeGeometry args={[2.32,3.08]} /><meshBasicMaterial map={paperTexture(art.title,art.caption)} side={2} toneMapped={false} /></mesh>
        <mesh position={[0,.02,.012]}><planeGeometry args={[1.8,1.96]} /><meshBasicMaterial map={artTexture(art.kind)} toneMapped={false} /></mesh>
        <Box size={[.16,.15,.08]} at={[0,1.52,.025]} color="#888879" />
      </group>)}
    </group>
    <group position={[0,0,-5]}>
      <Box size={[13,.12,.14]} at={[0,1.28,0]} color="#faf9f3" />
      <Box size={[13,.09,.12]} at={[0,.18,0]} color="#faf9f3" />
      {Array.from({length:39},(_,i)=><group key={i} position={[-6.3+i*.33,0,0]}>
        <Line points={[[0,.2,0],[.025,.47,0],[-.045,.72,0],[.025,.96,0],[0,1.22,0]]} color="#646157" lineWidth={.8} />
        <Line points={[[.04,.2,0],[.015,.47,0],[.08,.72,0],[.015,.96,0],[.04,1.22,0]]} color="#646157" lineWidth={.8} />
      </group>)}
    </group>

  </group>
}

function Blank() {
  return <RoomShell wall="#fcfbf7">
    <Window at={[0, 3.2, -6.35]} width={3.5} height={3.2} />
    <mesh rotation={[-Math.PI / 2, 0, -.17]} position={[0, .003, -1.4]}><planeGeometry args={[4.5, 3.2]} /><meshStandardMaterial color="#dedac5" /></mesh>
    <Box size={[1.8, .12, 1.5]} at={[0, .65, -2.8]} color="#bdaf8b" texture="wood" />
    <Box size={[.12, .6, 1.35]} at={[-.65, .3, -2.8]} color="#ab9b78" />
    <Box size={[.12, .6, 1.35]} at={[.65, .3, -2.8]} color="#ab9b78" />
    <Box size={[.9, .03, .75]} at={[-.13, .74, -2.75]} color="#f8f4e7" />
    <Pot at={[-3.6, 0, -5.1]} scale={1.7} />
    <Sign text="留一点空白" sub="下一段故事，由你决定" at={[3.6, 3.1, -6.34]} size={[2.4, .8]} />
  </RoomShell>
}

export type CameraHandle = { travel: (target: Place, reduced: boolean, commit: () => void) => Promise<void> }
export const CameraController = forwardRef<CameraHandle, { place: Place; busy: boolean; reduced: boolean; progress: React.MutableRefObject<number> }>(({ place, busy, reduced, progress }, ref) => {
  const { camera, size } = useThree()
  const aim = useRef(new Vector3()), traveling = useRef(false), initialized = useRef(false)
  const smooth = useRef(progress.current)
  const previousSize = useRef(`${size.width}:${size.height}`)
  const reset = () => {
    if (place === 'yard') {
      camera.position.set(0,1.65,size.width < 650 ? 11.8 : 11.2)
      aim.current.set(0,2.12,2.2)
    } else if (place === 'hall') {
      const pose = hallPose(progress.current); camera.position.copy(pose.position); aim.current.copy(pose.aim)
    } else {
      camera.position.copy(roomPoint(place, [0, 1.65, place === 'gallery' || size.width < 650 ? 4.2 : 2.8])); aim.current.copy(roomPoint(place, [0, 2.25, -3]))
    }
    camera.lookAt(aim.current)
  }
  useLayoutEffect(() => {
    const sizeKey = `${size.width}:${size.height}`
    if (!initialized.current || (!busy && !traveling.current && (place === 'yard' || previousSize.current !== sizeKey))) { reset(); initialized.current = true }
    previousSize.current = sizeKey
    const cam = camera as PerspectiveCamera; cam.fov = place === 'yard' ? (size.width < 650 ? 54 : 44) : size.width < 650 ? 66 : 57; cam.updateProjectionMatrix()
  }, [place, size.width, size.height, busy])
  useEffect(() => () => { gsap.killTweensOf(camera.position); gsap.killTweensOf(aim.current); gsap.killTweensOf(camera) }, [camera])
  useImperativeHandle(ref, () => ({ travel: async (target, quiet, commit) => {
    traveling.current = true
    const move = (position: Vector3, look: Vector3, duration: number) => new Promise<void>(resolve => {
      if (quiet) { camera.position.copy(position); aim.current.copy(look); resolve(); return }
      let finished = false
      let timer: ReturnType<typeof setTimeout>
      const finish = () => {
        if (finished) return
        finished = true; clearTimeout(timer); timeline.kill()
        camera.position.copy(position); aim.current.copy(look); resolve()
      }
      const timeline = gsap.timeline({ paused: true, onComplete: finish })
      timeline.to(camera.position, { x: position.x, y: position.y, z: position.z, duration, ease: 'power2.inOut' }, 0).to(aim.current, { x: look.x, y: look.y, z: look.z, duration, ease: 'power2.inOut' }, 0)
      // A throttled frame loop or a cancelled tween must never leave navigation locked.
      timer = setTimeout(finish, duration * 1000 + 120)
      timeline.play()
    })
    const enterHouse = async () => {
      const cam = camera as PerspectiveCamera
      gsap.to(cam, { fov: size.width < 650 ? 66 : 57, duration: quiet ? 0 : .9, onUpdate: () => cam.updateProjectionMatrix() })
      await move(new Vector3(0,1.65,5.3),new Vector3(0,1.9,-2.8),1.25)
      await move(new Vector3(0,1.65,2.35),new Vector3(0,1.9,-3),.9)
    }
    try {
      if (place === 'yard') { await enterHouse(); commit(); await new Promise<void>(r => requestAnimationFrame(() => r())); await move(hallPose(progress.current).position, hallPose(progress.current).aim, .65) }
      else if (place !== 'hall') {
        await move(roomPoint(place, [0, 1.65, 5.05]), roomPoint(place, [0, 1.65, 7]), .8)
        await move(hallPose(progress.current).position, hallPose(progress.current).aim, .8)
        if (target === 'hall') commit()
      }
      if (target === 'yard') {
        await move(new Vector3(0, 1.65, 2.35), new Vector3(0, 1.65, 5), 1.3); commit(); await new Promise<void>(r => requestAnimationFrame(() => r()));
        await move(new Vector3(0,1.65,size.width < 650 ? 11.8 : 11.2), new Vector3(0,2.12,2.2), 1.2)
      } else if (target !== 'hall') {
        const d = doorStops.find(d => d.id === target)!
        progress.current = (d.depth - 2) / 28
        const pose = hallPose(progress.current)
        await move(pose.position, new Vector3(d.side * 3.2, 1.65, 1.5 - d.depth), 1)
        await move(roomPoint(target, [0,1.65,5.1]), roomPoint(target, [0,1.65,0]), .75)
        commit()
        await move(roomPoint(target, [0,1.65,target === 'gallery' || size.width < 650 ? 4.2 : 2.8]), roomPoint(target, [0,2.25,-3]), .8)
      }
      smooth.current = progress.current
    } finally { traveling.current = false }
  }}), [place, size.width])
  useFrame((_, dt) => {
    if (!traveling.current && !busy && place === 'hall') {
      smooth.current = reduced ? progress.current : smooth.current + (progress.current - smooth.current) * (1 - Math.exp(-dt * 9))
      const pose = hallPose(smooth.current); camera.position.copy(pose.position); aim.current.copy(pose.aim)
    }
    camera.lookAt(aim.current)
  })
  return null
})

export function World({ place, opening, destination, navigate, interact, homeName, reduced }: {
  place: Place; opening: Place | null; destination: Place | null; navigate: (p: Place) => void; interact: (index: number) => void; homeName: string; reduced: boolean
}) {
  return <>
    <color attach="background" args={['#fcfbf7']} />
    <ambientLight intensity={1.5} />
    <hemisphereLight args={['#fff9eb','#8c946c',1.1]} />
    <directionalLight position={[-4,10,7]} intensity={1.6} castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-15} shadow-camera-right={15} shadow-camera-top={15} shadow-camera-bottom={-15} shadow-bias={-.0005} />
    <group visible={place==='yard' || opening==='hall' || opening==='yard' || destination==='yard'}><Yard opening={destination === 'yard' ? 'yard' : opening} navigate={navigate} homeName={homeName} reduced={reduced} /></group>
    <Interior.Provider value={true}>
      <Hall opening={opening} navigate={navigate} homeName={homeName} reduced={reduced} destination={destination} />
      {doorStops.map(d=>{ const t=roomTransform(d.id);return <group key={d.id} visible={place===d.id || opening===d.id || destination===d.id} position={[t.x,0,t.z]} rotation={[0,t.rotation,0]}>{d.id==='study'?<Study interact={place===d.id?interact:()=>{}} />:d.id==='gallery'?<Gallery interact={place===d.id?interact:()=>{}} reduced={reduced} />:<Blank />}</group> })}
    </Interior.Provider>
  </>
}
