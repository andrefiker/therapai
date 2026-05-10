// app/api/patient/[id]/memory/route.ts
//
// D25 F2+F5 — returns the patient memory state for a given patient.
// Two payloads in one response:
//   confirmed: latest confirmed assertion per (dimension, sub_key) — the canonical state
//   pending:   assertions awaiting clinician confirmation
//
// RLS gates which patient is visible. If the patient isn't in this user's tenant,
// queries return empty rows → response shows nothing → 404 returned to client.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';

export const runtime = 'nodejs';
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: patientId } = await params;
  if (!patientId) return NextResponse.json({ error: 'missing_patient_id' }, { status: 400 });

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Confirm patient is visible (RLS will hide it otherwise).
  const { data: patient } = await supabase
    .from('therapai_patients')
    .select('id, name')
    .eq('id', patientId)
    .maybeSingle();
  if (!patient) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Confirmed state via the SQL function.
  const [{ data: confirmedRows, error: stateErr }, { data: pendingRows, error: pendingErr }] = await Promise.all([
    supabase.rpc('therapai_patient_state', { p_patient_id: patientId }),
    supabase
      .from('therapai_patient_memory_assertions')
      .select('id, dimension, sub_key, assertion_text, structured_value, source_session_id, source_kind, model_emitted, confidence, requires_confirmation, created_at')
      .eq('patient_id', patientId)
      .is('confirmed_by_clinician_at', null)
      .is('dismissed_by_clinician_at', null)
      .is('superseded_by_id', null)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (stateErr) console.error('[memory][state] rpc failed', stateErr);
  if (pendingErr) console.error('[memory][pending] query failed', pendingErr);

  return NextResponse.json({
    ok: true,
    patient_id: patient.id,
    patient_name: patient.name,
    confirmed: confirmedRows ?? [],
    pending: pendingRows ?? [],
  });
}
