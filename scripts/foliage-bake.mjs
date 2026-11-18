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
  const maxSide=level==='high'?2048:1024
  const desiredTile=tileSize??(level==='high'?40:32)
  const rawCount=Math.max(1,buckets.size*axes.length)
  const tile=Math.max(8,Math.min(desiredTile,Math.floor(maxSide/Math.ceil(Math.sqrt(rawCount)))))
  const padding=tile<32?1:2,inner=tile-padding*2
  const canopyCenter=data.min.map((v,k)=>(v+data.max[k])*0.5)
  const alphaThreshold=Math.round(0.36*255)
  const cards=[]
  for(const bucket of buckets.values()){
    const middle=bucket.min.map((x,k)=>(x+bucket.max[k])/2)
    let distSq=0
    for(let k=0;k<3;k++){const d=middle[k]-canopyCenter[k];distSq+=d*d}
    for(const {right,up,view}of axes){
      const bounds=projectedBounds(bucket.min,bucket.max,right,up)
      if(bounds.high.some((x,k)=>x-bounds.low[k]<1e-6))continue
      const depth=new Float32Array(inner*inner).fill(-Infinity),pixels=Buffer.alloc(inner*inner*4)
      for(const [si,t]of bucket.triangles)rasterTriangle(data.sources[si],t,right,up,view,bounds,inner,(x,y,z,color)=>{
        const i=y*inner+x;if(z<depth[i])return;depth[i]=z
        for(let k=0;k<4;k++)pixels[i*4+k]=Math.round(color[k])
      })
      let pxMin=inner,pxMax=-1,pyMin=inner,pyMax=-1
      for(let py=0;py<inner;py++){
        for(let px=0;px<inner;px++){
          if(pixels[(py*inner+px)*4+3]>=alphaThreshold){
            if(px<pxMin)pxMin=px
            if(px>pxMax)pxMax=px
            if(py<pyMin)pyMin=py
            if(py>pyMax)pyMax=py
          }
        }
      }
      if(pxMax<pxMin)continue
      const x0=Math.max(0,pxMin-1),x1=Math.min(inner,pxMax+2)
      const y0=Math.max(0,pyMin-1),y1=Math.min(inner,pyMax+2)
      cards.push({pixels,bounds,middle,right,up,view,x0,x1,y0,y1,distSq})
    }
  }
  cards.sort((a,b)=>b.distSq-a.distSq)
  const cardCount=Math.max(1,cards.length)
  const side=Math.min(maxSide,2**Math.ceil(Math.log2(Math.ceil(Math.sqrt(cardCount))*tile)))
  const columns=Math.floor(side/tile)
  const atlas=Buffer.alloc(side*side*4),positions=[],normals=[],uvs=[],indices=[]
  for(let card=0;card<cards.length;card++){
    const {pixels,bounds,middle,right,up,view,x0,x1,y0,y1}=cards[card]
    const col=card%columns,row=Math.floor(card/columns)
    for(let y=0;y<inner;y++)pixels.copy(atlas,((row*tile+padding+y)*side+col*tile+padding)*4,y*inner*4,(y+1)*inner*4)
    const z=middle.reduce((s,x,k)=>s+x*view[k],0)
    const spanX=bounds.high[0]-bounds.low[0],spanY=bounds.high[1]-bounds.low[1]
    const wx0=bounds.low[0]+(x0/inner)*spanX,wx1=bounds.low[0]+(x1/inner)*spanX
    const wy0=bounds.low[1]+(1-y1/inner)*spanY,wy1=bounds.low[1]+(1-y0/inner)*spanY
    const first=positions.length/3
    for(const [sx,sy]of [[0,0],[1,0],[1,1],[0,1]]){
      const wx=sx?wx1:wx0,wy=sy?wy1:wy0
      for(let k=0;k<3;k++){positions.push(right[k]*wx+up[k]*wy+view[k]*z);normals.push(view[k])}
      uvs.push((col*tile+padding+(sx?x1:x0))/side,(row*tile+padding+(sy?y0:y1))/side)
    }
    indices.push(first,first+1,first+2,first,first+2,first+3)
  }
  // RGB bleed into transparent texels avoids black mip fringes without growing the alpha mask.
  const original=Buffer.from(atlas)
  for(let y=1;y<side-1;y++)for(let x=1;x<side-1;x++){
    const at=(y*side+x)*4;if(original[at+3])continue
    for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){const n=((y+dy)*side+x+dx)*4;if(original[n+3]){atlas[at]=original[n];atlas[at+1]=original[n+1];atlas[at+2]=original[n+2];break}}
  }
  const image=await sharp(atlas,{raw:{width:side,height:side,channels:4}}).webp({nearLossless:true,quality:80}).toBuffer()
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
  return { clusters:buckets.size,cards:cards.length,triangles:indices.length/3,atlasSize:side,tile }
  }
  attach.triangles = indices.length/3
  return attach
}
