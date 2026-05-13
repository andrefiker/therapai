// app/api/admin/approve-waitlist/route.ts
//
// Admin-only: mark a therapai_waitlist row as invited. The user can then log
// in with magic-link, hit /onboarding (callback resolves landing path based
// on invited_at), fill name + clinical_lens + ingest_source, and the
// /api/onboarding POST inserts their therapai_therapists row with
// id = auth.uid() (RLS contract).
//
// Multi-tenant pivot 2026-05-13: replaces the prior "approve creates a
// therapists row with a random UUID" flow, which produced rows whose id
// never matched auth.uid() and therefore failed every RLS check.
//
// Stripe customer creation is left as a separate concern — the trial-tier
// tester doesn't need a Stripe customer; that comes at paid upgrade time.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import { isAdminEmail } from '@/lib/admin';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { waitlist_id?: string }

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const waitlistId = body.waitlist_id?.trim();
  if (!waitlistId) {
    return NextResponse.json({ error: 'missing_waitlist_id' }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: w, error: wErr } = await admin
    .from('therapai_waitlist')
    .select('id, email, name, invited_at')
    .eq('id', waitlistId)
    .maybeSingle();
  if (wErr || !w) {
    return NextResponse.json({ error: 'waitlist_not_found', message: wErr?.message }, { status: 404 });
  }

  if (w.invited_at) {
    return NextResponse.json({
      ok: true,
      already_invited: true,
      invited_at: w.invited_at,
      message: `${w.email} já estava convidado(a) em ${w.invited_at}.`,
    });
  }

  const now = new Date().toISOString();
  const { error: updErr } = await admin
    .from('therapai_waitlist')
    .update({ invited_at: now })
    .eq('id', waitlistId);
  if (updErr) {
    return NextResponse.json({ error: 'update_failed', message: updErr.message }, { status: 500 });
  }

  // Audit
  await admin.from('therapai_audit_log').insert({
    actor_user_id: user.id,
    action: 'admin_invited_waitlist',
    target_table: 'therapai_waitlist',
    target_row_id: waitlistId,
    context: { invited_email: w.email, invited_name: w.name },
  });

  return NextResponse.json({
    ok: true,
    invited_email: w.email,
    invited_at: now,
    next_step: `Envie ${w.email} para fazer login pelo site — entrarão direto no /onboarding e se provisionarão.`,
  });
}
