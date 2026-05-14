// app/api/auth/google/callback/route.ts
//
// Receives Google's redirect after user grants consent. Validates state
// against the cookie, exchanges code for tokens, fetches user info to
// record which account granted access, upserts the grant row.

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer, supabaseAdmin } from '@/lib/supabase';
import { getTherapist } from '@/lib/viewer';
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  GOOGLE_SCOPES,
  isGoogleOAuthConfigured,
} from '@/lib/google-oauth';
import { audit, extractClientIp } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function settingsUrl(origin: string, status: 'connected' | 'error', detail?: string): URL {
  const url = new URL(`${origin}/settings`);
  url.searchParams.set('google', status);
  if (detail) url.searchParams.set('detail', detail);
  return url;
}

export async function GET(req: NextRequest) {
  const { origin, searchParams } = new URL(req.url);

  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(settingsUrl(origin, 'error', 'oauth_not_configured'));
  }

  const errorParam = searchParams.get('error');
  if (errorParam) {
    return NextResponse.redirect(settingsUrl(origin, 'error', errorParam));
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code || !state) {
    return NextResponse.redirect(settingsUrl(origin, 'error', 'missing_code_or_state'));
  }

  // Validate state against cookie
  const cookieState = req.cookies.get('google_oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(settingsUrl(origin, 'error', 'state_mismatch'));
  }

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(settingsUrl(origin, 'error', 'not_logged_in'));

  const therapist = await getTherapist(supabase, user);
  if (!therapist) return NextResponse.redirect(settingsUrl(origin, 'error', 'no_tenant'));

  // State encodes therapist_id.nonce — verify the therapist matches the logged-in user
  const [stateTherapistId] = state.split('.');
  if (stateTherapistId !== therapist.id) {
    return NextResponse.redirect(settingsUrl(origin, 'error', 'therapist_state_mismatch'));
  }

  // Exchange code for tokens
  let tokens;
  let userInfo;
  try {
    tokens = await exchangeCodeForTokens(code);
    userInfo = await fetchUserInfo(tokens.access_token);
  } catch (err) {
    console.error('[oauth/google/callback] token exchange failed', err);
    return NextResponse.redirect(settingsUrl(origin, 'error', 'token_exchange_failed'));
  }

  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();

  // Upsert grant row (service-role; tenants cannot INSERT)
  const { error: upsertErr } = await supabaseAdmin
    .from('therapai_therapist_oauth_grants')
    .upsert({
      therapist_id: therapist.id,
      provider: 'google',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: expiresAt,
      scopes: tokens.scope.split(' ').filter(Boolean),
      granted_email: userInfo.email,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'therapist_id,provider' });
  if (upsertErr) {
    console.error('[oauth/google/callback] grant upsert failed', upsertErr);
    return NextResponse.redirect(settingsUrl(origin, 'error', 'grant_save_failed'));
  }

  audit(supabase, user.id, {
    action: 'oauth_granted',
    target_table: 'therapai_therapist_oauth_grants',
    target_row_id: therapist.id,
    context: {
      provider: 'google',
      granted_email: userInfo.email,
      scopes: tokens.scope,
      requested_scopes: GOOGLE_SCOPES.join(' '),
    },
    ip: extractClientIp(req.headers),
    user_agent: req.headers.get('user-agent'),
  });

  const response = NextResponse.redirect(settingsUrl(origin, 'connected', userInfo.email));
  // Clear the state cookie
  response.cookies.set('google_oauth_state', '', { path: '/api/auth/google', maxAge: 0 });
  return response;
}
