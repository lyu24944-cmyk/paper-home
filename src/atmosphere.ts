import type { AtmosphereMode, AtmospherePreset, WeatherMode } from './types/content'

export interface AtmosphereOption {
  id: AtmosphereMode
  label: string
  shortLabel: string
  eyebrow: string
  footerText: string
  icon: string
}

export const ATMOSPHERE_OPTIONS: AtmosphereOption[] = [
  {
    id: 'dawn',
    label: '晨雾',
    shortLabel: '晨',
    eyebrow: '晨雾庭院',
    footerText: '门外，晨雾微凉',
    icon: 'dawn',
  },
  {
    id: 'daylight',
    label: '晴昼',
    shortLabel: '昼',
    eyebrow: '晴日庭院',
    footerText: '门外，是个晴天',
    icon: 'sun',
  },
  {
    id: 'golden',
    label: '落日',
    shortLabel: '夕',
    eyebrow: '夕照庭院',
    footerText: '门外，晚霞正暖',
    icon: 'sunset',
  },
  {
    id: 'night',
    label: '夜灯',
    shortLabel: '夜',
    eyebrow: '夜灯庭院',
    footerText: '门外，夜灯亮着',
    icon: 'moon',
  },
  {
    id: 'auto',
    label: '随时间',
    shortLabel: '时',
    eyebrow: '四时庭院',
    footerText: '门外，天色随时间流转',
    icon: 'clock',
  },
]

export function isValidAtmosphereMode(value: unknown): value is AtmosphereMode {
  return value === 'dawn' || value === 'daylight' || value === 'golden' || value === 'night' || value === 'auto'
}

export function isValidWeatherMode(value: unknown): value is WeatherMode {
  return value === 'clear' || value === 'rain'
}

export function resolveAtmospherePreset(mode: AtmosphereMode, date = new Date()): AtmospherePreset {
  if (mode !== 'auto') return mode
  const hour = date.getHours()
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 17) return 'daylight'
  if (hour >= 17 && hour < 20) return 'golden'
  return 'night'
}

export interface AtmosphereLighting {
  preset: AtmospherePreset
  weather: WeatherMode
  clearColor: string
  fogColor: string
  fogNear: number
  fogFar: number
  backgroundIntensity: number
  environmentIntensity: number
  hemiSkyColor: string
  hemiGroundColor: string
  hemiIntensity: number
  sunPosition: [number, number, number]
  sunColor: string
  sunIntensity: number
  ambientColor: string
  ambientIntensity: number
  hallPointColor: string
  hallPointIntensity: number
  windowRectColor: string
  windowRectIntensity: number
  porchLanternColor: string
  porchLanternIntensity: number
  roomWarmFillIntensity: number
  deskLampRecommended: boolean
  glassOpacity: number
  glassEnvIntensity: number
}

const BASE_PRESETS: Record<AtmospherePreset, Omit<AtmosphereLighting, 'preset' | 'weather'>> = {
  dawn: {
    clearColor: '#cfdce0',
    fogColor: '#cfdce0',
    fogNear: 28,
    fogFar: 78,
    backgroundIntensity: 0.52,
    environmentIntensity: 0.28,
    hemiSkyColor: '#d8e6ee',
    hemiGroundColor: '#63695c',
    hemiIntensity: 0.36,
    sunPosition: [-12, 6.8, 10],
    sunColor: '#ffe5c4',
    sunIntensity: 1.95,
    ambientColor: '#dce8f0',
    ambientIntensity: 0.08,
    hallPointColor: '#ffeacc',
    hallPointIntensity: 2.7,
    windowRectColor: '#d9e8ff',
    windowRectIntensity: 2.8,
    porchLanternColor: '#ffd296',
    porchLanternIntensity: 1.5,
    roomWarmFillIntensity: 0.95,
    deskLampRecommended: false,
    glassOpacity: 0.16,
    glassEnvIntensity: 0.85,
  },
  daylight: {
    // Exact baseline match with original World.tsx constants
    clearColor: '#cbdde2',
    fogColor: '#cbdde2',
    fogNear: 55,
    fogFar: 110,
    backgroundIntensity: 0.8,
    environmentIntensity: 0.4,
    hemiSkyColor: '#e8f1f4',
    hemiGroundColor: '#777761',
    hemiIntensity: 0.32,
    sunPosition: [-8, 13, 9],
    sunColor: '#fff3dd',
    sunIntensity: 3.3,
    ambientColor: '#ffffff',
    ambientIntensity: 0.06,
    hallPointColor: '#fff4dd',
    hallPointIntensity: 2.4,
    windowRectColor: '#e5eeff',
    windowRectIntensity: 3.8,
    porchLanternColor: '#ffcf8b',
    porchLanternIntensity: 0,
    roomWarmFillIntensity: 0,
    deskLampRecommended: false,
    glassOpacity: 0.14,
    glassEnvIntensity: 0.8,
  },
  golden: {
    clearColor: '#e3c7ab',
    fogColor: '#dfbfa2',
    fogNear: 38,
    fogFar: 92,
    backgroundIntensity: 0.62,
    environmentIntensity: 0.34,
    hemiSkyColor: '#ffd9b3',
    hemiGroundColor: '#695848',
    hemiIntensity: 0.34,
    sunPosition: [-14, 5.2, 8.5],
    sunColor: '#ffbe7b',
    sunIntensity: 3.1,
    ambientColor: '#ffe0c2',
    ambientIntensity: 0.07,
    hallPointColor: '#ffe6bd',
    hallPointIntensity: 2.9,
    windowRectColor: '#ffdfb8',
    windowRectIntensity: 3.1,
    porchLanternColor: '#ffc980',
    porchLanternIntensity: 2.4,
    roomWarmFillIntensity: 1.45,
    deskLampRecommended: true,
    glassOpacity: 0.17,
    glassEnvIntensity: 0.95,
  },
  night: {
    clearColor: '#1b2530',
    fogColor: '#1b2530',
    fogNear: 24,
    fogFar: 70,
    backgroundIntensity: 0.11,
    environmentIntensity: 0.12,
    hemiSkyColor: '#48627a',
    hemiGroundColor: '#242b28',
    hemiIntensity: 0.25,
    sunPosition: [9, 14, -8],
    sunColor: '#8eb4d9',
    sunIntensity: 0.68,
    ambientColor: '#6f89a6',
    ambientIntensity: 0.05,
    hallPointColor: '#ffdfa8',
    hallPointIntensity: 3.8,
    windowRectColor: '#ffcf8c',
    windowRectIntensity: 2.6,
    porchLanternColor: '#ffca7a',
    porchLanternIntensity: 4.2,
    roomWarmFillIntensity: 2.75,
    deskLampRecommended: true,
    glassOpacity: 0.21,
    glassEnvIntensity: 1.08,
  },
}

export function getAtmosphereLighting(
  preset: AtmospherePreset,
  weather: WeatherMode = 'clear',
): AtmosphereLighting {
  const base = BASE_PRESETS[preset] ?? BASE_PRESETS.daylight
  if (weather !== 'rain') {
    return {
      preset,
      weather,
      ...base,
    }
  }
  const isNight = preset === 'night'
  return {
    preset,
    weather,
    ...base,
    fogColor: isNight ? '#17212b' : preset === 'golden' ? '#b8aba1' : '#b7c7cc',
    clearColor: isNight ? '#17212b' : preset === 'golden' ? '#b8aba1' : '#b7c7cc',
    fogNear: Math.round(base.fogNear * 0.72),
    fogFar: Math.round(base.fogFar * 0.78),
    backgroundIntensity: Number((base.backgroundIntensity * 0.72).toFixed(2)),
    environmentIntensity: Number((base.environmentIntensity * 0.82).toFixed(2)),
    sunIntensity: Number((base.sunIntensity * 0.62).toFixed(2)),
    porchLanternIntensity: Math.max(2.2, base.porchLanternIntensity),
    roomWarmFillIntensity: Math.max(1.5, base.roomWarmFillIntensity),
    deskLampRecommended: true,
    glassOpacity: Math.min(0.24, base.glassOpacity + 0.03),
  }
}

export const DEFAULT_STUDY_QUOTES: string[] = [
  '“一座好房子不是用来仰望的纪念碑，而是让人愿意坐下来听雨、翻书、慢慢呼吸的容器。”',
  '“纸张的温润与三维空间的景深并不矛盾——删掉多余的炫技，留白处才有风吹过。”',
  '“先让自己在本地舒服地写完第一篇手记，再决定要不要把钥匙交给云端。”',
  '“窗户如果是假的贴图，房子就是封闭的盒子；当视线能穿过 6 毫米玻璃看见书桌上的台灯，家才有了内外。”',
]

export const DEFAULT_NOW_NOTES: string[] = [
  '打磨四时天色与雨夜窗景',
  '在读《建筑的模式语言》',
  '收集慢节奏的独立小工具',
]
