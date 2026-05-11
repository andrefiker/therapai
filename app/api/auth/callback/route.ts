import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Demo-mode signup (2026-05-11): magic-link auth is open to anyone.
// Only André's email gets owner-therapist privileges (write access).
// Every other authenticated user lands in read-only evaluator view of
// André's tenant (see lib/viewer.ts + the dashboard query split).
//
// When real paying clinicians come online via /admin/waitlist, this will be
// revisited — at that point each clinician needs their own tenant restored.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/dashboard'

  const response = NextResponse.redirect(`${origin}${next}`)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  if (code) {
    await supabase.auth.exchangeCodeForSession(code)
    return response
  }

  if (token_hash && type) {
    await supabase.auth.verifyOtp({ token_hash, type: type as 'email' | 'magiclink' | 'recovery' | 'invite' | 'signup' })
    return response
  }

  return NextResponse.redirect(`${origin}/login`)
}
