import sharp from 'sharp'

export async function leafSources(doc) {
  const sources = []
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial()
      if (!material?.getName().toLowerCase().includes('leaves')) continue
      const p = primitive.getAttribute('POSITION'), uv = primitive.getAttribute('TEXCOORD_0')
      const positions = new Float32Array(p.getCount() * 3), uvs = new Float32Array(p.getCount() * 2)
      const matrix = node.getWorldMatrix(), v = [], t = []
      for (let i = 0; i < p.getCount(); i++) {
        p.getElement(i, v); const [x, y, z] = v
        const w = [matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12], matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13], matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14]]
        for (let k = 0; k < 3; k++) { positions[i*3+k] = w[k]; min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]) }
        if (uv) { uv.getElement(i, t); uvs[i*2] = t[0]; uvs[i*2+1] = t[1] }
      }
      const texture = material.getBaseColorTexture()
      const image = texture?.getImage()
      const decoded = image ? await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : null
      const idx = primitive.getIndices()
      sources.push({ primitive, positions, uvs, indices: idx ? idx.getArray() : Uint32Array.from({length:p.getCount()},(_,i)=>i),
        directional: material.getExtras().clusterCards === true,
        pixels: decoded?.data, width: decoded?.info.width ?? 1, height: decoded?.info.height ?? 1,
        factor: material.getBaseColorFactor(), cutoff: material.getAlphaMode() === 'MASK' ? material.getAlphaCutoff() : 0.01 })
    }
  }
  return { sources, min, max }
}

export function projectedBounds(min, max, right, up) {
  const low = [Infinity, Infinity], high = [-Infinity, -Infinity]
  for (const x of [min[0],max[0]]) for (const y of [min[1],max[1]]) for (const z of [min[2],max[2]]) {
    const v = [x,y,z]
    for (const [k, axis] of [right,up].entries()) { const n=v.reduce((s,c,i)=>s+c*axis[i],0);low[k]=Math.min(low[k],n);high[k]=Math.max(high[k],n) }
  }
  return { low, high }
}

// Orthographic CPU rasterizer: deterministic offline baking and geometric mask tests.
export function rasterTriangle(source, triangle, right, up, view, bounds, size, pixel) {
  const ids = [0,1,2].map(k=>source.indices[triangle*3+k])
  if(source.directional){
    const a=source.positions.subarray(ids[0]*3,ids[0]*3+3),b=source.positions.subarray(ids[1]*3,ids[1]*3+3),c=source.positions.subarray(ids[2]*3,ids[2]*3+3)
    const u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n)
    const facing=Math.abs(n.reduce((s,x,k)=>s+x*view[k],0))/len
    const best=Math.max(Math.abs(view[0]),Math.abs(view[1]),Math.abs(view[2]),Math.abs((view[0]+view[2])*Math.SQRT1_2),Math.abs((view[0]-view[2])*Math.SQRT1_2))
    if(facing<best-.001)return
  }
  const xy = [], depth = []
  for (const id of ids) {
    const v=source.positions.subarray(id*3,id*3+3)
    const dot=a=>v[0]*a[0]+v[1]*a[1]+v[2]*a[2]
    xy.push([(dot(right)-bounds.low[0])/(bounds.high[0]-bounds.low[0])*size, (1-(dot(up)-bounds.low[1])/(bounds.high[1]-bounds.low[1]))*size])
    depth.push(dot(view))
  }
  const [[ax,ay],[bx,by],[cx,cy]]=xy
  const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
  if (Math.abs(den)<1e-10) return
  const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(size-1,Math.ceil(Math.max(ax,bx,cx)))
  const y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(size-1,Math.ceil(Math.max(ay,by,cy)))
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const a=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den
    const b=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den,c=1-a-b
    if(a<0||b<0||c<0)continue
    const u=a*source.uvs[ids[0]*2]+b*source.uvs[ids[1]*2]+c*source.uvs[ids[2]*2]
    const v=a*source.uvs[ids[0]*2+1]+b*source.uvs[ids[1]*2+1]+c*source.uvs[ids[2]*2+1]
    const tx=Math.min(source.width-1,Math.max(0,Math.floor(u*source.width))),ty=Math.min(source.height-1,Math.max(0,Math.floor(v*source.height)))
    const at=(ty*source.width+tx)*4,p=source.pixels
    const alpha=(p?p[at+3]/255:1)*source.factor[3]
    if(alpha<source.cutoff)continue
    pixel(x,y,a*depth[0]+b*depth[1]+c*depth[2],p? [p[at]*source.factor[0],p[at+1]*source.factor[1],p[at+2]*source.factor[2],alpha*255]:[85,112,51,255])
  }
}

export function leafMask(data, angle, reference = data, size = 256) {
  const right=[Math.cos(angle),0,-Math.sin(angle)],up=[0,1,0],view=[Math.sin(angle),0,Math.cos(angle)]
  const bounds=projectedBounds(reference.min,reference.max,right,up)
  for(let k=0;k<2;k++){const pad=(bounds.high[k]-bounds.low[k])*.025;bounds.low[k]-=pad;bounds.high[k]+=pad}
  const mask=new Uint8Array(size*size)
  for(const source of data.sources)for(let t=0;t<source.indices.length/3;t++)rasterTriangle(source,t,right,up,view,bounds,size,(x,y)=>{mask[y*size+x]=1})
  return mask
}

export function maskIoU(a,b) {
  let intersection=0,union=0
  for(let i=0;i<a.length;i++){if(a[i]&&b[i])intersection++;if(a[i]||b[i])union++}
  return union?intersection/union:1
}
