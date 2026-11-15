import { useEffect, useRef } from 'react'
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

type PipelineBundle = {
  composer: EffectComposer
  fxaa: ShaderPass
  gpu: Record<string, number[]>
  pollGPU: () => void
}

export function RenderPipeline({
  quality,
  clearColor = '#cbdde2',
  transition,
  prepare,
  capture,
  onPreparing,
  onReady,
}: {
  quality: Quality
  clearColor?: string
  transition: React.MutableRefObject<TransitionState | null>
  prepare: React.MutableRefObject<(() => Promise<void>) | null>
  capture?: React.MutableRefObject<(() => string | null) | null>
  onPreparing: (message: string) => void
  onReady: () => void
}) {
  const { gl, scene, camera, size, viewport } = useThree()
  const recording = useRef(false)
  const frames = useRef<number[]>([])
  const previous = useRef(0)
  const diagnosticAt = useRef(0)
  const warmed = useRef(false)
  const pipelineRef = useRef<PipelineBundle | null>(null)
  const sizeRef = useRef(size)
  const dprRef = useRef(viewport.dpr)
  const clearColorRef = useRef(clearColor)
  const onPreparingRef = useRef(onPreparing)
  const onReadyRef = useRef(onReady)
  const appliedDprRef = useRef(gl.getPixelRatio())

  sizeRef.current = size
  dprRef.current = viewport.dpr
  clearColorRef.current = clearColor
  onPreparingRef.current = onPreparing
  onReadyRef.current = onReady

  useEffect(() => {
    const initialWidth = Math.max(1, sizeRef.current.width)
    const initialHeight = Math.max(1, sizeRef.current.height)
    const initialDpr = Math.max(1, dprRef.current)
    const target = new WebGLRenderTarget(
      Math.max(1, Math.round(initialWidth * initialDpr)),
      Math.max(1, Math.round(initialHeight * initialDpr)),
      { type: HalfFloatType, samples: 0 },
    )
    const composer = new EffectComposer(gl, target)
    composer.addPass(new RenderPass(scene, camera))
    const ao = new GTAOPass(scene, camera, initialWidth, initialHeight)
    ao.updateGtaoMaterial({
      radius: 0.3,
      thickness: 0.45,
      distanceExponent: 2,
      distanceFallOff: 1,
      scale: 1,
      samples: quality === 'high' ? 6 : 4,
      screenSpaceRadius: false,
    })
    ao.updatePdMaterial({ samples: quality === 'high' ? 6 : 4, radius: 4, rings: 2 })
    ao.blendIntensity = 0.55
    const setAoSize = ao.setSize.bind(ao)
    const ratio = quality === 'high' ? 0.4 : 0.33
    ao.setSize = (w: number, h: number) =>
      setAoSize(Math.max(1, Math.ceil(w * ratio)), Math.max(1, Math.ceil(h * ratio)))
    // Clear glazing must not become an opaque wall in the AO normal/depth buffer.
    const renderAO = ao.render.bind(ao)
    ao.render = (renderer, write, read, delta, mask) => {
      const hidden: Object3D[] = []
      scene.traverseVisible((object) => {
        if (object.userData.skipAO) {
          object.visible = false
          hidden.push(object)
          return
        }
        if (object instanceof Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          if (materials.every((m) => m.transparent && !m.depthWrite)) {
            object.visible = false
            hidden.push(object)
          }
        }
      })
      try {
        renderAO(renderer, write, read, delta, mask)
      } finally {
        hidden.forEach((o) => {
          o.visible = true
        })
      }
    }
    composer.addPass(ao)
    // Tone mapping + linear-to-sRGB must run before FXAA, which expects sRGB luma input.
    composer.addPass(new OutputPass())
    const fxaa = new ShaderPass(FXAAShader)
    composer.addPass(fxaa)

    const context = gl.getContext() as WebGL2RenderingContext
    const timer =
      qaEnabled && new URLSearchParams(location.search).has('gpu')
        ? context.getExtension('EXT_disjoint_timer_query_webgl2')
        : null
    const gpu: Record<string, number[]> = {}
    const pending: { query: WebGLQuery; name: string }[] = []
    if (timer) {
      composer.passes.forEach((pass, index) => {
        const render = pass.render.bind(pass)
        const name = ['scene', 'ambient-occlusion', 'output', 'FXAA'][index] ?? `pass-${index}`
        let count = 0
        gpu[name] = []
        pass.render = (...args) => {
          const query = ++count % 8 === 0 && pending.length < 12 ? context.createQuery() : null
          if (query) context.beginQuery(timer.TIME_ELAPSED_EXT, query)
          try {
            render(...args)
          } finally {
            if (query) {
              context.endQuery(timer.TIME_ELAPSED_EXT)
              pending.push({ query, name })
            }
          }
        }
      })
    }
    const pollGPU = () => {
      if (!timer) return
      for (let i = pending.length - 1; i >= 0; i--) {
        const { query, name } = pending[i]
        if (context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)) {
          if (!context.getParameter(timer.GPU_DISJOINT_EXT)) {
            gpu[name].push(context.getQueryParameter(query, context.QUERY_RESULT) / 1e6)
            if (gpu[name].length > 240) gpu[name].shift()
          }
          context.deleteQuery(query)
          pending.splice(i, 1)
        }
      }
    }

    appliedDprRef.current = gl.getPixelRatio()
    if (Math.abs(appliedDprRef.current - initialDpr) > 1e-4) {
      composer.setPixelRatio(initialDpr)
      appliedDprRef.current = initialDpr
    }
    composer.setSize(initialWidth, initialHeight)
    fxaa.uniforms.resolution.value.set(
      1 / Math.max(1, initialWidth * initialDpr),
      1 / Math.max(1, initialHeight * initialDpr),
    )

    const bundle: PipelineBundle = { composer, fxaa, gpu, pollGPU }
    pipelineRef.current = bundle

    let mounted = true
    warmed.current = false
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    // All room geometry and light types persist. Upload once behind the loading state.
    const warm = (async () => {
      try {
        const stage = async (message: string) => {
          if (mounted) onPreparingRef.current(message)
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          )
        }
        await stage('正在整理门窗与家具…')
        if (!mounted) return
        const start = performance.now()
        const textures = new Set<Texture>()
        scene.traverse((object) => {
          if (object instanceof Mesh) {
            const materials = Array.isArray(object.material) ? object.material : [object.material]
            for (const material of materials) {
              for (const value of Object.values(material)) {
                if (value instanceof Texture) textures.add(value)
              }
            }
          }
        })
        textures.forEach((texture) => gl.initTexture(texture))
        recordEvent('texture-upload', performance.now() - start, `${textures.size} textures`)
        await stage('正在准备室内光线…')
        if (!mounted) return
        const compileStart = performance.now()
        await gl.compileAsync(scene, camera)
        recordEvent('shader-compile', performance.now() - compileStart)
        await stage('正在布置房间与庭院…')
        if (!mounted) return
        // Upload even geometry behind the camera and in hidden rooms, including deep links.
        const states: { object: Object3D; visible: boolean; frustumCulled: boolean }[] = []
        scene.traverse((object) => {
          states.push({ object, visible: object.visible, frustumCulled: object.frustumCulled })
          object.visible = true
          object.frustumCulled = false
        })
        gl.shadowMap.needsUpdate = true
        try {
          composer.render(0)
        } finally {
          states.forEach(({ object, visible, frustumCulled }) => {
            object.visible = visible
            object.frustumCulled = frustumCulled
          })
        }
        warmed.current = true
        recordEvent('initial-render-warmup', performance.now() - start)
      } catch (err) {
        console.error('[RenderPipeline] warmup failed:', err)
        warmed.current = true
      } finally {
        if (mounted) onReadyRef.current()
      }
    })()
    prepare.current = () => warm
    return () => {
      mounted = false
      prepare.current = null
      pipelineRef.current = null
      if (timer) {
        for (const item of pending) context.deleteQuery(item.query)
        pending.length = 0
      }
      composer.passes.forEach((p) => p.dispose())
      composer.dispose()
    }
  }, [quality, gl, scene, camera, prepare])

  useEffect(() => {
    const pipeline = pipelineRef.current
    if (!pipeline) return
    const start = performance.now()
    if (Math.abs(appliedDprRef.current - viewport.dpr) > 1e-4) {
      pipeline.composer.setPixelRatio(viewport.dpr)
      appliedDprRef.current = viewport.dpr
    }
    pipeline.composer.setSize(size.width, size.height)
    pipeline.fxaa.uniforms.resolution.value.set(
      1 / Math.max(1, size.width * viewport.dpr),
      1 / Math.max(1, size.height * viewport.dpr),
    )
    recordEvent(
      'render-target-resize',
      performance.now() - start,
      `${size.width}x${size.height}@${viewport.dpr}`,
    )
  }, [quality, gl, scene, camera, size.width, size.height, viewport.dpr])

  useEffect(() => {
    if (!capture) return
    capture.current = () => {
      const pipeline = pipelineRef.current
      if (!warmed.current || !pipeline) return null
      pipeline.composer.render(0)
      return gl.domElement.toDataURL('image/png')
    }
    return () => {
      capture.current = null
    }
  }, [capture, gl])

  useFrame((_, dt) => {
    const pipeline = pipelineRef.current
    if (!warmed.current || !pipeline) {
      gl.setClearColor(clearColorRef.current, 1)
      gl.clear()
      return
    }
    const start = performance.now()
    const shadowUpdate = gl.shadowMap.needsUpdate
    const prevAutoReset = gl.info.autoReset
    gl.info.autoReset = false
    gl.info.reset()
    try {
      pipeline.composer.render(Math.min(dt, 0.1))
    } finally {
      gl.info.autoReset = prevAutoReset
    }
    const renderCPUms = performance.now() - start
    pipeline.pollGPU()
    if (shadowUpdate) recordEvent('shadow-refresh', renderCPUms)
    if (qaEnabled) {
      const w = window as unknown as { __HOME_QA__: Record<string, unknown> }
      if (!w.__HOME_QA__) w.__HOME_QA__ = {}
      const api = w.__HOME_QA__
      if (!api.start) {
        api.start = () => {
          frames.current = []
          recording.current = true
          previous.current = 0
          recordEvent('measurement-start')
        }
        api.stop = () => {
          recording.current = false
          const f = frames.current.slice().sort((a, b) => a - b)
          const sum = f.reduce((a, b) => a + b, 0)
          const percentile = (p: number) => f[Math.max(0, Math.ceil(f.length * p) - 1)] ?? null
          return {
            samples: f.length,
            durationMs: sum,
            averageFPS: sum ? f.length / (sum / 1000) : 0,
            p50ms: percentile(0.5),
            p95ms: percentile(0.95),
            p99ms: percentile(0.99),
            maxMs: f.at(-1) ?? null,
            minimumFPS: 1000 / (f.at(-1) || 1),
            over33ms: f.filter((v) => v > 1000 / 30).length,
            over50ms: f.filter((v) => v > 50).length,
            over100ms: f.filter((v) => v > 100).length,
            events: performanceEvents.slice(),
          }
        }
      }
      Object.assign(api, {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        fov: (camera as PerspectiveCamera).fov,
        dpr: gl.getPixelRatio(),
        width: gl.domElement.width,
        height: gl.domElement.height,
        calls: gl.info.render.calls,
        passTriangles: gl.info.render.triangles,
        transition: transition.current,
        renderCPUms,
        programs: gl.info.programs?.length,
        gpu: pipeline.gpu,
      })
      if (start - diagnosticAt.current > 250) {
        diagnosticAt.current = start
        let triangles = 0
        let objects = 0
        scene.traverseVisible((o) => {
          if (o instanceof Mesh) {
            const g = o.geometry
            if (g) {
              triangles +=
                ((g.index ? g.index.count : g.getAttribute('position')?.count || 0) / 3) *
                ('count' in o ? Number(o.count) : 1)
              objects++
            }
          }
        })
        const context = gl.getContext()
        const debug = context.getExtension('WEBGL_debug_renderer_info')
        const galleryGroup = scene.getObjectByName('gallery-papers')
        Object.assign(api, {
          sceneTriangles: triangles,
          objects,
          galleryPaperXs: galleryGroup
            ? galleryGroup.children.map((c) => Number(c.position.x.toFixed(3)))
            : [],
          renderer: debug
            ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : context.getParameter(context.RENDERER),
        })
      }
      if (recording.current) {
        if (previous.current) frames.current.push(start - previous.current)
        previous.current = start
      }
    }
  }, 1)
  return null
}
