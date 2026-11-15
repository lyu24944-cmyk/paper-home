import type { SupabaseClient } from '@supabase/supabase-js'

export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '') || ''
export const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || ''

const isLocalSnapshotExport =
  typeof __LOCAL_SNAPSHOT_EXPORT__ !== 'undefined' && Boolean(__LOCAL_SNAPSHOT_EXPORT__)

export const isCloudConfigured = Boolean(!isLocalSnapshotExport && supabaseUrl && supabaseAnonKey)

let client: SupabaseClient | null = null

export async function getSupabaseClient(): Promise<SupabaseClient> {
  if (typeof __LOCAL_SNAPSHOT_EXPORT__ !== 'undefined' && __LOCAL_SNAPSHOT_EXPORT__) {
    throw new Error('静态导出模式不包含云端客户端。')
  }
  if (!isCloudConfigured) {
    throw new Error('尚未配置云端地址或密钥（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。')
  }
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  }
  return client
}
