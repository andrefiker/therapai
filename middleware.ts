import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // 2026-05-13: all /api/* routes pass through middleware. Each route handler
  // performs its own auth check (typically returning 401 JSON for unauthenticated
  // callers), which is the correct contract for an API surface — middleware
  // redirecting /api/me/export to /login broke API ergonomics. Page routes
  // (/dashboard, /patients, /settings, /admin) still require auth via middleware.
  const isPublic =
    pathname === '/' ||
    pathname === '/pending' ||
    pathname === '/privacidade' ||
    pathname === '/termos' ||
    pathname === '/dpa' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/demo') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')

  // /onboarding lives outside (app)/ — it's the page where a tenant row gets
  // created, so it can't require a tenant row to enter. Middleware enforces
  // auth only; the page itself checks invite status.

  if (isPublic) return supabaseResponse

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
