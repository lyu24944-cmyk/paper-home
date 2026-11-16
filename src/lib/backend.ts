import { isCloudConfigured } from './supabase'
import type { BackendMode, LocalStudioHealth } from '../types/content'

export const LOCAL_OWNER_STORAGE_KEY = 'paper-home:local-owner-active'

let cachedHealth: LocalStudioHealth | null = null
let healthEpoch = 0
let inflightHealth: Promise<LocalStudioHealth> | null = null

export function invalidateBackendHealth() {
  healthEpoch++
  cachedHealth=null
  inflightHealth=null
}

export function isStaticSnapshotBuild(): boolean {
  return typeof __LOCAL_SNAPSHOT_EXPORT__ !== 'undefined' && Boolean(__LOCAL_SNAPSHOT_EXPORT__)
}

export async function resolveBackendHealth(force = false): Promise<LocalStudioHealth> {
  if (isStaticSnapshotBuild()) {
    return { mode: 'static-snapshot', writable: false, isLoopback: false, hasContent: true }
  }
  if (isCloudConfigured) {
    return { mode: 'cloud', writable: true, isLoopback: false, hasContent: true }
  }
  if (!force && cachedHealth) return cachedHealth
  if (!force && inflightHealth) return await inflightHealth

  const epoch=healthEpoch
  const task = (async () => {
    if (import.meta.env.DEV) {
      try {
        const res = await fetch('/__local-cms/health', { cache: 'no-store' })
        const ct = res.headers.get('content-type') || ''
        if (res.ok && ct.includes('application/json')) {
          const data = (await res.json()) as Record<string, unknown>
          if (data.ok === true && data.service === 'paper-home-local-cms') {
            const health: LocalStudioHealth = {
              mode: 'local-studio',
              writable: Boolean(data.writable),
              pinRequired: Boolean(data.pinRequired),
              isLoopback: Boolean(data.isLoopback),
              hasContent: Boolean(data.hasContent),
              dataDir: typeof data.dataDir === 'string' ? data.dataDir : 'local-data/',
            }
            if(epoch===healthEpoch)cachedHealth=health
            return health
          }
        }
      } catch {
        // Fall through to readonly mode if dev middleware is unavailable.
      }
    }

    const health:LocalStudioHealth = {
      mode: 'unconfigured-readonly',
      writable: false,
      isLoopback: false,
      hasContent: false,
    }
    if(epoch===healthEpoch)cachedHealth=health
    return health
  })()
  inflightHealth=task

  try {
    return await task
  } finally {
    if(inflightHealth===task)inflightHealth = null
  }
}

export async function getBackendMode(): Promise<BackendMode> {
  const h = await resolveBackendHealth()
  return h.mode
}

export function isLocalOwnerActive(): boolean {
  try {
    return sessionStorage.getItem(LOCAL_OWNER_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setLocalOwnerActive(active: boolean) {
  try {
    sessionStorage.removeItem('paper-home:local-pin')
    if (active) sessionStorage.setItem(LOCAL_OWNER_STORAGE_KEY, '1')
    else sessionStorage.removeItem(LOCAL_OWNER_STORAGE_KEY)
  } catch {
    // Ignore storage restrictions.
  }
}

export function getLocalHeaders(): Record<string,string> {
  return { 'X-Local-Owner':'1' }
}
