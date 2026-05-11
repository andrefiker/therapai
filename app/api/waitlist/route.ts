// app/api/waitlist/route.ts
//
// Public waitlist intake endpoint for the marketing landing.
// POST { email, name?, crp?, notes? } → insert into therapai_waitlist.
// Uses the anon client (RLS insert policy permits anon writes).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { email?: string; name?: string; crp?: string; notes?: string; consent?: boolean }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'invalid_email', message: 'Email inválido.' }, { status: 400 });
  }
  const name = clip(body.name, 120);
  const crp = clip(body.crp, 40);
  const notes = clip(body.notes, 500);

  if (body.consent !== true) {
    return NextResponse.json({ error: 'consent_required', message: 'Aceite dos termos é obrigatório.' }, { status: 400 });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return [] }, setAll() {} } },
  );

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null;
  const userAgent = clip(req.headers.get('user-agent'), 300);

  const now = new Date().toISOString();
  const { error } = await supabase.from('therapai_waitlist').insert({
    email,
    name: name || null,
    crp: crp || null,
    notes: notes || null,
    user_agent: userAgent || null,
    ip_hash: ipHash,
    consent_terms_at: now,
    consent_privacy_at: now,
    consent_dpa_at: now,
  });

  if (error) {
    // Unique-violation = already on list. Treat as success (idempotent UX).
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, status: 'already_on_list' });
    }
    console.error('[waitlist] insert failed', error);
    return NextResponse.json({ error: 'insert_failed', message: 'Não foi possível registrar agora. Tente novamente em instantes.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: 'added' });
}

function clip(v: string | null | undefined, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t;
}
