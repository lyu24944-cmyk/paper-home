import { applyFoliageSelection } from './lib/foliage'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RGBADepthPacking,
  SpriteMaterial,
  SRGBColorSpace,
  Uint16BufferAttribute,
  Vector3,
  type Material,
} from 'three'
import type { AtmosphereLighting } from './atmosphere'
import { Builder, StaticBatch } from './Geometry'
import type { V3 } from './layout'
import type { ResourcePack } from './resources'

const BASE_GROUND_Y = -0.335
const PATH_BOLLARD_Z = [4.2, 7.2] as const
const BOLLARD_SIDES = [-1, 1] as const

let nextPackToken = 1
const packTokens = new WeakMap<ResourcePack, number>()
function getPackToken(pack: ResourcePack): number {
  let id = packTokens.get(pack)
  if (!id) {
    id = nextPackToken++
    packTokens.set(pack, id)
  }
  return id
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function hash2d(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123
  return s - Math.floor(s)
}

/**
 * Shared countryside terrain elevation function so sculpted meadow,
 * perimeter woods, hedgerows, pasture rails, wildflowers, and grass clumps
 * sit flush without floating. Strictly keeps house footprint, central walkway,
 * and the front-right camera corridor flat at -0.335m.
 */
export function getTerrainHeight(x: number, z: number): number {
  if (x >= -8.8 && x <= 8.5 && z >= -16.4 && z <= 11.4) return BASE_GROUND_Y
  const dist = Math.hypot(x, z)
  if (x >= 7.5 && z >= 2.0 && dist < 44) return BASE_GROUND_Y
  if (z >= 10.6 && x >= -10.5 && dist < 48) return BASE_GROUND_Y

  const leftMask = smoothstep(-8.8, -19.5, x)
  const backMask = smoothstep(-16.4, -29.0, z)
  const rightBackMask = smoothstep(8.5, 19.0, x) * smoothstep(2.0, -3.5, z)
  const farOuterMask = smoothstep(42.0, 58.0, dist) * smoothstep(32, 46, Math.hypot(x - 16, z - 20))
  const frontLeftMask = smoothstep(-10.5, -24.0, x) * smoothstep(10.6, 22.0, z)
  const cameraClear = smoothstep(24, 38, Math.hypot(x - 16, z - 20))
  const edgeWeight = Math.min(
    1,
    Math.max(leftMask, backMask, rightBackMask, frontLeftMask, farOuterMask) * cameraClear,
  )
  if (edgeWeight <= 0.001) return BASE_GROUND_Y

  const broad =
    0.5 +
    0.32 * Math.sin(x * 0.048 + 0.4) * Math.cos(z * 0.044 - 0.6) +
    0.18 * Math.sin((x + z) * 0.072)
  const detail =
    0.5 +
    0.5 *
      (0.6 * Math.sin(x * 0.16 - z * 0.11 + 1.2) +
        0.4 * Math.cos(x * 0.13 + z * 0.18 - 0.5))

  const radialLift = smoothstep(18, 86, dist) * 3.8 + smoothstep(14, 42, dist) * 0.95
  // Gently taper past 74m so SculptedGround tucks cleanly beneath HorizonTransition's inner ridge
  const outerTaper = 1 - smoothstep(74, 98, dist) * 0.62
  const heightDelta = edgeWeight * outerTaper * (radialLift * (0.48 + 0.52 * broad) + detail * 0.36)
  return BASE_GROUND_Y + Math.min(4.4, heightDelta)
}

function getTerrainNormal(x: number, z: number): Vector3 {
  const eps = 0.55
  const hL = getTerrainHeight(x - eps, z)
  const hR = getTerrainHeight(x + eps, z)
  const hD = getTerrainHeight(x, z - eps)
  const hU = getTerrainHeight(x, z + eps)
  return new Vector3(hL - hR, eps * 2, hD - hU).normalize()
}

function isInRestrictedCorridor(x: number, z: number): boolean {
  if (x >= -7.8 && x <= 7.8 && z >= -16.2 && z <= 11.2) return true
  if (Math.abs(x) <= 1.55 && z >= 0.0 && z <= 13.0) return true
  if (x >= 7.2 && z >= 1.8) return true
  if (z >= 10.6 && x >= -8.8) return true
  if (Math.hypot(x - 11.6, z - 15.3) < 12) return true
  if (Math.hypot(x - 19.0, z - 25.6) < 14) return true
  return false
}

interface ExtractedPart {
  geometry: BufferGeometry
  material: Material
  depthMaterial?: MeshDepthMaterial
  matrix: Matrix4
}

function extractNormalizedModel(
  gltfScene: { clone: (recursive?: boolean) => any },
  yEmbedRatio = 0,
): { parts: ExtractedPart[]; size: Vector3 } {
  const root = gltfScene.clone(true)
  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(root)
  const size = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  const normScale = 1 / Math.max(0.001, size.y)
  const normMatrix = new Matrix4().makeScale(normScale, normScale, normScale)
  normMatrix.multiply(
    new Matrix4().makeTranslation(-center.x, -bounds.min.y - size.y * yEmbedRatio, -center.z),
  )

  const parts: ExtractedPart[] = []
  root.traverse((obj: any) => {
    if (!(obj instanceof Mesh)) return
    const meshMatrix = normMatrix.clone().multiply(obj.matrixWorld)
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    const groups = obj.geometry.groups
    if (groups.length > 0 && mats.length > 1) {
      const geom = obj.geometry
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi]
        const mat = mats[g.materialIndex ?? 0] ?? mats[0]
        const sub = extractSubGeometry(geom, g.start, g.count)
        sub.applyMatrix4(meshMatrix)
        const prepared = prepareVegetalMaterial(mat)
        parts.push({
          geometry: sub,
          material: prepared.material,
          depthMaterial: prepared.depthMaterial,
          matrix: new Matrix4(),
        })
      }
    } else {
      const sub = obj.geometry.clone()
      sub.applyMatrix4(meshMatrix)
      const prepared = prepareVegetalMaterial(mats[0])
      parts.push({
        geometry: sub,
        material: prepared.material,
        depthMaterial: prepared.depthMaterial,
        matrix: new Matrix4(),
      })
    }
  })

  return { parts, size }
}

/**
 * Extracts per-child-node normalized variants from showcase-grid Poly Haven sets
 * (e.g. shrub_03 has 4 sprays a..d; fern_02 has 4 plants;
 * celandine_01 has 5 variants; periwinkle_plant has 6 variants; grass_medium_02 has 5 tufts;
 * rock_moss_set_02 has 7 rocks laid out side-by-side).
 */
function extractShowcaseVariants(
  gltfScene: { clone: (recursive?: boolean) => any },
  yEmbedRatio = 0.04,
): ExtractedPart[][] {
  const root = gltfScene.clone(true)
  root.updateMatrixWorld(true)
  const variants: ExtractedPart[][] = []

  const meshNodes: Mesh[] = []
  root.traverse((obj: any) => {
    if (obj instanceof Mesh) meshNodes.push(obj)
  })

  for (const node of meshNodes) {
    const bounds = new Box3().setFromObject(node)
    const size = bounds.getSize(new Vector3())
    if (size.y < 0.001) continue
    const center = bounds.getCenter(new Vector3())
    const invScale = 1 / size.y
    const localNorm = new Matrix4().makeScale(invScale, invScale, invScale)
    localNorm.multiply(
      new Matrix4().makeTranslation(
        -center.x,
        -bounds.min.y - size.y * yEmbedRatio,
        -center.z,
      ),
    )

    const nodeWorldToLocal = localNorm.clone().multiply(node.matrixWorld)
    const mats = Array.isArray(node.material) ? node.material : [node.material]
    const groups = node.geometry.groups
    const nodeParts: ExtractedPart[] = []

    if (groups.length > 0 && mats.length > 1) {
      for (const g of groups) {
        const sub = extractSubGeometry(node.geometry, g.start, g.count)
        sub.applyMatrix4(nodeWorldToLocal)
        const prepared = prepareVegetalMaterial(mats[g.materialIndex ?? 0] ?? mats[0])
        nodeParts.push({
          geometry: sub,
          material: prepared.material,
          depthMaterial: prepared.depthMaterial,
          matrix: new Matrix4(),
        })
      }
    } else {
      const sub = node.geometry.clone()
      sub.applyMatrix4(nodeWorldToLocal)
      const prepared = prepareVegetalMaterial(mats[0])
      nodeParts.push({
        geometry: sub,
        material: prepared.material,
        depthMaterial: prepared.depthMaterial,
        matrix: new Matrix4(),
      })
    }
    variants.push(nodeParts)
  }

  return variants
}

function extractSubGeometry(source: BufferGeometry, start: number, count: number): BufferGeometry {
  const geom = source.clone()
  const idx = source.getIndex()
  if (idx) {
    const sliced = idx.array.slice(start, start + count)
    geom.setIndex(Array.from(sliced))
  } else {
    geom.setDrawRange(start, count)
  }
  geom.clearGroups()
  return geom
}

function prepareVegetalMaterial(mat: Material): {
  material: Material
  depthMaterial?: MeshDepthMaterial
} {
  const cloned = mat.clone()
  if (cloned.userData.clusterCards) applyFoliageSelection(cloned)
  if (cloned instanceof MeshStandardMaterial) {
    if (cloned.transparent || cloned.alphaTest > 0) {
      cloned.transparent = false
      cloned.alphaTest = Math.max(cloned.alphaTest, 0.36)
      cloned.side = DoubleSide
      cloned.depthWrite = true
      const dm = cloned.map
        ? new MeshDepthMaterial({
            map: cloned.map,
            alphaTest: cloned.alphaTest,
            depthPacking: RGBADepthPacking,
            side: DoubleSide,
          })
        : undefined
      if (dm && cloned.userData.clusterCards) applyFoliageSelection(dm)
      return { material: cloned, depthMaterial: dm }
    }
  }
  return { material: cloned }
}

function disposePartLists(lists: ExtractedPart[][]): void {
  for (const list of lists) {
    for (const p of list) {
      p.geometry.dispose()
      p.material.dispose()
      p.depthMaterial?.dispose()
    }
  }
}

function createGlowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62)
  grad.addColorStop(0, 'rgba(255, 228, 168, 0.82)')
  grad.addColorStop(0.28, 'rgba(255, 200, 114, 0.36)')
  grad.addColorStop(0.64, 'rgba(255, 178, 86, 0.08)')
  grad.addColorStop(1, 'rgba(255, 165, 72, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 128, 128)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

function createTreeShadowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62)
  grad.addColorStop(0, 'rgba(22, 30, 16, 0.44)')
  grad.addColorStop(0.45, 'rgba(24, 34, 18, 0.24)')
  grad.addColorStop(0.8, 'rgba(26, 36, 20, 0.06)')
  grad.addColorStop(1, 'rgba(26, 36, 20, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 128, 128)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/**
 * Multi-blade crossed grass tuft geometry with warm mossy roots and sunlit tips.
 */
function createTuftGeometry(): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const rootColor = new Color('#657a3b')
  const midColor = new Color('#879c50')
  const tipColor = new Color('#aec06d')
  const tempColor = new Color()

  const bladeConfigs = [
    { angle: 0.12, tiltX: 0.032, tiltZ: 0.015, h: 0.135, w: 0.007 },
    { angle: 1.02, tiltX: -0.028, tiltZ: 0.025, h: 0.11, w: 0.0062 },
    { angle: 1.95, tiltX: 0.024, tiltZ: -0.03, h: 0.145, w: 0.0068 },
    { angle: 2.88, tiltX: -0.022, tiltZ: -0.022, h: 0.095, w: 0.0058 },
    { angle: 3.85, tiltX: 0.028, tiltZ: 0.028, h: 0.125, w: 0.0064 },
    { angle: 4.78, tiltX: -0.034, tiltZ: 0.014, h: 0.105, w: 0.0055 },
    { angle: 5.56, tiltX: 0.02, tiltZ: -0.026, h: 0.12, w: 0.006 },
  ]

  let vertexOffset = 0
  const up = new Vector3()
  const side = new Vector3()
  const normal = new Vector3()

  for (const cfg of bladeConfigs) {
    const cos = Math.cos(cfg.angle)
    const sin = Math.sin(cfg.angle)
    side.set(cos, 0, sin)
    normal.set(-sin, 0.25, cos).normalize()

    const tiers = [0, 0.42, 0.8, 1.0]
    for (let ti = 0; ti < tiers.length; ti++) {
      const t = tiers[ti]
      const width = cfg.w * (1 - t * 0.88)
      const curve = t * t
      const cx = cfg.tiltX * curve + cos * 0.012
      const cz = cfg.tiltZ * curve + sin * 0.012
      const cy = cfg.h * t

      tempColor.copy(rootColor).lerp(midColor, Math.min(1, t * 1.5)).lerp(tipColor, Math.max(0, (t - 0.35) * 1.54))

      if (ti < tiers.length - 1) {
        for (const s of [-1, 1]) {
          positions.push(cx + side.x * width * s, cy, cz + side.z * width * s)
          normals.push(normal.x, normal.y, normal.z)
          colors.push(tempColor.r, tempColor.g, tempColor.b)
        }
      } else {
        positions.push(cx, cy, cz)
        up.copy(normal).lerp(new Vector3(0, 1, 0), 0.35).normalize()
        normals.push(up.x, up.y, up.z)
        colors.push(tempColor.r, tempColor.g, tempColor.b)
      }
    }

    indices.push(
      vertexOffset + 0,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset + 1,
      vertexOffset + 3,
      vertexOffset + 2,
      vertexOffset + 2,
      vertexOffset + 3,
      vertexOffset + 4,
      vertexOffset + 3,
      vertexOffset + 5,
      vertexOffset + 4,
      vertexOffset + 4,
      vertexOffset + 5,
      vertexOffset + 6,
    )
    vertexOffset += 7
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geo.setIndex(new Uint16BufferAttribute(indices, 1))
  geo.computeBoundingSphere()
  return geo
}

function SculptedGround({
  grassMaterial,
  quality,
}: {
  grassMaterial: Material
  quality: ResourcePack['quality']
}) {
  const geometry = useMemo(() => {
    const segs = quality === 'high' ? 64 : 48
    const vertsPerSide = segs + 1
    const count = vertsPerSide * vertsPerSide
    const positions = new Float32Array(count * 3)
    const uvs = new Float32Array(count * 2)
    const colors = new Float32Array(count * 3)
    const indices: number[] = []

    const mapAxis = (t: number) => {
      const a = Math.abs(t)
      const s = Math.sign(t)
      return s * (a * 28 + Math.pow(Math.max(0, a - 0.2), 2.15) * 126)
    }

    const color = new Color()
    const baseWhite = new Color('#ffffff')
    const hillSun = new Color('#fffbe8')
    const woodMargin = new Color('#dce8ce')

    let vi = 0
    for (let iz = 0; iz <= segs; iz++) {
      const tz = (iz / segs) * 2 - 1
      const z = mapAxis(tz)
      for (let ix = 0; ix <= segs; ix++) {
        const tx = (ix / segs) * 2 - 1
        const x = mapAxis(tx)
        const y = getTerrainHeight(x, z)
        positions[vi * 3 + 0] = x
        positions[vi * 3 + 1] = y
        positions[vi * 3 + 2] = z

        uvs[vi * 2 + 0] = x / 2.51
        uvs[vi * 2 + 1] = z / 2.51

        const elev = y - BASE_GROUND_Y
        const dist = Math.hypot(x, z)
        color.copy(baseWhite)
        if (elev > 0.05) {
          color.lerp(hillSun, smoothstep(0.2, 2.4, elev) * 0.42)
        }
        color.lerp(woodMargin, smoothstep(22, 52, dist) * 0.48)
        colors[vi * 3 + 0] = color.r
        colors[vi * 3 + 1] = color.g
        colors[vi * 3 + 2] = color.b
        vi++
      }
    }

    for (let iz = 0; iz < segs; iz++) {
      for (let ix = 0; ix < segs; ix++) {
        const a = iz * vertsPerSide + ix
        const b = a + 1
        const c = a + vertsPerSide
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
  }, [quality])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      material={grassMaterial}
      receiveShadow
      castShadow={false}
      raycast={() => null}
    />
  )
}

function HorizonTransition({ lighting }: { lighting: AtmosphereLighting }) {
  const { innerRidgeGeo, outerRidgeGeo } = useMemo(() => {
    const buildRidge = (
      innerR: number,
      outerR: number,
      minH: number,
      maxH: number,
      phase: number,
      segs = 112,
    ) => {
      const positions: number[] = []
      const colors: number[] = []
      const indices: number[] = []
      const baseColor = new Color('#557042')
      const slopeColor = new Color('#718d56')
      const peakColor = new Color('#8ea47c')
      const temp = new Color()
      const rings = 5 // [inner skirt, inner slope, crest, outer slope, outer skirt]

      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        const rawWave =
          0.5 +
          0.3 * Math.sin(a * 2 + phase) +
          0.16 * Math.cos(a * 5 - phase * 1.35) +
          0.09 * Math.sin(a * 9 + phase * 0.7 + 0.6)
        const wave = Math.max(0.08, Math.min(1, rawWave))
        const crestH = minH + (maxH - minH) * wave

        const profiles = [
          { r: innerR, y: -1.4, c: baseColor },
          { r: innerR + (outerR - innerR) * 0.25, y: crestH * 0.56, c: temp.copy(baseColor).lerp(slopeColor, 0.7).clone() },
          { r: (innerR + outerR) * 0.5, y: crestH, c: temp.copy(slopeColor).lerp(peakColor, wave).clone() },
          { r: innerR + (outerR - innerR) * 0.78, y: crestH * 0.6, c: temp.copy(slopeColor).lerp(peakColor, wave * 0.6).clone() },
          { r: outerR, y: -2.2, c: baseColor },
        ]
        for (const p of profiles) {
          positions.push(cos * p.r, p.y, sin * p.r)
          colors.push(p.c.r, p.c.g, p.c.b)
        }
      }

      for (let i = 0; i < segs; i++) {
        const b = i * rings
        const n = (i + 1) * rings
        for (let r = 0; r < rings - 1; r++) {
          indices.push(b + r, n + r, b + r + 1, b + r + 1, n + r, n + r + 1)
        }
      }

      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute(positions, 3))
      g.setAttribute('color', new Float32BufferAttribute(colors, 3))
      g.setIndex(indices)
      g.computeVertexNormals()
      return g
    }

    return {
      innerRidgeGeo: buildRidge(68, 92, 2.8, 11.4, 0.85),
      outerRidgeGeo: buildRidge(88, 122, 4.2, 15.6, 2.55),
    }
  }, [])

  const ridgeMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0,
      }),
    [],
  )

  useEffect(() => {
    const ridgeHex =
      lighting.preset === 'night'
        ? '#465868'
        : lighting.preset === 'golden'
          ? '#f2d6c3'
          : lighting.preset === 'dawn'
            ? '#dae5eb'
            : '#eef3ea'
    ridgeMaterial.color.set(ridgeHex)
  }, [lighting.preset, ridgeMaterial])

  useEffect(
    () => () => {
      innerRidgeGeo.dispose()
      outerRidgeGeo.dispose()
      ridgeMaterial.dispose()
    },
    [innerRidgeGeo, outerRidgeGeo, ridgeMaterial],
  )

  return (
    <group>
      <mesh
        geometry={innerRidgeGeo}
        material={ridgeMaterial}
        userData={{ skipAO: true }}
        castShadow={false}
        receiveShadow={false}
        raycast={() => null}
      />
      <mesh
        geometry={outerRidgeGeo}
        material={ridgeMaterial}
        userData={{ skipAO: true }}
        castShadow={false}
        receiveShadow={false}
        raycast={() => null}
      />
    </group>
  )
}

function sampleVariants<T>(items: T[], maxCount: number): T[] {
  if (items.length <= maxCount) return items
  const out: T[] = []
  for (let i = 0; i < maxCount; i++) {
    out.push(items[Math.floor((i * items.length) / maxCount)])
  }
  return out
}

function InstancedMultiPart({
  instanceKey,
  parts,
  matrices,
  colors,
  castShadow = false,
  receiveShadow = true,
  skipAO = false,
}: {
  instanceKey: string
  parts: ExtractedPart[]
  matrices: Matrix4[]
  colors?: Color[]
  castShadow?: boolean
  receiveShadow?: boolean
  skipAO?: boolean
}) {
  const refs = useRef<(InstancedMesh | null)[]>([])
  refs.current.length = parts.length

  useLayoutEffect(() => {
    if (!matrices.length) return
    refs.current.forEach((mesh) => {
      if (!mesh) return
      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i])
        if (colors && colors[i]) mesh.setColorAt(i, colors[i])
      }
      mesh.instanceMatrix.needsUpdate = true
      if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      if (mesh.boundingSphere) mesh.boundingSphere.radius += 0.35
    })
  }, [parts, matrices, colors])

  if (!matrices.length) return null

  return (
    <group>
      {parts.map((part, idx) => (
        <instancedMesh
          key={`${instanceKey}-${idx}-${matrices.length}`}
          ref={(el) => {
            refs.current[idx] = el
          }}
          args={[part.geometry, part.material, matrices.length]}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          customDepthMaterial={castShadow ? part.depthMaterial : undefined}
          userData={skipAO ? { skipAO: true } : undefined}
          raycast={() => null}
        />
      ))}
    </group>
  )
}

function TreeShadowDiscs({
  placements,
}: {
  placements: Array<{ x: number; z: number; radius: number }>
}) {
  const ref = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(1, 1)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const texture = useMemo(() => createTreeShadowTexture(), [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      }),
    [texture],
  )

  const matrices = useMemo(() => {
    const up = new Vector3(0, 1, 0)
    const pos = new Vector3()
    const quat = new Quaternion()
    const scl = new Vector3()
    return placements.map(({ x, z, radius }) => {
      const n = getTerrainNormal(x, z)
      pos.set(x, getTerrainHeight(x, z) + 0.025, z)
      quat.setFromUnitVectors(up, n)
      scl.set(radius * 2, 1, radius * 2)
      return new Matrix4().compose(pos, quat, scl)
    })
  }, [placements])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh || !matrices.length) return
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i])
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [matrices])

  useEffect(
    () => () => {
      geometry.dispose()
      texture.dispose()
      material.dispose()
    },
    [geometry, texture, material],
  )

  if (!matrices.length) return null

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, matrices.length]}
      castShadow={false}
      receiveShadow={false}
      userData={{ skipAO: true }}
      raycast={() => null}
    />
  )
}

type TreeKind = 'small' | 'big' | 'broad'
type TreeSpec = { kind: TreeKind; x: number; z: number; h: number; r: number }

const RING1_TREES: TreeSpec[] = [
  { kind: 'small', x: -11.4, z: -2.2, h: 5.4, r: 0.9 },
  { kind: 'broad', x: -12.6, z: -10.4, h: 7.2, r: 2.1 },
  { kind: 'small', x: -14.4, z: 3.6, h: 5.1, r: 1.4 },
  { kind: 'broad', x: -17.2, z: 1.8, h: 6.4, r: 3.6 },
  { kind: 'small', x: 11.8, z: -5.6, h: 5.4, r: 1.2 },
  { kind: 'broad', x: 14.2, z: -10.5, h: 7.4, r: 3.1 },
  { kind: 'big', x: -9.5, z: -11.5, h: 7.1, r: 2.5 },
  { kind: 'broad', x: 16.8, z: -2.2, h: 6.4, r: 0.6 },
  { kind: 'small', x: -6.8, z: -18.8, h: 6.1, r: 2.8 },
  { kind: 'big', x: 2.2, z: -20.2, h: 8.2, r: 0.4 },
  { kind: 'broad', x: 9.6, z: -17.2, h: 7.5, r: 1.9 },
  { kind: 'broad', x: -16.4, z: -5.8, h: 6.9, r: 4.2 },
]

const RING2_AND_RING3_TREES: TreeSpec[] = [
  // Ring 2: rolling mixed woodland belt behind house, left slope, and right valley (z <= -2.5 on right!)
  { kind: 'broad', x: -18.5, z: 2.8, h: 7.4, r: 0.4 },
  { kind: 'broad', x: -24.5, z: -2.4, h: 8.2, r: 1.9 },
  { kind: 'big', x: -22.2, z: -14.8, h: 8.8, r: 3.1 },
  { kind: 'broad', x: -15.2, z: -22.8, h: 8.4, r: 4.2 },
  { kind: 'big', x: -29.2, z: -24.0, h: 9.2, r: 0.8 },
  { kind: 'broad', x: -6.2, z: -25.5, h: 9.2, r: 2.3 },
  { kind: 'big', x: 5.8, z: -28.5, h: 9.1, r: 5.1 },
  { kind: 'big', x: 14.4, z: -21.5, h: 8.2, r: 1.3 },
  { kind: 'broad', x: 20.5, z: -13.5, h: 7.9, r: 3.7 },
  { kind: 'small', x: 18.8, z: -4.2, h: 5.9, r: 2.6 },
  { kind: 'broad', x: 25.0, z: -7.2, h: 8.0, r: 0.7 },
  { kind: 'small', x: -20.8, z: 11.2, h: 6.1, r: 1.7 },
  { kind: 'broad', x: -1.6, z: -34.0, h: 9.8, r: 2.9 },
  { kind: 'broad', x: -20.5, z: -29.5, h: 9.6, r: 1.2 },
  { kind: 'big', x: -11.8, z: -34.0, h: 9.4, r: 3.8 },
  { kind: 'broad', x: 13.8, z: -32.5, h: 9.5, r: 2.4 },
  { kind: 'small', x: -34.5, z: -12.0, h: 7.1, r: 0.9 },
  { kind: 'big', x: -31.8, z: 5.6, h: 8.2, r: 3.4 },
  { kind: 'broad', x: -36.5, z: -28.5, h: 8.9, r: 2.7 },
  { kind: 'big', x: -3.2, z: -24.5, h: 8.6, r: 0.5 },
  { kind: 'small', x: 8.4, z: -25.2, h: 7.2, r: 3.3 },
  { kind: 'broad', x: -25.4, z: -37.2, h: 10.2, r: 4.8 },
  { kind: 'broad', x: 19.6, z: -37.8, h: 9.4, r: 1.5 },
  // Extra right valley & center-rear canopy layer visible from yard camera (+13.6, +18.0)
  { kind: 'broad', x: 11.2, z: -14.8, h: 7.2, r: 1.8 },
  { kind: 'broad', x: 15.6, z: -16.8, h: 7.8, r: 2.1 },
  { kind: 'small', x: 13.8, z: -8.6, h: 5.5, r: 4.7 },
  { kind: 'broad', x: -10.8, z: -17.5, h: 8.1, r: 0.9 },

  // Ring 3: distant hillside silhouette woods (visible backdrop arc)
  { kind: 'broad', x: -46.0, z: -18.0, h: 10.2, r: 0.3 },
  { kind: 'broad', x: -48.5, z: -3.5, h: 9.6, r: 1.8 },
  { kind: 'broad', x: -44.0, z: -36.5, h: 10.8, r: 2.1 },
  { kind: 'broad', x: -32.0, z: -46.5, h: 10.4, r: 0.9 },
  { kind: 'big', x: -20.0, z: -49.5, h: 11.0, r: 3.9 },
  { kind: 'broad', x: -8.5, z: -51.5, h: 10.8, r: 2.5 },
  { kind: 'broad', x: 4.5, z: -49.5, h: 10.6, r: 1.1 },
  { kind: 'big', x: 16.5, z: -47.5, h: 10.4, r: 4.4 },
  { kind: 'broad', x: -14.2, z: -42.5, h: 10.5, r: 5.2 },
  { kind: 'broad', x: 11.2, z: -41.5, h: 10.2, r: 1.3 },
  { kind: 'broad', x: -17.5, z: -36.5, h: 9.6, r: 3.9 },
]

function tintTreeParts(
  parts: ExtractedPart[],
  tintHex: string,
  match?: (materialName: string, index: number) => boolean,
): ExtractedPart[] {
  const tint = new Color(tintHex)
  return parts.map((part, idx) => {
    const matName = part.material.name || ''
    if (match && !match(matName, idx)) return part
    if (part.material instanceof MeshStandardMaterial) {
      part.material.color.multiply(tint)
    }
    return part
  })
}

function PerimeterForestAndTrees({ pack }: { pack: ResourcePack }) {
  const packToken = getPackToken(pack)

  const {
    smallTreeParts,
    bigTreeParts,
    broadTreeParts,
    shrubThreeVariants,
    shrubFourParts,
  } = useMemo(() => {
    const broadBase = extractNormalizedModel(pack.treeBroad.scene)
    const shrubFourBase = extractNormalizedModel(pack.shrubFour.scene, 0.06)
    return {
      smallTreeParts: extractNormalizedModel(pack.treeSmall.scene),
      bigTreeParts: extractNormalizedModel(pack.tree.scene),
      broadTreeParts: {
        ...broadBase,
        parts: tintTreeParts(broadBase.parts, '#786c5c', (name) => name === 'island_tree_02'),
      },
      shrubThreeVariants: sampleVariants(extractShowcaseVariants(pack.shrubThree.scene, 0.04), 2).map(
        (parts) => tintTreeParts(parts, '#548241'),
      ),
      shrubFourParts: {
        ...shrubFourBase,
        parts: tintTreeParts(shrubFourBase.parts, '#4c793a'),
      },
    }
  }, [pack])

  useEffect(
    () => () => {
      disposePartLists([
        smallTreeParts.parts,
        bigTreeParts.parts,
        broadTreeParts.parts,
        ...shrubThreeVariants,
        shrubFourParts.parts,
      ])
    },
    [smallTreeParts, bigTreeParts, broadTreeParts, shrubThreeVariants, shrubFourParts],
  )

  const {
    shadowSmallMatrices,
    shadowBigMatrices,
    shadowBroadMatrices,
    outerSmallMatrices,
    outerBigMatrices,
    outerBroadMatrices,
    shrubThreeBuckets,
    shrubFourMatrices,
    shadowDiscs,
  } = useMemo(() => {
    const shadowRadius = pack.quality === 'high' ? 20.6 : 13.5
    const sSmall: Matrix4[] = []
    const sBig: Matrix4[] = []
    const sBroad: Matrix4[] = []
    const small: Matrix4[] = []
    const big: Matrix4[] = []
    const broad: Matrix4[] = []
    const s3B: Matrix4[][] = Array.from(
      { length: Math.max(1, shrubThreeVariants.length) },
      () => [],
    )
    const s4: Matrix4[] = []
    const discs: Array<{ x: number; z: number; radius: number }> = []

    const pos = new Vector3()
    const quat = new Quaternion()
    const scl = new Vector3()
    const yAxis = new Vector3(0, 1, 0)

    for (const s of RING1_TREES) {
      if (isInRestrictedCorridor(s.x, s.z)) continue
      const y = getTerrainHeight(s.x, s.z) - (s.kind === 'broad' ? 0.24 : 0.14)
      pos.set(s.x, y, s.z)
      quat.setFromAxisAngle(yAxis, s.r)
      scl.set(s.h, s.h, s.h)
      const mat = new Matrix4().compose(pos, quat, scl)
      const casts = Math.hypot(s.x, s.z) <= shadowRadius
      if (s.kind === 'small') (casts ? sSmall : small).push(mat)
      else if (s.kind === 'big') (casts ? sBig : big).push(mat)
      else (casts ? sBroad : broad).push(mat)
      discs.push({ x: s.x, z: s.z, radius: s.h * 0.38 })
    }

    for (let i = 0; i < RING2_AND_RING3_TREES.length; i++) {
      const s = RING2_AND_RING3_TREES[i]
      if (isInRestrictedCorridor(s.x, s.z)) continue
      const y = getTerrainHeight(s.x, s.z) - (s.kind === 'small' ? 0.14 : 0.26)
      pos.set(s.x, y, s.z)
      quat.setFromAxisAngle(yAxis, s.r)
      // Distant Ring 2/3 oaks use broad canopy LOD instead of heavy hero tree geometry.
      const scaleH = s.kind === 'big' ? s.h * 0.96 : s.h
      scl.set(scaleH, scaleH, scaleH)
      const mat = new Matrix4().compose(pos, quat, scl)
      if (s.kind === 'small') small.push(mat)
      else broad.push(mat)
      if (Math.hypot(s.x, s.z) <= 44) {
        discs.push({ x: s.x, z: s.z, radius: s.h * 0.36 })
      }
    }

    const pushShrub3 = (idx: number, x: number, z: number, scale: number, rotY: number) => {
      if (isInRestrictedCorridor(x, z)) return
      const y = getTerrainHeight(x, z) - 0.04
      pos.set(x, y, z)
      quat.setFromAxisAngle(yAxis, rotY)
      scl.set(scale * 1.38, scale, scale * 1.38)
      s3B[Math.abs(idx) % s3B.length].push(new Matrix4().compose(pos, quat, scl))
    }

    const pushShrub4 = (x: number, z: number, scale: number, rotY: number) => {
      if (isInRestrictedCorridor(x, z)) return
      const y = getTerrainHeight(x, z) - 0.04
      pos.set(x, y, z)
      quat.setFromAxisAngle(yAxis, rotY)
      scl.set(scale * 0.72, scale * 0.94, scale * 0.96)
      s4.push(new Matrix4().compose(pos, quat, scl))
    }

    // 1. Courtyard outer fence hedgerows (left fence flank, front-left fence flank, neat right-rear border)
    for (let i = 0; i < 14; i++) {
      const z = -5.6 + i * 1.16
      const jitter = (hash2d(i * 13 + 7) - 0.5) * 0.24
      pushShrub4(-7.9 + jitter, z, 0.45 + hash2d(i * 7 + 3) * 0.16, hash2d(i * 17) * Math.PI)
      pushShrub3(i, -8.15 - jitter * 0.5, z + 0.35, 0.65 + hash2d(i * 11) * 0.25, i * 1.3)
    }
    for (let i = 0; i < 7; i++) {
      const x = -2.2 - i * 0.92
      pushShrub4(x, 10.65 + (i % 2) * 0.1, 0.42 + hash2d(i * 19 + 5) * 0.14, i * 0.9)
      if (i % 2 === 0) pushShrub3(i + 20, x - 0.25, 10.72, 0.58, i * 1.8)
    }
    for (let i = 0; i < 6; i++) {
      const z = -5.6 + i * 0.96
      pushShrub4(7.72 + (i % 2) * 0.12, z, 0.38 + hash2d(i * 23) * 0.12, i * 0.8 + 1.57)
      if (i % 2 === 0) pushShrub3(i + 30, 7.88, z + 0.25, 0.52, i * 2.1)
    }

    // 2. Understory shrubs tucked around Ring 1 & near Ring 2 tree bases to root trunks into ground
    const baseTrees = [...RING1_TREES, ...RING2_AND_RING3_TREES.slice(0, 12)]
    for (let i = 0; i < baseTrees.length; i++) {
      const t = baseTrees[i]
      if (isInRestrictedCorridor(t.x, t.z)) continue
      const a1 = hash2d(i * 29 + 11) * Math.PI * 2
      const a2 = a1 + 2.2
      const r1 = 0.85 + hash2d(i * 31 + 3) * 0.55
      pushShrub4(t.x + Math.cos(a1) * r1, t.z + Math.sin(a1) * r1, 0.48 + hash2d(i * 37) * 0.2, a1)
      pushShrub3(i, t.x + Math.cos(a2) * (r1 * 0.88), t.z + Math.sin(a2) * (r1 * 0.88), 0.72 + hash2d(i * 41) * 0.3, a2 + 1.1)
      if (i < RING1_TREES.length) {
        const frontAngle = 0.78 + hash2d(i * 53 + 7) * 0.85
        pushShrub3(
          i + 90,
          t.x + Math.cos(frontAngle) * (r1 * 0.7),
          t.z + Math.sin(frontAngle) * (r1 * 0.7),
          0.66 + hash2d(i * 59) * 0.24,
          frontAngle + 2.1,
        )
      }
    }

    // 3. Meadow slope hedgerow drifts backing pasture fences & rear ridge
    for (let i = 0; i < 24; i++) {
      const h1 = hash2d(i * 43 + 17)
      const h2 = hash2d(i * 47 + 29)
      if (i < 10) {
        const x = -11.9 - i * 0.85 + (h1 - 0.5) * 0.5
        const z = 8.4 - i * 2.55 + (h2 - 0.5) * 0.8
        pushShrub4(x, z, 0.52 + h1 * 0.2, h2 * Math.PI * 2)
        pushShrub3(i + 50, x - 0.4, z + 0.45, 0.76 + h2 * 0.25, h1 * Math.PI * 2)
      } else if (i < 17) {
        const k = i - 10
        const x = 9.6 + k * 2.05
        const z = -4.2 - k * 1.4 - (h1 * 0.6)
        pushShrub4(x, z, 0.52 + h2 * 0.18, h1 * Math.PI * 2)
        pushShrub3(i + 60, x + 0.35, z - 0.5, 0.78 + h1 * 0.24, h2 * Math.PI * 2)
      } else {
        const k = i - 17
        const x = -18.0 + k * 6.2
        const z = -19.5 - Math.sin(k * 0.8) * 3.2
        pushShrub4(x, z, 0.58 + h1 * 0.22, h2 * Math.PI * 2)
      }
    }

    return {
      shadowSmallMatrices: sSmall,
      shadowBigMatrices: sBig,
      shadowBroadMatrices: sBroad,
      outerSmallMatrices: small,
      outerBigMatrices: big,
      outerBroadMatrices: broad,
      shrubThreeBuckets: s3B,
      shrubFourMatrices: s4,
      shadowDiscs: discs,
    }
  }, [pack.quality, shrubThreeVariants.length])

  return (
    <group>
      <TreeShadowDiscs placements={shadowDiscs} />
      <InstancedMultiPart
        instanceKey={`${packToken}-shadow-small-tree`}
        parts={smallTreeParts.parts}
        matrices={shadowSmallMatrices}
        castShadow
        receiveShadow
        skipAO
      />
      <InstancedMultiPart
        instanceKey={`${packToken}-shadow-big-tree`}
        parts={bigTreeParts.parts}
        matrices={shadowBigMatrices}
        castShadow
        receiveShadow
        skipAO
      />
      <InstancedMultiPart
        instanceKey={`${packToken}-shadow-broad-tree`}
        parts={broadTreeParts.parts}
        matrices={shadowBroadMatrices}
        castShadow
        receiveShadow
        skipAO
      />
      <InstancedMultiPart
        instanceKey={`${packToken}-small-tree`}
        parts={smallTreeParts.parts}
        matrices={outerSmallMatrices}
        castShadow={false}
        receiveShadow={false}
        skipAO
      />
      <InstancedMultiPart
        instanceKey={`${packToken}-big-tree`}
        parts={bigTreeParts.parts}
        matrices={outerBigMatrices}
        castShadow={false}
        receiveShadow={false}
        skipAO
      />
      <InstancedMultiPart
        instanceKey={`${packToken}-broad-tree`}
        parts={broadTreeParts.parts}
        matrices={outerBroadMatrices}
        castShadow={false}
        receiveShadow={false}
        skipAO
      />
      {shrubThreeVariants.map((parts, idx) => (
        <InstancedMultiPart
          key={`shrub3-v-${idx}`}
          instanceKey={`${packToken}-shrub3-${idx}`}
          parts={parts}
          matrices={shrubThreeBuckets[idx] ?? []}
          castShadow={false}
          receiveShadow
          skipAO
        />
      ))}
      <InstancedMultiPart
        instanceKey={`${packToken}-shrub4`}
        parts={shrubFourParts.parts}
        matrices={shrubFourMatrices}
        castShadow={false}
        receiveShadow
        skipAO
      />
    </group>
  )
}

function PastureFences({ materials }: { materials: Record<string, Material> }) {
  const builder = useMemo(() => {
    const b = new Builder()
    const paths: Array<Array<[number, number]>> = [
      // Left hillside pasture fence curving safely outside yard perimeter
      [
        [-11.8, 9.8],
        [-13.0, 5.2],
        [-14.4, 0.2],
        [-15.8, -5.2],
        [-17.4, -10.8],
        [-19.2, -16.5],
      ],
      // Right-rear valley pasture fence (strictly z <= -3.6, backed by hedgerows & woodland)
      [
        [9.2, -3.8],
        [13.6, -5.8],
        [18.0, -8.8],
        [22.4, -12.4],
      ],
    ]

    const dir = new Vector3()
    const quat = new Quaternion()
    const euler = new Euler()

    for (const line of paths) {
      const pts = line.map(([x, z]) => new Vector3(x, getTerrainHeight(x, z), z))
      for (const p of pts) {
        b.box([0.1, 0.96, 0.1], [p.x, p.y + 0.38, p.z], 'wood', [0, 0, 0], 0.008)
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const c = pts[i + 1]
        dir.copy(c).sub(a)
        const len = dir.length()
        if (len < 0.1) continue
        dir.normalize()
        const yaw = Math.atan2(dir.x, dir.z)
        const pitch = -Math.asin(Math.max(-1, Math.min(1, dir.y)))
        quat.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ'))
        euler.setFromQuaternion(quat, 'XYZ')
        const rot: V3 = [euler.x, euler.y, euler.z]
        for (const railY of [0.38, 0.68]) {
          b.box(
            [0.055, 0.085, len + 0.05],
            [(a.x + c.x) * 0.5, (a.y + c.y) * 0.5 + railY, (a.z + c.z) * 0.5],
            'wood',
            rot,
            0.004,
          )
        }
      }
    }
    return b
  }, [])

  return (
    <group userData={{ skipAO: true }}>
      <StaticBatch builder={builder} materials={materials} castShadow={false} />
    </group>
  )
}

function YardFoliageAndRocks({ pack }: { pack: ResourcePack }) {
  const packToken = getPackToken(pack)

  const {
    rockVariants,
    fernVariants,
    flowerVariants,
    sorrelVariants,
    periwinkleVariants,
    grassClumpVariants,
  } = useMemo(
    () => ({
      rockVariants: sampleVariants(extractShowcaseVariants(pack.rocks.scene, 0.12), 2),
      fernVariants: sampleVariants(extractShowcaseVariants(pack.fern.scene, 0.04), 2),
      flowerVariants: sampleVariants(extractShowcaseVariants(pack.wildflower.scene, 0.03), 2),
      sorrelVariants: sampleVariants(extractShowcaseVariants(pack.shrub.scene, 0.02), 2),
      periwinkleVariants: sampleVariants(extractShowcaseVariants(pack.periwinkle.scene, 0.03), 2),
      grassClumpVariants: sampleVariants(extractShowcaseVariants(pack.grassClump.scene, 0.03), 2),
    }),
    [pack],
  )

  useEffect(
    () => () => {
      disposePartLists([
        ...rockVariants,
        ...fernVariants,
        ...flowerVariants,
        ...sorrelVariants,
        ...periwinkleVariants,
        ...grassClumpVariants,
      ])
    },
    [
      rockVariants,
      fernVariants,
      flowerVariants,
      sorrelVariants,
      periwinkleVariants,
      grassClumpVariants,
    ],
  )

  const buckets = useMemo(() => {
    const high = pack.quality === 'high'
    const makeBuckets = (len: number) => Array.from({ length: len }, () => [] as Matrix4[])
    const rockB = makeBuckets(rockVariants.length)
    const fernB = makeBuckets(fernVariants.length)
    const flowerB = makeBuckets(flowerVariants.length)
    const sorrelB = makeBuckets(sorrelVariants.length)
    const periwinkleB = makeBuckets(periwinkleVariants.length)
    const grassClumpB = makeBuckets(grassClumpVariants.length)

    const pushItem = (
      bucketsList: Matrix4[][],
      idx: number,
      x: number,
      z: number,
      scale: number,
      rotY: number,
      yOffset = 0,
      pitchX = 0,
    ) => {
      if (!bucketsList.length) return
      const bIdx = Math.abs(idx) % bucketsList.length
      const y = getTerrainHeight(x, z) + yOffset
      const m = new Matrix4().compose(
        new Vector3(x, y, z),
        new Quaternion().setFromEuler(new Euler(pitchX, rotY, 0, 'YXZ')),
        new Vector3(scale, scale * (0.94 + hash2d(idx + 3) * 0.14), scale),
      )
      bucketsList[bIdx].push(m)
    }

    // 1. Mossy stone placements: right L-flowerbed, gate piers, porch flanks, left tree roots
    const rockSpots: Array<[number, number, number, number, number]> = [
      [2.65, 3.65, 0.28, 0.3, 0.26],
      [3.15, 3.45, 0.32, 1.8, 0.26],
      [4.2, 3.65, 0.26, 2.7, 0.26],
      [5.75, 3.85, 0.33, 0.9, 0.26],
      [5.95, 4.9, 0.31, 4.1, 0.26],
      [5.85, 6.2, 0.28, 2.1, 0.26],
      [5.9, 7.6, 0.32, 5.2, 0.26],
      [5.15, 4.65, 0.25, 1.3, 0.0],
      [2.05, 9.75, 0.28, 3.8, 0.0],
      [-2.05, 9.75, 0.27, 0.7, 0.0],
      [-4.6, 4.5, 0.3, 2.2, 0.04],
      [-6.35, 4.9, 0.36, 4.8, 0.04],
      [-5.95, 6.8, 0.28, 1.1, 0.04],
      [6.0, 0.75, 0.27, 0.4, 0.0],
      [-6.0, 0.75, 0.26, 2.9, 0.0],
      [-10.9, -2.5, 0.52, 1.4, 0.0],
      [-11.8, -9.8, 0.56, 3.7, 0.0],
      [11.4, -5.2, 0.48, 2.1, 0.0],
      [13.6, -9.8, 0.55, 4.3, 0.0],
    ]
    const rockLimit = high ? rockSpots.length : Math.min(15, rockSpots.length)
    for (let i = 0; i < rockLimit; i++) {
      const [x, z, sc, r, dy] = rockSpots[i]
      pushItem(rockB, i, x, z, sc, r, dy)
    }

    // 2. Garden ferns: flowerbed corners, side wall aprons, Ring 1 tree roots
    const fernSpots: Array<[number, number, number, number, number]> = [
      [2.85, 3.75, 0.42, 0.6, 0.27],
      [3.85, 3.75, 0.44, 2.1, 0.27],
      [5.75, 4.1, 0.48, 1.4, 0.27],
      [5.9, 5.45, 0.44, 3.9, 0.27],
      [5.85, 7.1, 0.46, 0.8, 0.27],
      [4.8, 9.45, 0.4, 2.7, 0.0],
      [5.95, -2.9, 0.48, 1.9, 0.0],
      [6.0, -5.8, 0.52, 4.3, 0.0],
      [5.95, -8.8, 0.46, 0.5, 0.0],
      [-6.1, -2.8, 0.5, 3.1, 0.0],
      [-6.2, -7.2, 0.54, 1.6, 0.0],
      [-6.55, 3.1, 0.46, 2.4, 0.0],
      [-6.55, 7.8, 0.43, 0.9, 0.0],
      [-4.9, 4.55, 0.42, 4.5, 0.04],
      [-3.5, 9.5, 0.39, 1.2, 0.0],
      [2.8, 9.55, 0.41, 3.3, 0.0],
      // Root ferns hugging Ring 1 perimeter trees
      [-11.2, -1.6, 0.58, 0.7, 0.0],
      [-12.1, -10.0, 0.62, 2.8, 0.0],
      [11.5, -5.0, 0.55, 1.5, 0.0],
      [13.8, -10.2, 0.62, 3.9, 0.0],
      [-9.2, -11.0, 0.6, 4.7, 0.0],
    ]
    const fernLimit = high ? fernSpots.length : Math.min(16, fernSpots.length)
    for (let i = 0; i < fernLimit; i++) {
      const [x, z, sc, r, dy] = fernSpots[i]
      pushItem(fernB, i, x, z, sc, r, dy)
    }

    // 3. Overflowing front wooden window boxes (wood rim top=0.815, soil top=0.825 -> plant at y=0.845..0.855)
    const wbBaseOffset = 0.845 - BASE_GROUND_Y
    for (const side of [-1, 1]) {
      for (let wi = 0; wi < 4; wi++) {
        const wx = side * 3.25 + (wi - 1.5) * 0.38
        pushItem(sorrelB, wi + (side > 0 ? 4 : 0), wx, 0.19, 0.21, wi * 1.4, wbBaseOffset)
        pushItem(
          flowerB,
          wi + (side > 0 ? 4 : 0),
          wx + (wi % 2 ? 0.05 : -0.05),
          0.22,
          0.24,
          wi * 2.1,
          wbBaseOffset + 0.008,
          0.16,
        )
        // Cascading blue-violet periwinkle blossoms draping gently over the front lip
        pushItem(
          periwinkleB,
          wi * 2 + (side > 0 ? 3 : 0),
          wx + (wi % 2 ? -0.06 : 0.06),
          0.27,
          0.26,
          wi * 0.9,
          wbBaseOffset - 0.004,
          0.34,
        )
      }
    }

    // 4. Right exterior terracotta plinth pots ([5.85, ..., -1.35 / -5.1 / -12.6])
    const rightPotSpots: Array<[number, number, number]> = [
      [5.85, -1.35, 0.485],
      [5.85, -5.1, 0.453],
      [5.85, -12.6, 0.501],
    ]
    rightPotSpots.forEach(([px, pz, pdy], idx) => {
      pushItem(periwinkleB, idx + 12, px, pz + 0.03, 0.22, idx * 1.9, pdy, 0.18)
      pushItem(flowerB, idx + 18, px - 0.02, pz - 0.02, 0.22, idx * 2.5, pdy)
      pushItem(fernB, idx + 22, px + 0.02, pz, 0.24, idx * 1.2, pdy)
    })

    // 5. Blue-violet periwinkle groundcover borders (gate piers, front porch steps, L-flowerbed)
    const periwinkleBorders: Array<[number, number, number, number, number]> = [
      [-1.72, 9.75, 0.28, 0.5, 0.0],
      [1.72, 9.75, 0.28, 2.2, 0.0],
      [-1.65, 1.55, 0.27, 1.1, 0.0],
      [1.65, 1.55, 0.27, 4.0, 0.0],
      [2.85, 3.6, 0.26, 0.9, 0.27],
      [3.65, 3.9, 0.29, 2.7, 0.27],
      [4.7, 3.65, 0.28, 1.5, 0.27],
      [5.75, 4.65, 0.3, 3.3, 0.27],
      [5.85, 6.0, 0.28, 0.4, 0.27],
      [5.78, 7.45, 0.29, 2.0, 0.27],
      [-4.9, 4.65, 0.26, 1.7, 0.04],
      [-6.05, 5.25, 0.28, 4.2, 0.04],
    ]
    for (let i = 0; i < periwinkleBorders.length; i++) {
      const [x, z, sc, r, dy] = periwinkleBorders[i]
      pushItem(periwinkleB, i + 20, x, z, sc, r, dy)
    }

    // 6. Wood sorrel broad-leaf clumps: border accents along walls & L-flowerbed soil
    const sorrelCount = high ? 54 : 36
    for (let i = 0; i < sorrelCount; i++) {
      const h1 = hash2d(i * 7 + 31)
      const h2 = hash2d(i * 11 + 43)
      const h3 = hash2d(i * 13 + 59)
      let x = 0
      let z = 0
      let dy = 0
      if (i < (high ? 20 : 14)) {
        if (i % 2 === 0) {
          x = 2.65 + h1 * 3.4
          z = 3.45 + h2 * 0.65
        } else {
          x = 5.52 + h1 * 0.68
          z = 3.55 + h2 * 4.6
        }
        dy = 0.27
      } else if (i < (high ? 36 : 25)) {
        if (i % 3 === 0) {
          x = 6.05 + h1 * 0.45
          z = -12.0 + h2 * 10.5
        } else {
          const side = i % 2 === 0 ? 1 : -1
          x = side * (1.8 + h1 * 4.8)
          z = 0.72 + h2 * 1.05
        }
      } else {
        const side = i % 2 === 0 ? 1 : -1
        x = side * (1.6 + h1 * 5.2)
        z = 8.4 + h2 * 1.4
      }
      if (Math.abs(x) < 1.3 && z > 0.2) continue
      pushItem(sorrelB, i, x, z, 0.16 + h3 * 0.11, h1 * Math.PI * 2, dy)
    }

    // 7. Golden celandine wildflowers dotted along stepping stones, flowerbed, and borders
    const flowerCount = high ? 84 : 52
    for (let i = 0; i < flowerCount; i++) {
      const h1 = hash2d(i * 17 + 71)
      const h2 = hash2d(i * 19 + 83)
      const h3 = hash2d(i * 23 + 97)
      let x = 0
      let z = 0
      let dy = 0
      if (i < (high ? 28 : 18)) {
        const side = i % 2 === 0 ? -1 : 1
        x = side * (0.86 + h1 * 0.82)
        z = 2.6 + h2 * 7.1
      } else if (i < (high ? 52 : 34)) {
        if (i % 2 === 0) {
          x = 2.7 + h1 * 3.35
          z = 3.45 + h2 * 0.65
        } else {
          x = 5.55 + h1 * 0.64
          z = 3.6 + h2 * 4.55
        }
        dy = 0.27
      } else if (i < (high ? 70 : 44)) {
        const side = i % 2 === 0 ? -1 : 1
        x = side * (1.8 + h1 * 4.5)
        z = 9.0 + h2 * 0.85
      } else {
        x = -6.8 + h1 * 4.8
        z = 11.4 + h2 * 3.2
      }
      pushItem(flowerB, i, x, z, 0.22 + h3 * 0.14, h2 * Math.PI * 2, dy)
    }

    // 8. Scanned meadow grass clumps (grass_medium_02) hugging walls, paths, stones & tree bases
    const clumpCount = high ? 132 : 92
    for (let i = 0; i < clumpCount; i++) {
      const h1 = hash2d(i * 31 + 101)
      const h2 = hash2d(i * 37 + 113)
      const h3 = hash2d(i * 41 + 127)
      let x = 0
      let z = 0
      let sc = 0.34 + h3 * 0.22
      const mode = i % 5
      if (mode === 0) {
        const side = i % 2 === 0 ? -1 : 1
        x = side * (0.8 + h1 * 0.55)
        z = 2.4 + h2 * 7.4
      } else if (mode === 1) {
        const side = i % 2 === 0 ? -1 : 1
        x = side * (7.05 + (h1 - 0.5) * 0.65)
        z = 2.2 + h2 * 7.8
      } else if (mode === 2) {
        const side = i % 2 === 0 ? -1 : 1
        x = side * (1.7 + h1 * 5.2)
        z = 9.65 + (h2 - 0.5) * 0.9
      } else if (mode === 3) {
        const side = i % 2 === 0 ? -1 : 1
        x = side * (6.1 + h1 * 0.65)
        z = -14.2 + h2 * 14.5
      } else {
        const treeAnchor = RING1_TREES[i % RING1_TREES.length]
        if (isInRestrictedCorridor(treeAnchor.x, treeAnchor.z)) continue
        const ang = h1 * Math.PI * 2
        const dist = 0.55 + h2 * 1.1
        x = treeAnchor.x + Math.cos(ang) * dist
        z = treeAnchor.z + Math.sin(ang) * dist
        sc = 0.44 + h3 * 0.26
      }
      if (Math.abs(x) < 0.72 && z >= 0.0 && z <= 10.4) continue
      pushItem(grassClumpB, i, x, z, sc, h1 * Math.PI * 2, -0.01)
    }

    return { rockB, fernB, flowerB, sorrelB, periwinkleB, grassClumpB }
  }, [
    pack.quality,
    rockVariants.length,
    fernVariants.length,
    flowerVariants.length,
    sorrelVariants.length,
    periwinkleVariants.length,
    grassClumpVariants.length,
  ])

  return (
    <group>
      {rockVariants.map((parts, idx) => (
        <InstancedMultiPart
          key={`rock-${idx}`}
          instanceKey={`${packToken}-rock-${idx}`}
          parts={parts}
          matrices={buckets.rockB[idx] ?? []}
          castShadow={false}
          receiveShadow
          skipAO
        />
      ))}
      {fernVariants.map((parts, idx) => (
        <InstancedMultiPart
          key={`fern-${idx}`}
          instanceKey={`${packToken}-fern-${idx}`}
          parts={parts}
          matrices={buckets.fernB[idx] ?? []}
          castShadow={false}
          receiveShadow
          skipAO
        />
      ))}
      {sorrelVariants.map((parts, idx) => (
        <InstancedMultiPart
          key={`sorrel-${idx}`}
          instanceKey={`${packToken}-sorrel-${idx}`}
          parts={parts}
          matrices={buckets.sorrelB[idx] ?? []}
          castShadow={false}
          receiveShadow
          skipAO
        />
      ))}
      {flowerVariants.map((parts, idx) => (
        <InstancedMultiPart
          key={`flower-${idx}`}
          instanceKey={`${packToken}-flower-${idx}`}
          parts={parts}
          matrices={buckets.flowerB[idx] ?? []}
          castShadow={false}
          receiveShadow
          skipAO
        />
      ))}
      {periwinkleVariants.map((parts, idx) => (
        <InstancedMultiPart
          key={`periwinkle-${idx}`}
          instanceKey={`${packToken}-periwinkle-${idx}`}
          parts={parts}
          matrices={buckets.periwinkleB[idx] ?? []}
          castShadow={false}
          receiveShadow
          skipAO
        />
      ))}
      {grassClumpVariants.map((parts, idx) => (
        <InstancedMultiPart
          key={`grass-clump-${idx}`}
          instanceKey={`${packToken}-grass-${idx}`}
          parts={parts}
          matrices={buckets.grassClumpB[idx] ?? []}
          castShadow={false}
          receiveShadow
          skipAO
        />
      ))}
    </group>
  )
}

function MeadowTurf({
  quality,
  reduced,
}: {
  quality: ResourcePack['quality']
  reduced: boolean
}) {
  const ref = useRef<InstancedMesh>(null)
  const windTime = useRef({ value: 0 })

  const geometry = useMemo(() => createTuftGeometry(), [])
  const material = useMemo(() => {
    const mat = new MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.88,
      metalness: 0,
      side: DoubleSide,
    })
    mat.customProgramCacheKey = () => 'meadow-tuft-wind-v2'
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windTime.current
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uWindTime;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float bladeLift = smoothstep(0.02, 0.22, position.y);
#ifdef USE_INSTANCING
  vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#else
  vec3 iPos = vec3(0.0);
#endif
float phase = uWindTime * 1.9 + iPos.x * 0.68 + iPos.z * 0.54;
transformed.x += sin(phase) * 0.038 * bladeLift;
transformed.z += cos(phase * 0.82 + 0.5) * 0.026 * bladeLift;`,
        )
    }
    return mat
  }, [])

  const { matrices, colors } = useMemo(() => {
    const target = quality === 'high' ? 720 : 420
    const mats: Matrix4[] = []
    const cols: Color[] = []
    const pos = new Vector3()
    const quat = new Quaternion()
    const scl = new Vector3()
    const yAxis = new Vector3(0, 1, 0)
    const fresh = new Color('#9eb065')
    const warm = new Color('#b5be70')
    const lush = new Color('#889f58')

    let seed = 101
    let attempts = 0
    while (mats.length < target && attempts < target * 4) {
      attempts++
      seed += 19
      const r1 = hash2d(seed)
      const r2 = hash2d(seed + 3)
      const r3 = hash2d(seed + 7)
      const r4 = hash2d(seed + 13)

      let x = 0
      let z = 0
      const mode = attempts % 4
      if (mode === 0) {
        const side = r1 < 0.5 ? -1 : 1
        x = side * (0.76 + r2 * 0.48)
        z = 2.3 + r3 * 7.6
      } else if (mode === 1) {
        x = (r1 * 2 - 1) * 7.15
        z = r2 < 0.5 ? 9.35 + r3 * 0.72 : 2.1 + r3 * 7.8
        if (r2 >= 0.5) x = (r1 < 0.5 ? -1 : 1) * (6.75 + r3 * 0.5)
      } else if (mode === 2) {
        x = (r1 * 2 - 1) * 6.5
        z = 2.5 + r2 * 7.2
      } else {
        const side = r1 < 0.5 ? -1 : 1
        x = side * (6.12 + r2 * 0.6)
        z = -14.8 + r3 * 16.0
      }

      if (x >= 2.45 && x <= 6.4 && z >= 3.25 && z <= 4.35) continue
      if (x >= 5.4 && x <= 6.4 && z >= 3.25 && z <= 8.5) continue
      if (x >= -5.9 && x <= 5.9 && z >= -15.5 && z <= 0.35) continue
      if (Math.abs(x) < 0.72 && z >= 0.0 && z <= 10.4) continue
      if (x >= -1.65 && x <= 1.65 && z <= 2.35) continue
      if (x >= -5.9 && x <= -4.1 && z >= 5.65 && z <= 6.55) continue
      if (x > 7.45 && z > 1.8) continue
      if (z > 10.15) continue

      const y = getTerrainHeight(x, z) - 0.012
      const sc = 0.76 + r3 * 0.54
      pos.set(x, y, z)
      quat.setFromAxisAngle(yAxis, r4 * Math.PI * 2)
      scl.set(sc, sc * (0.85 + r2 * 0.32), sc)
      mats.push(new Matrix4().compose(pos, quat, scl))

      const c = new Color().copy(fresh).lerp(warm, r1 * 0.55).lerp(lush, r3 * 0.4)
      cols.push(c)
    }

    return { matrices: mats, colors: cols }
  }, [quality])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i])
      mesh.setColorAt(i, colors[i])
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 0.25
  }, [matrices, colors])

  useFrame((_, dt) => {
    if (reduced) return
    windTime.current.value += Math.min(dt, 0.05)
  })

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  if (!matrices.length) return null

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, matrices.length]}
      castShadow={false}
      receiveShadow
      userData={{ skipAO: true }}
      raycast={() => null}
    />
  )
}

function PathBollardsGlow({
  lighting,
  meshesVisible = true,
}: {
  lighting: AtmosphereLighting
  meshesVisible?: boolean
}) {
  const glowTexture = useMemo(() => createGlowTexture(), [])
  const coreMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#f2ecdc',
        roughness: 0.25,
        metalness: 0,
        emissive: lighting.pathBollardColor,
        emissiveIntensity: lighting.pathBollardEmissive,
      }),
    [],
  )
  const spriteMaterial = useMemo(
    () =>
      new SpriteMaterial({
        map: glowTexture,
        color: lighting.pathBollardColor,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [glowTexture],
  )

  useEffect(() => {
    coreMaterial.emissive.set(lighting.pathBollardColor)
    coreMaterial.emissiveIntensity = lighting.pathBollardEmissive
    coreMaterial.color.set(lighting.pathBollardEmissive > 0 ? '#fff5dc' : '#eae4d4')
    spriteMaterial.color.set(lighting.pathBollardColor)
    spriteMaterial.opacity = Math.min(0.46, lighting.pathBollardEmissive * 0.26)
  }, [lighting.pathBollardColor, lighting.pathBollardEmissive, coreMaterial, spriteMaterial])

  useEffect(
    () => () => {
      glowTexture.dispose()
      coreMaterial.dispose()
      spriteMaterial.dispose()
    },
    [glowTexture, coreMaterial, spriteMaterial],
  )

  const lit = lighting.pathBollardEmissive > 0.02

  return (
    <group>
      <group visible={meshesVisible}>
        {/* 4 low pathway lanterns along the central stepping-stone walk */}
        {BOLLARD_SIDES.map((side) =>
          PATH_BOLLARD_Z.map((z) => (
            <group key={`path-${side}-${z}`} position={[side * 1.12, 0.155, z]} raycast={() => null}>
              <mesh material={coreMaterial} userData={{ skipAO: true }} raycast={() => null}>
                <boxGeometry args={[0.092, 0.1, 0.092]} />
              </mesh>
              {lit && (
                <sprite
                  material={spriteMaterial}
                  scale={[0.28, 0.28, 1]}
                  userData={{ skipAO: true }}
                  raycast={() => null}
                />
              )}
            </group>
          )),
        )}
        {/* 2 warm entry gate-pier lanterns sitting atop stone piers at z=10.1 */}
        {BOLLARD_SIDES.map((side) => (
          <group key={`pier-${side}`} position={[side * 1.32, 0.688, 10.1]} raycast={() => null}>
            <mesh material={coreMaterial} userData={{ skipAO: true }} raycast={() => null}>
              <boxGeometry args={[0.095, 0.11, 0.095]} />
            </mesh>
            {lit && (
              <sprite
                material={spriteMaterial}
                scale={[0.34, 0.34, 1]}
                userData={{ skipAO: true }}
                raycast={() => null}
              />
            )}
          </group>
        ))}
      </group>
      {/* Keep 4 pointLights mounted permanently so NUM_POINT_LIGHTS never triggers shader recompiles */}
      <pointLight
        position={[-1.15, 0.42, 5.7]}
        color={lighting.pathBollardColor}
        intensity={lighting.pathBollardLightIntensity}
        distance={6.8}
        decay={2}
      />
      <pointLight
        position={[1.15, 0.42, 5.7]}
        color={lighting.pathBollardColor}
        intensity={lighting.pathBollardLightIntensity}
        distance={6.8}
        decay={2}
      />
      <pointLight
        position={[-1.32, 0.92, 10.0]}
        color={lighting.pathBollardColor}
        intensity={lighting.pathBollardLightIntensity}
        distance={7.2}
        decay={2}
      />
      <pointLight
        position={[1.32, 0.92, 10.0]}
        color={lighting.pathBollardColor}
        intensity={lighting.pathBollardLightIntensity}
        distance={7.2}
        decay={2}
      />
    </group>
  )
}

export function ExteriorScenery({
  pack,
  materials,
  lighting,
  reduced,
  interiorHidden = false,
}: {
  pack: ResourcePack
  materials: Record<string, Material>
  lighting: AtmosphereLighting
  reduced: boolean
  interiorHidden?: boolean
}) {
  return (
    <group>
      <group visible={!interiorHidden}>
        <SculptedGround grassMaterial={materials.grass} quality={pack.quality} />
        <HorizonTransition lighting={lighting} />
        <PerimeterForestAndTrees pack={pack} />
        <PastureFences materials={materials} />
        <YardFoliageAndRocks pack={pack} />
        <MeadowTurf quality={pack.quality} reduced={reduced} />
      </group>
      <PathBollardsGlow lighting={lighting} meshesVisible={!interiorHidden} />
    </group>
  )
}
