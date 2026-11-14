import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '') || ''
export const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || ''

export const isCloudConfigured = Boolean(supabaseUrl && supabaseAnonKey)

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!isCloudConfigured) {
    throw new Error('尚未配置云端地址或密钥（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。')
  }
  if (!client) {
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
