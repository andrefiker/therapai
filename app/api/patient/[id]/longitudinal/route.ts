// app/api/patient/[id]/longitudinal/route.ts
//
// On-demand longitudinal report rebuild. Replaces the prior auto-rebuild
// (was step 5 of runFullAnalysisPipeline). André's call 2026-05-15: don't
// burn inference on every session ingest; rebuild only when the clinician
// asks via the patient-page button.
//
// Auth: createSupabaseServer() → RLS-filtered. The rebuild itself uses the
// same RLS-aware client passed to rebuildLongitudinalForPatient(), so a
// clinician can only rebuild for their own patients.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import { getTherapist } from '@/lib/viewer';
import { rebuildLongitudinalForPatient } from '@/lib/ingest';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: patientId } = await params;
  if (!patientId) return NextResponse.json({ error: 'missing_patient_id' }, { status: 400 });

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const therapist = await getTherapist(supabase, user);
  if (!therapist) return NextResponse.json({ error: 'forbidden', message: 'Tenant não provisionado.' }, { status: 403 });

  // RLS will block this if the patient isn't visible to the current therapist.
  const { data: patient } = await supabase
    .from('therapai_patients')
    .select('id, name')
    .eq('id', patientId)
    .maybeSingle();
  if (!patient) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    await rebuildLongitudinalForPatient(supabase, therapist.id, patient.id);
  } catch (err) {
    console.error('[patient/longitudinal] rebuild failed', err);
    return NextResponse.json({
      ok: false,
      error: 'rebuild_failed',
      message: (err as Error).message ?? 'Falha ao gerar relatório longitudinal.',
    }, { status: 500 });
  }

  // Return the freshly-rebuilt row so the UI can render it immediately.
  const { data: longitudinal } = await supabase
    .from('therapai_longitudinal')
    .select('report_md, sessions_count, period_start, period_end, updated_at')
    .eq('patient_id', patient.id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    patient_name: patient.name,
    longitudinal,
    rebuilt_at: new Date().toISOString(),
  });
}
