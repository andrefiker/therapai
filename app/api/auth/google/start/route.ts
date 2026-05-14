// app/api/auth/google/start/route.ts
//
// Initiates Google OAuth for the authenticated therapist. Sets a state
// cookie that the callback validates before exchanging the code; redirects
// the browser to Google's consent screen.

import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createSupabaseServer } from '@/lib/supabase';
import { getTherapist } from '@/lib/viewer';
import { buildAuthUrl, isGoogleOAuthConfigured } from '@/lib/google-oauth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.json({
      error: 'oauth_not_configured',
      message: 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET ainda não estão configurados em produção. Operador precisa criar OAuth client no Google Cloud Console.',
    }, { status: 503 });
  }

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  const therapist = await getTherapist(supabase, user);
  if (!therapist) return NextResponse.redirect(new URL('/pending', req.url));

  // Random state bound to this therapist + a nonce. Stored in an HttpOnly
  // cookie the callback reads. Encoded as `<therapist_id>.<nonce>` so the
  // callback can verify both the bind and the freshness.
  const nonce = randomBytes(16).toString('hex');
  const state = `${therapist.id}.${nonce}`;

  const response = NextResponse.redirect(buildAuthUrl(state));
  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/auth/google',
    maxAge: 600, // 10 min
  });
  return response;
}
