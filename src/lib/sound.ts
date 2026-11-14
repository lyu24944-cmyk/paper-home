import { qaEnabled } from '../diagnostics'

export type SoundEffectId =
  | 'door-knock'
  | 'door-open'
  | 'door-close'
  | 'step'
  | 'lamp-on'
  | 'lamp-off'
  | 'paper-flip'
  | 'paper-card'
  | 'ink-stamp'
  | 'mailbox'
  | 'bench'
  | 'ceramics'
  | 'foliage'
  | 'atmo-dawn'
  | 'atmo-daylight'
  | 'atmo-golden'
  | 'atmo-night'
  | 'atmo-auto'
  | 'rain-on'
  | 'rain-off'
  | 'map-unfold'
  | 'drawer-slide'
  | 'shutter'
  | 'modal-close'
  | 'success-seal'
  | 'ambient-on'
  | 'ambient-off'
  | 'ui-tap'
  | 'ui-switch'

const VALID_SOUNDS = new Set<string>([
  'door-knock',
  'door-open',
  'door-close',
  'step',
  'lamp-on',
  'lamp-off',
  'paper-flip',
  'paper-card',
  'ink-stamp',
  'mailbox',
  'bench',
  'ceramics',
  'foliage',
  'atmo-dawn',
  'atmo-daylight',
  'atmo-golden',
  'atmo-night',
  'atmo-auto',
  'rain-on',
  'rain-off',
  'map-unfold',
  'drawer-slide',
  'shutter',
  'modal-close',
  'success-seal',
  'ambient-on',
  'ambient-off',
  'ui-tap',
  'ui-switch',
])

const SFX_STORAGE_KEY = 'paper-home:sfx'

interface NoiseBank {
  white: AudioBuffer
  pink: AudioBuffer
  paper: AudioBuffer
}

interface EngineState {
  ctx: AudioContext
  bus: GainNode
  spaceFilter: BiquadFilterNode
  buffers: NoiseBank
}

let engine: EngineState | null = null
let acousticSpace: 'yard' | 'indoor' = 'yard'
let sfxEnabled = (() => {
  try {
    return localStorage.getItem(SFX_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
})()

let lastExplicitSoundAt = 0
let activeClickEvent: Event | null = null
const handledClickEvents = new WeakSet<Event>()
let contextCreateCount = 0

function syncQaAudioMetrics(id: SoundEffectId) {
  if (!qaEnabled) return
  const w = window as unknown as {
    __HOME_QA__?: Record<string, unknown> & { soundEvents?: { id: string; at: number }[] }
  }
  if (!w.__HOME_QA__) w.__HOME_QA__ = {}
  const events = (w.__HOME_QA__.soundEvents as { id: string; at: number }[] | undefined) ?? []
  events.push({ id, at: Math.round(performance.now()) })
  if (events.length > 80) events.shift()
  Object.assign(w.__HOME_QA__, {
    sfxEnabled,
    lastSound: id,
    soundCount: (Number(w.__HOME_QA__.soundCount) || 0) + 1,
    audioContextCount: contextCreateCount,
    soundEvents: events,
  })
}

function buildNoiseBank(ctx: AudioContext): NoiseBank {
  const mk = (seconds: number, fill: (idx: number, prev: number) => [number, number]) => {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const ch = buf.getChannelData(0)
    let state = 0
    for (let i = 0; i < len; i++) {
      const [val, nextState] = fill(i, state)
      ch[i] = val
      state = nextState
    }
    return buf
  }

  const white = mk(0.14, () => [Math.random() * 2 - 1, 0])
  const pink = mk(0.24, (_, prev) => {
    const w = Math.random() * 2 - 1
    const next = prev * 0.94 + w * 0.06
    return [next * 3.8, next]
  })
  const paper = mk(0.22, (i, prev) => {
    const w = Math.random() * 2 - 1
    const env = Math.sin(Math.min(1, i / (ctx.sampleRate * 0.22)) * Math.PI)
    const rough = w * 0.72 + (i % 7 === 0 ? w * 0.6 : 0)
    const next = prev * 0.4 + rough * 0.6
    return [next * (0.55 + env * 0.45), next]
  })

  return { white, pink, paper }
}

function ensureEngine(): EngineState | null {
  if (typeof window === 'undefined') return null
  if (!engine) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    contextCreateCount += 1

    const spaceFilter = ctx.createBiquadFilter()
    spaceFilter.type = 'lowpass'
    spaceFilter.frequency.value = acousticSpace === 'indoor' ? 4200 : 16000
    spaceFilter.Q.value = 0.5

    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 18
    comp.ratio.value = 6
    comp.attack.value = 0.002
    comp.release.value = 0.12

    const bus = ctx.createGain()
    bus.gain.value = 0.88

    bus.connect(spaceFilter)
    spaceFilter.connect(comp)
    comp.connect(ctx.destination)

    engine = {
      ctx,
      bus,
      spaceFilter,
      buffers: buildNoiseBank(ctx),
    }
  }

  if (engine.ctx.state === 'suspended') {
    void engine.ctx.resume().catch(() => {})
  }
  return engine
}

/** Pitch & gain micro-jitter keeps consecutive clicks organic and non-fatiguing. */
function jitter(base: number, pct = 0.04): number {
  return base * (1 + (Math.random() * 2 - 1) * pct)
}

function playTone(
  st: EngineState,
  opts: {
    type?: OscillatorType
    freq: number
    endFreq?: number
    gain: number
    delay?: number
    attack?: number
    duration: number
  },
) {
  const { ctx, bus } = st
  const t = ctx.currentTime + (opts.delay ?? 0)
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(Math.max(20, opts.freq), t)
  if (opts.endFreq && opts.endFreq !== opts.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), t + opts.duration * 0.9)
  }
  const atk = opts.attack ?? 0.003
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(opts.gain, t + atk)
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration)
  osc.connect(g)
  g.connect(bus)
  osc.start(t)
  osc.stop(t + opts.duration + 0.015)
}

function playNoiseBurst(
  st: EngineState,
  bufKey: keyof NoiseBank,
  opts: {
    filterType: BiquadFilterType
    freq: number
    endFreq?: number
    q?: number
    gain: number
    delay?: number
    attack?: number
    duration: number
    rate?: number
  },
) {
  const { ctx, bus, buffers } = st
  const t = ctx.currentTime + (opts.delay ?? 0)
  const src = ctx.createBufferSource()
  src.buffer = buffers[bufKey]
  if (opts.rate) src.playbackRate.value = opts.rate

  const filter = ctx.createBiquadFilter()
  filter.type = opts.filterType
  filter.frequency.setValueAtTime(opts.freq, t)
  if (opts.endFreq) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.endFreq), t + opts.duration)
  }
  if (opts.q !== undefined) filter.Q.value = opts.q

  const g = ctx.createGain()
  const atk = opts.attack ?? 0.004
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(opts.gain, t + atk)
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration)

  src.connect(filter)
  filter.connect(g)
  g.connect(bus)
  src.start(t)
  src.stop(t + Math.min(opts.duration + 0.02, src.buffer.duration))
}

function synthesize(st: EngineState, id: SoundEffectId) {
  switch (id) {
    case 'door-knock':
      // Two gentle oak door knocks
      for (const offset of [0, 0.12]) {
        playTone(st, {
          type: 'triangle',
          freq: jitter(offset === 0 ? 132 : 122, 0.03),
          endFreq: 66,
          gain: offset === 0 ? 0.14 : 0.11,
          delay: offset,
          attack: 0.002,
          duration: 0.085,
        })
        playNoiseBurst(st, 'pink', {
          filterType: 'bandpass',
          freq: 760,
          q: 2.2,
          gain: offset === 0 ? 0.055 : 0.042,
          delay: offset,
          attack: 0.001,
          duration: 0.032,
        })
      }
      break

    case 'door-open':
      // Brass latch release + soft wood hinge sweep
      playTone(st, {
        type: 'triangle',
        freq: jitter(1420),
        endFreq: 760,
        gain: 0.04,
        attack: 0.001,
        duration: 0.028,
      })
      playNoiseBurst(st, 'pink', {
        filterType: 'bandpass',
        freq: 340,
        endFreq: 190,
        q: 1.5,
        gain: 0.06,
        delay: 0.04,
        attack: 0.015,
        duration: 0.18,
      })
      playTone(st, {
        type: 'sine',
        freq: jitter(110),
        endFreq: 78,
        gain: 0.06,
        delay: 0.04,
        duration: 0.11,
      })
      break

    case 'door-close':
      // Wood frame thud + gentle latch click
      playTone(st, {
        type: 'sine',
        freq: jitter(128),
        endFreq: 58,
        gain: 0.1,
        duration: 0.095,
      })
      playTone(st, {
        type: 'triangle',
        freq: jitter(1120),
        endFreq: 620,
        gain: 0.03,
        delay: 0.02,
        duration: 0.024,
      })
      break

    case 'step':
      // Soft parquet wood footstep
      playTone(st, {
        type: 'sine',
        freq: jitter(102, 0.06),
        endFreq: 54,
        gain: jitter(0.055, 0.08),
        duration: 0.058,
      })
      playNoiseBurst(st, 'pink', {
        filterType: 'lowpass',
        freq: 520,
        gain: 0.022,
        duration: 0.03,
      })
      break

    case 'lamp-on':
      // Crisp brass pull-chain click with warm harmonic tail
      playTone(st, {
        type: 'triangle',
        freq: jitter(1780),
        endFreq: 1120,
        gain: 0.048,
        duration: 0.026,
      })
      playTone(st, {
        type: 'sine',
        freq: 880,
        endFreq: 1320,
        gain: 0.032,
        delay: 0.015,
        duration: 0.06,
      })
      break

    case 'lamp-off':
      playTone(st, {
        type: 'triangle',
        freq: jitter(1240),
        endFreq: 580,
        gain: 0.045,
        duration: 0.028,
      })
      playNoiseBurst(st, 'white', {
        filterType: 'bandpass',
        freq: 1900,
        q: 2.5,
        gain: 0.025,
        duration: 0.018,
      })
      break

    case 'paper-flip':
      // Textured cotton paper sweep + warm body tap
      playNoiseBurst(st, 'paper', {
        filterType: 'bandpass',
        freq: jitter(1850),
        endFreq: 2750,
        q: 0.9,
        gain: 0.052,
        attack: 0.008,
        duration: 0.13,
      })
      playTone(st, {
        type: 'sine',
        freq: jitter(420),
        endFreq: 590,
        gain: 0.022,
        delay: 0.012,
        duration: 0.08,
      })
      break

    case 'paper-card':
      // Lighter index-card slide
      playNoiseBurst(st, 'paper', {
        filterType: 'bandpass',
        freq: jitter(2200),
        endFreq: 1650,
        q: 1.1,
        gain: 0.038,
        duration: 0.075,
      })
      playTone(st, {
        type: 'triangle',
        freq: jitter(520),
        endFreq: 440,
        gain: 0.018,
        duration: 0.045,
      })
      break

    case 'ink-stamp':
      // Heavy woodblock thump + soft pad release
      playTone(st, {
        type: 'sine',
        freq: jitter(175),
        endFreq: 56,
        gain: 0.14,
        attack: 0.002,
        duration: 0.1,
      })
      playNoiseBurst(st, 'pink', {
        filterType: 'bandpass',
        freq: 920,
        endFreq: 460,
        q: 1.6,
        gain: 0.045,
        duration: 0.055,
      })
      break

    case 'mailbox':
      // Tin lid clink + hollow wooden post resonance
      playTone(st, {
        type: 'triangle',
        freq: jitter(960),
        endFreq: 690,
        gain: 0.05,
        duration: 0.065,
      })
      playTone(st, {
        type: 'sine',
        freq: jitter(240),
        endFreq: 165,
        gain: 0.07,
        delay: 0.015,
        duration: 0.085,
      })
      break

    case 'bench':
      // Warm oak creak settle
      playTone(st, {
        type: 'sine',
        freq: jitter(280),
        endFreq: 210,
        gain: 0.048,
        duration: 0.11,
      })
      playNoiseBurst(st, 'pink', {
        filterType: 'bandpass',
        freq: 520,
        q: 3.2,
        gain: 0.025,
        duration: 0.08,
      })
      break

    case 'ceramics':
      // Terracotta pot crisp dual-overtone ring
      playTone(st, {
        type: 'sine',
        freq: jitter(810, 0.03),
        endFreq: 790,
        gain: 0.065,
        duration: 0.13,
      })
      playTone(st, {
        type: 'triangle',
        freq: jitter(1340, 0.03),
        endFreq: 1315,
        gain: 0.028,
        duration: 0.075,
      })
      break

    case 'foliage':
      // Breezy leaf rustle
      playNoiseBurst(st, 'paper', {
        filterType: 'highpass',
        freq: 2100,
        gain: 0.03,
        attack: 0.012,
        duration: 0.14,
      })
      break

    case 'atmo-dawn':
      playTone(st, { type: 'sine', freq: 659.25, gain: 0.035, duration: 0.18 })
      playTone(st, { type: 'sine', freq: 880, gain: 0.026, delay: 0.04, duration: 0.2 })
      break

    case 'atmo-daylight':
      playTone(st, { type: 'sine', freq: 523.25, gain: 0.035, duration: 0.15 })
      playTone(st, { type: 'sine', freq: 783.99, gain: 0.028, delay: 0.035, duration: 0.18 })
      break

    case 'atmo-golden':
      playTone(st, { type: 'triangle', freq: 440, gain: 0.036, duration: 0.18 })
      playTone(st, { type: 'sine', freq: 554.37, gain: 0.028, delay: 0.04, duration: 0.2 })
      break

    case 'atmo-night':
      playTone(st, { type: 'triangle', freq: 293.66, gain: 0.045, duration: 0.22 })
      playTone(st, { type: 'sine', freq: 440, gain: 0.03, delay: 0.05, duration: 0.24 })
      break

    case 'atmo-auto':
      playTone(st, { type: 'sine', freq: 587.33, gain: 0.032, duration: 0.12 })
      playTone(st, { type: 'sine', freq: 880, gain: 0.025, delay: 0.055, duration: 0.14 })
      break

    case 'rain-on':
      // Ascending water droplet plink
      playTone(st, {
        type: 'sine',
        freq: jitter(620),
        endFreq: 1180,
        gain: 0.048,
        duration: 0.09,
      })
      playNoiseBurst(st, 'pink', {
        filterType: 'highpass',
        freq: 1900,
        gain: 0.022,
        delay: 0.015,
        duration: 0.12,
      })
      break

    case 'rain-off':
      playTone(st, {
        type: 'sine',
        freq: 760,
        endFreq: 460,
        gain: 0.035,
        duration: 0.075,
      })
      break

    case 'map-unfold':
      playNoiseBurst(st, 'paper', {
        filterType: 'bandpass',
        freq: 1450,
        endFreq: 2400,
        q: 0.8,
        gain: 0.06,
        attack: 0.01,
        duration: 0.17,
      })
      playTone(st, {
        type: 'triangle',
        freq: 310,
        endFreq: 465,
        gain: 0.025,
        duration: 0.085,
      })
      break

    case 'drawer-slide':
      playNoiseBurst(st, 'pink', {
        filterType: 'bandpass',
        freq: 620,
        endFreq: 380,
        q: 1.2,
        gain: 0.045,
        duration: 0.11,
      })
      playTone(st, {
        type: 'sine',
        freq: jitter(165),
        endFreq: 95,
        gain: 0.055,
        delay: 0.035,
        duration: 0.065,
      })
      break

    case 'shutter':
      // Tactile film camera leaf click
      playNoiseBurst(st, 'white', {
        filterType: 'bandpass',
        freq: 3100,
        endFreq: 1600,
        q: 1.8,
        gain: 0.045,
        duration: 0.024,
      })
      playTone(st, {
        type: 'triangle',
        freq: jitter(1280),
        endFreq: 520,
        gain: 0.038,
        duration: 0.025,
      })
      break

    case 'modal-close':
      playTone(st, {
        type: 'sine',
        freq: jitter(260),
        endFreq: 135,
        gain: 0.042,
        duration: 0.065,
      })
      playNoiseBurst(st, 'paper', {
        filterType: 'lowpass',
        freq: 1400,
        gain: 0.022,
        duration: 0.055,
      })
      break

    case 'success-seal':
      playTone(st, { type: 'sine', freq: 523.25, gain: 0.038, duration: 0.12 })
      playTone(st, { type: 'sine', freq: 783.99, gain: 0.042, delay: 0.065, duration: 0.19 })
      break

    case 'ambient-on':
      playTone(st, { type: 'sine', freq: 392.0, gain: 0.032, attack: 0.015, duration: 0.24 })
      playTone(st, { type: 'sine', freq: 587.33, gain: 0.026, delay: 0.04, attack: 0.015, duration: 0.26 })
      break

    case 'ambient-off':
      playTone(st, { type: 'sine', freq: 440, endFreq: 293.66, gain: 0.028, duration: 0.14 })
      break

    case 'ui-switch':
      playTone(st, {
        type: 'triangle',
        freq: jitter(880),
        endFreq: 640,
        gain: 0.028,
        duration: 0.024,
      })
      break

    case 'ui-tap':
    default:
      // Ultra-light walnut & paper micro-tap (~18ms)
      playTone(st, {
        type: 'triangle',
        freq: jitter(410, 0.05),
        endFreq: jitter(220, 0.05),
        gain: jitter(0.026, 0.08),
        attack: 0.0015,
        duration: 0.022,
      })
      playNoiseBurst(st, 'paper', {
        filterType: 'bandpass',
        freq: jitter(1950),
        q: 1.4,
        gain: 0.016,
        duration: 0.018,
      })
      break
  }
}

export function isSfxEnabled(): boolean {
  return sfxEnabled
}

export function setSfxEnabled(enabled: boolean): void {
  sfxEnabled = enabled
  try {
    localStorage.setItem(SFX_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Ignore storage restriction
  }
  if (qaEnabled) {
    const w = window as unknown as { __HOME_QA__?: Record<string, unknown> }
    if (!w.__HOME_QA__) w.__HOME_QA__ = {}
    w.__HOME_QA__.sfxEnabled = enabled
  }
}

export function setAcousticSpace(space: 'yard' | 'indoor'): void {
  acousticSpace = space
  if (engine) {
    const targetFreq = space === 'indoor' ? 4200 : 16000
    engine.spaceFilter.frequency.setTargetAtTime(targetFreq, engine.ctx.currentTime, 0.08)
  }
}

export function markSoundHandled(): void {
  lastExplicitSoundAt = performance.now()
  if (activeClickEvent !== null) {
    handledClickEvents.add(activeClickEvent)
  }
}

export function playSound(id: SoundEffectId, opts?: { force?: boolean }): void {
  markSoundHandled()
  if (!sfxEnabled && !opts?.force) return
  try {
    const st = ensureEngine()
    syncQaAudioMetrics(id)
    if (!st) return
    synthesize(st, id)
  } catch {
    syncQaAudioMetrics(id)
  }
}

function resolveDelegatedSound(el: Element): SoundEffectId | 'none' {
  const host = el.closest('[data-sound]')
  if (host) {
    const raw = host.getAttribute('data-sound')
    if (raw === 'none') return 'none'
    if (raw && VALID_SOUNDS.has(raw)) return raw as SoundEffectId
  }
  if (el.matches('a[href]')) return 'paper-card'
  if (el.matches('select, input[type="checkbox"], input[type="radio"], [role="radio"], [role="switch"]')) {
    return 'ui-switch'
  }
  if (el.classList.contains('dialog-close')) return 'modal-close'
  return 'ui-tap'
}

const CLICKABLE_SELECTOR = [
  'button:not(:disabled)',
  'a[href]',
  'summary',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  'select:not(:disabled)',
  'input[type="checkbox"]:not(:disabled)',
  'input[type="radio"]:not(:disabled)',
  'label:has(input[type="file"])',
].join(', ')

export function installGlobalClickSoundDelegator(): () => void {
  const onClickCapture = (e: MouseEvent) => {
    activeClickEvent = e
    handledClickEvents.delete(e)
  }

  const onClick = (e: MouseEvent) => {
    const handledThisEvent = handledClickEvents.has(e)
    if (activeClickEvent === e) {
      activeClickEvent = null
    }
    if (!sfxEnabled) return
    if (handledThisEvent || performance.now() - lastExplicitSoundAt < 45) return
    const target = e.target
    if (!(target instanceof Element)) return
    const control = target.closest(CLICKABLE_SELECTOR)
    if (!control) return
    if (control instanceof HTMLButtonElement && control.disabled) return
    if (control.getAttribute('aria-disabled') === 'true') return

    const soundId = resolveDelegatedSound(control)
    if (soundId === 'none') return
    playSound(soundId)
  }

  document.addEventListener('click', onClickCapture, true)
  document.addEventListener('click', onClick, false)
  return () => {
    document.removeEventListener('click', onClickCapture, true)
    document.removeEventListener('click', onClick, false)
    activeClickEvent = null
  }
}
