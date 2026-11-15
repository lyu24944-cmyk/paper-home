import { isValidAtmosphereMode, isValidWeatherMode } from '../atmosphere'
import { rooms } from '../content'
import type { AtmosphereMode, FocusPoseId, Place, WeatherMode } from '../types/content'

export interface DeepLinkState {
  room: Place
  item: string | null
  at: AtmosphereMode | null
  weather: WeatherMode | null
  focus: FocusPoseId | null
  lamp: boolean | null
  isRich: boolean
}

const VALID_ROOMS = new Set<string>(rooms.map((r) => r.id))

export function isValidFocusForRoom(focus: unknown, room: Place): focus is FocusPoseId {
  if (focus === 'yard-bench') return room === 'yard'
  if (focus === 'study-shelf') return room === 'study'
  if (focus === 'blank-table') return room === 'blank'
  return false
}

function parseBoolParam(raw: string | null): boolean | null {
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  return null
}

/** Parse either plain `#room` or rich `#room=...&item=...&at=...&weather=...` hash state. */
export function parseDeepLinkHash(
  hash: string = typeof window !== 'undefined' ? window.location.hash : '',
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): DeepLinkState {
  const cleanHash = hash.replace(/^#/, '').trim()
  const searchParams = new URLSearchParams(search)
  const qAt = searchParams.get('at')
  const qWeather = searchParams.get('weather')

  if (VALID_ROOMS.has(cleanHash)) {
    return {
      room: cleanHash as Place,
      item: null,
      at: isValidAtmosphereMode(qAt) ? qAt : null,
      weather: isValidWeatherMode(qWeather) ? qWeather : null,
      focus: null,
      lamp: null,
      isRich: false,
    }
  }

  if (cleanHash.includes('=')) {
    const hp = new URLSearchParams(cleanHash)
    const rawRoom = hp.get('room')
    const room: Place = rawRoom && VALID_ROOMS.has(rawRoom) ? (rawRoom as Place) : 'yard'
    const rawItem = hp.get('item')?.trim() || null
    const rawAt = hp.get('at') ?? qAt
    const rawWeather = hp.get('weather') ?? qWeather
    const rawFocus = hp.get('focus')
    const rawLamp = hp.get('lamp')
    return {
      room,
      item: rawItem,
      at: isValidAtmosphereMode(rawAt) ? rawAt : null,
      weather: isValidWeatherMode(rawWeather) ? rawWeather : null,
      focus: isValidFocusForRoom(rawFocus, room) ? rawFocus : null,
      lamp: room === 'study' ? parseBoolParam(rawLamp) : null,
      isRich: true,
    }
  }

  return {
    room: 'yard',
    item: null,
    at: isValidAtmosphereMode(qAt) ? qAt : null,
    weather: isValidWeatherMode(qWeather) ? qWeather : null,
    focus: null,
    lamp: null,
    isRich: false,
  }
}

export interface BuildDeepLinkOptions {
  room: Place
  item?: string | null
  at?: AtmosphereMode
  weather?: WeatherMode
  focus?: FocusPoseId | null
  lamp?: boolean
}

/** Build a shareable deep-link hash fragment reflecting the exact room, work item, and atmosphere. */
export function buildDeepLinkHash(opts: BuildDeepLinkOptions): string {
  const params = new URLSearchParams()
  params.set('room', opts.room)
  if (opts.item && opts.item.trim()) {
    params.set('item', opts.item.trim())
  }
  if (opts.at && opts.at !== 'daylight') {
    params.set('at', opts.at)
  } else if (opts.at === 'daylight') {
    params.set('at', 'daylight')
  }
  if (opts.weather === 'rain') {
    params.set('weather', 'rain')
  }
  if (opts.focus && isValidFocusForRoom(opts.focus, opts.room)) {
    params.set('focus', opts.focus)
  }
  if (opts.room === 'study' && typeof opts.lamp === 'boolean') {
    params.set('lamp', opts.lamp ? '1' : '0')
  }
  return `#${params.toString()}`
}

/** Build a clean full share URL for clipboard copying and postcard QR embedding. */
export function buildDeepLinkUrl(opts: BuildDeepLinkOptions): string {
  const hash = buildDeepLinkHash(opts)
  if (typeof window === 'undefined') return hash
  const sp = new URLSearchParams(window.location.search)
  sp.delete('qa')
  sp.delete('gpu')
  const qs = sp.toString()
  return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}${hash}`
}
