import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Demo-mode signup (2026-05-11): magic-link auth is open to anyone.
// Only André's email gets owner-therapist privileges (write access).
// Every other authenticated user lands in read-only evaluator view of the
// synthetic Dra. Demo tenant (see lib/viewer.ts).
//
// LGPD F8.1 (2026-05-13): error handling added around the Supabase auth
// exchanges. Failures previously redirected silently to /dashboard with no
// session, which middleware then bounced to /login — producing Mate's reported
// "click link, get sent back to email entry" loop. Now failures redirect
// explicitly to /login?error=<reason> so the user sees what happened and can
// request another link without confusion.
function loginUrl(origin: string, error: string): URL {
  const url = new URL(`${origin}/login`)
  url.searchParams.set('error', error)
  return url
}

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
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed', {
        message: error.message,
        status: error.status,
      })
      return NextResponse.redirect(loginUrl(origin, 'link_invalid_or_expired'))
    }
    return response
  }

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'email' | 'magiclink' | 'recovery' | 'invite' | 'signup',
    })
    if (error) {
      console.error('[auth/callback] verifyOtp failed', {
        message: error.message,
        status: error.status,
      })
      return NextResponse.redirect(loginUrl(origin, 'otp_invalid_or_expired'))
    }
    return response
  }

  return NextResponse.redirect(loginUrl(origin, 'missing_auth_params'))
}
