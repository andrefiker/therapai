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

// Post-D20 RLS migration: equals auth.users.id for andrefiker@gmail.com.
// Used as legacy fallback in app/debug/page.tsx and app/patients/[id]/page.tsx.
// New code should derive therapist id from auth via createSupabaseServer() instead.
// Old sentinel value (pre-D20): 'a0000000-0000-0000-0000-000000000001'.
export const THERAPIST_ID = '60fdab49-c4dd-45cc-9e2b-51bec3504d35'
