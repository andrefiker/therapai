import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createSupabaseServer() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Post-D20 + frontend RLS refactor: THERAPIST_ID constant retired.
// Read-side queries use createSupabaseServer() (auth-aware, RLS filters by auth.uid).
// Write-side ingest (webhook, onboarding) uses supabaseAdmin (service_role bypasses RLS).
// Webhook uses its own ANDRE_THERAPIST_ID local constant scoped to that file.
//
// To restore for legacy code: const THERAPIST_ID = '60fdab49-c4dd-45cc-9e2b-51bec3504d35'
