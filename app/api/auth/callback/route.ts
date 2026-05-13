import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isInvited } from '@/lib/viewer'

// Multi-tenant pivot 2026-05-13: after a successful auth exchange, route the
// user based on tenant state:
//   - therapai_therapists row exists  → /dashboard
//   - invited on waitlist             → /onboarding
//   - neither                         → /pending
// LGPD F8.1: explicit /login?error=... on auth failure so users see what
// happened instead of looping back to the email field silently.

function loginUrl(origin: string, error: string): URL {
  const url = new URL(`${origin}/login`)
  url.searchParams.set('error', error)
  return url
}

async function resolveLandingPath(userId: string, email: string | null): Promise<string> {
  // Has a tenant row?
  const { data: therapist } = await supabaseAdmin
    .from('therapai_therapists')
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  if (therapist) return '/dashboard'

  // Invited?
  if (email && await isInvited(supabaseAdmin, email)) return '/onboarding'

  return '/pending'
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const nextOverride = searchParams.get('next')

  let response = NextResponse.redirect(`${origin}/dashboard`)

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
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed', { message: error.message, status: error.status })
      return NextResponse.redirect(loginUrl(origin, 'link_invalid_or_expired'))
    }
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'email' | 'magiclink' | 'recovery' | 'invite' | 'signup',
    })
    if (error) {
      console.error('[auth/callback] verifyOtp failed', { message: error.message, status: error.status })
      return NextResponse.redirect(loginUrl(origin, 'otp_invalid_or_expired'))
    }
  } else {
    return NextResponse.redirect(loginUrl(origin, 'missing_auth_params'))
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(loginUrl(origin, 'session_not_persisted'))

  const target = nextOverride ?? await resolveLandingPath(user.id, user.email ?? null)

  // Re-anchor the response onto the resolved target while preserving the set-cookie writes.
  const redirected = NextResponse.redirect(`${origin}${target}`)
  for (const c of response.cookies.getAll()) redirected.cookies.set(c)
  return redirected
}
