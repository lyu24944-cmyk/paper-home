import type { Quality } from '../resources'

export const QUALITY_STORAGE_KEY = 'paper-home:quality'

const IN_APP_BROWSER_RE =
  /micromessenger|xiaohongshu|redbook|xhsapp|xhswebview|\bxhs\b|discover\/|aweme|douyin|bytedancewebview|ttwebview|musical_ly|biliapp|bilibili|weibo|mqqbrowser|\bqq\/|qzone/i

const MOBILE_OR_TABLET_RE =
  /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet|harmonyos|silk|kindle/i

export function parseQualityParam(search: string = typeof location !== 'undefined' ? location.search : ''): Quality | null {
  const raw = new URLSearchParams(search).get('quality')
  if (raw === 'low' || raw === 'high') return raw
  return null
}

export function loadSavedQuality(): Quality | null {
  try {
    const raw = localStorage.getItem(QUALITY_STORAGE_KEY)
    if (raw === 'low' || raw === 'high') return raw
  } catch {
    // Ignore storage access errors in restricted WebViews.
  }
  return null
}

export function saveQualityPreference(quality: Quality): void {
  try {
    localStorage.setItem(QUALITY_STORAGE_KEY, quality)
  } catch {
    // Ignore storage quota or privacy mode errors.
  }
}

export function shouldDefaultLowQuality(): boolean {
  if (typeof navigator === 'undefined') return false

  const ua = navigator.userAgent || ''
  if (IN_APP_BROWSER_RE.test(ua)) return true

  const navWithHints = navigator as Navigator & {
    deviceMemory?: number
    userAgentData?: { mobile?: boolean }
  }
  if (navWithHints.userAgentData?.mobile === true) return true
  if (MOBILE_OR_TABLET_RE.test(ua)) return true
  if (/macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return true
  if (typeof navWithHints.deviceMemory === 'number' && navWithHints.deviceMemory > 0 && navWithHints.deviceMemory <= 4) {
    return true
  }

  return false
}

export function resolveInitialQuality(): Quality {
  const fromUrl = parseQualityParam()
  if (fromUrl) return fromUrl

  const saved = loadSavedQuality()
  if (saved) return saved

  return shouldDefaultLowQuality() ? 'low' : 'high'
}
