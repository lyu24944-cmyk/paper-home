import { createContext, useContext } from 'react'

export type Locale = 'zh' | 'en'

const LOCALE_STORAGE_KEY = 'paper-home:locale'

export function isValidLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en'
}

export function resolveInitialLocale(): Locale {
  try {
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('lang')
    if (isValidLocale(fromQuery)) return fromQuery
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isValidLocale(saved)) return saved
  } catch {
    // Ignore storage/URL access errors in restricted environments.
  }
  return 'zh'
}

export function saveLocalePreference(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Ignore storage errors.
  }
}

export interface I18nContextValue {
  locale: Locale
  setLocale: (next: Locale) => void
  toggleLocale: () => void
  tr: (zh: string, en: string) => string
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  setLocale: () => {},
  toggleLocale: () => {},
  tr: (zh) => zh,
})

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
