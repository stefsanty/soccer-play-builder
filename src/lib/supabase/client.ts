import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv, warnNotConfigured } from './config'

/** Browser client, or null (with a console warning) when env vars are missing. */
export function createClient() {
  const env = getSupabaseEnv()
  if (!env) {
    warnNotConfigured()
    return null
  }
  return createBrowserClient(env.url, env.anonKey)
}
