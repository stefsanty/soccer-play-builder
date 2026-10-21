import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabaseEnv, warnNotConfigured } from './config'

/** Server client, or null (with a console warning) when env vars are missing. */
export async function createClient() {
  const env = getSupabaseEnv()
  if (!env) {
    warnNotConfigured()
    return null
  }
  const cookieStore = await cookies()

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component — safe to ignore when
          // middleware is refreshing sessions.
        }
      },
    },
  })
}
