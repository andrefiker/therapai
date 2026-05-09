import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabaseResponse = NextResponse.redirect(`${origin}/`)
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      // Create therapist record if first login
      const admin = (await import('@/lib/supabase')).supabaseAdmin
      const { data: existing } = await admin
        .from('therapai_therapists')
        .select('id')
        .eq('email', data.user.email!)
        .single()

      if (!existing) {
        await admin.from('therapai_therapists').insert({
          auth_user_id: data.user.id,
          name: data.user.email!.split('@')[0],
          email: data.user.email!,
          plan: 'trial',
          sessions_limit: 10,
        })
        return NextResponse.redirect(`${origin}/onboarding`)
      } else {
        // Update auth_user_id if missing
        await admin.from('therapai_therapists')
          .update({ auth_user_id: data.user.id })
          .eq('email', data.user.email!)
          .is('auth_user_id', null)
      }
    }
    return supabaseResponse
  }

  return NextResponse.redirect(`${origin}/login`)
}
