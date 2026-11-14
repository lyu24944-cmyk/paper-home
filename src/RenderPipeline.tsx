import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { HalfFloatType, Mesh, Object3D, PerspectiveCamera, Texture, WebGLRenderTarget } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'
import type { TransitionState } from './layout'
import type { Quality } from './resources'
import { performanceEvents, qaEnabled, recordEvent } from './diagnostics'

export function RenderPipeline({quality,transition,prepare,onPreparing,onReady}:{quality:Quality;transition:React.MutableRefObject<TransitionState|null>;prepare:React.MutableRefObject<(()=>Promise<void>)|null>;onPreparing:(message:string)=>void;onReady:()=>void}){
  const {gl,scene,camera,size,viewport}=useThree(),recording=useRef(false),frames=useRef<number[]>([]),previous=useRef(0),diagnosticAt=useRef(0),warmed=useRef(false)
  const pipeline=useMemo(()=>{
    const target=new WebGLRenderTarget(1,1,{type:HalfFloatType,samples:0}),composer=new EffectComposer(gl,target)
    composer.addPass(new RenderPass(scene,camera))
    const ao=new GTAOPass(scene,camera,1,1)
    ao.updateGtaoMaterial({radius:.3,thickness:.45,distanceExponent:2,distanceFallOff:1,scale:1,samples:quality==='high'?6:4,screenSpaceRadius:false})
    ao.updatePdMaterial({samples:quality==='high'?6:4,radius:4,rings:2})
    ao.blendIntensity=.55
    const setSize=ao.setSize.bind(ao),ratio=quality==='high'?.4:.33
    ao.setSize=(w:number,h:number)=>setSize(Math.max(1,Math.ceil(w*ratio)),Math.max(1,Math.ceil(h*ratio)))
    // Clear glazing must not become an opaque wall in the AO normal/depth buffer.
    const renderAO=ao.render.bind(ao)
    ao.render=(renderer,write,read,delta,mask)=>{
      const hidden:Object3D[]=[]
      scene.traverseVisible(object=>{
        if(object.userData.skipAO){object.visible=false;hidden.push(object);return}
        if(object instanceof Mesh){const materials=Array.isArray(object.material)?object.material:[object.material]
          if(materials.every(m=>m.transparent&&!m.depthWrite)){object.visible=false;hidden.push(object)}
        }
      })
      try{renderAO(renderer,write,read,delta,mask)}finally{hidden.forEach(o=>{o.visible=true})}
    }
    composer.addPass(ao)
    const fxaa=new ShaderPass(FXAAShader);composer.addPass(fxaa);composer.addPass(new OutputPass())
    const context=gl.getContext() as WebGL2RenderingContext,timer=qaEnabled&&new URLSearchParams(location.search).has('gpu')?context.getExtension('EXT_disjoint_timer_query_webgl2'):null
    const gpu:Record<string,number[]>={},pending:{query:WebGLQuery;name:string}[]=[]
    if(timer)composer.passes.forEach((pass,index)=>{const render=pass.render.bind(pass),name=['scene','ambient-occlusion','FXAA','output'][index];let count=0;gpu[name]=[]
      pass.render=(...args)=>{const query=++count%8===0&&pending.length<12?context.createQuery():null
        if(query)context.beginQuery(timer.TIME_ELAPSED_EXT,query)
        try{render(...args)}finally{if(query){context.endQuery(timer.TIME_ELAPSED_EXT);pending.push({query,name})}}
      }
    })
    const pollGPU=()=>{if(!timer)return;for(let i=pending.length-1;i>=0;i--){const {query,name}=pending[i];if(context.getQueryParameter(query,context.QUERY_RESULT_AVAILABLE)){if(!context.getParameter(timer.GPU_DISJOINT_EXT)){gpu[name].push(context.getQueryParameter(query,context.QUERY_RESULT)/1e6);if(gpu[name].length>240)gpu[name].shift()}context.deleteQuery(query);pending.splice(i,1)}}}
    return {composer,ao,target,fxaa,gpu,pollGPU}
  },[quality,gl,scene,camera])
  useEffect(()=>{const start=performance.now();pipeline.composer.setPixelRatio(viewport.dpr);pipeline.composer.setSize(size.width,size.height);pipeline.fxaa.uniforms.resolution.value.set(1/(size.width*viewport.dpr),1/(size.height*viewport.dpr));recordEvent('render-target-resize',performance.now()-start,`${size.width}x${size.height}@${viewport.dpr}`)},[pipeline,size.width,size.height,viewport.dpr])
  useEffect(()=>{
    let mounted=true
    warmed.current=false
    gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=true
    // All room geometry and light types persist. Upload once behind the loading state.
    const warm=(async()=>{
      const stage=async(message:string)=>{if(mounted)onPreparing(message);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))}
      await stage('正在整理门窗与家具…')
      if(!mounted)return
      const start=performance.now(),textures=new Set<Texture>()
      scene.traverse(object=>{if(object instanceof Mesh){const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials)for(const value of Object.values(material))if(value instanceof Texture)textures.add(value)}})
      textures.forEach(texture=>gl.initTexture(texture));recordEvent('texture-upload',performance.now()-start,`${textures.size} textures`)
      await stage('正在准备室内光线…')
      if(!mounted)return
      const compileStart=performance.now();await gl.compileAsync(scene,camera);recordEvent('shader-compile',performance.now()-compileStart)
      await stage('正在布置房间与庭院…')
      if(!mounted)return
      // Upload even geometry behind the camera and in hidden rooms, including deep links.
      const states:{object:Object3D;visible:boolean;frustumCulled:boolean}[]=[]
      scene.traverse(object=>{states.push({object,visible:object.visible,frustumCulled:object.frustumCulled});object.visible=true;object.frustumCulled=false})
      gl.shadowMap.needsUpdate=true
      try{pipeline.composer.render(0)}finally{states.forEach(({object,visible,frustumCulled})=>{object.visible=visible;object.frustumCulled=frustumCulled})}
      warmed.current=true;recordEvent('initial-render-warmup',performance.now()-start)
    })()
    prepare.current=()=>warm
    void warm.then(()=>{if(mounted)onReady()})
    return()=>{mounted=false;prepare.current=null;pipeline.composer.passes.forEach(p=>p.dispose());pipeline.composer.dispose()}
  },[pipeline])
  useFrame((_,dt)=>{
    if(!warmed.current){gl.setClearColor('#cbdde2',1);gl.clear();return}
    const start=performance.now(),shadowUpdate=gl.shadowMap.needsUpdate;gl.info.autoReset=false;gl.info.reset()
    pipeline.composer.render(Math.min(dt,.1))
    const renderCPUms=performance.now()-start
    pipeline.pollGPU()
    if(shadowUpdate)recordEvent('shadow-refresh',renderCPUms)
    if(qaEnabled){
      const w=window as unknown as {__HOME_QA__:Record<string,unknown>}
      if(!w.__HOME_QA__)w.__HOME_QA__={}
      const api=w.__HOME_QA__
      if(!api.start){api.start=()=>{frames.current=[];recording.current=true;previous.current=0;recordEvent('measurement-start')};api.stop=()=>{
        recording.current=false;const f=frames.current.slice().sort((a,b)=>a-b),sum=f.reduce((a,b)=>a+b,0),percentile=(p:number)=>f[Math.max(0,Math.ceil(f.length*p)-1)]??null
        return {samples:f.length,durationMs:sum,averageFPS:sum?f.length/(sum/1000):0,p50ms:percentile(.5),p95ms:percentile(.95),p99ms:percentile(.99),maxMs:f.at(-1)??null,minimumFPS:1000/(f.at(-1)||1),over33ms:f.filter(v=>v>1000/30).length,over50ms:f.filter(v=>v>50).length,over100ms:f.filter(v=>v>100).length,events:performanceEvents.slice()}
      }}
      Object.assign(api,{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:(camera as PerspectiveCamera).fov,dpr:gl.getPixelRatio(),width:gl.domElement.width,height:gl.domElement.height,calls:gl.info.render.calls,passTriangles:gl.info.render.triangles,transition:transition.current,renderCPUms,programs:gl.info.programs?.length,gpu:pipeline.gpu})
      if(start-diagnosticAt.current>250){diagnosticAt.current=start;let triangles=0,objects=0
        scene.traverseVisible(o=>{if(o instanceof Mesh){const g=o.geometry;if(g){triangles+=(g.index?g.index.count:g.getAttribute('position')?.count||0)/3*('count'in o?Number(o.count):1);objects++}}})
        const context=gl.getContext(),debug=context.getExtension('WEBGL_debug_renderer_info')
        Object.assign(api,{sceneTriangles:triangles,objects,renderer:debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):context.getParameter(context.RENDERER)})
      }
      if(recording.current){if(previous.current)frames.current.push(start-previous.current);previous.current=start}
    }
  },1)
  return null
}
