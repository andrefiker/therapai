import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/'

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
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      await ensureTherapist(data.user, origin, response)
    }
    return response
  }

  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: type as any })
    if (!error && data.user) {
      await ensureTherapist(data.user, origin, response)
    }
    return response
  }

  return NextResponse.redirect(`${origin}/login`)
}

async function ensureTherapist(user: any, origin: string, response: NextResponse) {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: existing } = await admin
      .from('therapai_therapists')
      .select('id, auth_user_id')
      .eq('email', user.email)
      .single()

    if (!existing) {
      await admin.from('therapai_therapists').insert({
        auth_user_id: user.id,
        name: user.email.split('@')[0],
        email: user.email,
        plan: 'trial',
        sessions_limit: 10,
      })
      response.headers.set('x-redirect-to', `${origin}/onboarding`)
    } else if (!existing.auth_user_id) {
      await admin.from('therapai_therapists')
        .update({ auth_user_id: user.id })
        .eq('email', user.email)
    }
  } catch (e) {
    console.error('ensureTherapist error:', e)
  }
}
