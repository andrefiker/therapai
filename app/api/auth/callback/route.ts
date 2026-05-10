import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Closed-signup policy (2026-05-10): magic-link auth completes for any email,
// but a clinician tenant (therapai_therapists row) only exists for emails an
// admin has explicitly approved (manually inserted or promoted from waitlist).
// Unapproved emails: their auth session is signed out and they're routed to
// /pending. No automatic tenant creation. This keeps the marketing site public
// while preventing random sign-up of empty tenants on the production backend.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/dashboard'

  let response = NextResponse.redirect(`${origin}${next}`)

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

  let user: { id: string; email?: string } | null = null

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) user = data.user
  } else if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: type as 'email' | 'magiclink' | 'recovery' | 'invite' | 'signup' })
    if (!error && data.user) user = data.user
  } else {
    return NextResponse.redirect(`${origin}/login`)
  }

  if (!user || !user.email) {
    return response
  }

  const approved = await checkApprovedAndLinkAuth(user)

  if (!approved) {
    // Sign out the just-created session so they aren't in a tenant-less limbo,
    // and redirect to the pending page. The setAll cookie callback above writes
    // the cleared cookies into a fresh response we return.
    response = NextResponse.redirect(`${origin}/pending`)
    await supabase.auth.signOut()
    return response
  }

  return response
}

async function checkApprovedAndLinkAuth(user: { id: string; email?: string }): Promise<boolean> {
  if (!user.email) return false
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // D20 design: therapai_therapists.id IS auth.users.id (no separate auth_user_id column).
    // Two paths to approval:
    //   1) A row already exists where id = auth.uid() — happy path, returning therapist.
    //   2) A pre-provisioned row exists by email but with a placeholder id — admin staged it
    //      before the user's first login. We rewrite the id to auth.uid() so RLS works.
    //
    // No match on either → not approved → caller sends them to /pending.

    const { data: byId } = await admin
      .from('therapai_therapists')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()
    if (byId) return true

    const { data: byEmail } = await admin
      .from('therapai_therapists')
      .select('id')
      .eq('email', user.email)
      .maybeSingle()
    if (byEmail && byEmail.id !== user.id) {
      const { error: updErr } = await admin
        .from('therapai_therapists')
        .update({ id: user.id })
        .eq('id', byEmail.id)
      if (updErr) {
        console.error('[auth][approval-check] id realignment failed:', updErr)
        return false
      }
      return true
    }

    return false
  } catch (e) {
    console.error('[auth][approval-check] failed:', e)
    return false
  }
}
