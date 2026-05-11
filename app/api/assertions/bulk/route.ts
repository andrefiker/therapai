// app/api/assertions/bulk/route.ts
//
// D32 — bulk confirm/dismiss for patient memory assertions.
// POST body: { ids: string[], action: 'confirm' | 'dismiss' }
//
// RLS on therapai_patient_memory_assertions filters to this clinician's tenant;
// ids belonging to other tenants silently drop out of the update.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import { isOwner } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BulkBody { ids?: string[]; action?: 'confirm' | 'dismiss' }

const MAX_IDS = 100;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: BulkBody;
  try { body = (await req.json()) as BulkBody; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const action = body.action;
  if (action !== 'confirm' && action !== 'dismiss') {
    return NextResponse.json({ error: 'invalid_action', message: 'action must be confirm or dismiss' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'no_ids', message: 'ids array required' }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: 'too_many_ids', message: `max ${MAX_IDS} per request` }, { status: 400 });
  }

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: 'forbidden', message: 'Modo demonstração — somente leitura.' }, { status: 403 });

  const now = new Date().toISOString();
  const update = action === 'confirm'
    ? { confirmed_by_clinician_at: now }
    : { dismissed_by_clinician_at: now };

  const { data, error } = await supabase
    .from('therapai_patient_memory_assertions')
    .update(update)
    .in('id', ids)
    .is('confirmed_by_clinician_at', null)
    .is('dismissed_by_clinician_at', null)
    .select('id');

  if (error) {
    console.error('[assertions/bulk] update failed', error);
    return NextResponse.json({ error: 'update_failed', message: error.message }, { status: 500 });
  }

  const acted = data?.length ?? 0;
  return NextResponse.json({
    ok: true,
    action,
    requested: ids.length,
    acted,
    skipped: ids.length - acted,
  });
}
