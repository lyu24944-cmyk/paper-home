import sharp from 'sharp'
import { leafSources, projectedBounds, rasterTriangle } from './tree-raster.mjs'

/** Keep every source leaf in an offline spatial bake; runtime uses bounded cluster cards. */
export async function bakeFoliage(doc, triangleBudget, level, tileSize) {
  const data = await leafSources(doc)
  const limit = Math.floor(triangleBudget / 10)
  const centroids=data.sources.map(source=>{
    const centers=new Float32Array(source.indices.length)
    for(let t=0;t<source.indices.length/3;t++)for(let k=0;k<3;k++)centers[t*3+k]=(source.positions[source.indices[t*3]*3+k]+source.positions[source.indices[t*3+1]*3+k]+source.positions[source.indices[t*3+2]*3+k])/3
    return centers
  })
  const keyFor=(center,t,g)=>{
    let key=0
    for(let k=0;k<3;k++)key=key*g+Math.min(g-1,Math.max(0,Math.floor((center[t*3+k]-data.min[k])/(data.max[k]-data.min[k])*g)))
    return key
  }
  let grid=1
  for(let candidate=Math.max(1,Math.floor(Math.cbrt(limit)));candidate<=64;candidate++){
    const occupied=new Set()
    for(const centers of centroids)for(let t=0;t<centers.length/3;t++)occupied.add(keyFor(centers,t,candidate))
    if(occupied.size>limit)break
    grid=candidate
  }
  const buckets = new Map()
  for (let si=0;si<data.sources.length;si++) {
    const source=data.sources[si],p=source.positions,idx=source.indices
    for(let t=0;t<idx.length/3;t++) {
      const key=keyFor(centroids[si],t,grid)
      if(!buckets.has(key))buckets.set(key,{ triangles:[],min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity] })
      const bucket=buckets.get(key);bucket.triangles.push([si,t])
      for(let j=0;j<3;j++)for(let k=0;k<3;k++) { const value=p[idx[t*3+j]*3+k];bucket.min[k]=Math.min(bucket.min[k],value);bucket.max[k]=Math.max(bucket.max[k],value) }
    }
  }
  const q=Math.SQRT1_2
  const axes=[{right:[1,0,0],up:[0,1,0],view:[0,0,1]}, {right:[0,0,-1],up:[0,1,0],view:[1,0,0]},
    {right:[q,0,-q],up:[0,1,0],view:[q,0,q]}, {right:[q,0,q],up:[0,1,0],view:[-q,0,q]},
    {right:[1,0,0],up:[0,0,-1],view:[0,1,0]}]
  const tile=tileSize??(level==='high'?40:32),padding=2,inner=tile-padding*2,count=buckets.size*axes.length
  const side=2**Math.ceil(Math.log2(Math.ceil(Math.sqrt(count))*tile)),columns=Math.floor(side/tile)
  const atlas=Buffer.alloc(side*side*4),positions=[],normals=[],uvs=[],indices=[]
  let card=0
  for(const bucket of buckets.values())for(const {right,up,view}of axes) {
    const bounds=projectedBounds(bucket.min,bucket.max,right,up)
    if(bounds.high.some((x,k)=>x-bounds.low[k]<1e-6))continue
    const depth=new Float32Array(inner*inner).fill(-Infinity),pixels=Buffer.alloc(inner*inner*4)
    for(const [si,t]of bucket.triangles)rasterTriangle(data.sources[si],t,right,up,view,bounds,inner,(x,y,z,color)=>{
      const i=y*inner+x;if(z<depth[i])return;depth[i]=z
      for(let k=0;k<4;k++)pixels[i*4+k]=Math.round(color[k])
    })
    const col=card%columns,row=Math.floor(card/columns)
    for(let y=0;y<inner;y++)pixels.copy(atlas,((row*tile+padding+y)*side+col*tile+padding)*4,y*inner*4,(y+1)*inner*4)
    const middle=bucket.min.map((x,k)=>(x+bucket.max[k])/2),z=middle.reduce((s,x,k)=>s+x*view[k],0)
    const first=positions.length/3
    for(const [sx,sy]of [[0,0],[1,0],[1,1],[0,1]]){
      const x=bounds[sx?'high':'low'][0],y=bounds[sy?'high':'low'][1]
      for(let k=0;k<3;k++){positions.push(right[k]*x+up[k]*y+view[k]*z);normals.push(view[k])}
      uvs.push((col*tile+padding+sx*inner)/side,(row*tile+padding+(1-sy)*inner)/side)
    }
    indices.push(first,first+1,first+2,first,first+2,first+3);card++
  }
  // RGB bleed into transparent texels avoids black mip fringes without growing the alpha mask.
  const original=Buffer.from(atlas)
  for(let y=1;y<side-1;y++)for(let x=1;x<side-1;x++){
    const at=(y*side+x)*4;if(original[at+3])continue
    for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){const n=((y+dy)*side+x+dx)*4;if(original[n+3]){atlas[at]=original[n];atlas[at+1]=original[n+1];atlas[at+2]=original[n+2];break}}
  }
  const image=await sharp(atlas,{raw:{width:side,height:side,channels:4}}).webp({lossless:true}).toBuffer()
  for(const source of data.sources)source.primitive.detach()
  // Attach only after trunk/branch simplification: those transforms prune empty meshes.
  const attach = () => {
  const buffer=doc.getRoot().listBuffers()[0]??doc.createBuffer()
  const attr=(name,type,array)=>doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer)
  const texture=doc.createTexture('foliage-atlas').setURI('foliage-atlas.webp').setImage(image).setMimeType('image/webp')
  const material=doc.createMaterial('baked_leaves').setExtras({clusterCards:true}).setBaseColorTexture(texture).setAlphaMode('MASK').setAlphaCutoff(.36).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(.95)
  const primitive=doc.createPrimitive().setAttribute('POSITION',attr('foliage-position','VEC3',new Float32Array(positions)))
    .setAttribute('NORMAL',attr('foliage-normal','VEC3',new Float32Array(normals)))
    .setAttribute('TEXCOORD_0',attr('foliage-uv','VEC2',new Float32Array(uvs)))
    .setIndices(attr('foliage-index','SCALAR',new Uint32Array(indices))).setMaterial(material)
  const node=doc.createNode('baked-leaf-clusters').setMesh(doc.createMesh('baked-leaf-clusters').addPrimitive(primitive))
  doc.getRoot().getDefaultScene().addChild(node)
  return { clusters:buckets.size,triangles:indices.length/3,atlasSize:side }
  }
  attach.triangles = indices.length/3
  return attach
}
