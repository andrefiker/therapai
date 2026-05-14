// app/api/auth/google/disconnect/route.ts
//
// POST: revoke the Google OAuth tokens for the authenticated tenant + delete
// the grant row. Returns 200 on success or 200 even if Google rejected the
// revoke (token already invalid is fine; local deletion is what matters).

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer, supabaseAdmin } from '@/lib/supabase';
import { getTherapist } from '@/lib/viewer';
import { revokeToken } from '@/lib/google-oauth';
import { audit, extractClientIp } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const therapist = await getTherapist(supabase, user);
  if (!therapist) return NextResponse.json({ error: 'tenant_not_provisioned' }, { status: 403 });

  // Fetch the grant via service-role so we can read the access_token to revoke it.
  const { data: grant } = await supabaseAdmin
    .from('therapai_therapist_oauth_grants')
    .select('access_token, refresh_token')
    .eq('therapist_id', therapist.id)
    .eq('provider', 'google')
    .maybeSingle();

  if (grant) {
    // Best-effort revoke of both tokens
    try { await revokeToken(grant.refresh_token ?? grant.access_token); } catch { /* idempotent */ }

    const { error } = await supabaseAdmin
      .from('therapai_therapist_oauth_grants')
      .delete()
      .eq('therapist_id', therapist.id)
      .eq('provider', 'google');
    if (error) {
      console.error('[oauth/google/disconnect] delete failed', error);
      return NextResponse.json({ error: 'delete_failed', message: error.message }, { status: 500 });
    }
  }

  audit(supabase, user.id, {
    action: 'oauth_revoked',
    target_table: 'therapai_therapist_oauth_grants',
    target_row_id: therapist.id,
    context: { provider: 'google' },
    ip: extractClientIp(req.headers),
    user_agent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ ok: true });
}
