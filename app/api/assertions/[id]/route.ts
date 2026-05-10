// app/api/assertions/[id]/route.ts
//
// D25 F2+F5 — confirm/dismiss a pending patient memory assertion.
// POST body: { action: 'confirm' | 'dismiss' }
//
// RLS on therapai_patient_memory_assertions ensures a clinician can only
// modify their own tenant's assertions.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ActionBody { action?: 'confirm' | 'dismiss' }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: assertionId } = await params;
  if (!assertionId) return NextResponse.json({ error: 'missing_assertion_id' }, { status: 400 });

  let body: ActionBody;
  try { body = (await req.json()) as ActionBody; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  if (body.action !== 'confirm' && body.action !== 'dismiss') {
    return NextResponse.json({ error: 'invalid_action', message: 'action must be confirm or dismiss' }, { status: 400 });
  }

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date().toISOString();
  const update = body.action === 'confirm'
    ? { confirmed_by_clinician_at: now }
    : { dismissed_by_clinician_at: now };

  const { data, error } = await supabase
    .from('therapai_patient_memory_assertions')
    .update(update)
    .eq('id', assertionId)
    .is('confirmed_by_clinician_at', null)
    .is('dismissed_by_clinician_at', null)
    .select('id, dimension, sub_key, assertion_text, confirmed_by_clinician_at, dismissed_by_clinician_at')
    .maybeSingle();

  if (error) {
    console.error('[assertions] update failed', error);
    return NextResponse.json({ error: 'update_failed', message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found_or_already_acted' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, action: body.action, assertion: data });
}
